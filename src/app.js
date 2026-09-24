const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { initializeSocketEvents } = require('./chat/socket-events');
const presenceManager = require('./chat/presence');

const PUBLIC_DIR = path.join(__dirname, '../public');

const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Build the Express app, HTTP server and Socket.io server (without listening)
 * @returns {{ app: import('express').Express, server: import('http').Server, io: Server }}
 */
function createChatServer() {
  const app = express();
  const server = http.createServer(app);

  const allowAnyOrigin = config.allowedOrigins.includes('*');

  /**
   * Reject browser connections from foreign origins. Auth relies on the phpBB
   * session cookie, and WebSockets are not subject to CORS, so without this any
   * website could open a socket authenticated as the visiting user.
   */
  function isOriginAllowed(req) {
    const origin = req.headers.origin;
    if (!origin || allowAnyOrigin) return true; // Non-browser clients send no Origin
    if (config.allowedOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  const io = new Server(server, {
    cors: config.allowedOrigins.length > 0
      ? { origin: allowAnyOrigin ? true : config.allowedOrigins, credentials: true }
      : undefined,
    allowRequest: (req, callback) => callback(null, isOriginAllowed(req)),
    maxHttpBufferSize: 1e5, // 100 KB payload limit to prevent DoS via massive strings
  });

  if (allowAnyOrigin) {
    console.warn('[Config] CORS_ORIGIN=* allows any website to connect on behalf of logged-in users. Do not use in production.');
  }

  // Features turned off in the config; CSS hides their controls from the first paint
  const bodyClass = [
    !config.allowGuests && 'guests-disabled',
    !config.allowRoomCreation && 'room-creation-disabled',
  ].filter(Boolean).join(' ');

  // Chat page with the configuration filled in (rendered once at startup)
  const indexHtml = fs
    .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
    .replaceAll('{{APP_NAME}}', escapeHtml(config.appName))
    .replaceAll('{{BODY_CLASS}}', bodyClass);

  app.get(['/', '/index.html'], (req, res) => {
    res.type('html').send(indexHtml);
  });
  app.use(express.static(PUBLIC_DIR, { index: false }));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Configuration endpoint (public info)
  app.get('/api/config', (req, res) => {
    res.json({
      appName: config.appName,
      phpbbApiEndpoint: config.phpbb.apiEndpoint,
      allowGuests: config.allowGuests,
      allowRoomCreation: config.allowRoomCreation,
    });
  });

  // Online users for the phpBB extension's forum widget
  app.get('/api/chat/online-users', (req, res) => {
    res.json({
      appName: config.appName,
      users: presenceManager.getOnlineUsers().map(({ userId, username }) => ({ id: userId, username })),
    });
  });

  // Initialize Socket.io event handlers
  initializeSocketEvents(io);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, server, io };
}

module.exports = { createChatServer };
