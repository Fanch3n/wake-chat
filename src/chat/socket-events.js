const config = require('../config');
const phpbbClient = require('../auth/phpbb-client');
const { RoomManager } = require('./room-manager');
const presenceManager = require('./presence');
const {
  MAX_MESSAGE_LENGTH,
  MAX_TOKEN_LENGTH,
  personalRoom,
  isValidRoomId,
  dmRoomId,
  safeHandler,
  generateRandomUsername,
  getSessionIdFromCookies,
} = require('./helpers');

/**
 * Initialize Socket.io event handlers
 * @param {Server} io - Socket.io server instance
 */
function initializeSocketEvents(io) {
  /**
   * Remove a user from a room, notify the room and the user's own sockets
   * (other tabs), and delete the room once it is empty
   */
  const removeUserFromRoom = (room, user) => {
    room.removeUser(user.id);
    io.in(personalRoom(user.id)).socketsLeave(room.id);

    io.to(room.id).to(personalRoom(user.id)).emit('user-left-room', {
      roomId: room.id,
      userId: user.id,
      username: user.username,
      timestamp: new Date(),
    });

    if (room.users.size === 0) {
      RoomManager.deleteRoom(room.id);
    }
  };

  io.on('connection', (socket) => {
    console.log(`[Socket] New connection: ${socket.id}`);

    // The authenticated user of this socket: { id, username, roles }
    const getUser = () => socket.data.user;

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
      socket.data.user = user;
      socket.join(personalRoom(user.id));

      // Another tab of a user who is already online joins the rooms they are in
      for (const roomId of RoomManager.getUserRooms(user.id)) {
        socket.join(roomId);
      }

      const cameOnline = presenceManager.addSocket(user, socket.id);
      console.log(`[Socket] User authenticated: ${user.username} (${socket.id})`);

      if (cameOnline) {
        // Notify all clients of new user online
        io.emit('user-online', {
          userId: user.id,
          username: user.username,
          timestamp: new Date(),
        });
      }

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
     * Get a room the user is currently a member of
     * @returns {ChatRoom|null}
     */
    const getJoinedRoom = (roomId, user) => {
      if (!isValidRoomId(roomId)) return null;
      const room = RoomManager.getRoom(roomId);
      return room && room.users.has(user.id) ? room : null;
    };

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

      const roomName = roomId === 'public' ? 'Public' : roomId;
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
      const added = room.addUser(user.id, user.username, user.roles);
      if (!added) {
        return ack({ success: false, error: 'Failed to join room' });
      }

      // Membership is per user, so all of the user's sockets (tabs) join
      io.in(personalRoom(user.id)).socketsJoin(room.id);

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
      const room = getJoinedRoom(data.roomId, user);
      if (!room) {
        return ack({ success: false, error: 'Room not found' });
      }

      removeUserFromRoom(room, user);
      console.log(`[Room] ${user.username} left ${room.id}`);

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
      const rooms = RoomManager.getAccessibleRooms(user).map((r) => ({
        ...r,
        isJoined: RoomManager.getRoom(r.id).users.has(user.id),
      }));
      ack({ success: true, rooms });
    });

    // ============================================
    // MESSAGING
    // ============================================

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
        return ack({ success: true, users: presenceManager.getOnlineUsers() });
      }

      const room = getVisibleRoom(data.roomId, user);
      if (!room) return ack({ success: false, error: 'Room not found' });

      const users = room.getUsers().map(({ userId, username }) => ({ userId, username }));
      ack({ success: true, users });
    });

    // ============================================
    // DISCONNECT
    // ============================================

    socket.on('disconnect', () => {
      const user = getUser();
      if (!user) return;

      console.log(`[Socket] User disconnected: ${user.username} (${socket.id})`);

      // The user stays online (and in their rooms) while another tab is open
      if (!presenceManager.removeSocket(user.id, socket.id)) return;

      for (const roomId of RoomManager.getUserRooms(user.id)) {
        removeUserFromRoom(RoomManager.getRoom(roomId), user);
      }

      // Notify clients about room changes (counters)
      io.emit('rooms-updated');

      // Notify all clients
      io.emit('user-offline', {
        userId: user.id,
        username: user.username,
        timestamp: new Date(),
      });
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
