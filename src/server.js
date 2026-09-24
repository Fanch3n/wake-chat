const config = require('./config');
const { createChatServer } = require('./app');

const SHUTDOWN_TIMEOUT_MS = 5000;

const { server, io } = createChatServer();

server.listen(config.port, () => {
  console.log(`[Server] Chat server listening on port ${config.port}`);
  console.log(`[Config] App name: ${config.appName}`);
  console.log(`[Config] phpBB API: ${config.phpbb.apiEndpoint}`);
  console.log(`[Config] Environment: ${config.nodeEnv}`);
});

/**
 * Close all sockets and the HTTP server, then exit. Node ignores SIGTERM by
 * default when it runs as PID 1 in a container, so without this handler
 * `docker stop` would wait for its timeout and then kill the process.
 */
function shutdown(signal) {
  console.log(`[Server] Received ${signal}, shutting down`);
  io.close(() => process.exit(0));
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
