import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {designGrid,planSheetDesign,type DesignSheet,type DesignCell} from '../lib/sheet-design-plan.ts';
import {headerLayoutForRow} from '../lib/google-sheets-plan.ts';

// Bounded reads of the approved native templates; no user data or credentials.
const designs:DesignSheet[]=JSON.parse(readFileSync(new URL('./fixtures/sheet-designs.json',import.meta.url),'utf8'));
const cell=(value:string|number):DesignCell=>({userEnteredValue:typeof value==='string'?{stringValue:value}:{numberValue:value}});
function layout(sheet:DesignSheet){return designGrid(sheet).flatMap((r,i)=>{const l=headerLayoutForRow(r.map(c=>c.userEnteredValue?.stringValue||''),i);return l?[l]:[]})[0]}
function target(source:DesignSheet){const s=structuredClone(source);s.properties.sheetId=987654;s.properties.title='Test user';return s}
function put(s:DesignSheet,r:number,c:number,value:DesignCell){const rows=s.data![0].rowData!;rows[r]??={values:[]};rows[r].values??=[];rows[r].values![c]=value}
function post(s:DesignSheet,index:number,special=false){const l=layout(s),cols=special?l.special:l.normal,r=l.row+index;for(const [key,v] of Object.entries({month:'2026-09',publishDate:'2026-09-15',platform:'X',contentLink:`https://x.com/fixture/status/${index}${special?'1':'0'}`,views:500,likes:10,...(special?{reward:200,theme:'Photo'}:{})}))put(s,r,cols[key as keyof typeof cols]!,cell(v));return r}

for(const from of designs)for(const to of designs)test(`${from.properties.title} -> ${to.properties.title}: posts, profile and backup`,()=>{
  const s=target(from),old=layout(s),next=layout(to);post(s,1);post(s,1,true);post(s,3);
  const rows=designGrid(s);
  for(let r=0;r<old.row;r++)for(let c=0;c<(rows[r]?.length||0);c++)if(/^(Account Name|Character Name)$/.test(rows[r][c].userEnteredValue?.stringValue||'')){
    const merged=s.merges?.find(m=>(m.startRowIndex||0)===r&&(m.startColumnIndex||0)===c);put(s,r,merged?.endColumnIndex??c+1,cell('Fixture user'));
  }
  const before=JSON.stringify(s),plan=planSheetDesign(s,to,'Backup fixture');assert.equal(JSON.stringify(s),before);
  assert.equal(plan.normalCount,2);assert.equal(plan.specialCount,1);
  assert.ok(!plan.requests.some(r=>r.duplicateSheet||r.copyPaste||r.addSheet));
  assert.ok(plan.requests.some(r=>(r.updateSheetProperties as any)?.properties?.gridProperties?.columnCount===to.properties.gridProperties.columnCount));
  assert.equal(plan.writes.find(w=>w.r===next.row+1&&w.c===next.normal.likes)?.cell.userEnteredValue?.numberValue,10);
  assert.equal(plan.writes.find(w=>w.r===next.row+1&&w.c===next.special.reward)?.cell.userEnteredValue?.numberValue,200);
  assert.ok(plan.writes.some(w=>w.r<next.row&&w.cell.userEnteredValue?.stringValue==='Fixture user'));
  assert.ok(!JSON.stringify(plan.requests).includes('deleteSheet'));
  assert.ok(plan.requests.every(r=>Object.keys(r).length===1));
});
test('numeric dates and notes survive, empty rows do not change post order',()=>{
  const s=target(designs[0]),l=layout(s);post(s,1);post(s,3,true);
  put(s,l.row+1,l.normal.publishDate!,{...cell(46280),note:'original date',userEnteredFormat:{numberFormat:{type:'DATE',pattern:'dd/mm/yyyy'}}});
  const plan=planSheetDesign(s,designs[1],'Backup');const w=plan.writes.find(w=>w.cell.note==='original date')!;
  assert.equal(w.cell.userEnteredValue?.numberValue,46280);assert.equal(w.cell.userEnteredFormat?.numberFormat?.pattern,'dd/mm/yyyy');
});
test('unsupported data blocks before producing a destructive plan',()=>{
  for(const variation of ['formula','chip','chart','capacity','template-data']){
    const s=target(designs[0]),to=structuredClone(designs[1]),l=layout(s);post(s,1);
    if(variation==='formula')put(s,l.row+1,l.normal.likes!,{userEnteredValue:{formulaValue:'=2+2'},effectiveValue:{numberValue:4}});
    if(variation==='chip')put(s,l.row+1,l.normal.contentLink!,{...cell('@'),chipRuns:[{}]});
    if(variation==='extra')put(s,l.row+1,8,cell('keep this'));
    if(variation==='chart')s.charts=[{}];
    if(variation==='capacity')to.properties.gridProperties.rowCount=layout(to).row+1;
    if(variation==='headers')s.data![0].rowData!.push(structuredClone(s.data![0].rowData![l.row]));
    if(variation==='template-data')post(to,1);
    assert.throws(()=>planSheetDesign(s,to,'Backup'),Error,variation);
  }
});

test('extra literal data is reported for explicit removal rather than blocking',()=>{
  const s=target(designs[0]),l=layout(s);post(s,1);const baseline=planSheetDesign(s,designs[1],'').discardedCells;put(s,l.row+1,25,cell('old extra'));
  assert.equal(planSheetDesign(s,designs[1],'').discardedCells,baseline+1);
});
test('platform validation is honored without silently changing platform',()=>{
  const s=target(designs[0]),l=layout(s);post(s,1);put(s,l.row+1,l.normal.platform!,cell('TikTok'));
  assert.throws(()=>planSheetDesign(s,designs[0],'Backup'),/não é aceito/);
});
test('legacy running-count helpers are replaced, not mistaken for user input',()=>{
  const s=target(designs.find(s=>s.properties.title==='DESIGN 1')!),l=layout(s);post(s,1,true);
  put(s,l.row+1,9,{userEnteredValue:{formulaValue:'=IF(K18="","",COUNTIF($K$18:K18,K18))'},effectiveValue:{numberValue:1}});
  assert.equal(planSheetDesign(s,designs[1],'Backup').specialCount,1);
});

test('repeated headers in collapsed historical groups preserve publications in their original order',()=>{
 const s=target(designs[0]),l=layout(s);post(s,1);
 const second=l.row+10;
 for(let r=0;r<=second+1;r++)s.data![0].rowData![r]??={values:[]};
 s.data![0].rowData![second]=structuredClone(s.data![0].rowData![l.row]);
 put(s,second+1,l.normal.contentLink!,cell('https://x.com/fixture/status/999'));
 put(s,second+1,l.normal.likes!,cell(123));
 s.rowGroups=[{range:{sheetId:s.properties.sheetId,dimension:'ROWS',startIndex:second,endIndex:second+3},depth:1,collapsed:true}];
 s.data![0].rowMetadata??=[];for(let r=0;r<=second+1;r++)s.data![0].rowMetadata![r]??={};s.data![0].rowMetadata![second+1]={hiddenByUser:true};
 const p=planSheetDesign(s,designs[1],'');
 assert.equal(p.sourceSections,2);assert.equal(p.normalCount,2);
 const links=p.writes.filter(w=>w.cell.userEnteredValue?.stringValue?.startsWith('https://x.com/fixture/')).map(w=>w.cell.userEnteredValue!.stringValue);
 assert.deepEqual(links,['https://x.com/fixture/status/10','https://x.com/fixture/status/999']);
 assert.ok(p.removedFeatures.includes('1 agrupamentos de linhas'));
 assert.equal(p.requests.filter(r=>r.deleteDimensionGroup).length,1);
});
test('custom cells above the table and formulas outside inputs are explicitly reported',()=>{
 const s=target(designs[0]),before=planSheetDesign(s,designs[1],'');
 put(s,0,25,cell('custom information'));put(s,1,25,{userEnteredValue:{formulaValue:'=42'},effectiveValue:{numberValue:42}});
 const p=planSheetDesign(s,designs[1],'');
 assert.equal(p.discardedCells,before.discardedCells+1);assert.ok(p.discardedExamples.includes('Z1'));
 assert.equal(p.replacedFormulas,before.replacedFormulas+1);
});
test('extra content on a repeated header row is not silently discarded',()=>{
 const s=target(designs[0]),l=layout(s),before=planSheetDesign(s,designs[1],'');
 put(s,l.row,25,cell('header custom data'));
 const p=planSheetDesign(s,designs[1],'');
 assert.equal(p.discardedCells,before.discardedCells+1);
 assert.ok(p.discardedExamples.includes(`Z${l.row+1}`));
});
