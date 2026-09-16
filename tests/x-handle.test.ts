import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedXHandle, validXHandle } from '../lib/x-handle.ts';

test('X handle accepts username or @username and normalizes outer whitespace', () => {
  for (const value of ['usuario', '@usuario', '  @usuario  ', 'UsEr_123', 'a', 'a'.repeat(15)]) assert.equal(validXHandle(value), true);
  assert.equal(normalizedXHandle('  @UsEr_123 '), 'UsEr_123');
});
test('X handle refuses empty, URL, email, punctuation and overlength values', () => {
  for (const value of ['', ' ', '@', null, undefined, '@@usuario', 'https://x.com/user', 'user@example.com', 'usu ario', 'usuário', 'user.name', 'a'.repeat(16)]) assert.equal(validXHandle(value), false);
});
