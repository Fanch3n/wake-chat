module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // Chat name shown to users (page title, welcome screen, forum widget)
  appName: process.env.APP_NAME?.trim() || 'Wake',
  phpbb: {
    // Base URL of phpBB installation (e.g., http://localhost/phpbb)
    apiEndpoint: process.env.PHPBB_API_ENDPOINT || 'http://localhost/phpbb',
  },
  // Allow guest logins (useful for testing or open chats)
  allowGuests: process.env.ALLOW_GUESTS !== 'false',
  // Allow users to create their own rooms dynamically
  allowRoomCreation: process.env.ALLOW_ROOM_CREATION !== 'false',
  // Additional browser origins allowed to connect (comma-separated).
  // Same-origin connections are always allowed; '*' allows any origin.
  allowedOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};
