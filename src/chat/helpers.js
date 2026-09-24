const MAX_ROOM_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_TOKEN_LENGTH = 256;

/**
 * Personal Socket.io room for a user. Uses ':' which is not allowed in
 * chat room IDs, so a chat room can never collide with a personal room.
 * Every socket of a user (e.g. one per browser tab) joins it.
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

module.exports = {
  MAX_MESSAGE_LENGTH,
  MAX_TOKEN_LENGTH,
  personalRoom,
  isValidRoomId,
  dmRoomId,
  safeHandler,
  generateRandomUsername,
  getSessionIdFromCookies,
};
