import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildDesignBlocks,shiftTemplateFormula} from '../lib/sheet-design-blocks.ts';
import {designGrid,planSheetDesign,type DesignSheet,type DesignCell} from '../lib/sheet-design-plan.ts';
import {headerLayoutForRow,planSheetUpdates} from '../lib/google-sheets-plan.ts';

const packed=JSON.parse(readFileSync(new URL('../lib/sheet-design-blueprints.json',import.meta.url),'utf8'));
const designs:DesignSheet[]=packed.sheets.map((s:any)=>({...s,data:s.data.map((g:any)=>({...g,rowData:g.rowData.map((r:any)=>({values:r.values.map((i:number)=>packed.cells[i])}))}))}));
const cell=(s:string):DesignCell=>({userEnteredValue:{stringValue:s}});
function header(s:DesignSheet){return designGrid(s).flatMap((row,r)=>{const h=headerLayoutForRow(row.map(c=>c.userEnteredValue?.stringValue||''),r);return h?[h]:[]})[0];}
function target(source:DesignSheet,history:number,current:number){
 const s=structuredClone(source),h=header(s),grid=s.data![0];s.properties.sheetId=98765;
 grid.rowData=grid.rowData!.slice(0,h.row+1);
 function posts(count:number,prefix:string){for(let i=0;i<count;i++){const row:DesignCell[]=[];row[h.normal.month!]=cell('2026-09');row[h.normal.publishDate!]=cell('2026-09-10');row[h.normal.contentLink!]=cell(`https://x.com/fixture/status/${prefix}${i}`);grid.rowData!.push({values:row});}}
 if(history>=0){posts(history,'100');grid.rowData.push(structuredClone(grid.rowData[h.row]));}
 posts(current,'200');s.properties.gridProperties.rowCount=grid.rowData.length+10;
 return s;
}

test('formula extension respects absolute rows and quoted strings',()=>{
 assert.equal(shiftTemplateFormula('=IF(A18="A18",$B$3+$B18+B$18+SUM($C$18:C18),"say ""A18""")',100),'=IF(A118="A18",$B$3+$B118+B$18+SUM($C$18:C118),"say ""A18""")');
});

for(const source of designs){
 test(`${source.properties.title}: all existing formula rows agree with expansion; last block capacity is 60`,()=>{
  const rows=designGrid(source),h=header(source);
  for(let r=h.row+2;r<rows.length;r++)for(let c=0;c<(rows[r]?.length||0);c++){
   const formula=rows[r][c]?.userEnteredValue?.formulaValue;
   if(formula)assert.equal(shiftTemplateFormula(rows[h.row+2][c].userEnteredValue!.formulaValue!,r-h.row-2),formula,`${r}:${c}`);
  }
  const before=JSON.stringify(source),expanded=buildDesignBlocks(source,rows,h.row,[130,45]);
  assert.equal(JSON.stringify(source),before);assert.deepEqual(expanded.capacities,[130,60]);
  assert.equal(expanded.rowCount-expanded.headers[1]-1,60);
  const result=designGrid(expanded.sheet);
  assert.deepEqual(result.slice(0,h.row),rows.slice(0,h.row));
  assert.ok(headerLayoutForRow(result[expanded.headers[1]].map(c=>c.userEnteredValue?.stringValue||''),expanded.headers[1]));
  for(const blockHeader of expanded.headers)for(const r of [blockHeader+1,blockHeader+expanded.capacities[expanded.headers.indexOf(blockHeader)]]){
   for(const columns of [h.normal,h.special])assert.ok(result[r][columns.eligible!].userEnteredValue?.formulaValue?.includes('<=75'));
  }
  assert.equal(result.at(-1)![h.normal.eligible!].userEnteredValue?.formulaValue,shiftTemplateFormula(rows[h.row+2][h.normal.eligible!].userEnteredValue!.formulaValue!,expanded.rowCount-1-h.row-2));
  assert.equal(expanded.sheet.data![0].rowMetadata?.length,expanded.rowCount);
 });

 test(`${source.properties.title}: old history beyond 100 stays separate; ordinary sync targets only last header`,()=>{
  const s=target(source,130,45),before=JSON.stringify(s),p=planSheetDesign(s,source,''),h=header(source);
  assert.equal(JSON.stringify(s),before);assert.equal(p.normalCount,175);assert.equal(p.currentBlockRows,45);assert.equal(p.capacity,60);
  assert.equal(p.totalRows-p.blockHeaders.at(-1)!-1,60);assert.equal(p.capacityExpanded,false);
  assert.equal(p.writes.filter(w=>w.c===h.normal.contentLink).length,175);
  assert.ok(!p.requests.some(r=>r.deleteSheet||r.addSheet||r.duplicateSheet));
  const materialized=designGrid(p.outputSheet);
  for(const w of p.writes)materialized[w.r][w.c]=w.cell;
  const values=materialized.map(row=>row.map(c=>c?.userEnteredValue?.stringValue??c?.userEnteredValue?.numberValue??''));
  const updates=planSheetUpdates('Fixture',values,[{post_url:'https://x.com/fixture/status/2000',published_at:'2026-09-10',network:'X',likes:42}],'2026-09');
  assert.ok(updates.updates.length>0);
  for(const u of updates.updates)assert.ok(Number(u.range.match(/\d+$/)?.[0])>p.blockHeaders.at(-1)!+1);
 });
}

test('empty, exactly full and overfull current blocks never truncate data or add 60 extra rows',()=>{
 for(const n of [0,1,45,60,61,120]){
  const p=planSheetDesign(target(designs[0],-1,n),designs[0],'');
  assert.equal(p.normalCount,n);assert.equal(p.currentBlockRows,n);assert.equal(p.capacity,Math.max(60,n));assert.equal(p.capacityExpanded,n>60);
  assert.equal(p.totalRows-p.blockHeaders[0]-1,Math.max(60,n));
 }
});

test('oversize designs stop without a partial plan',()=>{
 const s=target(designs[0],1950,50),before=JSON.stringify(s);
 assert.throws(()=>planSheetDesign(s,designs[0],''),/limite seguro de 2000/);assert.equal(JSON.stringify(s),before);
});

test('reapplying a design preserves block boundaries, counts and 60-row capacity',()=>{
 const p=planSheetDesign(target(designs[1],130,45),designs[2],''),s=structuredClone(p.outputSheet);
 s.properties.sheetId=98765;
 for(const w of p.writes)s.data![0].rowData![w.r].values![w.c]=w.cell;
 const again=planSheetDesign(s,designs[3],'');
 assert.equal(again.sourceSections,2);assert.equal(again.normalCount,175);assert.equal(again.currentBlockRows,45);assert.equal(again.capacity,60);
});
