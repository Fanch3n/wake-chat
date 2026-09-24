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
        // 401/403 are normal (expired session, inactive user); anything else is likely misconfiguration
        if (response.status !== 401 && response.status !== 403) {
          console.error(`[phpBB] Token validation returned HTTP ${response.status} from ${response.url} - check PHPBB_API_ENDPOINT`);
        }
        return { valid: false, error: errorData?.error || `Token validation failed (HTTP ${response.status})` };
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
}

module.exports = new PhpBBClient();
