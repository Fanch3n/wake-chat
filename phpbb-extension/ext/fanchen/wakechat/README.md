# Wake Chat phpBB Extension

This phpBB extension provides an API endpoint (`/api/auth/validate`) for SSO integration with the Wake chat server and allows the display of active chat users on the phpBB frontpage.

## Features
- Secure API endpoint for validating user tokens
- Returns user info and roles in a format compatible with the chat server
- Easy to install and configure

## Installation
1. Copy the `ext/fanchen/wakechat` folder into your phpBB `ext/` directory.
2. In the phpBB ACP (Admin Control Panel), go to **Customise > Manage extensions**.
3. Find **Wake Chat** and click **Enable**.

## API Usage
- **POST** `/api/auth/validate`
- Body: `{ "token": "user_token_here" }`
- Response (success):
  ```json
  {
    "user": {
      "id": 123,
      "username": "john_doe",
      "roles": ["user"]
    }
  }
  ```
- Response (failure):
  ```json
  { "error": "Invalid token" }
  ```

## Displaying Online Chat Users in the Forum

The extension also includes a feature to show who is currently active in the real-time chat directly on your forum.

**How it works:**
1. The Node.js chat server tracks connected WebSocket sessions and exposes an internal `/api/chat/online-users` endpoint.
2. The phpBB extension acts as a secure proxy, fetching this data from the Node backend.
3. The forum frontend (or a custom phpBB HTML block) can make a simple AJAX `GET` request to the extension's proxy route (`/app.php/api/chat/online-users`) to load the active users. The heading uses the chat name configured on the chat server (`APP_NAME`).

Because the forum fetches the list through its own origin, the chat server doesn't need to allow the forum in `CORS_ORIGIN` for this widget. Note that `/api/chat/online-users` on the chat server itself is unauthenticated, so anyone who can reach the chat server can read the list of online usernames.

## Customization
- Replace the token validation logic in `controller/main_controller.php` with your actual authentication method (e.g., session, OAuth, JWT, etc).
- Adjust the roles logic as needed for your forum's permissions.

## Security
- Always use HTTPS in production.
- Restrict access to the API as needed (e.g., by IP, secret, or rate limiting).

## License
MIT
