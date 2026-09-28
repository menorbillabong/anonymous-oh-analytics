import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as timeline from '../lib/x-timeline.ts';
import { X_PARTIAL_WARNING } from '../lib/x-timeline-fetch.ts';

const source = readFileSync(new URL('../app/api/x-posts/recent/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const post = { id: '1', url: 'https://x.com/Creator/status/1', text: 'Post', published_at: '2026-09-20T12:00:00Z', views: 12, likes: 3, reposts: 0, comments: 0, author_handle: 'Creator', author_name: 'Creator', author_avatar: '' };
function fixture(options: { partial?: boolean; denied?: string; fail?: string; pinned?: boolean } = {}) {
  const calls: string[] = [];
  const dependencies: Record<string, unknown> = {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/x-timeline': { ...timeline, xPostDateKey: () => '2026-09-28' },
    '@/lib/x-timeline-fetch': { X_PARTIAL_WARNING, fetchPublicTimeline: async (handle: string, limit: number, start: string) => {
      calls.push('timeline');
      assert.equal(handle, 'Creator'); assert.equal(limit, 100); assert.equal(start, '2026-09-01');
      if (options.fail) throw new Error(options.fail);
      return { posts: [post], partial: !!options.partial };
    } },
  };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (url.includes('/rpc/')) {
      calls.push('claim');
      assert.equal(init?.method, 'POST'); assert.ok(init?.signal);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture');
      return options.denied ? Response.json({ message: options.denied }, { status: 403 }) : Response.json({ handle: 'Creator', limit: 100, start_date: '2026-09-01' });
    }
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    if (url === 'https://x.com/Creator') {
      calls.push('pinned-profile');
      return new Response(options.pinned ? '<div data-href="/Creator/status/2"><svg data-icon="icon-pin-fill"></svg></div>' : '');
    }
    assert.equal(url, 'https://api.fxtwitter.com/2/status/2');
    calls.push('pinned-status');
    return Response.json({ status: { type: 'status', id: '2', text: 'Pinned', created_at: post.published_at, author: { screen_name: 'Creator' } } });
  };
  const module = { exports: {} as { POST: (r: Request) => Promise<Response> } };
  new Function('require', 'module', 'exports', 'process', 'fetch', 'console', compiled)(
    (name: string) => dependencies[name], module, module.exports,
    { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://db.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture' } }, fetchImpl, { warn: () => {} },
  );
  return { calls, run: (auth = true) => module.exports.POST(new Request('http://local.test/api/x-posts/recent', { method: 'POST', headers: auth ? { authorization: 'Bearer fixture' } : {} })) };
}

test('unauthenticated request cannot call any upstream service', async () => {
  const f = fixture(); assert.equal((await f.run(false)).status, 401); assert.deepEqual(f.calls, []);
});
test('account permission, period, handle and cooldown protections still precede public queries', async () => {
  for (const [denied, expected] of [['X_IMPORT_NOT_ALLOWED', 403], ['X_IMPORT_PERIOD_REQUIRED', 409], ['X_IMPORT_HANDLE_REQUIRED', 400], ['X_IMPORT_RATE_LIMIT', 429]] as const) {
    const f = fixture({ denied }); assert.equal((await f.run()).status, expected); assert.deepEqual(f.calls, ['claim']);
  }
});
test('partial result carries its warning and claims the request only once', async () => {
  const f = fixture({ partial: true }); const response = await f.run(); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.partial, true); assert.equal(body.warning, X_PARTIAL_WARNING);
  assert.equal(body.posts[0].published_at, post.published_at); assert.equal(body.posts[0].likes, 3);
  assert.equal(f.calls.filter(c => c === 'claim').length, 1);
});
test('complete results retain pinned post lookup and carry no warning', async () => {
  const f = fixture({ pinned: true }); const body = await (await f.run()).json();
  assert.equal(body.partial, false); assert.equal(body.warning, null);
  assert.deepEqual(body.posts.map((p: { id: string }) => p.id), ['1', '2']);
  assert.ok(f.calls.includes('pinned-status'));
});
test('total failure is not reported as an empty success; rate limiting has a specific message', async () => {
  for (const fail of ['X_TIMELINE_UNAVAILABLE', 'X_TIMELINE_RATE_LIMITED']) {
    const f = fixture({ fail }); const response = await f.run();
    assert.equal(response.status, 503); const body = await response.json(); assert.equal(body.posts, undefined);
    if (fail === 'X_TIMELINE_RATE_LIMITED') assert.match(body.error, /limitando/);
    assert.equal(f.calls.filter(c => c === 'claim').length, 1);
  }
});
test('review receives the warning independently of duplicate/filter notices', () => {
  const ui = readFileSync(new URL('../app/bulk-review-injector.tsx', import.meta.url), 'utf8');
  assert.match(ui, /setSearchWarning\(warning\)/);
  assert.match(ui, /undefined,warning/);
  assert.match(ui, /role="status">\{searchWarning\}/);
  assert.match(ui, /throw new Error\(warning\|\|'Nenhuma publicação/);
});
