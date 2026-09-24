/**
 * Presence Manager
 * Tracks which users are online and in which rooms
 */
class PresenceManager {
  constructor() {
    this.users = new Map(); // userId -> { username, socketId, rooms: [], lastSeen }
  }

  /**
   * Get online users for API (id, username, roles)
   * @returns {array}
   */
  getOnlineUsers() {
    // For each user, try to get roles from socketUsers if available, else default to ['user']
    return Array.from(this.users.entries()).map(([userId, user]) => ({
      id: userId,
      username: user.username,
      roles: user.roles || ['user'],
    }));
  }

  /**
   * User came online
   * @param {string} userId - User ID
   * @param {string} username - Username
   * @param {string} socketId - Socket.io socket ID
   * @param {array} roles - User roles
   */
  userOnline(userId, username, socketId, roles = ['user']) {
    this.users.set(userId, {
      username,
      socketId,
      roles,
      rooms: [],
      lastSeen: new Date(),
      status: 'online',
    });
  }

  /**
   * User went offline
   * @param {string} userId - User ID
   * @returns {object|null} User info that was removed
   */
  userOffline(userId) {
    const user = this.users.get(userId);
    if (user) {
      this.users.delete(userId);
      return user;
    }
    return null;
  }

  /**
   * User joined a room
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   */
  userJoinedRoom(userId, roomId) {
    const user = this.users.get(userId);
    if (user && !user.rooms.includes(roomId)) {
      user.rooms.push(roomId);
      user.lastSeen = new Date();
    }
  }

  /**
   * User left a room
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   */
  userLeftRoom(userId, roomId) {
    const user = this.users.get(userId);
    if (user) {
      user.rooms = user.rooms.filter((r) => r !== roomId);
      if (user.rooms.length === 0) {
        this.users.delete(userId);
      }
    }
  }

  /**
   * Get all online users
   * @returns {array} Array of { userId, username, rooms }
   */
  getAllOnlineUsers() {
    return Array.from(this.users.entries()).map(([userId, user]) => ({
      userId,
      username: user.username,
      rooms: user.rooms,
      status: user.status,
    }));
  }

  /**
   * Get online users in a specific room
   * @param {string} roomId - Room ID
   * @returns {array} Array of { userId, username }
   */
  getOnlineUsersInRoom(roomId) {
    return Array.from(this.users.entries())
      .filter(([, user]) => user.rooms.includes(roomId))
      .map(([userId, user]) => ({
        userId,
        username: user.username,
        status: user.status,
      }));
  }

  /**
   * Get a single user's presence info
   * @param {string} userId - User ID
   * @returns {object|null}
   */
  getUser(userId) {
    const user = this.users.get(userId);
    if (!user) return null;

    return {
      userId,
      username: user.username,
      rooms: user.rooms,
      status: user.status,
      lastSeen: user.lastSeen,
    };
  }

  /**
   * Find an online user by ID, tolerating number/string mismatches
   * (phpBB IDs are numbers, but clients may send them back as strings)
   * @param {string|number} userId - User ID
   * @returns {{ id: string|number, username: string }|null}
   */
  findOnlineUser(userId) {
    for (const [id, user] of this.users) {
      if (String(id) === String(userId)) {
        return { id, username: user.username };
      }
    }
    return null;
  }

  /**
   * Check if user is online
   * @param {string} userId - User ID
   * @returns {boolean}
   */
  isOnline(userId) {
    return this.users.has(userId);
  }

  /**
   * Clear all presence data (useful for testing)
   */
  clear() {
    this.users.clear();
  }
}

module.exports = new PresenceManager();
