import 'server-only';
import {createHash} from 'node:crypto';
import {accessToken,googleRequest as sheetsRequest,SHEETS_API} from './google-sheets';
import {sheetDesign,SHEET_DESIGNS} from './sheet-designs';
import {designGrid,planSheetDesign,type DesignSheet} from './sheet-design-plan';
import packedBlueprints from './sheet-design-blueprints.json';
import {nativeSnapshot,replaceNativeSheet} from './sheet-native-snapshot';

const TEMPLATE_WORKBOOK='1YuHQY_FFRjbz1M-pd3LswkcUyEBbA531jKyd579IVKA';
// Bound only model operations; preserve the existing ordinary sync request behavior.
function googleRequest(url:string,token:string,init?:RequestInit){return sheetsRequest(url,token,{...init,signal:AbortSignal.timeout(init?.method==='POST'?45000:20000)})}
const quote=(name:string)=>`'${name.replaceAll("'","''")}'`;
function column(index:number){let name='';for(let n=index;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name}
function bounds(sheet:DesignSheet){
  const grid=sheet.properties.gridProperties;
  if(!grid||grid.rowCount>2000||grid.columnCount>100)throw new Error('Esta aba excede o tamanho suportado pela transformação automática. Nenhuma alteração foi feita.');
  return `${quote(sheet.properties.title)}!A1:${column(grid.columnCount)}${grid.rowCount}`;
}
function digest(target:DesignSheet,source:DesignSheet,month:string){return createHash('sha256').update(JSON.stringify({target,source,month})).digest('hex')}

export async function readRegisteredSheet(tabName:string){
  const spreadsheetId=process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if(spreadsheetId!==TEMPLATE_WORKBOOK)throw new Error('Os modelos ainda não foram configurados para esta planilha.');
  const token=await accessToken(),base=`${SHEETS_API}/${spreadsheetId}`;
  const metadata=await googleRequest(`${base}?fields=sheets(properties)`,token) as {sheets:DesignSheet[]};
  const targetMeta=metadata.sheets.find(s=>s.properties.title===tabName);
  if(!targetMeta)throw new Error('Não encontrei a aba vinculada.');
  if(SHEET_DESIGNS.some(d=>d.sheetId===targetMeta.properties.sheetId)||/^Backup AOH /i.test(tabName))throw new Error('Esta aba é um modelo ou uma cópia de segurança e não pode ser transformada.');
  const result=await googleRequest(`${base}?ranges=${encodeURIComponent(bounds(targetMeta))}&includeGridData=true`,token) as {sheets:DesignSheet[]};
  const target=result.sheets.find(s=>s.properties.sheetId===targetMeta.properties.sheetId)!;
  if(!target)throw new Error('Não foi possível conferir as células da planilha.');
  return {token,base,target,spreadsheetId};
}

export async function prepareSheetDesign(tabName:string,designId:unknown,month:string){
  const design=sheetDesign(designId);if(!design)throw new Error('Modelo inválido.');
  const {token,base,target}=await readRegisteredSheet(tabName);
  const packed=packedBlueprints.sheets.find(s=>s.properties.sheetId===design.sheetId)!;
  const source={...packed,data:packed.data.map(g=>({...g,rowData:g.rowData.map(row=>({values:row.values.map(index=>packedBlueprints.cells[index])}))}))} as DesignSheet;
  const plan=planSheetDesign(target,source,'',month);
  return {token,base,target,source,plan,fingerprint:digest(target,source,month),design,tabName};
}

export async function applySheetDesign(prepared:Awaited<ReturnType<typeof prepareSheetDesign>>,validatePermission:()=>Promise<void>){
  const {token,base,target,plan}=prepared;
  await validatePermission();
  // One atomic replacement; manual backups are kept separately on the site.
  await googleRequest(`${base}:batchUpdate`,token,{method:'POST',body:JSON.stringify({requests:plan.requests})});
  let verified=false;
  try{
    const range=bounds({...target,properties:{...target.properties,gridProperties:prepared.source.properties.gridProperties}});
    const after=await googleRequest(`${base}?ranges=${encodeURIComponent(range)}&fields=sheets(properties,data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,note,textFormatRuns))))`,token);
    const tab=after.sheets?.find((s:DesignSheet)=>s.properties.sheetId===target.properties.sheetId);
    if(tab){const grid=designGrid(tab);verified=plan.writes.every(w=>JSON.stringify(grid[w.r]?.[w.c]?.userEnteredValue||{stringValue:''})===JSON.stringify(w.cell.userEnteredValue)&&String(grid[w.r]?.[w.c]?.note||'')===String(w.cell.note||''))&&!grid.some(row=>row?.some(cell=>cell?.effectiveValue?.errorValue))}
  }catch{/* The batch may have committed. Never retry automatically or report an untouched sheet. */}
  return {success:true,verified,tabName:target.properties.title,normalCount:plan.normalCount,specialCount:plan.specialCount};
}

export function sheetFingerprint(sheet:DesignSheet){return createHash('sha256').update(JSON.stringify(nativeSnapshot(sheet))).digest('hex')}
export async function restoreRegisteredSheet(prepared:Awaited<ReturnType<typeof readRegisteredSheet>>,snapshot:DesignSheet,validatePermission:()=>Promise<void>){
  if(prepared.target.properties.sheetId!==snapshot.properties.sheetId)throw new Error('Este backup pertence a outra aba.');
  const requests=replaceNativeSheet(prepared.target,snapshot);
  await validatePermission();
  await googleRequest(`${prepared.base}:batchUpdate`,prepared.token,{method:'POST',body:JSON.stringify({requests})});
  return {success:true,tabName:prepared.target.properties.title};
}
