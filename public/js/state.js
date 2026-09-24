/**
 * Client state shared by the UI modules
 */
export const state = {
  user: null, // { id, username, roles } once signed in
  room: null, // Current room: { id, name, isDm }, or null when none is selected
  rooms: [], // Last room list received from the server
  messages: new Map(), // roomId -> messages received so far
  historyFetched: new Set(), // Rooms whose message history has been loaded
  unread: new Map(), // roomId -> number of unread messages
  hiddenUnread: 0, // Messages in the current room that arrived while the tab was hidden
};

export const isOwnUser = (userId) => state.user !== null && String(userId) === String(state.user.id);
