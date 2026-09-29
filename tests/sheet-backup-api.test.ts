import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../app/api/google-sheets/backup/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const fingerprint='a'.repeat(64),createdAt='2026-09-27T12:00:00Z';
type Options={unauthorized?:boolean;revoked?:boolean;saveError?:boolean;expired?:boolean;corrupt?:boolean;stale?:boolean;otherTab?:boolean;otherId?:boolean;deniedClaim?:boolean;writeError?:boolean};
function route(options:Options={}){
 let saves=0,writes=0;const calls:string[]=[];
 const target={properties:{sheetId:123,title:'Own tab'}};
 const table={select:()=>table,eq:(key:string,id:string)=>{assert.equal(key,'user_id');assert.equal(id,'owner');return table},maybeSingle:async()=>({data:{snapshot:'encrypted',expires_at:options.expired?'2000-01-01':'2099-01-01'}}),upsert:async(payload:any,opts:any)=>{assert.deepEqual(payload,{user_id:'owner',snapshot:'new-encrypted'});assert.equal(opts.onConflict,'user_id');saves++;return{error:options.saveError?{}:null}}};
 const client={from:(name:string)=>{assert.equal(name,'google_sheets_site_backup');return table},rpc:async(name:string)=>{calls.push(name);return{data:name==='claim_google_sheets_sync'?{allowed:!options.deniedClaim,sheet_tab_name:'Own tab'}:true}}};
 const dependencies:Record<string,unknown>={
  'next/server':{NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)}},
  '@/lib/sheet-backup-context':{backupContext:async()=>{if(options.unauthorized)throw new Error('Sessão inválida.');return{client,user:{id:'owner'},config:{tab:'Own tab'},permission:async()=>{if(options.revoked)throw new Error('Permission revoked');return{tab:'Own tab'}}}}},
  '@/lib/sheet-backup-codec':{sealBackup:(data:any)=>{assert.equal(data.userId,'owner');assert.equal(data.sheet.properties.title,'Own tab');assert.equal(Date.parse(data.expiresAt)-Date.parse(data.createdAt),7*86400000);return'new-encrypted'},openBackup:(_snapshot:string,_key:string,user:string,book:string)=>{assert.equal(user,'owner');assert.equal(book,'fixture-book');if(options.corrupt)throw new Error('Corrupt backup');return{createdAt,expiresAt:'2099-01-01',sheet:{properties:{sheetId:options.otherId?999:123,title:options.otherTab?'Other tab':'Own tab'}}}}},
  '@/lib/sheet-native-snapshot':{nativeSnapshot:(sheet:unknown)=>sheet,replaceNativeSheet:()=>[]},
  '@/lib/sheet-native-features':{featureSummary:()=>['2 agrupamentos de linhas']},
  '@/lib/sheet-design-service':{
   readRegisteredSheet:async(tab:string)=>{assert.equal(tab,'Own tab');calls.push('read');return{target,spreadsheetId:'fixture-book'}},
   sheetFingerprint:()=>options.stale?'b'.repeat(64):fingerprint,
   restoreRegisteredSheet:async(current:any,snapshot:any,permission:()=>Promise<void>)=>{if(current.target.properties.sheetId!==snapshot.properties.sheetId)throw new Error('Other sheet');await permission();writes++;if(options.writeError)throw new Error('Network error');return{success:true}},
  },
 };
 const module={exports:{} as {GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>}};
 new Function('require','module','exports','process',compiled)((name:string)=>dependencies[name],module,module.exports,{env:{GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:'fixture',GOOGLE_SHEETS_SPREADSHEET_ID:'fixture-book'}});
 return{calls,saves:()=>saves,writes:()=>writes,request:(action='restore',body:Record<string,unknown>={})=>{const get=action==='status'||action==='preview';return module.exports[get?'GET':'POST'](new Request(`http://local.test/api/google-sheets/backup${action==='preview'?'?preview=restore':''}`,{method:get?'GET':'POST',...(!get?{body:JSON.stringify({action,confirm:true,fingerprint,backupCreatedAt:createdAt,...body})}:{})}))}};
}
test('backup status/preview are read-only and never return encrypted contents',async()=>{const r=route();for(const action of ['status','preview']){const response=await r.request(action);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(!JSON.stringify(await response.json()).includes('encrypted'))}assert.equal(r.saves(),0);assert.equal(r.writes(),0);assert.ok(!r.calls.includes('claim_google_sheets_sync'))});
test('backup save uses only owned registered tab and one atomic upsert',async()=>{const r=route();assert.equal((await r.request('save',{userId:'forged',tab:'forged'})).status,200);assert.equal(r.saves(),1);assert.equal(r.writes(),0)});
test('backup save failure preserves previous row without deletion',async()=>{const r=route({saveError:true});const response=await r.request('save');assert.equal(response.status,422);assert.match((await response.json()).error,/anterior não foi removida/);assert.equal(r.writes(),0)});
test('unauthenticated and revoked permission cannot save or restore',async()=>{for(const action of ['save','restore'])for(const option of [{unauthorized:true},{revoked:true}]){const r=route(option);assert.ok((await r.request(action)).status>=400);assert.equal(r.saves(),0);assert.equal(r.writes(),0)}});
test('expired backup is hidden and cannot restore',async()=>{const r=route({expired:true});assert.deepEqual(await (await r.request('status')).json(),{backup:null});assert.equal((await r.request()).status,422);assert.equal(r.writes(),0)});
test('corrupt, changed, mismatched or stale backup cannot overwrite current sheet',async()=>{for(const option of [{corrupt:true},{stale:true},{otherTab:true},{otherId:true}]){const r=route(option);assert.equal((await r.request()).status,422);assert.equal(r.writes(),0);assert.ok(r.calls.includes('complete_google_sheets_sync'))}});
test('restore requires explicit confirmation and unchanged backup identity',async()=>{for(const body of [{confirm:false},{fingerprint:'bad'},{backupCreatedAt:'changed'}]){const r=route();assert.equal((await r.request('restore',body)).status,422);assert.equal(r.writes(),0)}});
test('restore claim precedes fresh sheet read and blocks on cooldown',async()=>{const r=route();assert.equal((await r.request()).status,200);assert.equal(r.writes(),1);assert.ok(r.calls.indexOf('claim_google_sheets_sync')<r.calls.indexOf('read'));const denied=route({deniedClaim:true});assert.equal((await denied.request()).status,422);assert.ok(!denied.calls.includes('read'));assert.equal(denied.writes(),0)});
test('uncertain restore response never retries and requires sheet inspection',async()=>{const r=route({writeError:true}),response=await r.request();assert.equal(response.status,502);assert.equal((await response.json()).checkSheet,true);assert.equal(r.writes(),1)});
