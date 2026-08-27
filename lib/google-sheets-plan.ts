const MAX_SHEET_ROWS = 2000;

export type SheetPost = {
  post_url?: string | null;
  network?: string | null;
  published_at?: string | null;
  views?: number | string | null;
  likes?: number | string | null;
  special_reward?: number | string | null;
  mission_name?: string | null;
  sheets_is_special?: boolean | null;
};

type SheetUpdate = {range:string; values:Array<Array<string|number>>};

export type SheetPlan = {
  updates: SheetUpdate[];
  normalCount: number;
  specialCount: number;
  skippedOutsideMonth: number;
};

type HeaderField = 'month'|'publishDate'|'platform'|'contentLink'|'views'|'likes'|'eligible'|'reward'|'theme';
type SectionColumns = Partial<Record<HeaderField,number>>;
type HeaderLayout = {row:number;normal:SectionColumns;special:SectionColumns};

const ESSENTIAL_FIELDS:HeaderField[]=['contentLink'];
const SITE_MANAGED_FIELDS:HeaderField[]=['month','publishDate','platform','contentLink','views','likes','reward','theme'];

function clean(value:unknown){return String(value ?? '').trim()}
function normalized(value:unknown){return clean(value).toLowerCase().replace(/\s+/g,' ')}
function safeNumber(value:unknown){const number=Number(value);return Number.isFinite(number)&&number>0?Math.floor(number):0}
function monthKey(value:unknown){const match=clean(value).match(/(\d{4})[-/](\d{1,2})/);return match?`${match[1]}-${match[2].padStart(2,'0')}`:''}
function a1Tab(tabName:string){return `'${tabName.replaceAll("'", "''")}'`}

export function xStatusId(value:unknown){
  return clean(value).match(/(?:x\.com|twitter\.com)\/[^/?#]+\/status\/(\d+)/i)?.[1] || '';
}

function linkKey(value:unknown){
  const status=xStatusId(value);
  return status?`status:${status}`:clean(value).replace(/[?#].*$/,'').replace(/\/$/,'').toLowerCase();
}

function headerField(value:unknown):HeaderField|null{
  const label=normalized(value);
  if(label==='month')return'month';
  if(label.includes('publish date'))return'publishDate';
  if(label==='platform')return'platform';
  if(label.includes('content link'))return'contentLink';
  if(label.includes('impressions')&&label.includes('views'))return'views';
  if(label==='likes')return'likes';
  if(label==='eligible')return'eligible';
  if(label==='reward')return'reward';
  if(label==='theme')return'theme';
  return null;
}

function sectionColumns(cells:Array<{column:number;field:HeaderField}>):SectionColumns|null{
  const fields=new Map<HeaderField,number>();
  for(const cell of cells){
    if(fields.has(cell.field))return null;
    fields.set(cell.field,cell.column);
  }
  if(!cells.length)return null;
  return Object.fromEntries(fields) as SectionColumns;
}

function hasRequired(section:SectionColumns|null,required:HeaderField[]){
  return Boolean(section&&required.every(field=>section[field]!==undefined));
}

function headerLayoutForRow(row:unknown[],rowIndex:number):HeaderLayout|null{
  const cells:Array<{column:number;field:HeaderField}>=[];
  row.forEach((value,column)=>{const field=headerField(value);if(field)cells.push({column,field})});
  if(cells.filter(cell=>cell.field==='contentLink').length<2)return null;

  let best:{normal:SectionColumns;special:SectionColumns;gap:number}|null=null;
  for(let split=1;split<cells.length;split++){
    const normal=sectionColumns(cells.slice(0,split));
    const special=sectionColumns(cells.slice(split));
    if(!hasRequired(normal,ESSENTIAL_FIELDS)||!hasRequired(special,ESSENTIAL_FIELDS))continue;
    const gap=cells[split]!.column-cells[split-1]!.column;
    if(!best||gap>best.gap)best={normal:normal!,special:special!,gap};
  }
  return best?{row:rowIndex,normal:best.normal,special:best.special}:null;
}

function findLastHeaderLayout(rows:unknown[][]):HeaderLayout|null{
  let layout:HeaderLayout|null=null;
  rows.forEach((row,index)=>{const candidate=headerLayoutForRow(row,index);if(candidate)layout=candidate});
  return layout;
}

function selectedSheetMonth(rows:unknown[][]){
  for(const row of rows){
    for(let column=0;column<row.length-1;column++){
      if(normalized(row[column]).includes('settlement month')){
        const month=monthKey(row[column+1]);
        if(month)return month;
      }
    }
  }
  return'';
}

function columnName(columnIndex:number){
  let value=columnIndex+1;
  let output='';
  while(value>0){
    const remainder=(value-1)%26;
    output=String.fromCharCode(65+remainder)+output;
    value=Math.floor((value-1)/26);
  }
  return output;
}

function cellRange(tab:string,columnIndex:number,rowIndex:number){return `${a1Tab(tab)}!${columnName(columnIndex)}${rowIndex+1}`}
function postDate(post:SheetPost){return clean(post.published_at).slice(0,10)}
function postPlatform(post:SheetPost){
  const network=normalized(post.network);
  if(network==='x'||network==='twitter')return'X';
  return xStatusId(post.post_url)?'X':'';
}

export function planSheetUpdates(tabName:string,rows:unknown[][],posts:SheetPost[],sheetMonth=''):SheetPlan{
  const layout=findLastHeaderLayout(rows);
  if(!layout)throw new Error('Não encontrei os dois cabeçalhos Content Link de Normal Mission e Special Mission nessa aba.');

  const manualMonth=monthKey(sheetMonth);
  const selectedMonth=manualMonth||selectedSheetMonth(rows);
  const existing=new Map<string,Array<{row:number;special:boolean}>>();
  let lastNormal=layout.row;
  let lastSpecial=layout.row;

  rows.forEach((row,index)=>{
    if(index<=layout.row)return;
    const normalLink=clean(row?.[layout.normal.contentLink!]);
    const specialLink=clean(row?.[layout.special.contentLink!]);
    if(normalLink)lastNormal=Math.max(lastNormal,index);
    if(specialLink)lastSpecial=Math.max(lastSpecial,index);
    if(normalLink){const key=linkKey(normalLink);existing.set(key,[...(existing.get(key)||[]),{row:index,special:false}])}
    if(specialLink){const key=linkKey(specialLink);existing.set(key,[...(existing.get(key)||[]),{row:index,special:true}])}
  });

  let nextNormal=lastNormal+1;
  let nextSpecial=lastSpecial+1;
  const updates:SheetUpdate[]=[];
  let normalCount=0,specialCount=0,skippedOutsideMonth=0;
  const uniquePosts=new Map<string,SheetPost>();
  for(const post of posts){const key=linkKey(post.post_url);if(key)uniquePosts.set(key,post)}

  const ordered=[...uniquePosts.entries()].sort((a,b)=>postDate(a[1]).localeCompare(postDate(b[1])));
  for(const[key,post]of ordered){
    const existingCells=existing.get(key)||[];
    const date=postDate(post);
    if(!date)continue;

    let row:number;
    const special=Boolean(post.sheets_is_special);
    const matchingCell=existingCells.find(cell=>cell.special===special);
    if(matchingCell){
      row=matchingCell.row;
    }else if(existingCells.length){
      row=special?nextSpecial++:nextNormal++;
      if(row>=MAX_SHEET_ROWS)throw new Error('A aba não possui linhas livres suficientes para concluir a atualização.');
    }else{
      if(!selectedMonth||monthKey(date)!==selectedMonth){skippedOutsideMonth++;continue}
      row=special?nextSpecial++:nextNormal++;
      if(row>=MAX_SHEET_ROWS)throw new Error('A aba não possui linhas livres suficientes para concluir a atualização.');
    }
    existing.set(key,[{row,special}]);

    for(const oldCell of existingCells){
      if(oldCell.row===row&&oldCell.special===special)continue;
      const section=oldCell.special?layout.special:layout.normal;
      for(const field of SITE_MANAGED_FIELDS){
        const column=section[field];
        if(column!==undefined)updates.push({range:cellRange(tabName,column,oldCell.row),values:[['']]});
      }
    }

    const section=special?layout.special:layout.normal;
    const add=(field:HeaderField,value:string|number)=>{
      const column=section[field];
      if(column!==undefined)updates.push({range:cellRange(tabName,column,row),values:[[value]]});
    };
    if(manualMonth&&section.month!==undefined&&!clean(rows?.[row]?.[section.month]))add('month',manualMonth);
    add('publishDate',date);
    add('platform',postPlatform(post));
    add('contentLink',clean(post.post_url));
    add('views',safeNumber(post.views));
    add('likes',safeNumber(post.likes));
    if(special){
      add('reward',safeNumber(post.special_reward));
      add('theme',clean(post.mission_name));
      specialCount++;
    }else{
      normalCount++;
    }
  }

  return{updates,normalCount,specialCount,skippedOutsideMonth};
}

export const GOOGLE_SHEETS_MAX_ROWS=MAX_SHEET_ROWS;


