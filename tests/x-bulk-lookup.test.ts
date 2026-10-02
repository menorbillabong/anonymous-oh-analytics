import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchLookupPost, parseLookupHandles, safeLookupUrl, selectLookupPost } from '../lib/x-bulk-lookup.ts';

const own = (id: string, date = '2026-10-02T10:00:00Z') => ({ type: 'status', id, author: { screen_name: 'tester' }, created_at: date });
const repost = { ...own('102'), author: { screen_name: 'author' }, reposted_by: { screen_name: 'tester' } };
test('handles normalize and deduplicate; reject invalid/oversized input', () => {
  assert.deepEqual(parseLookupHandles('@Tester\nTESTER, other_name'), ['tester', 'other_name']);
  for (const input of ['', 'https://x.com/test', '@wrong!', 'a'.repeat(16), Array.from({ length: 101 }, (_, i) => `user${i}`).join('\n')]) assert.throws(() => parseLookupHandles(input));
});
test('reposts opt in; own posts unaffected, latest own post beats pinned/unsorted dates', () => {
  const values = [repost, own('101', '2025-01-01'), own('103')];
  assert.equal(selectLookupPost(values, 'tester', false)?.url, 'https://x.com/tester/status/103');
  assert.deepEqual(selectLookupPost(values, 'tester', true), { url: 'https://x.com/author/status/102', repost: true });
  assert.equal(selectLookupPost([repost], 'tester', false), null);
  assert.equal(selectLookupPost([{ ...own('100'), pinned: true }, own('103')], 'tester', false)?.url, 'https://x.com/tester/status/103');
});
test('reject other authors/reposters, replies, tombstones and unsafe IDs', () => {
  assert.equal(selectLookupPost([null, { ...repost, reposted_by: { screen_name: 'other' } }, { ...own('1'), replying_to: {} }, { ...own('2'), type: 'tombstone' }, own('bad/link')], 'tester', true), null);
  assert.equal(safeLookupUrl('https://x.com/test/status/123'), true);
  for (const url of ['javascript:alert(1)', 'https://x.com.evil.com/a/status/1', 'https://evil.com/', 'https://x.com/a/status/1?redirect=evil', null]) assert.equal(safeLookupUrl(url), false);
});
test('read-only fetch bounded to the provider, returns reposts only when enabled', async () => {
  let calls = 0;
  const mock: typeof fetch = async (url, options) => { calls++; assert.equal(String(url), 'https://api.fxtwitter.com/2/profile/tester/statuses?count=100'); assert.equal(options?.cache, 'no-store'); return Response.json({ code: 200, results: [repost] }); };
  assert.equal((await fetchLookupPost('tester', true, mock))?.repost, true);
  assert.equal(await fetchLookupPost('tester', false, mock), null);
  await assert.rejects(fetchLookupPost('../evil', true, mock)); assert.equal(calls, 2);
});
test('rate limiting is not retried, empty/error responses are distinct', async () => {
  let calls = 0;
  await assert.rejects(fetchLookupPost('tester', true, async () => { calls++; return new Response('', { status: 429 }); }), /limitou/);
  assert.equal(calls, 1);
  assert.equal(await fetchLookupPost('tester', false, async () => new Response(null, { status: 204 })), null);
  await assert.rejects(fetchLookupPost('tester', false, async () => Response.json({ code: 500, results: [] })));
});
