/**
 * Presence Manager
 * Tracks which users are online. A user can be connected with several sockets
 * at once (e.g. one per browser tab) and stays online until the last one
 * disconnects. Room membership is tracked by the rooms themselves.
 */
class PresenceManager {
  constructor() {
    this.users = new Map(); // userId -> { username, sockets: Set<socketId> }
  }

  /**
   * Register a connected socket for a user
   * @param {object} user - { id, username }
   * @param {string} socketId - Socket.io socket ID
   * @returns {boolean} True if the user just came online (first socket)
   */
  addSocket(user, socketId) {
    const existing = this.users.get(user.id);
    if (existing) {
      existing.sockets.add(socketId);
      return false;
    }

    this.users.set(user.id, { username: user.username, sockets: new Set([socketId]) });
    return true;
  }

  /**
   * Unregister a disconnected socket
   * @param {string|number} userId - User ID
   * @param {string} socketId - Socket.io socket ID
   * @returns {boolean} True if the user went offline (last socket closed)
   */
  removeSocket(userId, socketId) {
    const user = this.users.get(userId);
    if (!user) return false;

    user.sockets.delete(socketId);
    if (user.sockets.size > 0) return false;

    this.users.delete(userId);
    return true;
  }

  /**
   * Get all online users
   * @returns {array} Array of { userId, username }
   */
  getOnlineUsers() {
    return Array.from(this.users.entries()).map(([userId, user]) => ({
      userId,
      username: user.username,
    }));
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
   * Clear all presence data (useful for testing)
   */
  clear() {
    this.users.clear();
  }
}

module.exports = new PresenceManager();
