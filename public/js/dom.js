/**
 * Small DOM helpers. User-supplied text is only ever set via textContent.
 */

export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Reference an icon from the SVG sprite in index.html */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

function initials(name) {
  const words = String(name).trim().split(/[\s_.-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]] : [words[0] || '?'];
  return letters.map((w) => Array.from(w)[0]).join('').toUpperCase();
}

/** Initials avatar with a color derived from the name */
export function avatar(name, small = false) {
  const node = el('div', small ? 'avatar avatar-sm' : 'avatar', initials(name));
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  node.style.setProperty('--hue', hash % 360);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

export const formatClock = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Time for today's messages, date and time for older ones */
export function formatTime(date) {
  if (date.toDateString() === new Date().toDateString()) return formatClock(date);
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${formatClock(date)}`;
}

let toastTimer = null;

/** Show a short-lived notification. type: 'info' | 'success' | 'error' */
export function showStatus(message, type = 'info') {
  const toast = $('status-msg');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}
