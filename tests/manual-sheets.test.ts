import assert from 'node:assert/strict';
import test from 'node:test';
import {planSheetUpdates} from '../lib/google-sheets-plan.ts';
import {mergeManualNote,sheetBatchRequests} from '../lib/google-sheets-batch.ts';
const config={allowed:true,enabled:true,amount:150,seed:'seed',period_id:1,start_date:'2026-09-01',revision:'1'};
const rows=[['Content Link','Likes','','Content Link','Likes','Reward']];
const posts=[{post_url:'https://x.com/a/status/1',published_at:'2026-09-02',likes:10},{post_url:'https://x.com/a/status/2',published_at:'2026-09-03',likes:20,sheets_is_special:true}];
test('sheet gets exactly real plus 150, visible headers and individual notes',()=>{
 const plan=planSheetUpdates('Tab',rows,posts,'2026-09',config);
 assert.equal(plan.manualLikes,150);
 assert.equal(plan.updates.filter(u=>u.manualNote?.startsWith('X likes')).reduce((a,u)=>a+Number(u.values[0][0]),0),180);
 assert.equal(plan.updates.filter(u=>u.values[0][0]==='Likes (X + manual)').length,2);
 assert.deepEqual(planSheetUpdates('Tab',rows,posts,'2026-09',config),plan);
});
test('disabling or revoking restores original values with no accumulating extras',()=>{
 for(const settings of [{...config,enabled:false},{...config,allowed:false}]){
 const plan=planSheetUpdates('Tab',rows,posts,'2026-09',settings);
 assert.equal(plan.manualLikes,0);
 assert.equal(plan.updates.filter(u=>u.manualNote!==undefined).reduce((a,u)=>a+Number(u.values[0][0]),0),30);
 }
});
test('missing month or likes column rejects incomplete distribution before writes',()=>{
 assert.throws(()=>planSheetUpdates('Tab',rows,posts,'2026-08',config),/MISMATCH/);
 assert.throws(()=>planSheetUpdates('Tab',[['Content Link','','','Content Link']],posts,'2026-09',config),/MISMATCH/);
});
test('batch changes only values and owned annotations, preserving user notes and formulas as text',()=>{
 const old=mergeManualNote('My original note','old');
 assert.equal(mergeManualNote(old,''),'My original note');
 assert.equal(mergeManualNote(mergeManualNote(old,'new'),'new'),mergeManualNote(old,'new'));
 const requests=sheetBatchRequests([{range:"'Tab'!AA2",values:[['=not-a-formula']]},{range:"'Tab'!B3",values:[[160]],manualNote:'X likes: 10\nManual adjustment: +150'}],7,new Map([['2:1','Keep me']]));
 assert.equal(requests[0].updateCells.range.startColumnIndex,26);
 assert.deepEqual(requests[0].updateCells.rows[0].values[0].userEnteredValue,{stringValue:'=not-a-formula'});
 assert.equal(requests[0].updateCells.fields,'userEnteredValue');
 assert.ok(requests[1].updateCells.rows[0].values[0].note?.startsWith('Keep me'));
});
