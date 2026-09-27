import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../app/api/google-sheets/design/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const fingerprint='a'.repeat(64);
function route(options:{enabled?:boolean;claimed?:boolean;changed?:boolean;revoke?:boolean;failWrite?:boolean;invalidUser?:boolean}={}){
  let writes=0,checks=0;const calls:string[]=[];
  const config={select:()=>config,eq:(_key:string,id:string)=>{assert.equal(id,'fixture-user');return config},maybeSingle:async()=>({data:{enabled:options.enabled!==false,sheet_tab_name:'Own tab',sheet_month:'2026-09'}})};
  const client={auth:{getUser:async()=>({data:{user:options.invalidUser?null:{id:'fixture-user'}}})},from:(name:string)=>{assert.equal(name,'google_sheets_user_config');return config},rpc:async(name:string)=>{
    calls.push(name);return{data:name==='get_my_google_sheets_sync_status'?{enabled:options.enabled!==false&&!(options.revoke&&++checks>1)}:name==='claim_google_sheets_sync'?{allowed:options.claimed!==false,sheet_tab_name:'Own tab',sheet_month:'2026-09'}:true};
  }};
  const dependencies:Record<string,unknown>={
    '@supabase/supabase-js':{createClient:()=>client},
    'next/server':{NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)}},
    '@/lib/sheet-designs':{sheetDesign:(id:string)=>id==='design-1'},
    '@/lib/sheet-design-service':{
      prepareSheetDesign:async(tab:string)=>{assert.equal(tab,'Own tab');calls.push('prepare');return{fingerprint:options.changed?'b'.repeat(64):fingerprint,plan:{normalCount:2,specialCount:1,capacity:100}}},
      applySheetDesign:async(_prepared:unknown,permission:()=>Promise<void>)=>{await permission();writes++;if(options.failWrite)throw new Error('network failure');return{success:true,verified:true}},
    },
  };
  const module={exports:{} as {GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>}};
  new Function('require','module','exports','process',compiled)((name:string)=>dependencies[name],module,module.exports,{env:{NEXT_PUBLIC_SUPABASE_URL:'http://local.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture'}});
  return {calls,writes:()=>writes,request:(method='POST',auth=true,body:unknown={design:'design-1',confirm:true,fingerprint,tabName:'FORGED'})=>module.exports[method as 'GET'|'POST'](new Request('http://local.test/api/google-sheets/design?design=design-1',{method,headers:auth?{authorization:'Bearer fixture'}:{},...(method==='POST'?{body:JSON.stringify(body)}:{})}))};
}
test('preflight never writes and uses the authenticated user tab',async()=>{const r=route();assert.equal((await r.request('GET')).status,200);assert.equal(r.writes(),0);assert.ok(!r.calls.includes('claim_google_sheets_sync'))});
test('missing or invalid session is denied',async()=>{for(const r of [route(),route({invalidUser:true})]){assert.equal((await r.request('POST',false)).status,401);assert.equal(r.writes(),0)}assert.equal((await route({invalidUser:true}).request()).status,401)});
test('disabled permission and revoked permission both deny all writes',async()=>{for(const options of [{enabled:false},{revoke:true}]){const r=route(options);assert.equal((await r.request()).status,403);assert.equal(r.writes(),0)}});
test('claim precedes fresh read; stale preview cannot overwrite new data',async()=>{const r=route({changed:true});assert.equal((await r.request()).status,409);assert.equal(r.writes(),0);assert.ok(r.calls.indexOf('claim_google_sheets_sync')<r.calls.indexOf('prepare'));assert.ok(r.calls.includes('complete_google_sheets_sync'))});
test('cooldown blocks before preparing a write',async()=>{const r=route({claimed:false});assert.equal((await r.request()).status,429);assert.equal(r.writes(),0);assert.ok(!r.calls.includes('prepare'))});
test('confirmation and template allowlist are required',async()=>{for(const body of [{design:'other',confirm:true,fingerprint},{design:'design-1',confirm:false,fingerprint},{design:'design-1',confirm:true,fingerprint:'z'.repeat(64)}]){const r=route();assert.equal((await r.request('POST',true,body)).status,422);assert.equal(r.writes(),0)}});
test('confirmed success writes once and records completion',async()=>{const r=route();assert.equal((await r.request()).status,200);assert.equal(r.writes(),1);assert.ok(r.calls.includes('complete_google_sheets_sync'))});
test('uncertain network outcome is not retried',async()=>{const r=route({failWrite:true}),response=await r.request();assert.equal(response.status,502);assert.equal((await response.json()).checkSheet,true);assert.equal(r.writes(),1)});
