import type {DesignSheet,DesignRequest} from './sheet-design-plan.ts';

type JsonObject=Record<string,any>;
export type DimensionGroup={range:{sheetId:number;dimension:'ROWS'|'COLUMNS';startIndex:number;endIndex:number};depth:number;collapsed?:boolean};
const labels:Record<string,string>={rowGroups:'agrupamentos de linhas',columnGroups:'agrupamentos de colunas',bandedRanges:'faixas de cores alternadas',filterViews:'visualizações de filtro',charts:'gráficos'};

export function featureSummary(sheet:DesignSheet):string[]{
  const raw=sheet as unknown as JsonObject;
  return [...Object.entries(labels).filter(([key])=>raw[key]?.length).map(([key,label])=>`${raw[key].length} ${label}`),...(raw.basicFilter?['1 filtro básico']:[])];
}

// Only self-contained objects: restoring one user's tab must never address
// another tab, a connected data source or a workbook-level named/table range.
function localObject(value:unknown,id:number){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if((key==='sheetId'&&item!==id)||['dataSourceId','dataSourceChartProperties','dataSourceColumnReference','namedRangeId','tableId'].includes(key))throw new Error('Há um recurso dependente de outra aba, tabela, intervalo nomeado ou fonte de dados. Esta operação foi bloqueada; nada foi alterado.');
    localObject(item,id);
  }
}
export function validateNativeFeatures(sheet:DesignSheet){
  const raw=sheet as unknown as JsonObject,id=sheet.properties.sheetId;
  for(const [key,dimension] of [['rowGroups','ROWS'],['columnGroups','COLUMNS']] as const){
    const groups:DimensionGroup[]=raw[key]||[];
    const ordered=[...groups].sort((a,b)=>a.depth-b.depth||a.range.startIndex-b.range.startIndex);
    for(const [index,g] of ordered.entries()){
      const r=g.range,limit=dimension==='ROWS'?sheet.properties.gridProperties.rowCount:sheet.properties.gridProperties.columnCount;
      if(!r||r.sheetId!==id||r.dimension!==dimension||!Number.isInteger(r.startIndex)||!Number.isInteger(r.endIndex)||r.startIndex<0||r.endIndex<=r.startIndex||r.endIndex>limit||!Number.isInteger(g.depth)||g.depth<1)throw new Error('Agrupamento inválido ou fora da aba. Nada foi alterado.');
      const earlier=ordered.slice(0,index);
      if(earlier.some(p=>p.depth===g.depth&&p.range.startIndex<r.endIndex&&p.range.endIndex>r.startIndex)|| (g.depth>1&&!earlier.some(p=>p.depth===g.depth-1&&p.range.startIndex<=r.startIndex&&p.range.endIndex>=r.endIndex)))throw new Error('A hierarquia dos agrupamentos não pôde ser preservada. Nada foi alterado.');
    }
  }
  for(const key of ['bandedRanges','filterViews','charts'])for(const item of raw[key]||[]){
    localObject(item,id);
    const idKey=key==='bandedRanges'?'bandedRangeId':key==='filterViews'?'filterViewId':'chartId';
    if(!Number.isInteger(item[idKey]))throw new Error(`Recurso sem identificação: ${labels[key]}. Nada foi alterado.`);
    if(key==='charts'){
      if(!item.spec||!item.position?.overlayPosition||item.position.overlayPosition.anchorCell?.sheetId!==id)throw new Error('Este gráfico não está ancorado na própria aba. Nada foi alterado.');
    }else if(!item.range||item.range.sheetId!==id)throw new Error('Filtro ou cores alternadas sem intervalo local. Nada foi alterado.');
  }
  if(raw.basicFilter){localObject(raw.basicFilter,id);if(raw.basicFilter.range?.sheetId!==id)throw new Error('Filtro sem intervalo local. Nada foi alterado.');}
}

export function clearNativeFeatures(sheet:DesignSheet):DesignRequest[]{
  const raw=sheet as unknown as JsonObject,id=sheet.properties.sheetId;
  const requests:DesignRequest[]=[];
  if(raw.basicFilter)requests.push({clearBasicFilter:{sheetId:id}});
  for(const view of raw.filterViews||[])requests.push({deleteFilterView:{filterId:view.filterViewId}});
  for(const band of raw.bandedRanges||[])requests.push({deleteBanding:{bandedRangeId:band.bandedRangeId}});
  for(const chart of raw.charts||[])requests.push({deleteEmbeddedObject:{objectId:chart.chartId}});
  // Deepest first, before resizing. Parent ranges remain valid until removed.
  for(const key of ['rowGroups','columnGroups'])for(const g of [...(raw[key]||[])].sort((a,b)=>b.depth-a.depth))requests.push({deleteDimensionGroup:{range:g.range}});
  return requests;
}

export function restoreNativeFeatures(sheet:DesignSheet,id:number):DesignRequest[]{
  const raw=sheet as unknown as JsonObject,requests:DesignRequest[]=[];
  const remap=(v:unknown)=>JSON.parse(JSON.stringify(v),(key,value)=>key==='sheetId'?id:value);
  for(const key of ['rowGroups','columnGroups']){
    const groups:DimensionGroup[]=[...(raw[key]||[])].sort((a,b)=>a.depth-b.depth||a.range.startIndex-b.range.startIndex);
    for(const g of groups)requests.push({addDimensionGroup:{range:{...g.range,sheetId:id}}});
    // All ranges must exist before collapse is restored. Parent collapse last.
    for(const g of [...groups].reverse())requests.push({updateDimensionGroup:{dimensionGroup:{...g,range:{...g.range,sheetId:id},collapsed:!!g.collapsed},fields:'collapsed'}});
  }
  for(const band of raw.bandedRanges||[])requests.push({addBanding:{bandedRange:remap(band)}});
  for(const view of raw.filterViews||[])requests.push({addFilterView:{filter:remap(view)}});
  if(raw.basicFilter)requests.push({setBasicFilter:{filter:remap(raw.basicFilter)}});
  for(const chart of raw.charts||[])requests.push({addChart:{chart:remap(chart)}});
  return requests;
}
