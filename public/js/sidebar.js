/**
 * Sidebar: room list, direct messages and online users
 */
import { $, el, icon, avatar } from './dom.js';
import { state, isOwnUser } from './state.js';

let handlers = {
  onSelectRoom: () => {},
  onLeaveRoom: () => {},
  onMessageUser: () => {},
};

/**
 * @param {{ onSelectRoom: (room, displayName, isDm) => void,
 *           onLeaveRoom: (roomId) => void,
 *           onMessageUser: (userId, username) => void }} callbacks
 */
export function initSidebar(callbacks) {
  handlers = callbacks;
  $('menu-btn').addEventListener('click', openSidebar);
  $('backdrop').addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });
}

// On small screens the sidebar is an off-canvas drawer
export function openSidebar() {
  document.body.classList.add('sidebar-open');
}

export function closeSidebar() {
  document.body.classList.remove('sidebar-open');
}

/** DM rooms are named "DM: <a> & <b>"; show the other participant */
export function dmDisplayName(room) {
  const name = room.name.replace(/^DM: /, '');
  const parts = name.split(' & ');
  if (parts.length === 2 && state.user) {
    if (parts[0] === state.user.username) return parts[1];
    if (parts[1] === state.user.username) return parts[0];
  }
  return name;
}

export function renderRooms() {
  const rooms = state.rooms.filter((r) => !r.isDirectMessage);
  const dms = state.rooms.filter((r) => r.isDirectMessage);

  $('rooms-list').replaceChildren(...rooms.map((room) => roomItem(room, room.name, false)));
  $('dm-list').replaceChildren(...dms.map((room) => roomItem(room, dmDisplayName(room), true)));
  $('dm-section').hidden = dms.length === 0;
}

function roomItem(room, displayName, isDm) {
  const isCurrent = state.room !== null && state.room.id === room.id;
  const unread = state.unread.get(room.id) || 0;

  const li = el('li', 'nav-item');
  li.classList.toggle('active', isCurrent);
  li.classList.toggle('unread', unread > 0);
  li.classList.toggle('not-joined', !room.isJoined);

  const btn = el('button', 'nav-btn');
  btn.type = 'button';
  if (isCurrent) btn.setAttribute('aria-current', 'page');
  btn.title = room.isJoined ? displayName : `Join ${displayName}`;
  btn.append(isDm ? avatar(displayName, true) : el('span', 'nav-icon', '#'));
  btn.append(el('span', 'nav-name', displayName));
  if (unread > 0) {
    const badge = el('span', 'badge', unread > 99 ? '99+' : String(unread));
    badge.setAttribute('aria-label', `${unread} unread`);
    btn.append(badge);
  } else if (!isDm) {
    const count = el('span', 'nav-count', String(room.userCount));
    count.title = `${room.userCount} online`;
    btn.append(count);
  }
  btn.addEventListener('click', () => handlers.onSelectRoom(room, displayName, isDm));
  li.append(btn);

  if (room.isJoined) {
    const leaveBtn = el('button', 'icon-btn leave-btn');
    leaveBtn.type = 'button';
    leaveBtn.title = isDm ? 'Close conversation' : 'Leave room';
    leaveBtn.setAttribute('aria-label', `${leaveBtn.title}: ${displayName}`);
    leaveBtn.append(icon('x'));
    leaveBtn.addEventListener('click', () => handlers.onLeaveRoom(room.id));
    li.append(leaveBtn);
  }

  return li;
}

/** Users in the current room, or everyone online when no room is selected */
export function renderOnlineUsers(users) {
  $('online-title').textContent = state.room ? 'In this room' : 'Online';
  $('online-count').textContent = users.length;

  const items = users.map((user) => {
    const li = el('li', 'nav-item');
    const isSelf = isOwnUser(user.userId);
    const btn = el(isSelf ? 'div' : 'button', isSelf ? 'nav-btn nav-static' : 'nav-btn');
    btn.append(avatar(user.username, true), el('span', 'nav-name', user.username));
    if (isSelf) {
      btn.append(el('span', 'nav-count', 'you'));
    } else {
      // Clicking another user starts a direct message
      btn.type = 'button';
      btn.title = `Message ${user.username}`;
      btn.addEventListener('click', () => handlers.onMessageUser(user.userId, user.username));
    }
    li.append(btn);
    return li;
  });
  $('online-users').replaceChildren(...items);
}
