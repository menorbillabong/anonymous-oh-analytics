import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {formatCooldown} from '../lib/sheets-cooldown.ts';

// Exercise the actual route with no external writes, credentials or real sheets.
const source=readFileSync(new URL('../app/api/google-sheets/sync/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function route(claim:Record<string,unknown>,fail=false){
  let writes=0;const calls:string[]=[];
  const posts={select:()=>posts,eq:()=>posts,order:()=>posts,range:async()=>({data:[],error:null})};
  const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from:()=>posts,rpc:async(name:string)=>{
    calls.push(name);return {data:name==='claim_google_sheets_sync'?claim:{},error:null};
  }};
  const dependencies:Record<string,unknown>={
    '@supabase/supabase-js':{createClient:()=>client},
    'next/server':{NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)}},
    '@/lib/google-sheets':{syncGoogleSheet:async()=>{writes++;if(fail)throw new Error('fixture failure');return{normalCount:2,specialCount:0,manualLikes:0}}},
    '@/lib/manual-like-adjustment':{parseManualAdjustment:(data:unknown)=>data},
    '@/lib/sheets-cooldown':{formatCooldown},
  };
  const module={exports:{} as {POST:(request:Request)=>Promise<Response>}};
  new Function('require','module','exports','process',compiled)((name:string)=>{
    if(!(name in dependencies))throw new Error(`Unexpected dependency ${name}`);return dependencies[name];
  },module,module.exports,{env:{NEXT_PUBLIC_SUPABASE_URL:'http://local.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-only'}});
  return {post:(authorized=true)=>module.exports.POST(new Request('http://local.test/api/google-sheets/sync',{method:'POST',headers:authorized?{authorization:'Bearer fixture-only'}:{}})),writes:()=>writes,calls};
}

test('sync API blocks early retries without fetching posts or writing sheets',async()=>{
  const fixture=route({allowed:false,retry_after_seconds:90,cooldown_seconds:90});
  const response=await fixture.post();const body=await response.json();
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'90');
  assert.equal(body.retryAfterSeconds,90);assert.match(body.error,/1:30/);
  assert.equal(fixture.writes(),0);assert.deepEqual(fixture.calls,['claim_google_sheets_sync']);
});
test('sync API uses the configured duration and does not restart wait after syncing',async()=>{
  const fixture=route({allowed:true,cooldown_seconds:135,cooldown_ends_at:new Date(Date.now()+45000).toISOString(),sheet_tab_name:'fixture'});
  const response=await fixture.post();const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.cooldownSeconds,135);
  assert.ok(body.retryAfterSeconds>0&&body.retryAfterSeconds<=45);assert.equal(fixture.writes(),1);
});
test('sync API retains cooldown information after a claimed request fails',async()=>{
  const fixture=route({allowed:true,cooldown_seconds:90,cooldown_ends_at:new Date(Date.now()+90000).toISOString()},true);
  const response=await fixture.post();const body=await response.json();
  assert.equal(response.status,502);assert.equal(body.cooldownSeconds,90);
  assert.ok(body.retryAfterSeconds>0&&body.retryAfterSeconds<=90);
  assert.ok(fixture.calls.includes('complete_google_sheets_sync'));
});
test('sync API denies missing session before making a claim',async()=>{
  const fixture=route({allowed:true});assert.equal((await fixture.post(false)).status,401);
  assert.equal(fixture.writes(),0);assert.deepEqual(fixture.calls,[]);
});
