import type {DesignSheet,DesignRequest,DesignCell} from './sheet-design-plan.ts';

const cellFields=['userEnteredValue','userEnteredFormat','note','textFormatRuns','dataValidation'] as const;
// Clearing textFormatRuns in a broad cell update also clears whole-cell links in
// Sheets. Restore those links last with a narrow mask, after values/runs/merges.
export function wholeCellLinkRequest(sheetId:number,rowIndex:number,columnIndex:number,cell:DesignCell):DesignRequest|null{
  const link=cell.userEnteredFormat?.textFormat?.link;
  return link?{updateCells:{start:{sheetId,rowIndex,columnIndex},rows:[{values:[{userEnteredFormat:{textFormat:{link}}}]}],fields:'userEnteredFormat.textFormat.link'}}:null;
}
export function nativeSnapshot(sheet:DesignSheet):DesignSheet{
  const raw=sheet as DesignSheet & Record<string,any>;
  const unsupported:Record<string,string>={charts:'gráficos',tables:'tabelas',bandedRanges:'cores alternadas',filterViews:'visualizações de filtro',rowGroups:'agrupamentos de linhas',columnGroups:'agrupamentos de colunas',slicers:'segmentações de dados',developerMetadata:'metadados personalizados',protectedRanges:'proteções de intervalos'};
  const found=Object.entries(unsupported).filter(([key])=>raw[key]?.length).map(([key,label])=>`${label} (${raw[key].length})`);
  if(raw.basicFilter)found.push('filtro básico');
  if(found.length)throw new Error(`Não foi possível concluir: esta aba contém ${found.join(', ')}, ainda não suportados nesta operação. Nenhum backup foi salvo e a planilha não foi alterada.`);
  const snapshot=structuredClone(sheet);
  for(const grid of snapshot.data||[])for(const row of grid.rowData||[])row.values=(row.values||[]).map(cell=>{
    const c=cell as Record<string,any>;
    if(c.chipRuns?.length||c.pivotTable||c.dataSourceTable||c.dataSourceFormula)throw new Error('Esta aba contém chips ou fontes de dados não suportados pelo backup. Nada foi alterado.');
    return Object.fromEntries(cellFields.filter(key=>c[key]!==undefined).map(key=>[key,c[key]])) as DesignCell;
  });
  return snapshot;
}

// No copyPaste/duplicateSheet: source is a server snapshot, never a live template tab.
export function replaceNativeSheet(target:DesignSheet,input:DesignSheet):DesignRequest[]{
  nativeSnapshot(target);
  const source=nativeSnapshot(input),id=target.properties.sheetId,grid=source.properties.gridProperties;
  const requests:DesignRequest[]=[];
  if(target.merges?.length)requests.push({unmergeCells:{range:{sheetId:id}}});
  for(let index=(target.conditionalFormats?.length||0)-1;index>=0;index--)requests.push({deleteConditionalFormatRule:{sheetId:id,index}});
  requests.push({updateSheetProperties:{properties:{sheetId:id,gridProperties:{frozenRowCount:0,frozenColumnCount:0}},fields:'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'}});
  requests.push({updateSheetProperties:{properties:{sheetId:id,gridProperties:{rowCount:grid.rowCount,columnCount:grid.columnCount,frozenRowCount:grid.frozenRowCount||0,frozenColumnCount:grid.frozenColumnCount||0,hideGridlines:grid.hideGridlines||false}},fields:'gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines'}});
  requests.push({updateCells:{range:{sheetId:id},fields:cellFields.join(',')}});
  for(const dimension of ['ROWS','COLUMNS'])requests.push({updateDimensionProperties:{range:{sheetId:id,dimension,startIndex:0,endIndex:dimension==='ROWS'?grid.rowCount:grid.columnCount},properties:{pixelSize:dimension==='ROWS'?21:100,hiddenByUser:false},fields:'pixelSize,hiddenByUser'}});
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
