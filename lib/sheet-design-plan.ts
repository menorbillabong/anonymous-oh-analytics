import {headerLayoutForRow,type HeaderField,type SectionColumns} from './google-sheets-plan.ts';
import {replaceNativeSheet,wholeCellLinkRequest} from './sheet-native-snapshot.ts';

type Value={stringValue?:string;numberValue?:number;boolValue?:boolean;formulaValue?:string;errorValue?:unknown};
export type DesignCell={userEnteredValue?:Value;effectiveValue?:Value;formattedValue?:string;userEnteredFormat?:{numberFormat?:{type?:string;pattern?:string};textFormat?:{link?:{uri:string}}};note?:string;hyperlink?:string;chipRuns?:unknown[];textFormatRuns?:unknown[];dataValidation?:{condition?:{type?:string;values?:{userEnteredValue?:string}[]}}};
type Range={sheetId?:number;startRowIndex?:number;endRowIndex?:number;startColumnIndex?:number;endColumnIndex?:number};
export type DesignSheet={properties:{sheetId:number;title:string;gridProperties:{rowCount:number;columnCount:number;frozenRowCount?:number;frozenColumnCount?:number;hideGridlines?:boolean}};merges?:Range[];conditionalFormats?:unknown[];charts?:unknown[];tables?:unknown[];bandedRanges?:unknown[];filterViews?:unknown[];basicFilter?:unknown;data?:{startRow?:number;startColumn?:number;rowData?:{values?:DesignCell[]}[];rowMetadata?:{pixelSize?:number}[];columnMetadata?:{pixelSize?:number}[]}[]};
export type DesignRequest=Record<string,unknown>;
const fields:HeaderField[]=['month','publishDate','platform','contentLink','views','likes','reward','theme'];
const clean=(s:unknown)=>String(s??'').trim();
const normalize=(s:unknown)=>clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
// Older approved layouts have a hidden running-count helper beside each section.
function runningCountHelper(cell:DesignCell|undefined){return /^=IF\([A-Z]+\d+="","",COUNTIF\(\$[A-Z]+\$\d+:[A-Z]+\d+,[A-Z]+\d+\)\)$/i.test(cell?.userEnteredValue?.formulaValue||'')&&!cell?.note}
function value(cell:DesignCell|undefined):string|number|boolean{
  const v=cell?.effectiveValue??cell?.userEnteredValue;
  if(v?.errorValue)throw new Error('A aba contém uma célula com erro. Corrija-a antes de trocar o modelo.');
  return v?.stringValue??v?.numberValue??v?.boolValue??'';
}
export function designGrid(sheet:DesignSheet){
  const rows:DesignCell[][]=[];
  for(const grid of sheet.data||[])for(const [r,row] of (grid.rowData||[]).entries()){
    const index=(grid.startRow||0)+r;rows[index]??=[];
    for(const [c,cell] of (row.values||[]).entries())rows[index][(grid.startColumn||0)+c]=cell;
  }
  return rows;
}
function layout(rows:DesignCell[][]){
  const matches=rows.flatMap((row,r)=>{const match=headerLayoutForRow((row||[]).map(value),r);return match?[match]:[]});
  if(matches.length!==1)throw new Error('Não foi possível identificar uma única tabela de missões normais e especiais. A aba não será alterada.');
  return matches[0];
}
function profileField(label:unknown){
  const n=normalize(label);
  if(n.startsWith('settlementmonth'))return'month';
  if(n==='discord')return'discord';
  if(n==='accountname'||n==='charactername')return'name';
  if(n==='region')return'region';
  if(n.startsWith('xigfb'))return'social';
  if(n==='actualserverid')return'server';
  if(n==='userid')return'uid';
  return null;
}
function profileCells(sheet:DesignSheet,rows:DesignCell[][],header:number){
  const map=new Map<string,{r:number;c:number;cell:DesignCell}>();
  rows.slice(0,header).forEach((row,r)=>row.forEach((cell,c)=>{
    const field=profileField(value(cell));if(!field)return;
    const merge=sheet.merges?.find(m=>(m.startRowIndex||0)===r&&(m.startColumnIndex||0)===c);
    const next=merge?.endColumnIndex??c+1;
    if(map.has(field))throw new Error('Há campos de perfil duplicados na aba. Revise-os antes de aplicar um modelo.');
    map.set(field,{r,c:next,cell:rows[r]?.[next]||{}});
  }));
  return map;
}
function scalarCell(cell:DesignCell|undefined):DesignCell{
  if(cell?.chipRuns?.length)throw new Error('A aba contém chips nas publicações. Eles precisam ser revisados antes de transformar o modelo.');
  if(cell?.userEnteredValue?.formulaValue)throw new Error('Há fórmulas personalizadas nos dados de entrada. Revise-as antes de transformar a aba.');
  const v=value(cell);
  return {userEnteredValue:typeof v==='number'?{numberValue:v}:typeof v==='boolean'?{boolValue:v}:{stringValue:v},...(cell?.note?{note:cell.note}:{}),...(cell?.textFormatRuns?{textFormatRuns:cell.textFormatRuns}:{}),...(cell?.userEnteredFormat?.textFormat?.link?{userEnteredFormat:{textFormat:{link:cell.userEnteredFormat.textFormat.link}}}:{})};
}
function dateMonth(cell:DesignCell|undefined){
  const v=value(cell);
  if(typeof v==='number'&&v>0)return new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000).toISOString().slice(0,7);
  const match=clean(v).match(/^(\d{4})-(\d{2})-\d{2}/);return match?`${match[1]}-${match[2]}`:'';
}
export function planSheetDesign(target:DesignSheet,source:DesignSheet,backupTitle:string,sheetMonth=''){
  if(target.properties.sheetId===source.properties.sheetId)throw new Error('O modelo original não pode ser transformado.');
  if([target,source].some(s=>(s.charts?.length||s.tables?.length||s.bandedRanges?.length||s.filterViews?.length||s.basicFilter)))throw new Error('Esta aba possui tabelas, gráficos ou filtros personalizados. A aplicação automática foi bloqueada para preservá-los.');
  const oldRows=designGrid(target),newRows=designGrid(source),old=layout(oldRows),next=layout(newRows);
  const capacity=source.properties.gridProperties.rowCount-next.row-1;
  const requests:DesignRequest[]=[];
  const writes:{r:number;c:number;cell:DesignCell}[]=[];
  let normalCount=0,specialCount=0,usedRows=0,discardedCells=0;
  const mapped=new Set([...Object.values(old.normal),...Object.values(old.special)]);
  for(let r=old.row+1;r<oldRows.length;r++){
    const row=oldRows[r]||[];
    for(let c=0;c<row.length;c++)if(!mapped.has(c)&&!runningCountHelper(row[c])&&!row[c]?.userEnteredValue?.formulaValue&&(clean(value(row[c]))||row[c]?.note))discardedCells++;
    const populated=(section:SectionColumns)=>fields.some(f=>section[f]!==undefined&&(clean(value(row[section[f]!]))||row[section[f]!]?.note));
    const normal=populated(old.normal),special=populated(old.special);
    if(!normal&&!special)continue;
    if(++usedRows>capacity)throw new Error(`Este modelo comporta ${capacity} linhas por seção. Seus dados excedem esse espaço; nada será alterado.`);
    const destinationRow=next.row+usedRows;
    for(const [from,to,present] of [[old.normal,next.normal,normal],[old.special,next.special,special]] as const){
      if(!present)continue;
      if(from===old.normal)normalCount++;else specialCount++;
      for(const f of fields){
        if(to[f]===undefined){if(from[f]!==undefined&&clean(value(row[from[f]!])))throw new Error('O modelo não possui uma coluna necessária para preservar seus dados.');continue}
        const original=from[f]===undefined?undefined:row[from[f]!];
        const cell=scalarCell(original);
        if(f==='publishDate'&&typeof value(original)==='number')cell.userEnteredFormat={...cell.userEnteredFormat,numberFormat:original?.userEnteredFormat?.numberFormat||{type:'DATE',pattern:'yyyy-mm-dd'}};
        if(f==='month'&&!clean(value(original))){const month=dateMonth(from.publishDate===undefined?undefined:row[from.publishDate]);if(month)cell.userEnteredValue={stringValue:month}}
        const rule=newRows[next.row+1]?.[to[f]!]?.dataValidation?.condition;
        if(rule&&clean(value(cell))&&rule.type==='ONE_OF_LIST'&&!rule.values?.some(v=>v.userEnteredValue===String(value(cell))))throw new Error(`O valor “${clean(value(cell))}” não é aceito pela lista do modelo. Ajuste-o antes da transformação.`);
        writes.push({r:destinationRow,c:to[f]!,cell});
      }
    }
  }
  // A live template must remain blank in all post input columns.
  for(let r=next.row+1;r<newRows.length;r++)for(const section of [next.normal,next.special])for(const f of fields){
    const c=section[f];if(c!==undefined&&clean(value(newRows[r]?.[c])))throw new Error('O modelo contém publicações de exemplo. O administrador precisa limpá-las antes de liberar seu uso.');
  }
  const oldProfile=profileCells(target,oldRows,old.row),newProfile=profileCells(source,newRows,next.row);
  for(const [field,current] of oldProfile)if(!newProfile.has(field)&&clean(value(current.cell)))throw new Error('O modelo não possui um campo necessário para preservar seu perfil.');
  for(const [field,dest] of newProfile){
    const current=oldProfile.get(field);let cell=scalarCell(current?.cell);
    if(field==='month'&&!clean(value(cell))&&/^\d{4}-\d{2}$/.test(sheetMonth))cell={userEnteredValue:{stringValue:sheetMonth}};
    writes.push({r:dest.r,c:dest.c,cell});
  }
  if(!newProfile.has('month'))throw new Error('O modelo não possui o campo do mês de referência.');
  const id=target.properties.sheetId;
  requests.push(...replaceNativeSheet(target,source));
  for(const write of writes){
    requests.push({updateCells:{start:{sheetId:id,rowIndex:write.r,columnIndex:write.c},rows:[{values:[write.cell]}],fields:'userEnteredValue,note,textFormatRuns'+(write.cell.userEnteredFormat?.numberFormat?',userEnteredFormat.numberFormat':'')}});
    const link=wholeCellLinkRequest(id,write.r,write.c,write.cell);if(link)requests.push(link);
  }
  return {requests,writes,normalCount,specialCount,capacity,discardedCells};
}
