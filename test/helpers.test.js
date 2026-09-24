const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isValidRoomId, dmRoomId, getSessionIdFromCookies } = require('../src/chat/helpers');

test('isValidRoomId accepts normal names and rejects unsafe ones', () => {
  assert.equal(isValidRoomId('general'), true);
  assert.equal(isValidRoomId('Room with spaces'), true);
  assert.equal(isValidRoomId(''), false);
  assert.equal(isValidRoomId(' padded '), false);
  assert.equal(isValidRoomId('user:2'), false, "':' is reserved for personal rooms");
  assert.equal(isValidRoomId('line\nbreak'), false);
  assert.equal(isValidRoomId('x'.repeat(129)), false);
  assert.equal(isValidRoomId(42), false);
});

test('dmRoomId is the same regardless of who starts the DM', () => {
  assert.equal(dmRoomId(2, 10), dmRoomId('10', '2'));
});

test('getSessionIdFromCookies finds the phpBB _sid cookie', () => {
  assert.equal(getSessionIdFromCookies('phpbb3_abc_u=2; phpbb3_abc_sid=s3ss10n; other=1'), 's3ss10n');
  assert.equal(getSessionIdFromCookies('phpbb3_abc_u=2'), null);
  assert.equal(getSessionIdFromCookies(undefined), null);
  assert.equal(getSessionIdFromCookies('x_sid=%E0%A4%A'), null, 'malformed encoding is ignored');
});
