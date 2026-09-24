const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { io: ioClient } = require('socket.io-client');

// phpBB session IDs accepted by the fake phpBB endpoint below
const PHPBB_SESSIONS = {
  'alice-sid': { id: 2, username: 'alice', roles: ['user'] },
  'bob-sid': { id: 3, username: 'bob', roles: ['user'] },
  'carol-sid': { id: 4, username: 'carol', roles: ['user'] },
};

let phpbb;
let chat;
let baseUrl;
let clients = [];

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

/** Connect a client; `auth` is a phpBB session ID (sent as cookie), 'guest', or null */
async function connect(auth = null) {
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
}

const usernames = (response) => response.users.map((u) => u.username).sort();

before(async () => {
  // Keep test output readable
  mock.method(console, 'log', () => {});

  phpbb = startFakePhpbb();
  await once(phpbb, 'listening');
  process.env.PHPBB_API_ENDPOINT = `http://127.0.0.1:${phpbb.address().port}/app.php/`;
  process.env.ALLOW_GUESTS = 'true';
  process.env.ALLOW_ROOM_CREATION = 'true';

  // Config is read on require, so load the app after setting the environment
  const { createChatServer } = require('../src/app');
  chat = createChatServer();
  chat.server.listen(0, '127.0.0.1');
  await once(chat.server, 'listening');
  baseUrl = `http://127.0.0.1:${chat.server.address().port}`;
});

afterEach(async () => {
  for (const socket of clients) socket.disconnect();
  clients = [];
  // Let the server process the disconnects so state doesn't leak between tests
  await new Promise((resolve) => setTimeout(resolve, 50));
});

after(async () => {
  chat.io.close();
  phpbb.close();
});

test('guests can chat in a room', async () => {
  const a = await connect('guest');
  const b = await connect('guest');
  await emit(a, 'join-room', { roomId: 'public' });
  await emit(b, 'join-room', { roomId: 'public' });

  const received = once(b, 'message-received');
  const sent = await emit(a, 'send-message', { roomId: 'public', text: '  hello  ' });
  assert.equal(sent.success, true);

  const [data] = await received;
  assert.equal(data.message.text, 'hello');
  assert.equal(data.message.username, a.user.username);
});

test('signs in from the phpBB session cookie and rejects unknown sessions', async () => {
  const alice = await connect('alice-sid');
  assert.deepEqual(alice.user, { id: 2, username: 'alice', roles: ['user'] });

  const stranger = await connect();
  const response = await emit(stranger, 'authenticate', { token: 'wrong-sid' });
  assert.deepEqual(response, { success: false, error: 'Invalid or expired session' });
});

test('leaving your only room keeps you online and reachable by DM', async () => {
  const alice = await connect('alice-sid');
  const bob = await connect('bob-sid');
  await emit(alice, 'join-room', { roomId: 'public' });
  await emit(alice, 'leave-room', { roomId: 'public' });

  assert.deepEqual(usernames(await emit(bob, 'get-online-users')), ['alice', 'bob']);
  assert.equal((await emit(bob, 'join-room', { dmWith: 2 })).success, true);

  await emit(alice, 'join-room', { roomId: 'lobby' });
  assert.deepEqual(usernames(await emit(alice, 'get-online-users', { roomId: 'lobby' })), ['alice']);
});

test('a second tab shares room membership, and closing it keeps the user online', async () => {
  const alice = await connect('alice-sid');
  const bobTab1 = await connect('bob-sid');
  await emit(alice, 'join-room', { roomId: 'lobby' });
  await emit(bobTab1, 'join-room', { roomId: 'lobby' });

  const bobTab2 = await connect('bob-sid');
  assert.deepEqual(usernames(await emit(alice, 'get-online-users', { roomId: 'lobby' })), ['alice', 'bob']);

  // The new tab receives messages of rooms the user already joined
  const received = once(bobTab2, 'message-received');
  await emit(alice, 'send-message', { roomId: 'lobby', text: 'hi bob' });
  assert.equal((await received)[0].message.text, 'hi bob');

  bobTab2.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(usernames(await emit(alice, 'get-online-users')), ['alice', 'bob']);
  assert.deepEqual(usernames(await emit(alice, 'get-online-users', { roomId: 'lobby' })), ['alice', 'bob']);
  assert.equal((await emit(bobTab1, 'send-message', { roomId: 'lobby', text: 'still here' })).success, true);

  // Closing the last tab takes the user offline and out of their rooms
  const offline = once(alice, 'user-offline');
  bobTab1.disconnect();
  assert.equal((await offline)[0].username, 'bob');
  assert.deepEqual(usernames(await emit(alice, 'get-online-users', { roomId: 'lobby' })), ['alice']);
});

test('leaving a room in one tab leaves it in all tabs', async () => {
  const tab1 = await connect('alice-sid');
  const tab2 = await connect('alice-sid');
  const bob = await connect('bob-sid');
  await emit(tab1, 'join-room', { roomId: 'lobby' });
  await emit(bob, 'join-room', { roomId: 'lobby' });

  const leftNotice = once(tab2, 'user-left-room');
  await emit(tab1, 'leave-room', { roomId: 'lobby' });
  assert.equal((await leftNotice)[0].userId, 2);

  let tab2GotMessage = false;
  tab2.on('message-received', () => (tab2GotMessage = true));
  await emit(bob, 'send-message', { roomId: 'lobby', text: 'anyone?' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(tab2GotMessage, false);
});

test('empty rooms are deleted', async () => {
  const alice = await connect('alice-sid');
  await emit(alice, 'join-room', { roomId: 'temporary' });
  await emit(alice, 'leave-room', { roomId: 'temporary' });

  const { rooms } = await emit(alice, 'get-rooms');
  assert.equal(rooms.some((r) => r.id === 'temporary'), false);
});

test('DM rooms are private to their two members', async () => {
  const alice = await connect('alice-sid');
  const bob = await connect('bob-sid');
  const carol = await connect('carol-sid');

  const dm = await emit(alice, 'join-room', { dmWith: bob.user.id });
  assert.equal(dm.success, true);

  const { rooms } = await emit(carol, 'get-rooms');
  assert.equal(rooms.some((r) => r.id === dm.room.id), false);
  assert.equal((await emit(carol, 'join-room', { roomId: dm.room.id })).success, false);
  assert.equal((await emit(carol, 'get-room-info', { roomId: dm.room.id })).success, false);

  // The recipient is notified even without having the DM open
  const notified = once(bob, 'dm-received');
  await emit(alice, 'send-message', { roomId: dm.room.id, text: 'psst' });
  assert.equal((await notified)[0].message.text, 'psst');
});

test('online-users API lists only IDs and names', async () => {
  await connect('alice-sid');
  const response = await fetch(`${baseUrl}/api/chat/online-users`);
  const body = await response.json();
  assert.deepEqual(body.users, [{ id: 2, username: 'alice' }]);
});
