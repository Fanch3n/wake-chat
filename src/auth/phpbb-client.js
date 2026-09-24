const config = require('../config');

/**
 * phpBB API Client
 * Provides methods to interact with phpBB for authentication and user info
 */
class PhpBBClient {
  constructor() {
    this.baseUrl = config.phpbb.apiEndpoint;
  }

  /**
   * Validate a user token with phpBB
   * @param {string} token - The authentication token from phpBB
   * @returns {Promise<object>} User info { id, username, roles }
   */
  async validateToken(token) {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        let errorData;
        try { errorData = await response.json(); } catch(e) {}
        return { valid: false, error: errorData?.error || 'Token validation failed' };
      }

      const data = await response.json();
      
      if (data.user) {
        return {
          id: data.user.id,
          username: data.user.username,
          roles: data.user.roles || [],
          valid: true,
        };
      }
      
      return { valid: false, error: 'Invalid token' };
    } catch (error) {
      console.error('[phpBB] Token validation error:', error.message);
      return {
        valid: false,
        error: error.message || 'Token validation failed',
      };
    }
  }

  /**
   * Get user info by user ID
   * @param {string|number} userId - phpBB user ID
   * @returns {Promise<object>} User info
   */
  async getUserInfo(userId) {
    try {
      const response = await fetch(`${this.baseUrl}/api/users/${userId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) return null;

      const data = await response.json();
      
      if (data.user) {
        return {
          id: data.user.id,
          username: data.user.username,
          email: data.user.email,
          roles: data.user.roles || [],
        };
      }
      
      return null;
    } catch (error) {
      console.error('[phpBB] Get user info error:', error.message);
      return null;
    }
  }

  /**
   * Check if a user has a specific role
   * @param {string[]} userRoles - Array of user role names
   * @param {string} roleName - Role name to check (e.g., 'admin', 'moderator')
   * @returns {boolean}
   */
  static hasRole(userRoles, roleName) {
    return Array.isArray(userRoles) && userRoles.includes(roleName);
  }

  /**
   * Check if user is admin
   * @param {string[]} userRoles - Array of user role names
   * @returns {boolean}
   */
  static isAdmin(userRoles) {
    return PhpBBClient.hasRole(userRoles, 'admin');
  }

  /**
   * Check if user is moderator
   * @param {string[]} userRoles - Array of user role names
   * @returns {boolean}
   */
  static isModerator(userRoles) {
    return PhpBBClient.hasRole(userRoles, 'moderator');
  }
}

module.exports = new PhpBBClient();
