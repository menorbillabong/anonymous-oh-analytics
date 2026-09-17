import assert from 'node:assert/strict';
import test from 'node:test';
import {planSheetUpdates} from '../lib/google-sheets-plan.ts';
import {removeManualNote,sheetBatchRequests} from '../lib/google-sheets-batch.ts';
const config={allowed:true,enabled:true,amount:150,seed:'seed',period_id:1,start_date:'2026-09-01',revision:'1'};
const rows=[['Content Link','Likes','','Content Link','Likes','Reward']];
const posts=[{post_url:'https://x.com/a/status/1',published_at:'2026-09-02',likes:10},{post_url:'https://x.com/a/status/2',published_at:'2026-09-03',likes:20,sheets_is_special:true}];
const legacyNote='[AOH MANUAL ADJUSTMENT]\nX likes: 10\nManual adjustment: +150\nTotal: 160\n[/AOH MANUAL ADJUSTMENT]';
const likeValues=(plan:ReturnType<typeof planSheetUpdates>)=>plan.updates.filter(u=>/![BE][2-9]\d*$/.test(u.range));

test('sheet gets exactly real plus 150 and visible headers without creating notes',()=>{
 const plan=planSheetUpdates('Tab',rows,posts,'2026-09',config);
 assert.equal(plan.manualLikes,150);
 assert.equal(likeValues(plan).reduce((a,u)=>a+Number(u.values[0][0]),0),180);
 assert.equal(plan.updates.filter(u=>u.values[0][0]==='Likes (X + manual)').length,2);
 assert.deepEqual(planSheetUpdates('Tab',rows,posts,'2026-09',config),plan);
 const requests=sheetBatchRequests(plan.updates,7,new Map());
 assert.ok(requests.every(r=>r.updateCells.fields==='userEnteredValue'));
 assert.ok(requests.every(r=>!('note' in r.updateCells.rows[0].values[0])));
});
test('disabling or revoking restores original values with no accumulating extras',()=>{
 for(const settings of [{...config,enabled:false},{...config,allowed:false}]){
 const plan=planSheetUpdates('Tab',rows,posts,'2026-09',settings);
 assert.equal(plan.manualLikes,0);
 assert.equal(likeValues(plan).reduce((a,u)=>a+Number(u.values[0][0]),0),30);
 }
});
test('missing month or likes column rejects incomplete distribution before writes',()=>{
 assert.throws(()=>planSheetUpdates('Tab',rows,posts,'2026-08',config),/MISMATCH/);
 assert.throws(()=>planSheetUpdates('Tab',[['Content Link','','','Content Link']],posts,'2026-09',config),/MISMATCH/);
});
test('batch writes only values when no system note exists, preserving personal notes',()=>{
 const requests=sheetBatchRequests([{range:"'Tab'!AA2",values:[['=not-a-formula']]},{range:"'Tab'!B3",values:[[160]]}],7,new Map([['2:1','Keep me']]));
 assert.equal(requests.length,2);
 assert.equal(requests[0].updateCells.range.startColumnIndex,26);
 assert.deepEqual(requests[0].updateCells.rows[0].values[0].userEnteredValue,{stringValue:'=not-a-formula'});
 assert.equal(requests[0].updateCells.fields,'userEnteredValue');
 assert.equal(requests[1].updateCells.fields,'userEnteredValue');
 assert.equal(requests[1].updateCells.rows[0].values[0].note,undefined);
});

test('legacy note removal preserves personal text and incomplete or unrelated annotations',()=>{
 assert.equal(removeManualNote(legacyNote),'');
 assert.equal(removeManualNote(`My original note\n${legacyNote}`),'My original note');
 assert.equal(removeManualNote(`My original note\r\n${legacyNote}`),'My original note');
 assert.equal(removeManualNote(`${legacyNote}\nKeep after`),'\nKeep after');
 assert.equal(removeManualNote(`${legacyNote}\n${legacyNote}`),'');
 for(const note of ['Personal note','X likes: 10','[AOH MANUAL ADJUSTMENT]\nIncomplete'])assert.equal(removeManualNote(note),note);
 assert.equal(removeManualNote(removeManualNote(`Keep\n${legacyNote}`)),'Keep');
});

test('cleans legacy cell and header notes even when those cells are not otherwise updated',()=>{
 const notes=new Map([['0:1',legacyNote],['2:1',`Keep me\n${legacyNote}`],['8:4','Personal note']]);
 const requests=sheetBatchRequests([{range:"'Tab'!B3",values:[[160]]}],7,notes);
 assert.equal(requests.length,3);
 assert.deepEqual(requests[0].updateCells.rows[0].values[0].userEnteredValue,{numberValue:160});
 const cleanup=requests.slice(1).map(r=>r.updateCells);
 assert.deepEqual(cleanup.map(c=>c.fields),['note','note']);
 assert.deepEqual(cleanup.map(c=>c.rows[0].values[0]),[{note:''},{note:'Keep me'}]);
 assert.ok(cleanup.every(c=>c.range.sheetId===7));
 assert.deepEqual(cleanup.map(c=>[c.range.startRowIndex,c.range.startColumnIndex]),[[0,1],[2,1]]);
 assert.equal(sheetBatchRequests([],7,notes).length,2);
 assert.deepEqual(sheetBatchRequests([],7,new Map([['2:1','Keep me']])),[]);
});

test('cleanup is idempotent and the adjusted totals remain identical after another sync',()=>{
 const plan=planSheetUpdates('Tab',rows,posts,'2026-09',config);
 const existing=new Map([['1:1',`Keep\n${legacyNote}`]]);
 const first=sheetBatchRequests(plan.updates,7,existing);
 const cleaned=new Map([...existing].map(([key,note])=>[key,removeManualNote(note)]));
 const second=sheetBatchRequests(plan.updates,7,cleaned);
 assert.deepEqual(first.filter(r=>r.updateCells.fields==='userEnteredValue'),second);
 assert.equal(second.length,plan.updates.length);
});
