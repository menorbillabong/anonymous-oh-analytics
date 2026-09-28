import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicTimeline, X_PARTIAL_WARNING } from '../lib/x-timeline-fetch.ts';

const post = (id: string, date = '2026-09-20T12:00:00Z') => ({ type: 'status', id, text: 'Publicação', created_at: date, author: { screen_name: 'Creator' } });
const page = (posts: unknown[], cursor: string | null = null) => Response.json({ code: 200, results: posts, cursor: { bottom: cursor } });
type Step = Response | Error | ((init?: RequestInit) => Promise<Response>);
function fixture(steps: Step[], overrides: Record<string, unknown> = {}) {
  const calls: string[] = [], waits: number[] = [], events: unknown[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    const step = steps.shift();
    assert.ok(step, `Unexpected request ${url}`);
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(init) : step;
  }) as typeof fetch;
  return { calls, waits, events, run: (limit = 100) => fetchPublicTimeline('Creator', limit, '2026-09-01', '2026-09-28', {
    fetchImpl, wait: async ms => { waits.push(ms); }, log: event => events.push(event), ...overrides,
  }) };
}

test('retries a transient first-page error without repeating account authorization', async () => {
  const f = fixture([new Response('', { status: 503 }), page([post('1')])]);
  const result = await f.run();
  assert.equal(result.partial, false);
  assert.deepEqual(result.posts.map(p => p.id), ['1']);
  assert.equal(f.calls[0], f.calls[1]);
  assert.deepEqual(f.waits, [500]);
});

test('retries network and invalid JSON errors at most twice', async () => {
  const f = fixture([new TypeError('network'), new Response('<html>'), page([post('1')])]);
  assert.equal((await f.run()).partial, false);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.waits, [500, 1000]);
});

test('keeps successful pages when a later page exhausts retries', async () => {
  const f = fixture([page([post('1')], 'next'), ...[1, 2, 3].map(() => new Response('', { status: 502 }))]);
  const result = await f.run();
  assert.deepEqual(result.posts.map(p => p.id), ['1']);
  assert.equal(result.partial, true);
  assert.equal(f.calls.length, 4);
  assert.ok(f.calls.slice(1).every(url => url.includes('cursor=next')));
  assert.match(X_PARTIAL_WARNING, /Busca incompleta/);
});

test('stops after a wholly older page but not after an old pinned post mixed with current posts', async () => {
  const f = fixture([
    page([post('9', '2026-07-01T12:00:00Z'), post('1')], 'next'),
    page([post('2', '2026-09-01T03:00:00Z')], 'older'),
    page([post('3', '2026-09-01T02:59:59Z')], 'unneeded'),
  ]);
  const result = await f.run();
  assert.equal(f.calls.length, 3);
  assert.equal(result.partial, false);
  assert.deepEqual(result.posts.map(p => p.id), ['1', '2']);
  assert.equal(result.posts[1].published_at, '2026-09-01T03:00:00.000Z');
});

test('deduplicates pages and preserves author/reply/repost and end-date filtering', async () => {
  const f = fixture([
    page([post('1')], 'next'),
    page([post('1'), post('2'), { ...post('3'), replying_to: { id: '1' } }, { ...post('4'), reposted_by: {} }, { ...post('5'), author: { screen_name: 'Other' } }, post('6', '2026-09-30T12:00:00Z')]),
  ]);
  assert.deepEqual((await f.run()).posts.map(p => p.id), ['1', '2']);
});

test('a legitimate empty response or 204 is not treated as an outage', async () => {
  for (const response of [page([]), new Response(null, { status: 204 })]) {
    const f = fixture([response]);
    assert.deepEqual(await f.run(), { posts: [], partial: false });
    assert.equal(f.calls.length, 1);
  }
});

test('malformed successful payloads are not silently reported as empty timelines', async () => {
  const f = fixture([Response.json({}), Response.json({}), Response.json({}), new Response('', { status: 403 }), new Response('', { status: 403 })]);
  await assert.rejects(f.run(), /X_TIMELINE_UNAVAILABLE/);
  assert.equal(f.calls.length, 5);
});

test('rate limits are not retried and remain distinguishable', async () => {
  const f = fixture([new Response('', { status: 429 }), new Response('', { status: 429 }), new Response('', { status: 429 })]);
  await assert.rejects(f.run(), /X_TIMELINE_RATE_LIMITED/);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.waits, []);
});

test('Retry-After on an unavailable service is respected by not retrying it', async () => {
  const f = fixture([page([post('1')], 'next'), new Response('', { status: 503, headers: { 'retry-after': '120' } })]);
  assert.equal((await f.run()).partial, true);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.waits, []);
});

test('access denials are not retried', async () => {
  const f = fixture([page([post('1')], 'next'), new Response('', { status: 403 })]);
  assert.equal((await f.run()).partial, true);
  assert.equal(f.calls.length, 2);
});

test('five-page cap and repeated cursors are marked incomplete', async () => {
  const cap = fixture([1, 2, 3, 4, 5].map(n => page([post(String(n))], `cursor-${n}`)));
  assert.equal((await cap.run()).partial, true);
  assert.equal(cap.calls.length, 5);
  const repeated = fixture([page([post('1')], 'same'), page([post('2')], 'same')]);
  assert.equal((await repeated.run()).partial, true);
  assert.equal(repeated.calls.length, 2);
});

test('count limit with more pages available is explicit, not a silent complete result', async () => {
  const f = fixture([page([post('1'), post('2')], 'next')]);
  const result = await f.run(1);
  assert.equal(result.partial, true);
  assert.equal(result.posts.length, 1);
});

test('total time budget stops further requests and preserves partial results', async () => {
  let time = 0;
  const f = fixture([async () => { time = 50; return page([post('1')], 'next'); }], { now: () => time, budgetMs: 40 });
  assert.equal((await f.run()).partial, true);
  assert.equal(f.calls.length, 1);
});

test('a stalled request is aborted and retried within the bounded attempts', async () => {
  const f = fixture([init => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }), page([post('1')])], { timeoutMs: 10 });
  assert.equal((await f.run()).partial, false);
  assert.equal(f.calls.length, 2);
});

test('fallback results are always marked incomplete', async () => {
  const entries = [{ content: { tweet: { id_str: '1', full_text: 'Post', created_at: '2026-09-20T12:00:00Z', user: { screen_name: 'Creator' } } } }];
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { timeline: { entries } } } })}</script>`;
  const f = fixture([new Response('', { status: 404 }), new Response(html)]);
  const result = await f.run();
  assert.equal(result.partial, true);
  assert.deepEqual(result.posts.map(p => p.id), ['1']);
});
