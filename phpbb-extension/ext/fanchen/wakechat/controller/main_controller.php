<?php
namespace fanchen\wakechat\controller;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Yaml\Yaml;
use phpbb\user;
use phpbb\db\driver\driver_interface;

readonly class main_controller
{
    public function __construct(
        protected user $user,
        protected driver_interface $db
    ) {}

    /**
     * Returns the list of users currently online in the chat by querying the chat backend API.
     * @return JsonResponse
     */
    public function chat_online_users(): JsonResponse
    {
        // Load config (expects 'chat_backend_api_url' in config)
        $config_path = __DIR__ . '/../config.yml';
        if (!file_exists($config_path)) {
            return new JsonResponse(['success' => false, 'error' => 'Config file not found'], 500);
        }
        
        $config = Yaml::parseFile($config_path);
        $api_url = $config['chat_backend_api_url'] ?? null;
        if (!$api_url) {
            return new JsonResponse(['success' => false, 'error' => 'Chat backend API URL not configured'], 500);
        }

        // Fetch online users from chat backend
        try {
            $context = stream_context_create([
                'http' => [
                    'timeout' => 2,
                    'ignore_errors' => true,
                ]
            ]);
            
            // Use @ to suppress PHP Warnings if the connection is refused, 
            // allowing us to gracefully handle the false response below.
            $response = @file_get_contents($api_url, false, $context);
            if ($response === false) {
                throw new \RuntimeException('Failed to contact chat backend');
            }
            
            $data = json_decode($response, true);
            if (!is_array($data) || !isset($data['users'])) {
                throw new \RuntimeException('Invalid response from chat backend');
            }
            
            return new JsonResponse([
                'success' => true,
                'appName' => is_string($data['appName'] ?? null) ? $data['appName'] : 'Wake',
                'users' => $data['users'],
            ]);
        } catch (\Throwable $e) {
            return new JsonResponse([
                'success' => false,
                'error' => 'Could not fetch chat online users: ' . $e->getMessage(),
            ], 502);
        }
    }

    public function validate(Request $request): JsonResponse
    {
        $session_id = $request->get('token');
        
        // If not sent as form-data/query, check if it's in a JSON body
        if (!$session_id) {
            $content = $request->getContent();
            if (!empty($content)) {
                $data = json_decode($content, true);
                if (is_array($data) && isset($data['token'])) {
                    $session_id = $data['token'];
                }
            }
        }

        if (!$session_id) {
            return new JsonResponse(['error' => 'No session ID (token) provided'], 400);
        }

        $sql = sprintf(
            "SELECT s.session_user_id, u.username, u.user_type, u.user_inactive_reason
            FROM %s s
            JOIN %s u ON s.session_user_id = u.user_id
            WHERE s.session_id = '%s'
              AND s.session_time > %d
              AND s.session_user_id <> %d",
            SESSIONS_TABLE,
            USERS_TABLE,
            $this->db->sql_escape($session_id),
            time() - 3600,
            ANONYMOUS
        );
        
        $result = $this->db->sql_query($sql);
        $row = $this->db->sql_fetchrow($result);
        $this->db->sql_freeresult($result);

        if (!$row) {
            return new JsonResponse(['error' => 'Invalid or expired session'], 401);
        }

        if ($row['user_type'] == USER_INACTIVE || $row['user_inactive_reason']) {
            return new JsonResponse(['error' => 'User inactive'], 403);
        }

        $roles = ['user'];
        if ((int)$row['user_type'] === USER_FOUNDER) {
            $roles[] = 'admin';
        }

        $user_id = (int)$row['session_user_id'];
        $group_roles = [];
        $sql = sprintf(
            'SELECT g.group_id, g.group_name, g.group_type
            FROM %s ug
            JOIN %s g ON ug.group_id = g.group_id
            WHERE ug.user_id = %d AND ug.user_pending = 0',
            USER_GROUP_TABLE,
            GROUPS_TABLE,
            $user_id
        );
        
        $result = $this->db->sql_query($sql);
        while ($group = $this->db->sql_fetchrow($result)) {
            $group_name = strtoupper($group['group_name']);
            $group_roles[] = match ($group_name) {
                'ADMINISTRATORS', 'ADMINS' => 'admin',
                'GLOBAL_MODERATORS', 'MODERATORS' => 'moderator',
                'REGISTERED' => 'user',
                default => strtolower($group['group_name']),
            };
        }
        $this->db->sql_freeresult($result);

        $roles = array_values(array_unique([...$roles, ...$group_roles]));

        return new JsonResponse([
            'user' => [
                'id' => $user_id,
                'username' => $row['username'],
                'roles' => $roles,
            ]
        ]);
    }
}
