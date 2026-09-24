const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { startTestServer, emit, usernames } = require('./support');

let server;
let baseUrl;
const connect = (auth) => server.connect(auth);

before(async () => {
  server = await startTestServer();
  baseUrl = server.baseUrl;
});

afterEach(() => server.disconnectAll());

after(() => server.close());

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
