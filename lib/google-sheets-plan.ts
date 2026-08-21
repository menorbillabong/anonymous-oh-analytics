const MAX_SHEET_ROWS = 2000;

export type SheetPost = {
  post_url?: string | null;
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

function findLastHeader(rows:unknown[][]){
  let header=-1;
  rows.forEach((row,index)=>{
    const normal=normalized(row?.[1])==='month'&&normalized(row?.[2]).includes('publish date')&&normalized(row?.[4]).includes('content link');
    const special=normalized(row?.[10])==='month'&&normalized(row?.[11]).includes('publish date')&&normalized(row?.[13]).includes('content link');
    if(normal&&special)header=index;
  });
  return header;
}

function cellRange(tab:string,column:string,rowIndex:number){return `${a1Tab(tab)}!${column}${rowIndex+1}`}
function postDate(post:SheetPost){return clean(post.published_at).slice(0,10)}

export function planSheetUpdates(tabName:string,rows:unknown[][],posts:SheetPost[]):SheetPlan{
  const header=findLastHeader(rows);
  if(header<0)throw new Error('Não encontrei os cabeçalhos Normal Mission e Special Mission nessa aba.');

  const selectedMonth=monthKey(rows?.[2]?.[2]);
  const existing=new Map<string,{row:number;special:boolean}>();
  let lastNormal=header;
  let lastSpecial=header;

  rows.forEach((row,index)=>{
    const normalLink=clean(row?.[4]);
    const specialLink=clean(row?.[13]);
    if(index>header&&normalLink)lastNormal=Math.max(lastNormal,index);
    if(index>header&&specialLink)lastSpecial=Math.max(lastSpecial,index);
    if(normalLink&&!existing.has(linkKey(normalLink)))existing.set(linkKey(normalLink),{row:index,special:false});
    if(specialLink&&!existing.has(linkKey(specialLink)))existing.set(linkKey(specialLink),{row:index,special:true});
  });

  let nextNormal=lastNormal+1;
  let nextSpecial=lastSpecial+1;
  const updates:SheetUpdate[]=[];
  let normalCount=0,specialCount=0,skippedOutsideMonth=0;
  const uniquePosts=new Map<string,SheetPost>();
  for(const post of posts){const key=linkKey(post.post_url);if(key)uniquePosts.set(key,post)}

  const ordered=[...uniquePosts.entries()].sort((a,b)=>postDate(a[1]).localeCompare(postDate(b[1])));
  for(const[key,post]of ordered){
    const existingCell=existing.get(key);
    const date=postDate(post);
    if(!date)continue;

    let row:number;
    let special:boolean;
    if(existingCell){
      row=existingCell.row;
      special=existingCell.special;
    }else{
      if(!selectedMonth||monthKey(date)!==selectedMonth){skippedOutsideMonth++;continue}
      special=Boolean(post.sheets_is_special);
      row=special?nextSpecial++:nextNormal++;
      if(row>=MAX_SHEET_ROWS)throw new Error('A aba não possui linhas livres suficientes para concluir a atualização.');
      existing.set(key,{row,special});
    }

    if(special){
      updates.push(
        {range:cellRange(tabName,'L',row),values:[[date]]},
        {range:cellRange(tabName,'N',row),values:[[clean(post.post_url)]]},
        {range:cellRange(tabName,'O',row),values:[[safeNumber(post.views)]]},
        {range:cellRange(tabName,'P',row),values:[[safeNumber(post.likes)]]},
        {range:cellRange(tabName,'R',row),values:[[safeNumber(post.special_reward)]]},
        {range:cellRange(tabName,'S',row),values:[[clean(post.mission_name)]]},
      );
      specialCount++;
    }else{
      updates.push(
        {range:cellRange(tabName,'C',row),values:[[date]]},
        {range:cellRange(tabName,'E',row),values:[[clean(post.post_url)]]},
        {range:cellRange(tabName,'F',row),values:[[safeNumber(post.views)]]},
        {range:cellRange(tabName,'G',row),values:[[safeNumber(post.likes)]]},
      );
      normalCount++;
    }
  }

  return{updates,normalCount,specialCount,skippedOutsideMonth};
}

export const GOOGLE_SHEETS_MAX_ROWS=MAX_SHEET_ROWS;

