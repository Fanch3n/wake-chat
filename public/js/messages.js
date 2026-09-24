/**
 * The message list of the current room
 */
import { $, el, avatar, formatClock, formatTime } from './dom.js';
import { isOwnUser } from './state.js';

const GROUP_WINDOW_MS = 5 * 60 * 1000; // Group consecutive messages from one user within 5 minutes
const NEAR_BOTTOM_PX = 80;

let lastRendered = null; // { userId, time } of the last rendered message, for grouping

const list = () => $('messages');

function isNearBottom() {
  const m = list();
  return m.scrollHeight - m.scrollTop - m.clientHeight < NEAR_BOTTOM_PX;
}

function scrollToBottom() {
  const m = list();
  m.scrollTop = m.scrollHeight;
}

function removeEmptyState() {
  const empty = $('empty-state');
  if (empty) empty.remove();
}

export function clearMessages() {
  list().replaceChildren();
  lastRendered = null;
}

/** Replace the list with a centered placeholder */
export function showEmptyState(title, text = '') {
  clearMessages();
  const empty = el('div', 'empty-state');
  empty.id = 'empty-state';
  empty.append(el('strong', '', title));
  if (text) empty.append(el('span', '', text));
  list().append(empty);
}

export function renderMessages(messages) {
  if (messages.length === 0) {
    showEmptyState('No messages yet', 'Be the first to say something.');
    return;
  }
  clearMessages();
  messages.forEach((msg) => addMessage(msg, false));
  scrollToBottom();
}

export function addMessage(msg, autoScroll = true) {
  removeEmptyState();

  const time = new Date(msg.timestamp);
  const userId = String(msg.userId);
  const own = isOwnUser(msg.userId);
  const continued =
    lastRendered && lastRendered.userId === userId && time - lastRendered.time < GROUP_WINDOW_MS;
  // Follow new messages only if the reader is already at the bottom (or sent it)
  const stick = own || isNearBottom();

  const row = el('div', `msg${continued ? '' : ' first'}${own ? ' own' : ''}`);
  const body = el('div');

  if (continued) {
    const gutter = el('div', 'msg-gutter-time', formatClock(time));
    gutter.title = time.toLocaleString();
    row.append(gutter);
  } else {
    row.append(avatar(msg.username));
    const head = el('div', 'msg-head');
    const timeEl = el('time', 'msg-time', formatTime(time));
    timeEl.dateTime = time.toISOString();
    timeEl.title = time.toLocaleString();
    head.append(el('span', 'msg-author', msg.username), timeEl);
    body.append(head);
  }

  body.append(el('div', 'msg-text', msg.text));
  row.append(body);
  list().append(row);
  lastRendered = { userId, time };

  if (autoScroll && stick) scrollToBottom();
}

export function addSystemMessage(text) {
  removeEmptyState();
  const stick = isNearBottom();
  list().append(el('div', 'system-msg', text));
  lastRendered = null;
  if (stick) scrollToBottom();
}
