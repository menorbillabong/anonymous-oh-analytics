import type {SheetUpdate} from './google-sheets-plan.ts';

const START='[AOH MANUAL ADJUSTMENT]';
const END='[/AOH MANUAL ADJUSTMENT]';
/** Preserve user notes; replace only our own explicitly delimited annotation. */
export function mergeManualNote(existing:string,manual:string){
  const plain=existing.replace(/\n?\[AOH MANUAL ADJUSTMENT\][\s\S]*?\[\/AOH MANUAL ADJUSTMENT\]/g,'');
  return manual?`${plain}${plain?'\n':''}${START}\n${manual}\n${END}`:plain;
}
export function sheetCell(range:string){
  const match=range.match(/!([A-Z]+)([1-9]\d*)$/);
  if(!match)throw new Error('Invalid single cell range');
  let column=0;for(const char of match[1])column=column*26+char.charCodeAt(0)-64;
  return{row:Number(match[2])-1,column:column-1};
}
export function sheetBatchRequests(updates:SheetUpdate[],sheetId:number,notes:Map<string,string>){
  return updates.map(update=>{
    const{row,column}=sheetCell(update.range),value=update.values[0][0];
    const cell:{userEnteredValue:{numberValue:number}|{stringValue:string};note?:string}={userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:value}};
    if(update.manualNote!==undefined)cell.note=mergeManualNote(notes.get(`${row}:${column}`)||'',update.manualNote);
    return{updateCells:{range:{sheetId,startRowIndex:row,endRowIndex:row+1,startColumnIndex:column,endColumnIndex:column+1},rows:[{values:[cell]}],fields:`userEnteredValue${update.manualNote!==undefined?',note':''}`}};
  });
}
