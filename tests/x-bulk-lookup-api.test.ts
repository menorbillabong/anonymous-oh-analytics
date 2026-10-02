import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../app/api/x-posts/lookup/route.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const runId = '00000000-0000-0000-0000-000000000001';
function fixture(deny = false, limited = false) {
  const actions: string[] = [];
  const module = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function('require', 'module', 'exports', 'process', 'fetch', code)(
    () => ({ fetchLookupPost: async (handle: string, reposts: boolean) => {
      actions.push('lookup'); assert.equal(handle, 'saved_handle'); assert.equal(reposts, true);
      if (limited) throw new Error('O serviço limitou as consultas.');
      return { url: 'https://x.com/author/status/123', repost: true };
    } }), module, module.exports,
    { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://db.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-test' } },
    async (url: string, options: RequestInit) => {
      assert.equal(url, 'https://db.test/rest/v1/rpc/my_x_lookup');
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer fixture');
      const args = JSON.parse(options.body as string); actions.push(args.p_action);
      if (deny) return Response.json({ code: '42501' }, { status: 403 });
      if (args.p_action === 'claim') return Response.json({ handle: 'saved_handle', include_reposts: true, claim_id: 'claim' });
      assert.equal(args.p_data.run_id, runId); assert.equal(args.p_data.claim_id, 'claim');
      assert.equal(args.p_data.status, limited ? 'error' : 'found');
      return Response.json({ enabled: true, items: [{ ...args.p_data, handle: 'saved_handle' }] });
    },
  );
  return { actions, run: (auth = true, body = { run_id: runId }) => module.exports.POST(new Request('http://local.test/api/x-posts/lookup', { method: 'POST', headers: auth ? { authorization: 'Bearer fixture' } : {}, body: JSON.stringify(body) })) };
}
test('no external call without authentication and a valid saved search id', async () => {
  const f = fixture(); assert.equal((await f.run(false)).status, 401); assert.equal((await f.run(true, { run_id: 'bad' })).status, 400); assert.deepEqual(f.actions, []);
});
test('live database permission precedes the external query', async () => {
  const f = fixture(true); assert.equal((await f.run()).status, 409); assert.deepEqual(f.actions, ['claim']);
});
test('saved handle/repost flag control lookup; result saved before returning success', async () => {
  const f = fixture(); const r = await f.run(); assert.equal(r.status, 200); assert.equal((await r.json()).search.items[0].repost, true); assert.deepEqual(f.actions, ['claim', 'lookup', 'complete']);
});
test('provider rate limit saves an error and pauses the UI queue', async () => {
  const f = fixture(false, true); const result = await (await f.run()).json(); assert.equal(result.limited, true); assert.equal(result.search.items[0].status, 'error'); assert.deepEqual(f.actions, ['claim', 'lookup', 'complete']);
});
