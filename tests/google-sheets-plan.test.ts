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
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!B102:H102"&&update.values[0].every(value=>value==='')));
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
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!K103:S103"&&update.values[0].every(value=>value==='')));
});

test('fails safely when the expected table headers are missing',()=>{
  assert.throws(()=>planSheetUpdates('Página1',[],[]),/cabeçalhos/);
});

