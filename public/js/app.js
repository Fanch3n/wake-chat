/**
 * Chat client entry point: socket connection, sign-in, rooms and the composer
 */
import { $, el, avatar, showStatus } from './dom.js';
import { state } from './state.js';
import { initTheme } from './theme.js';
import { renderMessages, addMessage, addSystemMessage, showEmptyState } from './messages.js';
import { initSidebar, closeSidebar, dmDisplayName, renderRooms, renderOnlineUsers } from './sidebar.js';
import { userTyping, userStoppedTyping, clearTyping } from './typing.js';

const APP_NAME = document.title;
const MAX_COMPOSER_HEIGHT_PX = 160;

let socket = null;

const isConnected = () => socket !== null && socket.connected;

/** Emit an event and resolve with the server's acknowledgement */
const request = (event, data = {}) => new Promise((resolve) => socket.emit(event, data, resolve));

// ============== CONNECTION ==============

function connect() {
  if (typeof io === 'undefined') {
    setConnectionState("Couldn't load the chat client. Reload the page to try again.");
    return;
  }

  socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
  });

  socket.on('connect', async () => {
    setConnectionState('Checking your forum login…');
    // Try to sign in with the phpBB session cookie first
    const response = await request('authenticate');
    setConnectionState('');
    if (response.success) {
      signedIn(response.user, `Welcome back, ${response.user.username}!`);
    } else {
      updateUI();
    }
  });

  socket.on('connect_error', () => setConnectionState("Can't reach the chat server. Retrying…"));
  socket.io.on('reconnect_failed', () => setConnectionState("Couldn't reconnect. Reload the page to try again."));

  socket.on('disconnect', () => {
    showStatus('Disconnected from server', 'error');
    setConnectionState('Connection lost. Reconnecting…');
    state.user = null;
    updateUI();
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
    showStatus(error.message || 'Socket error', 'error');
  });

  socket.on('rooms-updated', () => {
    if (state.user) loadRooms();
  });

  socket.on('user-online', updateOnlineUsers);
  socket.on('user-offline', updateOnlineUsers);

  socket.on('user-joined-room', (data) => {
    if (isCurrentRoom(data.roomId) && String(data.userId) !== String(state.user?.id)) {
      addSystemMessage(`${data.username} joined the room`);
      loadRoomInfo();
    }
    updateOnlineUsers();
  });

  socket.on('user-left-room', (data) => {
    if (String(data.userId) === String(state.user?.id)) {
      // We left this room, possibly from another tab
      forgetRoom(data.roomId);
      return;
    }
    if (isCurrentRoom(data.roomId)) {
      addSystemMessage(`${data.username} left the room`);
      loadRoomInfo();
    }
    updateOnlineUsers();
  });

  socket.on('message-received', ({ roomId, message }) => {
    if (!state.messages.has(roomId)) state.messages.set(roomId, []);
    state.messages.get(roomId).push(message);

    if (isCurrentRoom(roomId)) {
      userStoppedTyping(message.userId);
      addMessage(message);
      if (document.hidden) state.hiddenUnread++;
    } else {
      state.unread.set(roomId, (state.unread.get(roomId) || 0) + 1);
      renderRooms();
    }
    updateTitle();
  });

  socket.on('dm-received', async ({ roomId }) => {
    if (isCurrentRoom(roomId)) return;
    state.unread.set(roomId, Math.max(state.unread.get(roomId) || 0, 1));
    updateTitle();

    // Join the DM in the background so it shows up in the room list,
    // without switching away from the current room
    const response = await request('join-room', { roomId });
    if (response.success) {
      state.messages.set(roomId, response.room.recentMessages);
      state.historyFetched.add(roomId);
    }
    loadRooms();
  });

  socket.on('user-typing', (data) => {
    if (isCurrentRoom(data.roomId)) userTyping(data.userId, data.username);
  });

  socket.on('user-stopped-typing', (data) => {
    if (isCurrentRoom(data.roomId)) userStoppedTyping(data.userId);
  });
}

// ============== UI STATE ==============

const isCurrentRoom = (roomId) => state.room !== null && state.room.id === roomId;

function setConnectionState(text) {
  $('connection-state').textContent = text;
}

function updateTitle() {
  let unread = state.hiddenUnread;
  for (const count of state.unread.values()) unread += count;
  document.title = unread > 0 ? `(${unread}) ${APP_NAME}` : APP_NAME;
}

/** Show the chat or the sign-in screen, depending on whether we are signed in */
function updateUI() {
  document.body.classList.toggle('signed-in', state.user !== null);

  if (state.user) {
    $('user-name').textContent = state.user.username;
    $('user-avatar').replaceWith(Object.assign(avatar(state.user.username), { id: 'user-avatar' }));
    $('user-roles').replaceChildren(...state.user.roles.map((r) => el('span', `role role-${r}`, r)));

    if (!state.room) showNoRoom();
    if (isConnected()) {
      loadRooms();
      updateOnlineUsers();
    }
  } else {
    state.room = null;
    state.unread.clear();
    $('messages').replaceChildren();
    $('room-name').textContent = APP_NAME;
    $('room-meta').textContent = '';
    clearTyping();
    closeSidebar();
    updateTitle();
  }
}

// ============== AUTHENTICATION ==============

function signedIn(user, welcome) {
  state.user = user;
  $('token-input').value = '';
  updateUI();
  showStatus(welcome, 'success');
  joinRoom('public', 'Public');
}

async function authenticate(payload, welcome, fallbackError) {
  if (!isConnected()) {
    setConnectionState('Still connecting to the chat server. Try again in a moment.');
    return;
  }
  const response = await request('authenticate', payload);
  if (response.success) {
    signedIn(response.user, welcome(response.user));
  } else {
    showStatus(response.error || fallbackError, 'error');
  }
}

const signInWithToken = () =>
  authenticate({ token: $('token-input').value.trim() }, (u) => `Welcome, ${u.username}!`, 'Authentication failed');

const joinAsGuest = () =>
  authenticate({ isGuest: true }, (u) => `Welcome to the chat, ${u.username}!`, 'Failed to join as guest');

function signOut() {
  state.user = null;
  updateUI();
  showStatus('Signed out, refreshing…', 'info');
  setTimeout(() => window.location.reload(), 1000);
}

// ============== ROOMS ==============

async function loadRooms() {
  if (!isConnected()) return;
  const response = await request('get-rooms');
  if (!response.success) return;
  state.rooms = response.rooms;
  renderRooms();
}

async function joinRoom(roomId, roomName, dmWith = null) {
  const response = await request('join-room', dmWith !== null ? { dmWith } : { roomId });
  if (!response.success) {
    showStatus(response.error, 'error');
    return;
  }

  // For DMs the server decides the room ID
  const { id, recentMessages, users } = response.room;
  const cached = state.rooms.find((r) => r.id === id);
  const isDm = dmWith !== null || Boolean(cached && cached.isDirectMessage);

  state.messages.set(id, recentMessages);
  state.historyFetched.add(id);
  showRoom({ id, name: roomName, isDm }, recentMessages, users.length);
}

async function selectRoom(room, displayName, isDm) {
  if (!room.isJoined) {
    joinRoom(room.id, displayName);
    return;
  }

  // Already joined: focus the room without sending a join to the server
  const fetched = state.historyFetched.has(room.id);
  showRoom({ id: room.id, name: displayName, isDm }, fetched ? state.messages.get(room.id) || [] : null, room.userCount);
  if (fetched) return;

  // Fetch history we don't have locally yet (e.g. after a reload, or a room joined in another tab)
  const response = await request('get-room-info', { roomId: room.id });
  if (!response.success || !isCurrentRoom(room.id)) return;
  state.messages.set(room.id, response.room.recentMessages);
  state.historyFetched.add(room.id);
  renderMessages(response.room.recentMessages);
  setRoomMeta(response.room.users.length);
}

async function leaveRoom(roomId) {
  const response = await request('leave-room', { roomId });
  if (!response.success) {
    showStatus(response.error || 'Could not leave the room', 'error');
    return;
  }
  forgetRoom(roomId);
}

/** Drop local state for a room we are no longer in */
function forgetRoom(roomId) {
  state.messages.delete(roomId);
  state.historyFetched.delete(roomId);
  state.unread.delete(roomId);
  updateTitle();
  if (isCurrentRoom(roomId)) {
    state.room = null;
    showNoRoom();
    updateOnlineUsers();
  }
  loadRooms();
}

function joinNewRoom() {
  const roomId = $('new-room-input').value.trim();
  if (!roomId) {
    showStatus('Enter a room name', 'error');
    return;
  }
  joinRoom(roomId, roomId);
  $('new-room-input').value = '';
}

function startDirectMessage(userId, username) {
  // The server derives the DM room ID and creates the room if needed
  joinRoom(null, username, userId);
}

/**
 * Make a room the current one. `messages` is null while its history is loading.
 */
function showRoom(room, messages, userCount) {
  state.room = room;
  state.unread.delete(room.id);
  clearTyping();
  updateTitle();

  $('room-name').textContent = room.isDm ? room.name : `# ${room.name}`;
  setRoomMeta(userCount);

  const input = $('message-input');
  input.disabled = false;
  input.placeholder = room.isDm ? `Message ${room.name}` : `Message #${room.name}`;
  updateSendButton();

  if (messages) renderMessages(messages);
  else showEmptyState('Loading messages…');

  closeSidebar();
  // Focusing on touch devices would pop up the keyboard on every room switch
  if (!window.matchMedia('(hover: none)').matches) input.focus();
  renderRooms();
  loadRooms();
  updateOnlineUsers();
}

function showNoRoom() {
  clearTyping();
  $('room-name').textContent = 'No room selected';
  $('room-meta').textContent = '';
  showEmptyState('Pick a room', 'Choose a room from the list, or join a new one.');

  const input = $('message-input');
  input.value = '';
  input.disabled = true;
  input.placeholder = 'Select a room to start chatting';
  autoResize();
  updateSendButton();
}

function setRoomMeta(userCount) {
  let meta = '';
  if (state.room) meta = state.room.isDm ? 'Direct message' : `${userCount} online`;
  $('room-meta').textContent = meta;
}

/** Refresh the header's user count after someone joins or leaves */
async function loadRoomInfo() {
  if (!state.room) return;
  const response = await request('get-online-users', { roomId: state.room.id });
  if (response.success) setRoomMeta(response.users.length);
}

async function updateOnlineUsers() {
  if (!isConnected() || !state.user) return;
  const response = await request('get-online-users', { roomId: state.room?.id ?? null });
  if (response.success) renderOnlineUsers(response.users);
}

// ============== COMPOSER ==============

async function sendMessage() {
  const input = $('message-input');
  const text = input.value.trim();
  if (!text || !state.room) return;

  const roomId = state.room.id;
  const response = await request('send-message', { roomId, text });
  if (!response.success) {
    showStatus(response.error, 'error');
    return;
  }
  input.value = '';
  autoResize();
  updateSendButton();
  socket.emit('typing-stop', { roomId });
}

function handleComposerInput() {
  autoResize();
  updateSendButton();
  if (!state.room || !isConnected()) return;
  const hasText = $('message-input').value.trim().length > 0;
  socket.emit(hasText ? 'typing-indicator' : 'typing-stop', { roomId: state.room.id });
}

function handleComposerKeydown(event) {
  // Enter sends, Shift+Enter inserts a line break
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
}

function updateSendButton() {
  const input = $('message-input');
  $('send-btn').disabled = input.disabled || input.value.trim().length === 0;
}

function autoResize() {
  const input = $('message-input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
}

// ============== STARTUP ==============

/** Submit handler that doesn't reload the page */
const onSubmit = (id, fn) =>
  $(id).addEventListener('submit', (e) => {
    e.preventDefault();
    fn();
  });

function init() {
  initTheme();
  initSidebar({ onSelectRoom: selectRoom, onLeaveRoom: leaveRoom, onMessageUser: startDirectMessage });
  updateUI();

  onSubmit('auth-form', signInWithToken);
  onSubmit('create-room-container', joinNewRoom);
  onSubmit('composer', sendMessage);
  $('guest-btn').addEventListener('click', joinAsGuest);
  $('logout-btn').addEventListener('click', signOut);
  $('message-input').addEventListener('input', handleComposerInput);
  $('message-input').addEventListener('keydown', handleComposerKeydown);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      state.hiddenUnread = 0;
      updateTitle();
    }
  });

  connect();
}

// Module scripts run after the document is parsed, so the DOM is ready here
init();
