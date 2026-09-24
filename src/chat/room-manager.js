const { randomUUID } = require('crypto');

/**
 * Represents a single chat room
 */
class ChatRoom {
  constructor(roomId, name, options = {}) {
    this.id = roomId;
    this.name = name;
    this.createdAt = new Date();
    this.users = new Map(); // userId -> { username, roles }
    this.messages = []; // In-memory message buffer
    this.maxMessages = options.maxMessages || 100; // Keep last 100 messages in memory
    this.isPrivate = options.isPrivate || false;
    this.isDirectMessage = options.isDirectMessage || false;
    this.dmUsers = options.dmUsers || null; // For DM rooms, array of 2 user IDs
    this.allowedRoles = options.allowedRoles || []; // Empty = everyone allowed
    this.createdBy = options.createdBy || 'system';
  }

  /**
   * Check if a user can join this room
   * @param {object} user - { id, username, roles }
   * @returns {boolean}
   */
  canUserJoin(user) {
    if (this.isDirectMessage && this.dmUsers) {
      return this.dmUsers.includes(user.id.toString());
    }

    if (this.allowedRoles.length === 0) {
      return true; // No restrictions
    }

    // User must have at least one allowed role
    return Array.isArray(user.roles) && this.allowedRoles.some((role) => user.roles.includes(role));
  }

  /**
   * Add a user to the room
   * @param {string} userId - User ID
   * @param {string} username - Username
   * @param {string[]} roles - User roles
   * @returns {boolean} Success
   */
  addUser(userId, username, roles) {
    if (!this.canUserJoin({ id: userId, username, roles })) {
      return false;
    }

    this.users.set(userId, { username, roles });
    return true;
  }

  /**
   * Remove a user from the room
   * @param {string} userId - User ID
   * @returns {boolean} Success
   */
  removeUser(userId) {
    return this.users.delete(userId);
  }

  /**
   * Get all users in the room
   * @returns {array} Array of { userId, username, roles }
   */
  getUsers() {
    return Array.from(this.users.entries()).map(([userId, user]) => ({
      userId,
      ...user,
    }));
  }

  /**
   * Broadcast a message to the room
   * @param {object} message - { userId, username, text, timestamp }
   */
  addMessage(message) {
    const fullMessage = {
      id: randomUUID(),
      ...message,
      timestamp: message.timestamp || new Date(),
    };

    this.messages.push(fullMessage);

    // Keep only last N messages in memory
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }

    return fullMessage;
  }

  /**
   * Get recent messages
   * @param {number} limit - Maximum number of messages to return
   * @returns {array} Messages
   */
  getRecentMessages(limit = 50) {
    return this.messages.slice(Math.max(0, this.messages.length - limit));
  }

  /**
   * Get room info
   * @returns {object}
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      createdBy: this.createdBy,
      isPrivate: this.isPrivate,
      isDirectMessage: this.isDirectMessage,
      allowedRoles: this.allowedRoles,
      userCount: this.users.size,
      messageCount: this.messages.length,
    };
  }
}

/**
 * Room Manager
 * Manages creation, deletion, and access to chat rooms
 */
class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> ChatRoom
  }

  /**
   * Create a new chat room
   * @param {string} roomId - Unique room ID
   * @param {string} name - Room display name
   * @param {object} options - { maxMessages, isPrivate, allowedRoles, createdBy }
   * @returns {ChatRoom}
   */
  createRoom(roomId, name, options = {}) {
    if (this.rooms.has(roomId)) {
      throw new Error(`Room "${roomId}" already exists`);
    }

    const room = new ChatRoom(roomId, name, options);
    this.rooms.set(roomId, room);
    console.log(`[Room] Created: ${roomId}`);
    return room;
  }

  /**
   * Get a room by ID
   * @param {string} roomId - Room ID
   * @returns {ChatRoom|null}
   */
  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  /**
   * Delete a room
   * @param {string} roomId - Room ID
   * @returns {boolean} Success
   */
  deleteRoom(roomId) {
    const deleted = this.rooms.delete(roomId);
    if (deleted) {
      console.log(`[Room] Deleted: ${roomId}`);
    }
    return deleted;
  }

  /**
   * Get rooms accessible to a user
   * @param {object} user - { id, username, roles }
   * @returns {array} Array of accessible room info
   */
  getAccessibleRooms(user) {
    return Array.from(this.rooms.values())
      .filter((room) => room.canUserJoin(user))
      .map((room) => room.toJSON());
  }

  /**
   * Get user's rooms (rooms the user has joined)
   * @param {string} userId - User ID
   * @returns {array} Array of room IDs
   */
  getUserRooms(userId) {
    const userRooms = [];
    for (const [roomId, room] of this.rooms) {
      if (room.users.has(userId)) {
        userRooms.push(roomId);
      }
    }
    return userRooms;
  }

  /**
   * Clear all rooms (useful for testing)
   */
  clear() {
    this.rooms.clear();
  }
}

module.exports = {
  ChatRoom,
  RoomManager: new RoomManager(),
};
