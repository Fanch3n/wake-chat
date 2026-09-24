const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, emit } = require('./support');

let server;

before(async () => {
  server = await startTestServer({ ALLOW_GUESTS: 'false', ALLOW_ROOM_CREATION: 'false', APP_NAME: 'Test <Chat>' });
});

afterEach(() => server.disconnectAll());

after(() => server.close());

test('the page is rendered with the configured name and disabled features', async () => {
  const html = await (await fetch(`${server.baseUrl}/`)).text();
  assert.match(html, /<title>Test &lt;Chat&gt;<\/title>/);
  assert.match(html, /<body class="guests-disabled room-creation-disabled">/);
  assert.doesNotMatch(html, /\{\{/, 'no unreplaced placeholders');
});

test('guest sign-in is rejected when guests are disabled', async () => {
  const socket = await server.connect();
  const response = await emit(socket, 'authenticate', { isGuest: true });
  assert.equal(response.success, false);
});

test('only the public room can be created when room creation is disabled', async () => {
  const alice = await server.connect('alice-sid');
  assert.equal((await emit(alice, 'join-room', { roomId: 'public' })).success, true);
  assert.deepEqual(await emit(alice, 'join-room', { roomId: 'new-room' }), {
    success: false,
    error: 'Room creation is disabled',
  });
});
