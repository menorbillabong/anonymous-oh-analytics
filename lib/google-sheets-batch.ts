import type {SheetUpdate} from './google-sheets-plan.ts';

/** Remove only complete legacy system annotations, preserving user text verbatim. */
export function removeManualNote(existing:string){
  return existing.replace(/\r?\n?\[AOH MANUAL ADJUSTMENT\][\s\S]*?\[\/AOH MANUAL ADJUSTMENT\]/g,'');
}
export function sheetCell(range:string){
  const match=range.match(/!([A-Z]+)([1-9]\d*)$/);
  if(!match)throw new Error('Invalid single cell range');
  let column=0;for(const char of match[1])column=column*26+char.charCodeAt(0)-64;
  return{row:Number(match[2])-1,column:column-1};
}
export function sheetBatchRequests(updates:SheetUpdate[],sheetId:number,notes:Map<string,string>){
  type Cell={userEnteredValue?:{numberValue:number}|{stringValue:string};note?:string};
  const requests=updates.map(update=>{
    const{row,column}=sheetCell(update.range),value=update.values[0][0];
    const cell:Cell={userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:value}};
    return{updateCells:{range:{sheetId,startRowIndex:row,endRowIndex:row+1,startColumnIndex:column,endColumnIndex:column+1},rows:[{values:[cell]}],fields:'userEnteredValue'}};
  });
  // Metadata covers only the user's linked tab. Note-only requests leave values,
  // formulas and formatting untouched, including on rows not updated this time.
  for(const[key,existing]of notes){
    const note=removeManualNote(existing);
    if(note===existing)continue;
    if(!/^\d+:\d+$/.test(key))throw new Error('Invalid note cell');
    const[row,column]=key.split(':').map(Number);
    requests.push({updateCells:{range:{sheetId,startRowIndex:row,endRowIndex:row+1,startColumnIndex:column,endColumnIndex:column+1},rows:[{values:[{note}]}],fields:'note'}});
  }
  return requests;
}
