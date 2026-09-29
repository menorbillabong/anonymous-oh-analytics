import type {DesignSheet,DesignRequest,DesignCell} from './sheet-design-plan.ts';
import {validateNativeFeatures,clearNativeFeatures,restoreNativeFeatures} from './sheet-native-features.ts';

const cellFields=['userEnteredValue','userEnteredFormat','note','textFormatRuns','dataValidation'] as const;
type Protection={protectedRangeId?:number;range?:Record<string,number>;namedRangeId?:string;tableId?:string;unprotectedRanges?:unknown[];requestingUserCanEdit?:boolean;[key:string]:unknown};
function protections(sheet:DesignSheet):Protection[]{return (sheet as DesignSheet & {protectedRanges?:Protection[]}).protectedRanges||[]}
// Whole-sheet protections remain on the same sheetId throughout replacement.
// Never delete/recreate protections or write editors/warningOnly permissions.
function validateProtections(sheet:DesignSheet){
  for(const p of protections(sheet))if(!Number.isInteger(p.protectedRangeId)||!p.range||p.range.sheetId!==sheet.properties.sheetId||Object.keys(p.range).some(key=>key!=='sheetId')||p.namedRangeId||p.tableId||p.unprotectedRanges?.length){
    throw new Error('Esta aba contém proteções parciais ou com exceções ainda não suportadas. As proteções foram mantidas e nada foi alterado.');
  }
}
function protectionSignature(sheet:DesignSheet){
  const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='requestingUserCanEdit').sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
  return JSON.stringify(protections(sheet).map(p=>canonical(p)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
// Clearing textFormatRuns in a broad cell update also clears whole-cell links in
// Sheets. Restore those links last with a narrow mask, after values/runs/merges.
export function wholeCellLinkRequest(sheetId:number,rowIndex:number,columnIndex:number,cell:DesignCell):DesignRequest|null{
  const link=cell.userEnteredFormat?.textFormat?.link;
  return link?{updateCells:{start:{sheetId,rowIndex,columnIndex},rows:[{values:[{userEnteredFormat:{textFormat:{link}}}]}],fields:'userEnteredFormat.textFormat.link'}}:null;
}
export function nativeSnapshot(sheet:DesignSheet):DesignSheet{
  const raw=sheet as DesignSheet & Record<string,any>;
  validateProtections(sheet);
  const unsupported:Record<string,string>={tables:'tabelas estruturadas',slicers:'segmentações de dados',developerMetadata:'metadados personalizados',commentAnchors:'comentários'};
  const found=Object.entries(unsupported).filter(([key])=>raw[key]?.length).map(([key,label])=>`${label} (${raw[key].length})`);
  if(found.length)throw new Error(`Não foi possível concluir: esta aba contém ${found.join(', ')}, ainda não suportados nesta operação. Nenhum backup foi salvo e a planilha não foi alterada.`);
  const sheetType=(raw.properties as Record<string,unknown>).sheetType;
  if(sheetType&&sheetType!=='GRID')throw new Error('Somente abas de células comuns podem ser copiadas pelo site. Nada foi alterado.');
  validateNativeFeatures(sheet);
  const snapshot=structuredClone(sheet);
  for(const grid of snapshot.data||[])for(const row of grid.rowData||[])row.values=(row.values||[]).map(cell=>{
    const c=cell as Record<string,any>;
    if(c.chipRuns?.length||c.pivotTable||c.dataSourceTable||c.dataSourceFormula||c.userEnteredValue?.imageValue)throw new Error('Esta aba contém chips, imagens em células, tabelas dinâmicas ou fontes de dados não suportados pelo backup. Nada foi alterado.');
    return Object.fromEntries(cellFields.filter(key=>c[key]!==undefined).map(key=>[key,c[key]])) as DesignCell;
  });
  return snapshot;
}

// No copyPaste/duplicateSheet: source is a server snapshot, never a live template tab.
export function replaceNativeSheet(target:DesignSheet,input:DesignSheet,mode:'restore'|'design'='restore'):DesignRequest[]{
  nativeSnapshot(target);
  const source=nativeSnapshot(input),id=target.properties.sheetId,grid=source.properties.gridProperties;
  if(protections(target).some(p=>p.requestingUserCanEdit!==true))throw new Error('A integração do site não tem permissão para editar esta aba protegida. Nenhuma proteção foi removida e nada foi alterado.');
  if(mode==='design'){
    if(protections(source).length)throw new Error('O modelo contém proteções próprias e não pode substituir as permissões da sua aba.');
  }else if(protectionSignature(target)!==protectionSignature(source))throw new Error('As proteções da aba mudaram desde o backup. A restauração foi bloqueada para não alterar permissões.');
  const requests:DesignRequest[]=[...clearNativeFeatures(target)];
  if(target.merges?.length)requests.push({unmergeCells:{range:{sheetId:id}}});
  for(let index=(target.conditionalFormats?.length||0)-1;index>=0;index--)requests.push({deleteConditionalFormatRule:{sheetId:id,index}});
  requests.push({updateSheetProperties:{properties:{sheetId:id,gridProperties:{frozenRowCount:0,frozenColumnCount:0}},fields:'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'}});
  requests.push({updateSheetProperties:{properties:{sheetId:id,gridProperties:{rowCount:grid.rowCount,columnCount:grid.columnCount,frozenRowCount:grid.frozenRowCount||0,frozenColumnCount:grid.frozenColumnCount||0,hideGridlines:grid.hideGridlines||false}},fields:'gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines'}});
  requests.push({updateSheetProperties:{properties:{sheetId:id,gridProperties:{rowGroupControlAfter:!!grid.rowGroupControlAfter,columnGroupControlAfter:!!grid.columnGroupControlAfter}},fields:'gridProperties.rowGroupControlAfter,gridProperties.columnGroupControlAfter'}});
  requests.push({updateCells:{range:{sheetId:id},fields:cellFields.join(',')}});
  for(const dimension of ['ROWS','COLUMNS'])requests.push({updateDimensionProperties:{range:{sheetId:id,dimension,startIndex:0,endIndex:dimension==='ROWS'?grid.rowCount:grid.columnCount},properties:{pixelSize:dimension==='ROWS'?21:100,hiddenByUser:false},fields:'pixelSize,hiddenByUser'}});
  requests.push(...restoreNativeFeatures(source,id));
  for(const data of source.data||[]){
    if(data.rowData?.length)requests.push({updateCells:{start:{sheetId:id,rowIndex:data.startRow||0,columnIndex:data.startColumn||0},rows:data.rowData,fields:cellFields.join(',')}});
    for(const [dimension,items,offset] of [['ROWS',data.rowMetadata,data.startRow||0],['COLUMNS',data.columnMetadata,data.startColumn||0]] as const){
      for(let i=0;i<(items?.length||0);){
        const item=items![i],pixelSize=item.pixelSize||(dimension==='ROWS'?21:100),hiddenByUser=!!(item as any).hiddenByUser;let end=i+1;
        while(end<items!.length&&(items![end].pixelSize||(dimension==='ROWS'?21:100))===pixelSize&&!!(items![end] as any).hiddenByUser===hiddenByUser)end++;
        requests.push({updateDimensionProperties:{range:{sheetId:id,dimension,startIndex:offset+i,endIndex:offset+end},properties:{pixelSize,hiddenByUser},fields:'pixelSize,hiddenByUser'}});i=end;
      }
    }
  }
  for(const range of source.merges||[])requests.push({mergeCells:{range:{...range,sheetId:id},mergeType:'MERGE_ALL'}});
  for(const [index,rule] of (source.conditionalFormats||[]).entries())requests.push({addConditionalFormatRule:{index,rule:JSON.parse(JSON.stringify(rule),(key,value)=>key==='sheetId'?id:value)}});
  for(const data of source.data||[])for(const [r,row] of (data.rowData||[]).entries())for(const [c,cell] of (row.values||[]).entries()){
    const request=wholeCellLinkRequest(id,(data.startRow||0)+r,(data.startColumn||0)+c,cell);if(request)requests.push(request);
  }
  return requests;
}
