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
    {post_url:'https://x.com/test/status/100',published_at:'2026-08-03',views:10,likes:2,sheets_is_special:false},
    {post_url:'https://x.com/test/status/200',published_at:'2026-08-04',views:20,likes:3,special_reward:300,mission_name:'Video Mission',sheets_is_special:true},
    {post_url:'https://x.com/test/status/300',published_at:'2026-08-05',views:30,likes:4,sheets_is_special:false},
    {post_url:'https://x.com/test/status/400',published_at:'2026-08-06',views:40,likes:5,special_reward:200,mission_name:'High Quality',sheets_is_special:true},
    {post_url:'https://x.com/test/status/500',published_at:'2026-07-31',views:50,likes:6,sheets_is_special:false},
  ]);

  assert.equal(plan.normalCount,2);
  assert.equal(plan.specialCount,2);
  assert.equal(plan.skippedOutsideMonth,1);
  assert.equal(plan.updates.length,20);
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!E102"));
  assert.ok(plan.updates.some(update=>update.range==="'ANONIMOUS'!N103"));
  assert.ok(plan.updates.every(update=>!/[BDHKMQ]\d+$/.test(update.range)));
});

test('escapes apostrophes in a sheet tab name',()=>{
  const plan=planSheetUpdates("D'Angelo",referenceRows(),[
    {post_url:'https://x.com/test/status/100',published_at:'2026-08-03',views:1,likes:1},
  ]);
  assert.ok(plan.updates.every(update=>update.range.startsWith("'D''Angelo'!")));
});

test('fails safely when the expected table headers are missing',()=>{
  assert.throws(()=>planSheetUpdates('Página1',[],[]),/cabeçalhos/);
});

