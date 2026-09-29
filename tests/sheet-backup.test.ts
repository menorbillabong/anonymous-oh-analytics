import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sealBackup,openBackup,type SheetBackup} from '../lib/sheet-backup-codec.ts';
import {nativeSnapshot,replaceNativeSheet,wholeCellLinkRequest} from '../lib/sheet-native-snapshot.ts';
import {planSheetDesign,type DesignSheet} from '../lib/sheet-design-plan.ts';
const packed=JSON.parse(readFileSync(new URL('../lib/sheet-design-blueprints.json',import.meta.url),'utf8'));
const designs:DesignSheet[]=packed.sheets.map((s:any)=>({...s,data:s.data.map((g:any)=>({...g,rowData:g.rowData.map((r:any)=>({values:r.values.map((i:number)=>packed.cells[i])}))}))}));
const now=Date.now(),secret='fixture-only-secret';
const fixture:SheetBackup={version:1,userId:'owner',spreadsheetId:'book',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+7*86400000).toISOString(),sheet:designs[0]};
test('encrypted backup round trip preserves full native snapshot, no plaintext data',()=>{
 const encoded=sealBackup(fixture,secret);assert.ok(!encoded.includes('Once Human'));assert.deepEqual(openBackup(encoded,secret,'owner','book',now),fixture);
 assert.notEqual(sealBackup(fixture,secret),encoded);
});
test('forged, cross-account, cross-workbook, expired and rotated-key snapshots fail closed',()=>{
 const encoded=sealBackup(fixture,secret);
 for(const [value,key,user,book,time] of [[encoded,secret,'other','book',now],[encoded,secret,'owner','other',now],[encoded,'wrong','owner','book',now],[encoded,secret,'owner','book',now+7*86400000],[encoded+'x',secret,'owner','book',now]] as const)assert.throws(()=>openBackup(value,key,user,book,time));
});
for(const design of designs)test(`complete embedded ${design.properties.title} is independent of source tabs`,()=>{
 const target=structuredClone(design);target.properties.sheetId=987;target.properties.title='fixture';
 const plan=planSheetDesign(target,design,'','2026-09');
 assert.ok(plan.requests.length>20);assert.ok(!plan.requests.some(r=>r.copyPaste||r.duplicateSheet||r.addSheet));
 assert.ok(design.data?.[0].rowMetadata?.length);assert.equal(design.data?.[0].columnMetadata?.length,design.properties.gridProperties.columnCount);
 const formulas=design.data!.flatMap(g=>g.rowData!.flatMap(r=>r.values!.map(c=>c.userEnteredValue?.formulaValue).filter(Boolean)));
 assert.ok(formulas.some(f=>f!.includes('35000')));assert.ok(formulas.every(f=>!f!.includes('!')),'no live template references');
});
test('snapshot strips computed fields but preserves literal native cell structure',()=>{
 const input=structuredClone(designs[0]);const c=input.data![0].rowData![0].values![0];c.effectiveValue={stringValue:'computed'};c.formattedValue='computed';
 const snapshot=nativeSnapshot(input);assert.equal(snapshot.data![0].rowData![0].values![0].effectiveValue,undefined);
 assert.equal(c.effectiveValue.stringValue,'computed');assert.deepEqual(snapshot.merges,input.merges);
 const target=structuredClone(input);target.properties.sheetId=12;
 assert.ok(replaceNativeSheet(target,snapshot).filter(r=>r.mergeCells).every(r=>(r.mergeCells as any).range.sheetId===12));
});

test('whole-cell hyperlinks are restored after clearing text runs',()=>{
 const source=structuredClone(designs[0]);
 source.data![0].rowData![0].values![0]={userEnteredValue:{stringValue:'Post'},userEnteredFormat:{textFormat:{link:{uri:'https://x.com/fixture/status/123'}}}};
 const target=structuredClone(source);target.properties.sheetId=12;
 const requests=replaceNativeSheet(target,source);
 assert.deepEqual(requests.at(-1),wholeCellLinkRequest(12,0,0,source.data![0].rowData![0].values![0]));
 assert.equal((requests.at(-1)!.updateCells as any).fields,'userEnteredFormat.textFormat.link');
});

test('unsupported protected ranges block backup and replacement before writing',()=>{
 const source={...designs[0],protectedRanges:[{protectedRangeId:1}]};
 assert.throws(()=>nativeSnapshot(source),/proteções/);
 assert.throws(()=>replaceNativeSheet(source,designs[1]),/proteções/);
});

function protectedSheet(){return {...structuredClone(designs[0]),protectedRanges:[{protectedRangeId:123,range:{sheetId:designs[0].properties.sheetId},requestingUserCanEdit:true,editors:{users:['fixture@example.test']}}]}}
test('whole-sheet protection is backed up, preserved in place for designs and restored without permission requests',()=>{
 const target=protectedSheet(),snapshot=nativeSnapshot(target);
 assert.deepEqual((snapshot as any).protectedRanges,target.protectedRanges);
 assert.deepEqual(openBackup(sealBackup({...fixture,sheet:snapshot},secret),secret,'owner','book',now).sheet,snapshot);
 for(const requests of [planSheetDesign(target,designs[1],'','2026-09').requests,replaceNativeSheet(target,snapshot)]){
  assert.ok(requests.length>0);
  assert.ok(requests.every(r=>!Object.keys(r).some(k=>/ProtectedRange|deleteSheet|addSheet/.test(k))));
  assert.ok(!JSON.stringify(requests).includes('fixture@example.test'));
 }
});
test('partial, foreign-sheet and exception protections remain blocked',()=>{
 for(const patch of [{range:{sheetId:designs[0].properties.sheetId,startRowIndex:0,endRowIndex:10}},{range:{sheetId:999}},{unprotectedRanges:[{sheetId:designs[0].properties.sheetId}]},{namedRangeId:'named'}]){
  const target=protectedSheet();Object.assign(target.protectedRanges[0],patch);
  assert.throws(()=>nativeSnapshot(target),/proteções/);
 }
});
test('backup is read-only but applying requires current permission; changed protection blocks restore',()=>{
 const target=protectedSheet(),saved=nativeSnapshot(target);
 target.protectedRanges[0].requestingUserCanEdit=false;
 assert.doesNotThrow(()=>nativeSnapshot(target));
 assert.throws(()=>replaceNativeSheet(target,saved),/permissão/);
 assert.throws(()=>planSheetDesign(target,designs[1],'','2026-09'),/permissão/);
 target.protectedRanges[0].requestingUserCanEdit=true;
 target.protectedRanges[0].editors.users=['changed@example.test'];
 assert.throws(()=>replaceNativeSheet(target,saved),/mudaram/);
 assert.throws(()=>replaceNativeSheet(designs[0],saved),/mudaram/);
 assert.throws(()=>replaceNativeSheet(target,designs[0]),/mudaram/);
});
test('other unsupported features keep precise failure messages',()=>{
 assert.throws(()=>nativeSnapshot({...designs[0],tables:[{}]}),/tabelas estruturadas \(1\)/);
});
