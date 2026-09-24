<?php
/**
* DO NOT CHANGE
*/
if (!defined('IN_PHPBB')) {
	exit;
}

if (empty($lang) || !is_array($lang)) {
	$lang = array();
}

$lang = array_merge($lang, array(
	'ACP_WAKECHAT_TITLE' => 'Wake Chat',
	'ACP_WAKECHAT_DESCRIPTION' => 'Provides integration API and GUI bridges for the Wake chat server.',
));
