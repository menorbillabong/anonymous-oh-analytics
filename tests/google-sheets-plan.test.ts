import assert from 'node:assert/strict';
import test from 'node:test';
import {planSheetUpdates} from '../lib/google-sheets-plan.ts';

function referenceRows(){
  const rows:unknown[][]=Array.from({length:140},()=>[]);
  rows[2]=['','Settlement Month','2026-08'];
  rows[100]=['','Month','Publish Date','Platform','Content Link','Impressions / Views','Likes','Eligible','','','Month','Publish Date','Platform','Content Link','Impressions / Views','Likes','Eligible','Reward','Theme'];
  rows[101]=['','','','','https://x.com/test/status/100/photo/1'];
  rows[102]=['','','','','','','','','','','','','','https://x.com/test/status/200/video/1'];
  return rows;
}

test('updates existing links and appends only posts from the selected month',()=>{
  const plan=planSheetUpdates('ANONIMOUS',referenceRows(),[
    {post_url:'https://x.com/test/status/100',network:'x',published_at:'2026-08-03',views:10,likes:2,sheets_is_special:false},
    {post_url:'https://x.com/test/status/200',network:'twitter',published_at:'2026-08-04',views:20,likes:3,special_reward:300,mission_name:'Video Mission',sheets_is_special:true},
    {post_url:'https://x.com/test/status/300',published_at:'2026-08-05',views:30,likes:4,sheets_is_special:false},
    {post_url:'https://x.com/test/status/400',published_at:'2026-08-06',views:40,likes:5,special_reward:200,mission_name:'High Quality',sheets_is_special:true},
    {post_url:'https://x.com/test/status/500',published_at:'2026-07-31',views:50,likes:6,sheets_is_special:false},
  ]);

  assert.equal(plan.normalCount,2);
  assert.equal(plan.specialCount,2);
  assert.equal(plan.skippedOutsideMonth,1);
  assert.equal(plan.updates.length,24);
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!E102"));
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!N103"));
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!D102"&&update.values[0][0]==='X'));
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!M103"&&update.values[0][0]==='X'));
  const platformUpdates=plan.updates.filter(update=>/[DM]\d+$/.test(update.range));
  assert.equal(platformUpdates.length,4);
  assert.ok(platformUpdates.every(update=>update.values[0][0]==='X'));
  assert.ok(plan.updates.every(update=>!/[BHKQ]\d+$/.test(update.range)));
});

test('escapes apostrophes in a sheet tab name',()=>{
  const plan=planSheetUpdates("D'Angelo",referenceRows(),[
    {post_url:'https://x.com/test/status/100',published_at:'2026-08-03',views:1,likes:1},
  ]);
  assert.ok(plan.updates.every(update=>update.range.startsWith("'D''Angelo'!")));
});

test('fills a manually selected Month only when the target cell is empty',()=>{
  const rows=referenceRows();
  rows[101]![1]='MANTER ESTE VALOR';
  const plan=planSheetUpdates('ANONIMOUS',rows,[
    {post_url:'https://x.com/test/status/100',published_at:'2026-08-03',views:10,likes:2},
    {post_url:'https://x.com/test/status/200',published_at:'2026-08-04',views:20,likes:3,sheets_is_special:true},
    {post_url:'https://x.com/test/status/300',published_at:'2026-08-05',views:30,likes:4},
  ],'2026-08');

  assert.ok(!plan.updates.some(update=>update.range==="'ANONIMOUS'!B102"));
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!K103"&&update.values[0][0]==='2026-08'));
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!B103"&&update.values[0][0]==='2026-08'));
});

test('uses the manual month to select new posts and ignores Month when it is empty',()=>{
  const manual=planSheetUpdates('ANONIMOUS',referenceRows(),[
    {post_url:'https://x.com/test/status/300',published_at:'2026-08-05',views:30,likes:4},
    {post_url:'https://x.com/test/status/500',published_at:'2026-07-31',views:50,likes:6},
  ],'2026-07');
  assert.equal(manual.normalCount,1);
  assert.equal(manual.skippedOutsideMonth,1);
  assert.ok(manual.updates.some(update=>/!B\d+$/.test(update.range)&&update.values[0][0]==='2026-07'));

  const empty=planSheetUpdates('ANONIMOUS',referenceRows(),[
    {post_url:'https://x.com/test/status/300',published_at:'2026-08-05',views:30,likes:4},
  ],'');
  assert.ok(empty.updates.every(update=>!/[BK]\d+$/.test(update.range)));
});

test('moves an existing normal publication to Special Mission without changing its historical reward and theme',()=>{
  const plan=planSheetUpdates('ANONIMOUS',referenceRows(),[
    {post_url:'https://x.com/test/status/100',published_at:'2026-08-03',views:10,likes:2,sheets_is_special:true,special_reward:200,mission_name:'High Quality'},
  ]);

  assert.equal(plan.normalCount,0);
  assert.equal(plan.specialCount,1);
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!E102"&&update.values[0][0]===''));
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!N104"&&update.values[0][0]==='https://x.com/test/status/100'));
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!R104"&&update.values[0][0]===200));
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!S104"&&update.values[0][0]==='High Quality'));
});

test('moves an existing special publication to Normal Mission and clears duplicate placements',()=>{
  const rows=referenceRows();
  rows[103]=['','','','','https://x.com/test/status/200/photo/1'];
  const plan=planSheetUpdates('ANONIMOUS',rows,[
    {post_url:'https://x.com/test/status/200',published_at:'2026-08-04',views:20,likes:3,sheets_is_special:false,special_reward:300,mission_name:'Video Mission'},
  ]);

  assert.equal(plan.normalCount,1);
  assert.equal(plan.specialCount,0);
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!E104"&&update.values[0][0]==='https://x.com/test/status/200'));
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!N103"&&update.values[0][0]===''));
});

test('finds the Gaucho_07 columns by their names even when both tables start earlier',()=>{
  const rows:unknown[][]=Array.from({length:80},()=>[]);
  rows[2]=['Settlement Month (YYYY-MM)','2026-08'];
  rows[30]=['Month','Publish Date','Platform','Content Link','Impressions / Views','Likes','Eligible','','','Month','Publish Date','Platform','Content Link','Impressions / Views','Likes','Eligible','Reward','Theme'];
  rows[31]=['2026-08','2026-08-01','X','https://x.com/test/status/100','','','','','','2026-08','2026-08-02','X','https://x.com/test/status/200'];

  const plan=planSheetUpdates('Gaucho_07',rows,[
    {post_url:'https://x.com/test/status/100',published_at:'2026-08-01',views:110,likes:11,sheets_is_special:false},
    {post_url:'https://x.com/test/status/200',published_at:'2026-08-02',views:220,likes:22,sheets_is_special:true,special_reward:300,mission_name:'Vídeos especiais'},
    {post_url:'https://x.com/test/status/300',published_at:'2026-08-03',views:330,likes:33,sheets_is_special:false},
  ],'2026-08');

  assert.equal(plan.normalCount,2);
  assert.equal(plan.specialCount,1);
  assert.ok(plan.updates.some(update=>update.range==="'Gaucho_07'!D32"&&update.values[0][0]==='https://x.com/test/status/100'));
  assert.ok(plan.updates.some(update=>update.range==="'Gaucho_07'!M32"&&update.values[0][0]==='https://x.com/test/status/200'));
  assert.ok(plan.updates.some(update=>update.range==="'Gaucho_07'!B33"&&update.values[0][0]==='2026-08-03'));
  assert.ok(plan.updates.some(update=>update.range==="'Gaucho_07'!Q32"&&update.values[0][0]===300));
  assert.ok(plan.updates.some(update=>update.range==="'Gaucho_07'!R32"&&update.values[0][0]==='Vídeos especiais'));
});

test('uses header names when columns are reordered inside each side',()=>{
  const rows:unknown[][]=Array.from({length:20},()=>[]);
  rows[1]=['Settlement Month','2026-08'];
  rows[5]=['','Content Link','Likes','Month','Platform','Publish Date','Eligible','Impressions / Views','','','Theme','Reward','Likes','Content Link','Month','Impressions / Views','Publish Date','Platform','Eligible'];

  const plan=planSheetUpdates('FLEXIVEL',rows,[
    {post_url:'https://x.com/test/status/400',published_at:'2026-08-04',views:44,likes:4,sheets_is_special:false},
    {post_url:'https://x.com/test/status/500',published_at:'2026-08-05',views:55,likes:5,sheets_is_special:true,special_reward:200,mission_name:'High Quality'},
  ],'2026-08');

  assert.ok(plan.updates.some(update=>update.range==="'FLEXIVEL'!B7"&&update.values[0][0]==='https://x.com/test/status/400'));
  assert.ok(plan.updates.some(update=>update.range==="'FLEXIVEL'!F7"&&update.values[0][0]==='2026-08-04'));
  assert.ok(plan.updates.some(update=>update.range==="'FLEXIVEL'!N7"&&update.values[0][0]==='https://x.com/test/status/500'));
  assert.ok(plan.updates.some(update=>update.range==="'FLEXIVEL'!K7"&&update.values[0][0]==='High Quality'));
  assert.ok(plan.updates.some(update=>update.range==="'FLEXIVEL'!L7"&&update.values[0][0]===200));
});

test('ignores optional columns that are absent from either section',()=>{
  const rows=referenceRows();
  rows[100]![2]='';
  rows[100]![3]='';
  rows[100]![5]='';
  rows[100]![11]='';
  rows[100]![12]='';
  rows[100]![14]='';
  rows[100]![15]='';
  rows[100]![18]='';
  const plan=planSheetUpdates('Página1',rows,[
    {post_url:'https://x.com/test/status/300',published_at:'2026-08-05',views:30,likes:4,sheets_is_special:false},
    {post_url:'https://x.com/test/status/400',published_at:'2026-08-06',views:40,likes:5,special_reward:200,mission_name:'High Quality',sheets_is_special:true},
  ]);

  assert.equal(plan.normalCount,1);
  assert.equal(plan.specialCount,1);
  assert.deepEqual(plan.updates.map(update=>update.range),["'Página1'!E103","'Página1'!G103","'Página1'!N104","'Página1'!R104"]);
});

test('fails safely when either essential Content Link column is absent',()=>{
  const rows=referenceRows();
  rows[100]![4]='';
  assert.throws(()=>planSheetUpdates('Página1',rows,[]),/Content Link/);
});

test('fails safely when the expected table headers are missing',()=>{
  assert.throws(()=>planSheetUpdates('Página1',[],[]),/cabeçalhos/);
});

