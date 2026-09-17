import assert from 'node:assert/strict';
import test from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {currentPeriodExportPosts,exportMessages,loadCurrentPeriodExport} from '../lib/current-period-export.ts';
import {buildPostsCsv,buildPostsTxt} from '../lib/csv-export.ts';
import {applyManualLikes,distributeManualLikes,emptyManualAdjustment,type ManualLikeAdjustment} from '../lib/manual-like-adjustment.ts';
import {planSheetUpdates} from '../lib/google-sheets-plan.ts';

const period={id:1,start_date:'2026-08-31'};
const now=new Date('2026-09-16T12:00:00Z');
const rows=[
 {id:1,user_id:'self',post_url:'https://x.com/a/status/1',published_at:'2026-08-30',counting_excluded:false},
 {id:2,user_id:'self',post_url:'https://x.com/a/status/2',published_at:'2026-08-31',counting_excluded:false},
 {id:3,user_id:'self',post_url:'https://x.com/a/status/3',published_at:'2026-09-01',counting_excluded:true},
 {id:4,user_id:'self',post_url:'https://x.com/a/status/4',x_published_at:'2026-09-17T02:59:59Z',counting_excluded:false},
 {id:5,user_id:'self',post_url:'https://x.com/a/status/5',x_published_at:'2026-09-17T03:00:00Z',counting_excluded:false},
 {id:6,user_id:'self',post_url:'https://x.com/a/status/6',published_at:'invalid',counting_excluded:false},
];

const adjustment={...emptyManualAdjustment,period_id:period.id,start_date:period.start_date};
const enabledAdjustment={...adjustment,allowed:true,enabled:true,amount:150,seed:'saved-seed',revision:'saved-revision'};
type FixtureOptions={noPeriod?:boolean;changed?:boolean;corrected?:boolean;error?:boolean;expired?:boolean;switched?:boolean;empty?:boolean;
 adjustment?:ManualLikeAdjustment;latestAdjustment?:ManualLikeAdjustment;adjustmentError?:boolean;latestAdjustmentError?:boolean;missingAdjustment?:boolean;sourceRows?:typeof rows;pageSize?:number};
function fixture(options:FixtureOptions={}){
 const calls:unknown[][]=[];
 let reads=0,authReads=0,adjustmentReads=0;
 const client={
  auth:{getUser:async()=>({data:{user:{id:options.expired||options.switched&&++authReads>1?'other':'self'}},error:null})},
  rpc:async(name:string)=>{
   calls.push(['rpc',name]);
   if(name==='get_my_manual_like_adjustment'){
    adjustmentReads++;
    return {data:options.missingAdjustment?null:adjustmentReads>1&&options.latestAdjustment?options.latestAdjustment:options.adjustment||adjustment,
     error:options.adjustmentError||options.latestAdjustmentError&&adjustmentReads>1?{message:'fail'}:null};
   }
   assert.equal(name,'get_my_active_period');
   reads++;return {data:options.noPeriod?{id:null,start_date:null}:options.changed&&reads>1?{...period,id:2}:options.corrected&&reads>1?{...period,start_date:'2026-09-02'}:period,error:null};
  },
  from:(table:string)=>{
   calls.push(['from',table]);
   const query={
    select:(columns:string)=>{calls.push(['select',columns]);return query},
    eq:(column:string,value:unknown)=>{calls.push(['eq',column,value]);return query},
    order:(column:string,config:unknown)=>{calls.push(['order',column,config]);return query},
    range:async(start:number,end:number)=>{calls.push(['range',start,end]);return {data:options.empty?[]:(options.sourceRows||rows).slice(start,Math.min(end+1,start+(options.pageSize||2))),error:options.error?{message:'fail'}:null}},
   };
   return query;
  },
 } as unknown as SupabaseClient;
 return {client,calls};
}

test('exports only non-closed posts between open start and today in site timezone',()=>{
 const selected=currentPeriodExportPosts(rows,period,'2026-09-16');
 assert.deepEqual(selected.map(row=>row.post_url),[rows[1].post_url,rows[3].post_url]);
 for(const build of [buildPostsCsv,buildPostsTxt]){
  assert.match(build(selected),/status\/2/);
  assert.match(build(selected),/status\/4/);
  for(const excluded of [1,3,5,6])assert.doesNotMatch(build(selected),new RegExp(`status/${excluded}`));
 }
 assert.deepEqual(currentPeriodExportPosts(rows,null,'2026-09-16'),[]);
});

test('loads all pages with stable ordering and own-user/active filters',async()=>{
 const {client,calls}=fixture();
 const {posts:selected,manualLikes}=await loadCurrentPeriodExport(client,'self',now);
 assert.equal(selected.length,2);
 assert.equal(manualLikes,0);
 assert.deepEqual(calls.filter(call=>call[0]==='range').map(call=>call[1]),[0,2,4,6]);
 assert.equal(calls.filter(call=>call[0]==='eq'&&call[1]==='user_id'&&call[2]==='self').length,4);
 assert.equal(calls.filter(call=>call[0]==='eq'&&call[1]==='counting_excluded'&&call[2]===false).length,4);
 assert.equal(calls.filter(call=>call[0]==='order'&&call[1]==='id').length,4);
});

for(const [option,message] of Object.entries({noPeriod:exportMessages.noPeriod,changed:exportMessages.changed,corrected:exportMessages.changed,error:exportMessages.failed,expired:exportMessages.session,switched:exportMessages.session,empty:exportMessages.empty,adjustmentError:exportMessages.failed,latestAdjustmentError:exportMessages.failed,missingAdjustment:exportMessages.failed})){
 test(`refuses export when ${option}`,async()=>{
  const {client,calls}=fixture({[option]:true});
  await assert.rejects(loadCurrentPeriodExport(client,'self',now),{message});
  if(option==='noPeriod'||option==='expired')assert.equal(calls.filter(call=>call[0]==='from').length,0);
 });
}

test('TXT has real tabs, five columns per publication, mission grouping and ascending dates',()=>{
 const text=buildPostsTxt([
  {mission_name:'Fotos',published_at:'2026-09-12',post_url:'https://x.com/a/status/2',views:20,likes:3},
  {mission_name:'Fotos',published_at:'2026-09-10',post_url:'https://x.com/a/status/1',views:10,likes:2},
  {mission_name:'Vídeos',published_at:'2026-09-11',post_url:'https://x.com/a/status/3'},
 ]);
 assert.ok(text.startsWith('MISSÃO: Fotos\r\nData\tRede\tLink\tVisualizações\tCurtidas\r\n'));
 assert.ok(text.indexOf('status/1')<text.indexOf('status/2'));
 assert.match(text,/\r\n\r\nMISSÃO: Vídeos/);
 for(const row of text.split('\r\n').filter(row=>row.includes('https://')))assert.equal(row.split('\t').length,5);
 assert.equal(buildPostsTxt([]),'');
});

test('TXT and CSV add exactly the saved total across missions and pages, without changing raw posts or accumulating',async()=>{
 const sourceRows=rows.map(row=>({...row,likes:10,views:100,mission_name:row.id===2?'Fotos':'Vídeos'}));
 const original=structuredClone(sourceRows);
 const options={sourceRows,adjustment:enabledAdjustment};
 const first=await loadCurrentPeriodExport(fixture(options).client,'self',now);
 const second=await loadCurrentPeriodExport(fixture(options).client,'self',now);
 assert.equal(first.manualLikes,150);
 assert.equal(first.posts.reduce((sum,post)=>sum+Number(post.likes),0),170);
 assert.deepEqual(first,second);
 assert.deepEqual(sourceRows,original);
 const eligible=currentPeriodExportPosts(sourceRows,period,'2026-09-16');
 // Same allocation helper/seed as Google Sheets; excluded and future rows get no extras.
 const sheetAllocation=distributeManualLikes(sourceRows,enabledAdjustment,'2026-09-16');
 assert.deepEqual(first.posts,applyManualLikes(eligible,sheetAllocation));
 for(const build of [buildPostsCsv,buildPostsTxt]){
  const output=build(first.posts,first.manualLikes);
  assert.match(output,/Curtidas \(X \+ manual\)/);
  const lines=output.split('\r\n').filter(line=>line.includes('https://'));
  assert.equal(lines.length,2);
  let likes=0;
  for(const line of lines){
   const cells=build===buildPostsTxt?line.split('\t'):line.slice(1,-1).split('","');
   assert.equal(cells.length,5);
   assert.equal(cells[3],'100');
   likes+=Number(cells[4]);
  }
  assert.equal(likes,170);
 }
});

for(const [name,config] of Object.entries({disabled:{...enabledAdjustment,enabled:false},revoked:{...enabledAdjustment,allowed:false},zero:{...enabledAdjustment,amount:0},unset:adjustment})){
 test(`${name} exports raw likes in both formats`,async()=>{
  const sourceRows=rows.map(row=>({...row,likes:10}));
  const result=await loadCurrentPeriodExport(fixture({sourceRows,adjustment:config}).client,'self',now);
  assert.equal(result.manualLikes,0);
  assert.deepEqual(result.posts,currentPeriodExportPosts(sourceRows,period,'2026-09-16'));
  for(const build of [buildPostsCsv,buildPostsTxt])assert.doesNotMatch(build(result.posts,result.manualLikes),/X \+ manual/);
 });
}

for(const [name,latest] of Object.entries({disabled:{enabled:false},revoked:{allowed:false},amount:{amount:151},seed:{seed:'new'},revision:{revision:'new'},period:{period_id:2},start:{start_date:'2026-09-01'}})){
 test(`refuses stale adjustment when ${name} changes during download`,async()=>{
  const {client}=fixture({adjustment:enabledAdjustment,latestAdjustment:{...enabledAdjustment,...latest}});
  await assert.rejects(loadCurrentPeriodExport(client,'self',now),{message:exportMessages.adjustmentChanged});
 });
}

test('refuses an adjustment belonging to a different period or start date',async()=>{
 for(const config of [{...enabledAdjustment,period_id:2},{...enabledAdjustment,start_date:'2026-09-01'}]){
  const {client,calls}=fixture({adjustment:config});
  await assert.rejects(loadCurrentPeriodExport(client,'self',now),{message:exportMessages.changed});
  assert.equal(calls.filter(call=>call[0]==='from').length,0);
 }
});

test('allocates once across more than 500 posts and gives duplicate X links no second extra',async()=>{
 const sourceRows=Array.from({length:1001},(_,i)=>({id:i+1,user_id:'self',post_url:`https://x.com/a/status/${i+1}`,published_at:'2026-09-01',counting_excluded:false,likes:1}));
 sourceRows.push({...sourceRows[0],id:1002,post_url:'https://twitter.com/a/status/1?s=20'});
 sourceRows.push({...sourceRows[0],id:1003,user_id:'other',post_url:'https://x.com/other/status/1003'});
 const {client,calls}=fixture({sourceRows,pageSize:500,adjustment:enabledAdjustment});
 const result=await loadCurrentPeriodExport(client,'self',now);
 assert.equal(result.posts.length,1002);
 assert.equal(result.posts.reduce((sum,post)=>sum+Number(post.likes),0),1002+150);
 assert.equal(result.posts.at(-1)?.likes,1);
 assert.deepEqual(calls.filter(call=>call[0]==='range').map(call=>call[1]),[0,500,1000,1003]);
});

test('exported per-post totals match the actual Sheets update plan',async()=>{
 const sourceRows=[
  {id:1,user_id:'self',post_url:'https://x.com/a/status/1',published_at:'2026-09-01',counting_excluded:false,likes:10},
  {id:2,user_id:'self',post_url:'https://x.com/a/status/2',published_at:'2026-09-02',counting_excluded:false,likes:20,sheets_is_special:true},
 ];
 const result=await loadCurrentPeriodExport(fixture({sourceRows,adjustment:enabledAdjustment}).client,'self',now);
 const plan=planSheetUpdates('Tab',[['Content Link','Likes','','Content Link','Likes','Reward']],sourceRows,'2026-09',enabledAdjustment);
 assert.equal(plan.manualLikes,result.manualLikes);
 assert.equal(plan.updates.find(update=>update.range==="'Tab'!B2")?.values[0][0],result.posts[0].likes);
 assert.equal(plan.updates.find(update=>update.range==="'Tab'!E2")?.values[0][0],result.posts[1].likes);
});

test('TXT flattens embedded separators and neutralizes formula-like values',()=>{
 const text=buildPostsTxt([{mission_name:'Fotos\tHQ\nTeste',published_at:'2026-09-10',post_url:'=HYPERLINK("x")\t\n',views:'invalid',likes:null}]);
 assert.match(text,/MISSÃO: Fotos HQ Teste/);
 assert.match(text,/\t'=HYPERLINK\("x"\) \t0\t0/);
 assert.equal(text.split('\r\n').filter(Boolean).length,3);
});
