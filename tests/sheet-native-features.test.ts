import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeSnapshot,replaceNativeSheet} from '../lib/sheet-native-snapshot.ts';
import {featureSummary,validateNativeFeatures} from '../lib/sheet-native-features.ts';
import type {DesignSheet} from '../lib/sheet-design-plan.ts';

function fixture():DesignSheet{return {
  properties:{sheetId:42,title:'Fixture',gridProperties:{rowCount:30,columnCount:10,rowGroupControlAfter:true}},
  rowGroups:[{range:{sheetId:42,dimension:'ROWS',startIndex:2,endIndex:20},depth:1,collapsed:true},{range:{sheetId:42,dimension:'ROWS',startIndex:3,endIndex:8},depth:2,collapsed:false}],
  columnGroups:[{range:{sheetId:42,dimension:'COLUMNS',startIndex:1,endIndex:4},depth:1,collapsed:false}],
  bandedRanges:[{bandedRangeId:12,range:{sheetId:42,startRowIndex:2,endRowIndex:20,startColumnIndex:0,endColumnIndex:4},rowProperties:{firstBandColorStyle:{rgbColor:{red:1}},secondBandColorStyle:{rgbColor:{blue:1}}}}],
  filterViews:[{filterViewId:13,title:'Saved filter',range:{sheetId:42,startRowIndex:1,endRowIndex:20,startColumnIndex:0,endColumnIndex:4},criteria:{'1':{hiddenValues:['hidden']}}}],
  basicFilter:{range:{sheetId:42,startRowIndex:1,endRowIndex:20,startColumnIndex:0,endColumnIndex:4}},
  charts:[{chartId:14,spec:{title:'Views',basicChart:{chartType:'COLUMN',domains:[{domain:{sourceRange:{sources:[{sheetId:42,startRowIndex:1,endRowIndex:8,startColumnIndex:0,endColumnIndex:1}]}}}]}},position:{overlayPosition:{anchorCell:{sheetId:42,rowIndex:0,columnIndex:5},widthPixels:300,heightPixels:200}}}],
  data:[{startRow:3,rowData:[{values:[{userEnteredValue:{stringValue:'hidden publication'},note:'keep'}]}],rowMetadata:[{hiddenByUser:true,pixelSize:25}]}],
}}
test('backup keeps groups, hidden publications, filters, banding and local charts without mutation',()=>{
 const sheet=fixture(),before=JSON.stringify(sheet),snapshot=nativeSnapshot(sheet);
 assert.deepEqual(snapshot,sheet);assert.equal(JSON.stringify(sheet),before);assert.equal(featureSummary(sheet).length,6);
});
test('restore clears deepest groups before resizing and rebuilds parents before children',()=>{
 const s=fixture(),r=replaceNativeSheet(s,nativeSnapshot(s)) as any[];
 const deleted=r.filter(x=>x.deleteDimensionGroup).map(x=>x.deleteDimensionGroup.range);
 assert.deepEqual(deleted.slice(0,2),[s.rowGroups![1].range,s.rowGroups![0].range]);
 assert.ok(r.findIndex(x=>x.deleteDimensionGroup)<r.findIndex(x=>x.updateSheetProperties));
 assert.deepEqual(r.filter(x=>x.addDimensionGroup).map(x=>x.addDimensionGroup.range),[...s.rowGroups!,...s.columnGroups!].map(g=>g.range));
 assert.equal(r.filter(x=>x.updateDimensionGroup&&x.updateDimensionGroup.dimensionGroup.collapsed).length,1);
 assert.ok(r.findLastIndex(x=>x.updateDimensionGroup)<r.findIndex(x=>x.updateDimensionProperties?.properties?.pixelSize===25),'manual hidden visibility is restored after collapse');
 for(const pair of [['deleteBanding','addBanding'],['deleteFilterView','addFilterView'],['deleteEmbeddedObject','addChart'],['clearBasicFilter','setBasicFilter']])assert.ok(r.findIndex(x=>x[pair[0]])<r.findIndex(x=>x[pair[1]]));
 assert.ok(!r.some(x=>x.addSheet||x.deleteSheet||x.duplicateSheet));
});
test('design removes old organization but does not carry old charts or filters into new columns',()=>{
 const source:DesignSheet={properties:{sheetId:1,title:'Model',gridProperties:{rowCount:10,columnCount:5}},data:[]};
 const requests=replaceNativeSheet(fixture(),source,'design');
 assert.equal(requests.filter(x=>x.deleteDimensionGroup).length,3);
 assert.ok(!requests.some(x=>x.addDimensionGroup||x.addChart||x.setBasicFilter));
});
test('invalid hierarchy, cross-sheet objects and connected sources fail closed',()=>{
 for(const change of [
  (s:any)=>s.rowGroups[1].depth=3,
  (s:any)=>s.rowGroups[1].range.endIndex=31,
  (s:any)=>s.rowGroups[1].range.sheetId=99,
  (s:any)=>s.charts[0].spec.basicChart.domains[0].domain.sourceRange.sources[0].sheetId=99,
  (s:any)=>s.charts[0].spec.dataSourceChartProperties={dataSourceId:'external'},
  (s:any)=>s.filterViews[0].namedRangeId='named',
  (s:any)=>s.basicFilter.range.sheetId=99,
 ]){const s=fixture();change(s);assert.throws(()=>validateNativeFeatures(s));assert.throws(()=>replaceNativeSheet(s,fixture()));}
});
test('unsupported resources still reject snapshots instead of saving incomplete copies',()=>{
 for(const key of ['tables','slicers','developerMetadata','commentAnchors'])assert.throws(()=>nativeSnapshot({...fixture(),[key]:[{}]}));
 for(const key of ['pivotTable','chipRuns','dataSourceTable','dataSourceFormula']){
  const s=fixture();(s.data![0].rowData![0].values![0] as any)[key]=key==='chipRuns'?[{}]:{};
  assert.throws(()=>nativeSnapshot(s));
 }
});
