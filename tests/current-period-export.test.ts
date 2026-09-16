import assert from 'node:assert/strict';
import test from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {currentPeriodExportPosts,exportMessages,loadCurrentPeriodExport} from '../lib/current-period-export.ts';
import {buildPostsCsv,buildPostsTxt} from '../lib/csv-export.ts';

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

function fixture(options:{noPeriod?:boolean;changed?:boolean;corrected?:boolean;error?:boolean;expired?:boolean;switched?:boolean;empty?:boolean}={}){
 const calls:unknown[][]=[];
 let reads=0,authReads=0;
 const client={
  auth:{getUser:async()=>({data:{user:{id:options.expired||options.switched&&++authReads>1?'other':'self'}},error:null})},
  rpc:async(name:string)=>{calls.push(['rpc',name]);reads++;return {data:options.noPeriod?{id:null,start_date:null}:options.changed&&reads>1?{...period,id:2}:options.corrected&&reads>1?{...period,start_date:'2026-09-02'}:period,error:null}},
  from:(table:string)=>{
   calls.push(['from',table]);
   const query={
    select:(columns:string)=>{calls.push(['select',columns]);return query},
    eq:(column:string,value:unknown)=>{calls.push(['eq',column,value]);return query},
    order:(column:string,config:unknown)=>{calls.push(['order',column,config]);return query},
    range:async(start:number,end:number)=>{calls.push(['range',start,end]);return {data:options.empty?[]:rows.slice(start,start+2),error:options.error?{message:'fail'}:null}},
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
 const selected=await loadCurrentPeriodExport(client,'self',now);
 assert.equal(selected.length,2);
 assert.deepEqual(calls.filter(call=>call[0]==='range').map(call=>call[1]),[0,2,4,6]);
 assert.equal(calls.filter(call=>call[0]==='eq'&&call[1]==='user_id'&&call[2]==='self').length,4);
 assert.equal(calls.filter(call=>call[0]==='eq'&&call[1]==='counting_excluded'&&call[2]===false).length,4);
 assert.equal(calls.filter(call=>call[0]==='order'&&call[1]==='id').length,4);
});

for(const [option,message] of Object.entries({noPeriod:exportMessages.noPeriod,changed:exportMessages.changed,corrected:exportMessages.changed,error:exportMessages.failed,expired:exportMessages.session,switched:exportMessages.session,empty:exportMessages.empty})){
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

test('TXT flattens embedded separators and neutralizes formula-like values',()=>{
 const text=buildPostsTxt([{mission_name:'Fotos\tHQ\nTeste',published_at:'2026-09-10',post_url:'=HYPERLINK("x")\t\n',views:'invalid',likes:null}]);
 assert.match(text,/MISSÃO: Fotos HQ Teste/);
 assert.match(text,/\t'=HYPERLINK\("x"\) \t0\t0/);
 assert.equal(text.split('\r\n').filter(Boolean).length,3);
});
