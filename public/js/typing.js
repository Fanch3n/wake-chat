/**
 * "X is typing…" indicator for the current room
 */
import { $ } from './dom.js';

// Hide users who haven't sent a typing update in a while (e.g. closed the tab mid-sentence)
const TYPING_TIMEOUT_MS = 6000;

const typing = new Map(); // userId -> { username, timer }

function render() {
  const names = Array.from(typing.values(), (t) => t.username);
  let text = '';
  if (names.length === 1) text = `${names[0]} is typing…`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
  else if (names.length > 2) text = 'Several people are typing…';
  $('typing-list').textContent = text;
}

export function userTyping(userId, username) {
  const existing = typing.get(userId);
  if (existing) clearTimeout(existing.timer);
  typing.set(userId, { username, timer: setTimeout(() => userStoppedTyping(userId), TYPING_TIMEOUT_MS) });
  render();
}

export function userStoppedTyping(userId) {
  const entry = typing.get(userId);
  if (!entry) return;
  clearTimeout(entry.timer);
  typing.delete(userId);
  render();
}

export function clearTyping() {
  typing.forEach((entry) => clearTimeout(entry.timer));
  typing.clear();
  render();
}
