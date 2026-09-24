/**
 * Test harness: a fake phpBB endpoint, the chat server, and Socket.io clients
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { mock } = require('node:test');
const { io: ioClient } = require('socket.io-client');

// phpBB session IDs accepted by the fake phpBB endpoint
const PHPBB_SESSIONS = {
  'alice-sid': { id: 2, username: 'alice', roles: ['user'] },
  'bob-sid': { id: 3, username: 'bob', roles: ['user'] },
  'carol-sid': { id: 4, username: 'carol', roles: ['user'] },
};

/** Fake phpBB extension: POST /app.php/api/auth/validate */
function startFakePhpbb() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const user = req.url === '/app.php/api/auth/validate' && PHPBB_SESSIONS[JSON.parse(body).token];
      if (user) {
        res.end(JSON.stringify({ user }));
      } else {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Invalid or expired session' }));
      }
    });
  });
  return server.listen(0, '127.0.0.1');
}

const emit = (socket, event, data = {}) => new Promise((resolve) => socket.emit(event, data, resolve));

const usernames = (response) => response.users.map((u) => u.username).sort();

/**
 * Start the fake phpBB and the chat server. Config is read when the app is
 * first required, so each test file can only use one set of `env` values
 * (node --test runs every file in its own process).
 * @param {object} env - Extra environment variables for the chat server
 */
async function startTestServer(env = {}) {
  // Keep test output readable
  mock.method(console, 'log', () => {});

  const phpbb = startFakePhpbb();
  await once(phpbb, 'listening');
  Object.assign(process.env, {
    PHPBB_API_ENDPOINT: `http://127.0.0.1:${phpbb.address().port}/app.php/`,
    ALLOW_GUESTS: 'true',
    ALLOW_ROOM_CREATION: 'true',
    ...env,
  });

  const { createChatServer } = require('../src/app');
  const chat = createChatServer();
  chat.server.listen(0, '127.0.0.1');
  await once(chat.server, 'listening');
  const baseUrl = `http://127.0.0.1:${chat.server.address().port}`;

  let clients = [];

  return {
    baseUrl,

    /** Connect a client; `auth` is a phpBB session ID (sent as cookie), 'guest', or null */
    async connect(auth = null) {
      const extraHeaders = auth && auth !== 'guest' ? { cookie: `phpbb3_test_sid=${auth}` } : {};
      const socket = ioClient(baseUrl, { forceNew: true, transports: ['websocket'], extraHeaders });
      clients.push(socket);
      await once(socket, 'connect');
      if (auth) {
        const response = await emit(socket, 'authenticate', auth === 'guest' ? { isGuest: true } : {});
        assert.equal(response.success, true, `authentication failed: ${response.error}`);
        socket.user = response.user;
      }
      return socket;
    },

    /** Disconnect all clients and let the server process it, so state doesn't leak between tests */
    async disconnectAll() {
      for (const socket of clients) socket.disconnect();
      clients = [];
      await new Promise((resolve) => setTimeout(resolve, 50));
    },

    close() {
      chat.io.close();
      phpbb.close();
    },
  };
}

module.exports = { startTestServer, emit, usernames };
