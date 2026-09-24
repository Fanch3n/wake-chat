const config = require('../config');
const phpbbClient = require('../auth/phpbb-client');
const { RoomManager } = require('./room-manager');
const presenceManager = require('./presence');

const MAX_ROOM_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_TOKEN_LENGTH = 256;

/**
 * Personal Socket.io room for a user. Uses ':' which is not allowed in
 * chat room IDs, so a chat room can never collide with a personal room.
 */
const personalRoom = (userId) => `user:${userId}`;

/**
 * Validate a client-supplied room ID
 * @param {*} roomId
 * @returns {boolean}
 */
function isValidRoomId(roomId) {
  return (
    typeof roomId === 'string' &&
    roomId.length > 0 &&
    roomId.length <= MAX_ROOM_ID_LENGTH &&
    roomId === roomId.trim() &&
    !/[\x00-\x1f\x7f:]/.test(roomId)
  );
}

/**
 * Canonical DM room ID for two users, independent of who starts the DM
 */
function dmRoomId(userIdA, userIdB) {
  const ids = [String(userIdA), String(userIdB)].sort();
  return `dm_${ids[0]}_${ids[1]}`;
}

/**
 * Wrap a socket event handler so malformed client input can never crash the
 * process: the payload is always an object, the ack is always callable, and
 * sync throws / async rejections are caught and reported to the client.
 * @param {string} event - Event name (for logging)
 * @param {Function} fn - (data, ack) => void|Promise<void>
 */
function safeHandler(event, fn) {
  return async (data, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const payload = data !== null && typeof data === 'object' ? data : {};
    try {
      await fn(payload, ack);
    } catch (error) {
      console.error(`[Socket] Error handling "${event}":`, error);
      ack({ success: false, error: 'Internal server error' });
    }
  };
}

/**
 * Generate a random guest username
 */
function generateRandomUsername() {
  const adjectives = ['Happy', 'Clever', 'Quick', 'Bright', 'Swift', 'Bold', 'Calm', 'Wise'];
  const animals = ['Panda', 'Eagle', 'Tiger', 'Fox', 'Hawk', 'Bear', 'Wolf', 'Lion'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${animal}${num}`;
}

/**
 * Find the phpBB session ID in the handshake cookies
 * @param {string|undefined} cookieHeader
 * @returns {string|null}
 */
function getSessionIdFromCookies(cookieHeader) {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    // Default phpBB3 cookies end in _sid
    if (part.substring(0, index).trim().endsWith('_sid')) {
      try {
        return decodeURIComponent(part.substring(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Initialize Socket.io event handlers
 * @param {Server} io - Socket.io server instance
 */
function initializeSocketEvents(io) {
  // Store active socket connections: socketId -> { userId, username, roles }
  const socketUsers = new Map();

  io.on('connection', (socket) => {
    console.log(`[Socket] New connection: ${socket.id}`);

    const getUser = () => socketUsers.get(socket.id);

    /**
     * Register an event that requires an authenticated user.
     * The handler receives (data, ack, user).
     */
    const onAuthenticated = (event, fn) => {
      socket.on(event, safeHandler(event, (data, ack) => {
        const user = getUser();
        if (!user) {
          return ack({ success: false, error: 'Not authenticated' });
        }
        return fn(data, ack, user);
      }));
    };

    /**
     * Mark the socket as authenticated and announce the user
     */
    const completeAuthentication = (user, ack) => {
      socketUsers.set(socket.id, user);
      presenceManager.userOnline(user.id, user.username, socket.id, user.roles);
      socket.join(personalRoom(user.id));

      console.log(`[Socket] User authenticated: ${user.username} (${socket.id})`);

      // Notify all clients of new user online
      io.emit('user-online', {
        userId: user.id,
        username: user.username,
        timestamp: new Date(),
      });

      ack({
        success: true,
        user: { id: user.id, username: user.username, roles: user.roles },
      });
    };

    // ============================================
    // AUTHENTICATION
    // ============================================

    /**
     * Event: authenticate
     * Validates phpBB session ID (explicit token or cookie), or logs in as guest
     */
    socket.on('authenticate', safeHandler('authenticate', async (data, ack) => {
      const existingUser = getUser();
      if (existingUser) {
        // Re-authenticating would leave stale presence entries behind
        return ack({
          success: true,
          user: { id: existingUser.id, username: existingUser.username, roles: existingUser.roles },
        });
      }

      // GUEST MODE: Auto-authenticate with random username if requested
      if (data.isGuest === true) {
        if (!config.allowGuests) {
          return ack({ success: false, error: 'Guest login is disabled on this server.' });
        }

        return completeAuthentication(
          { id: socket.id, username: generateRandomUsername(), roles: ['user'] },
          ack
        );
      }

      let token = data.token;
      if (token !== undefined && token !== null && token !== '' && typeof token !== 'string') {
        return ack({ success: false, error: 'Invalid session ID' });
      }
      if (!token) {
        token = getSessionIdFromCookies(socket.handshake.headers.cookie);
      }

      if (!token) {
        return ack({ success: false, error: 'Authentication required. Please provide a valid session ID or join as a guest.' });
      }
      if (token.length > MAX_TOKEN_LENGTH) {
        return ack({ success: false, error: 'Invalid session ID' });
      }

      const result = await phpbbClient.validateToken(token);

      if (!result.valid) {
        socket.emit('error', { message: result.error });
        return ack({ success: false, error: result.error });
      }

      // The socket may have disconnected or authenticated while we awaited phpBB
      if (socket.disconnected || getUser()) {
        return ack({ success: false, error: 'Connection state changed during authentication' });
      }

      completeAuthentication(
        { id: result.id, username: result.username, roles: result.roles },
        ack
      );
    }));

    // ============================================
    // ROOM MANAGEMENT
    // ============================================

    /**
     * Resolve (and create if needed) the room a join-room request targets.
     * @returns {{ room?: ChatRoom, error?: string }}
     */
    const resolveRoomForJoin = (data, user) => {
      // Direct messages: the room ID and its members are derived server-side
      if (data.dmWith !== undefined) {
        if (typeof data.dmWith !== 'string' && typeof data.dmWith !== 'number') {
          return { error: 'Invalid DM target' };
        }
        if (String(data.dmWith) === String(user.id)) {
          return { error: 'You cannot message yourself' };
        }

        const target = presenceManager.findOnlineUser(data.dmWith);
        if (!target) {
          return { error: 'User is not online' };
        }

        const roomId = dmRoomId(user.id, target.id);
        const existing = RoomManager.getRoom(roomId);
        if (existing) return { room: existing };

        return {
          room: RoomManager.createRoom(roomId, `DM: ${user.username} & ${target.username}`, {
            createdBy: user.id,
            isDirectMessage: true,
            isPrivate: true,
            dmUsers: [String(user.id), String(target.id)],
          }),
        };
      }

      const roomId = data.roomId;
      if (!isValidRoomId(roomId)) {
        return { error: 'Invalid room ID' };
      }

      const existing = RoomManager.getRoom(roomId);
      if (existing) return { room: existing };

      // DM rooms can only be created via dmWith, never from a client-chosen ID
      if (roomId.startsWith('dm_')) {
        return { error: 'Room not found' };
      }

      if (!config.allowRoomCreation && roomId !== 'public') {
        return { error: 'Room creation is disabled' };
      }

      const roomName = roomId === 'public' ? 'Public' : `Room: ${roomId}`;
      return { room: RoomManager.createRoom(roomId, roomName, { createdBy: user.id }) };
    };

    /**
     * Event: join-room
     * User joins a chat room ({ roomId }) or opens a DM ({ dmWith: userId })
     */
    onAuthenticated('join-room', (data, ack, user) => {
      const { room, error } = resolveRoomForJoin(data, user);
      if (error) {
        return ack({ success: false, error });
      }

      // Check permissions
      if (!room.canUserJoin(user)) {
        return ack({
          success: false,
          error: 'You do not have permission to join this room',
        });
      }

      const alreadyInRoom = room.users.has(user.id);

      // Add user to room
      const added = room.addUser(user.id, user.username, user.roles, socket.id);
      if (!added) {
        return ack({ success: false, error: 'Failed to join room' });
      }

      // Join Socket.io room
      socket.join(room.id);

      // Track user's room
      presenceManager.userJoinedRoom(user.id, room.id);

      console.log(`[Room] ${user.username} joined ${room.id} (wasAlreadyInRoom: ${alreadyInRoom})`);

      if (!alreadyInRoom) {
        // Notify room members
        io.to(room.id).emit('user-joined-room', {
          roomId: room.id,
          userId: user.id,
          username: user.username,
          timestamp: new Date(),
        });

        // Update room list globally for all users
        io.emit('rooms-updated');
      }

      // Send room info to user
      ack({
        success: true,
        room: {
          id: room.id,
          name: room.name,
          users: room.getUsers(),
          recentMessages: room.getRecentMessages(50),
        },
      });
    });

    /**
     * Event: leave-room
     * User leaves a chat room
     */
    onAuthenticated('leave-room', (data, ack, user) => {
      const roomId = data.roomId;
      const room = isValidRoomId(roomId) ? RoomManager.getRoom(roomId) : null;

      if (!room || !room.users.has(user.id)) {
        return ack({ success: false, error: 'Room not found' });
      }

      // Remove user from room
      room.removeUser(user.id);
      presenceManager.userLeftRoom(user.id, roomId);

      // Leave Socket.io room
      socket.leave(roomId);

      console.log(`[Room] ${user.username} left ${roomId}`);

      // Notify room members
      io.to(roomId).emit('user-left-room', {
        roomId,
        userId: user.id,
        username: user.username,
        timestamp: new Date(),
      });

      // Delete empty rooms (optional)
      if (room.users.size === 0) {
        RoomManager.deleteRoom(roomId);
      }

      ack({ success: true });

      // Update room list globally for all users
      io.emit('rooms-updated');
    });

    /**
     * Event: get-rooms
     * Get rooms accessible by the user
     */
    onAuthenticated('get-rooms', (data, ack, user) => {
      // This will only return public rooms and private/DM rooms the user is allowed to join
      const rooms = RoomManager.getAccessibleRooms(user).map((r) => {
        const roomInstance = RoomManager.getRoom(r.id);
        return {
          ...r,
          isJoined: roomInstance ? roomInstance.users.has(user.id) : false,
        };
      });
      ack({ success: true, rooms });
    });

    // ============================================
    // MESSAGING
    // ============================================

    /**
     * Get a room the user is currently a member of
     * @returns {ChatRoom|null}
     */
    const getJoinedRoom = (roomId, user) => {
      if (!isValidRoomId(roomId)) return null;
      const room = RoomManager.getRoom(roomId);
      return room && room.users.has(user.id) ? room : null;
    };

    /**
     * Event: send-message
     * Send a message to a room the user has joined
     */
    onAuthenticated('send-message', (data, ack, user) => {
      const roomId = data.roomId;
      const room = getJoinedRoom(roomId, user);

      if (!room) {
        return ack({ success: false, error: 'You are not a member of this room' });
      }

      if (typeof data.text !== 'string' || data.text.trim().length === 0) {
        return ack({ success: false, error: 'Message cannot be empty' });
      }

      // Safeguard against gigantic payloads locking up the server or crashing clients
      const trimmedText = data.text.trim();
      if (trimmedText.length > MAX_MESSAGE_LENGTH) {
        return ack({ success: false, error: `Message is too long (maximum ${MAX_MESSAGE_LENGTH} characters)` });
      }

      // Add message to room
      const message = room.addMessage({
        userId: user.id,
        username: user.username,
        text: trimmedText,
      });

      console.log(`[Message] ${user.username} in ${roomId}: ${trimmedText.substring(0, 50)}`);

      // Broadcast message to room
      io.to(roomId).emit('message-received', {
        roomId,
        message,
      });

      // If it is a Direct Message, notify the other user directly in case they don't have the room open
      if (room.isDirectMessage) {
        const otherUserId = room.dmUsers.find((uid) => uid !== String(user.id));
        if (otherUserId) {
          io.to(personalRoom(otherUserId)).emit('dm-received', {
            roomId,
            message,
            fromUser: { id: user.id, username: user.username },
          });
        }
      }

      ack({ success: true, message });
    });

    /**
     * Event: typing-indicator
     * Broadcast typing status to a joined room
     */
    onAuthenticated('typing-indicator', (data, ack, user) => {
      const room = getJoinedRoom(data.roomId, user);
      if (!room) return;

      // Broadcast to others in room (exclude sender)
      socket.to(room.id).emit('user-typing', {
        roomId: room.id,
        userId: user.id,
        username: user.username,
      });
    });

    /**
     * Event: typing-stop
     * User stopped typing
     */
    onAuthenticated('typing-stop', (data, ack, user) => {
      const room = getJoinedRoom(data.roomId, user);
      if (!room) return;

      socket.to(room.id).emit('user-stopped-typing', {
        roomId: room.id,
        userId: user.id,
      });
    });

    // ============================================
    // PRESENCE & STATUS
    // ============================================

    /**
     * Get a room the user is allowed to see
     * @returns {ChatRoom|null}
     */
    const getVisibleRoom = (roomId, user) => {
      if (!isValidRoomId(roomId)) return null;
      const room = RoomManager.getRoom(roomId);
      return room && room.canUserJoin(user) ? room : null;
    };

    /**
     * Event: get-room-info
     * Get details of a room explicitly (for switching rooms on client)
     */
    onAuthenticated('get-room-info', (data, ack, user) => {
      const room = getVisibleRoom(data.roomId, user);
      if (!room) return ack({ success: false, error: 'Room not found' });

      ack({
        success: true,
        room: {
          id: room.id,
          name: room.name,
          users: room.getUsers(),
          recentMessages: room.getRecentMessages(50),
        },
      });
    });

    /**
     * Event: get-online-users
     * Get online users (all or in a specific room)
     */
    onAuthenticated('get-online-users', (data, ack, user) => {
      if (data.roomId === undefined || data.roomId === null) {
        return ack({ success: true, users: presenceManager.getAllOnlineUsers() });
      }

      const room = getVisibleRoom(data.roomId, user);
      if (!room) return ack({ success: false, error: 'Room not found' });

      ack({ success: true, users: presenceManager.getOnlineUsersInRoom(room.id) });
    });

    // ============================================
    // DISCONNECT
    // ============================================

    socket.on('disconnect', () => {
      const user = socketUsers.get(socket.id);

      if (user) {
        console.log(
          `[Socket] User disconnected: ${user.username} (${socket.id})`
        );

        // Remove from all rooms
        const userRooms = presenceManager.getUser(user.id)?.rooms || [];
        for (const roomId of userRooms) {
          const room = RoomManager.getRoom(roomId);
          if (room) {
            room.removeUser(user.id);
            io.to(roomId).emit('user-left-room', {
              roomId,
              userId: user.id,
              username: user.username,
              timestamp: new Date(),
            });

            // Delete empty rooms
            if (room.users.size === 0) {
              RoomManager.deleteRoom(roomId);
            }
          }
        }

        // Notify clients about room changes (counters)
        io.emit('rooms-updated');

        // Remove from presence
        presenceManager.userOffline(user.id);

        // Notify all clients
        io.emit('user-offline', {
          userId: user.id,
          username: user.username,
          timestamp: new Date(),
        });

        socketUsers.delete(socket.id);
      }
    });

    /**
     * Event: error handler
     */
    socket.on('error', (error) => {
      console.error(`[Socket] Error from ${socket.id}:`, error);
    });
  });
}

module.exports = { initializeSocketEvents };
