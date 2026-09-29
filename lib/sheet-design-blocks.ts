import type {DesignCell,DesignSheet} from './sheet-design-plan.ts';

export const CURRENT_BLOCK_CAPACITY=60;
export const MAX_DESIGN_ROWS=2000;
export const BLOCK_HEADING_ROWS=3;

// The embedded templates use ordinary A1 references. Leave quoted text and
// absolute row anchors untouched when extending their calculated input rows.
export function shiftTemplateFormula(formula:string,delta:number){
  return formula.split(/("(?:[^"]|"")*")/).map((part,i)=>i%2?part:part.replace(/(?<![A-Za-z0-9_])([$]?[A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_])/g,(_all,col,absolute,row)=>`${col}${absolute}${Number(row)+(absolute?0:delta)}`)).join('');
}

// Inserting a template row moves absolute references too, unlike copying a row.
export function insertTemplateFormulaRow(formula:string,before:number){
  return formula.split(/("(?:[^"]|"")*")/).map((part,i)=>i%2?part:part.replace(/(?<![A-Za-z0-9_])([$]?[A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_])/g,(_all,col,absolute,row)=>`${col}${absolute}${Number(row)+(Number(row)>before?1:0)}`)).join('');
}

export function buildDesignBlocks(source:DesignSheet,rows:DesignCell[][],header:number,sizes:number[]){
  if(!sizes.length||sizes.some(n=>!Number.isInteger(n)||n<0)||source.properties.gridProperties.rowCount<header+3||!rows[header+2])throw new Error('O modelo não contém as linhas necessárias para ampliar os blocos. Nada foi alterado.');
  // Embedded templates currently have only cells, top/header merges and rules.
  // Refuse future unsupported structures rather than resizing them incorrectly.
  if(source.data?.length!==1||source.data[0].startRow||source.data[0].startColumn||source.charts?.length||source.tables?.length||source.rowGroups?.length||source.columnGroups?.length||source.filterViews?.length||source.bandedRanges?.length||source.basicFilter||(source.merges||[]).some(m=>(m.endRowIndex||0)>header+1))throw new Error('A estrutura deste modelo precisa ser revisada antes de ampliar os blocos. Nada foi alterado.');
  const titles=rows[header-2]||[];
  if(header<BLOCK_HEADING_ROWS||!titles.some(c=>c.userEnteredValue?.stringValue?.trim()==='Normal Mission')||!titles.some(c=>c.userEnteredValue?.stringValue?.trim()==='Special Mission'))throw new Error('Os títulos de missão deste modelo precisam ser revisados. Nada foi alterado.');
  // Keep the summary intact when its last row occupies the desired spacer.
  if(rows[header-3].some(c=>c.userEnteredValue||c.note)){
    const before=header-2;
    source=structuredClone(source);rows=structuredClone(rows);
    for(const row of rows)for(const c of row){
      if(c.userEnteredValue?.formulaValue)c.userEnteredValue.formulaValue=insertTemplateFormulaRow(c.userEnteredValue.formulaValue,before);
    }
    rows.splice(before,0,rows[header-1].map(c=>({...(c.userEnteredFormat?{userEnteredFormat:structuredClone(c.userEnteredFormat)}:{})})));
    const originalGrid=source.data![0];
    originalGrid.rowMetadata=Array.from({length:source.properties.gridProperties.rowCount},(_,r)=>structuredClone(originalGrid.rowMetadata?.[r]||{}));
    originalGrid.rowMetadata.splice(before,0,{pixelSize:20});
    const moveRange=(r:{startRowIndex?:number;endRowIndex?:number})=>{
      if(r.startRowIndex!==undefined&&r.startRowIndex>=before)r.startRowIndex++;
      if(r.endRowIndex!==undefined&&r.endRowIndex>before)r.endRowIndex++;
    };
    for(const m of source.merges||[])moveRange(m);
    for(const raw of source.conditionalFormats||[])for(const r of (raw as {ranges:{startRowIndex?:number;endRowIndex?:number}[]}).ranges)moveRange(r);
    source.properties.gridProperties.rowCount++;
    if((source.properties.gridProperties.frozenRowCount||0)>before)source.properties.gridProperties.frozenRowCount!++;
    header++;
  }
  const capacities=sizes.map((n,i)=>i===sizes.length-1?Math.max(CURRENT_BLOCK_CAPACITY,n):n);
  const headers:number[]=[];let rowCount=header;
  for(const [i,n] of capacities.entries()){if(i)rowCount+=BLOCK_HEADING_ROWS;headers.push(rowCount);rowCount+=1+n;}
  if(rowCount>MAX_DESIGN_ROWS)throw new Error(`A transformação precisaria de ${rowCount} linhas, acima do limite seguro de ${MAX_DESIGN_ROWS}. Nenhuma publicação foi descartada e nada foi alterado.`);
  const result=structuredClone(source),grid=result.data![0],original=source.data![0];
  grid.rowData=rows.slice(0,header).map(values=>({values:structuredClone(values)}));
  grid.rowMetadata=Array.from({length:header},(_,r)=>structuredClone(original.rowMetadata?.[r]||{}));
  for(const [index,h] of headers.entries()){
    if(index)for(let r=header-BLOCK_HEADING_ROWS;r<header;r++){
      grid.rowData.push({values:structuredClone(rows[r])});
      grid.rowMetadata.push({...structuredClone(original.rowMetadata?.[r]||{}),hiddenByUser:false});
    }
    grid.rowData.push({values:structuredClone(rows[header])});
    grid.rowMetadata.push(structuredClone(original.rowMetadata?.[header]||{}));
    for(let offset=1;offset<=capacities[index];offset++){
      const r=h+offset,base=r===header+1?header+1:header+2;
      const values=structuredClone(rows[base]).map(c=>{
        delete c.effectiveValue;delete c.formattedValue;delete c.hyperlink;
        if(c.userEnteredValue?.formulaValue)c.userEnteredValue.formulaValue=shiftTemplateFormula(c.userEnteredValue.formulaValue,r-base);
        return c;
      });
      grid.rowData.push({values});grid.rowMetadata.push({...structuredClone(original.rowMetadata?.[base]||{}),hiddenByUser:false});
    }
  }
  result.properties.gridProperties.rowCount=rowCount;
  result.properties.gridProperties.frozenRowCount=Math.min(source.properties.gridProperties.frozenRowCount||0,header+1);
  // Repeat the entire title/spacer/header band, including two-row title merges.
  const bandStart=header-BLOCK_HEADING_ROWS;
  if((source.merges||[]).some(m=>(m.startRowIndex||0)<bandStart&&(m.endRowIndex||0)>bandStart))throw new Error('Uma mesclagem do resumo atravessa a identificação das missões. Nada foi alterado.');
  result.merges=[...(result.merges||[]),...headers.slice(1).flatMap(h=>(source.merges||[]).filter(m=>(m.startRowIndex||0)>=bandStart).map(m=>({...m,startRowIndex:m.startRowIndex!+h-header,endRowIndex:m.endRowIndex!+h-header})))];
  result.conditionalFormats=(source.conditionalFormats||[]).map(raw=>{
    const rule=structuredClone(raw) as {ranges:Array<{startRowIndex?:number;endRowIndex?:number;[key:string]:unknown}>};
    if(rule.ranges.some(r=>r.endRowIndex===undefined||r.endRowIndex>header+1))throw new Error('O modelo contém uma regra de formatação que precisa ser revisada antes da ampliação. Nada foi alterado.');
    const intersections=rule.ranges.filter(r=>r.endRowIndex!>bandStart).map(r=>({...r,startRowIndex:Math.max(r.startRowIndex||0,bandStart)}));
    rule.ranges.push(...headers.slice(1).flatMap(h=>intersections.map(r=>({...r,startRowIndex:r.startRowIndex+h-header,endRowIndex:r.endRowIndex!+h-header}))));
    return rule;
  });
  return {sheet:result,headers,capacities,rowCount};
}
