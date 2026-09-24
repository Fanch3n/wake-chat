# Wake — Real-Time Chat for phpBB

A real-time group chat application built with Node.js (Express), Socket.io, and flexible phpBB authentication.

## Features

✅ **Real-time Group Messaging** — Multiple users chatting together in rooms using WebSockets  
✅ **phpBB Integration** — Flexible API-based authentication with configurable phpBB endpoint  
✅ **Online Presence** — See who's online and active in each room  
✅ **Role-Based Permissions** — Enforce chat access based on phpBB user roles (admin, moderator, etc.)  
✅ **Typing Indicators** — Real-time typing status for better UX  
✅ **Light & Dark Mode** — Follows the system setting, with a manual toggle  
✅ **Multiple Chat Rooms** — Create and join different chat spaces dynamically  
✅ **Direct Messages** — Private one-to-one rooms between online users  
✅ **Zero Persistence** — Lightweight memory-based chat (add database later)  

## Architecture

```
Node.js (Express) + Socket.io
├── Authentication (phpBB API token validation)
├── Chat Rooms (in-memory, no DB)
├── Real-time Messaging (Socket.io events)
├── Presence Tracking (online users)
└── Client (HTML/JavaScript)
```

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3000
NODE_ENV=development

# Chat name shown to users (defaults to "Wake")
APP_NAME=Wake

# Your phpBB URL including app.php (e.g., https://forum.example.com/app.php)
PHPBB_API_ENDPOINT=http://localhost/phpbb/app.php

# Extra allowed browser origins (comma-separated); the chat's own origin is always allowed
CORS_ORIGIN=
```

### 3. Start the Server

**Development (with auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server will listen on `http://localhost:3000`

### Running with Docker

A prebuilt image is published to GitHub Container Registry on every push to `main` (tag `main`) and for each release tag `vX.Y.Z` (tags `X.Y.Z` and `latest`):

```bash
cp .env.example .env   # then edit .env
docker compose up -d
```

`docker-compose.yml` pulls `ghcr.io/fanch3n/wake-chat:main` and loads configuration from `.env`. To build the image from source instead, replace the `image:` line with `build: .`.

Without Compose:

```bash
docker run -d --name wake-chat -p 3000:3000 --env-file .env ghcr.io/fanch3n/wake-chat:main
```

The image defaults to `NODE_ENV=production`; remove `NODE_ENV=development` from the `.env` you pass in, since it overrides that default. The container listens on port 3000 unless `PORT` is set.

## Usage

### 1. Access the Chat Client

Open browser: **http://localhost:3000**

### 2. Authenticate

If you're logged in to the forum on the same domain, the chat signs you in automatically from the phpBB session cookie. Otherwise:

1. Paste your phpBB session ID into the "phpBB session ID" field and click "Sign in", or
2. Click "Continue as guest" (if `ALLOW_GUESTS` is enabled)

### 3. Chat

- **Join/Create Room**: Type a room name (e.g., "general", "gaming") in the sidebar and click "Join"
- **Send Message**: Press Enter to send; Shift+Enter inserts a line break
- **Direct Messages**: Click a user in the sidebar to message them privately
- **Unread Messages**: Rooms with new messages show a badge, and the count appears in the tab title
- **Dark Mode**: Use the sun/moon button in the top right. The chat follows your system setting until you pick a mode
- **Mobile**: On small screens, the menu button opens the room list

## phpBB Integration

### How Authentication Works

The chat server expects your phpBB installation to expose a token validation API endpoint:

#### Required API Endpoint

**POST** `/api/auth/validate`

Request body:
```json
{
  "token": "user_token_here"
}
```

Response (success):
```json
{
  "user": {
    "id": 123,
    "username": "john_doe",
    "roles": ["user"]
  }
}
```

Response (failure):
```json
{
  "error": "Invalid token"
}
```

### Implementing the Endpoint in phpBB

If your phpBB doesn't have this endpoint, you can add it via a phpBB extension or API middleware:

**Example (pseudo-code):**
```php
// POST /api/auth/validate
if ($_POST['token']) {
    $token = $_POST['token'];
    $user = validate_token($token); // Your validation logic
    
    if ($user) {
        return json_response([
            'user' => [
                'id' => $user['user_id'],
                'username' => $user['username'],
                'roles' => get_user_roles($user['user_id'])
            ]
        ]);
    }
}
return json_response(['error' => 'Invalid token'], 401);
```

### Flexible Configuration

The chat server is **endpoint-agnostic** — configure the phpBB API URL in `.env`:

- Single phpBB: `PHPBB_API_ENDPOINT=https://forum.example.com/app.php`
- Local dev: `PHPBB_API_ENDPOINT=http://localhost/phpbb/app.php`
- Include `/app.php` (phpBB extension routes live there unless URL rewriting is enabled). A trailing slash is ignored.
- Different endpoint: Any URL that implements the token validation API

## API Endpoints (Chat Server)

### Public Endpoints

**GET** `/health`  
Health check endpoint.

**GET** `/api/config`  
Returns public configuration (phpBB API endpoint).

## Socket.io Events

### Client → Server

| Event | Data | Response |
|-------|------|----------|
| `authenticate` | `{ token }` | `{ success, user, error }` |
| `join-room` | `{ roomId }` or `{ dmWith: userId }` | `{ success, room, error }` |
| `leave-room` | `{ roomId }` | `{ success, error }` |
| `send-message` | `{ roomId, text }` | `{ success, message, error }` |
| `typing-indicator` | `{ roomId }` | — |
| `typing-stop` | `{ roomId }` | — |
| `get-rooms` | `{}` | `{ success, rooms }` |
| `get-room-info` | `{ roomId }` | `{ success, room, error }` |
| `get-online-users` | `{ roomId? }` | `{ success, users }` |

### Server → Client

| Event | Data |
|-------|------|
| `user-online` | `{ userId, username, timestamp }` |
| `user-offline` | `{ userId, username, timestamp }` |
| `user-joined-room` | `{ roomId, userId, username, timestamp }` |
| `user-left-room` | `{ roomId, userId, username, timestamp }` |
| `message-received` | `{ roomId, message }` |
| `user-typing` | `{ roomId, userId, username }` |
| `user-stopped-typing` | `{ roomId, userId }` |

## Project Structure

```
.
├── src/
│   ├── server.js              # Entry point: starts the server, handles shutdown
│   ├── app.js                 # Express + Socket.io setup and HTTP routes
│   ├── config.js              # Configuration from environment variables
│   ├── auth/
│   │   └── phpbb-client.js    # phpBB session validation
│   └── chat/
│       ├── socket-events.js   # Socket.io event handlers
│       ├── room-manager.js    # Rooms, their members and message history
│       ├── presence.js        # Who is online (a user may have several tabs open)
│       └── helpers.js         # Validation and other pure helpers
├── public/
│   ├── index.html             # Web client markup
│   ├── css/app.css            # Styles, including light and dark theme
│   └── js/                    # Client ES modules (app.js is the entry point)
├── test/                      # Tests (node:test)
├── phpbb-extension/           # phpBB extension (SSO endpoint + online-users widget)
├── .github/workflows/         # Builds and publishes the Docker image to GHCR
├── Dockerfile                 # Container image
├── docker-compose.yml         # Runs the published image
├── .env.example               # Configuration template
├── package.json               # Dependencies
└── README.md                  # This file
```

## Development

### Running Tests

```bash
npm test
```

The tests use Node's built-in test runner. `test/support.js` starts the chat server with a fake phpBB endpoint, and the tests drive it with real Socket.io clients. GitHub Actions runs the tests before building the Docker image.

### Logging

The server logs important events to the console:
- `[Server]` — Server startup/shutdown
- `[Socket]` — Socket connections/disconnections
- `[Room]` — Room creation/deletion/user joins/leaves
- `[Message]` — Messages sent
- `[phpBB]` — phpBB API calls

## Future Enhancements

### Phase 2 (Planned)
- [ ] Persistent message history (MongoDB/PostgreSQL)
- [ ] Message search and history
- [ ] User profiles and avatars
- [ ] Read receipts
- [ ] Message reactions/reactions
- [ ] Admin room management panel

### Phase 3 (Planned)
- [ ] JWT tokens for stateless auth
- [ ] Rate limiting
- [ ] Media sharing (images, files)
- [ ] Voice/video calls
- [ ] Mobile app (React Native)

## Configuration Details

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment (development/production) |
| `APP_NAME` | `Wake` | Chat name shown in the page title, welcome screen and the phpBB online-users widget |
| `PHPBB_API_ENDPOINT` | `http://localhost/phpbb/app.php` | phpBB URL including `app.php`; the server calls `<endpoint>/api/auth/validate` |
| `ALLOW_GUESTS` | `true` | Allow clients to join as guests without phpBB validation |
| `ALLOW_ROOM_CREATION`| `true` | Allow valid clients to create new dynamic rooms |
| `CORS_ORIGIN` | _(empty)_ | Extra browser origins allowed to connect, comma-separated. Same-origin is always allowed; `*` allows any site (dev only) |

### Role-Based Access

Roles are validated from phpBB and enforced in chat:

- **No role restrictions** — All authenticated users can join any room (default)
- **Admin only** — Set `allowedRoles: ['admin']` on room creation
- **Moderator+** — Set `allowedRoles: ['moderator', 'admin']` on room

Roles come from phpBB user data and are stored in Socket connection context.

## Troubleshooting

### Connection Fails
- Check `PHPBB_API_ENDPOINT` is correct and accessible, and includes `/app.php`. The server logs `[phpBB] Token validation returned HTTP ...` when the endpoint is wrong
- Verify CORS settings in `.env` match client origin
- Check server is running: `curl http://localhost:3000/health`

### Token Validation Fails
- Verify phpBB `/api/auth/validate` endpoint is implemented
- Check token format matches your phpBB implementation
- Inspect browser console for API errors

### Messages Not Appearing
- Verify Socket.io is connected (check browser console)
- Ensure you've authenticated with a valid token
- Check you've joined a room
- Verify no role-based restrictions apply

### Performance Issues
- In-memory storage grows with messages — consider adding persistence
- For production, use a database instead of memory
- Monitor Socket.io connections: `io.sockets.sockets.size`

## License

MIT

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review `.env.example` configuration
3. Inspect browser console and server logs
4. Verify phpBB API endpoint is accessible

---

**Happy chatting!** 💬
