import {postDateKey,postPublishedDate,postPublishedValue} from './post-date.ts';

export type CsvPost={
 mission_name?:unknown;
 post_url?:unknown;
 views?:unknown;
 likes?:unknown;
 x_published_at?:unknown;
 published_at?:unknown;
 published_date?:unknown;
 created_at?:unknown;
};

function csvCell(value:unknown){
 return `"${String(value??'').replaceAll('"','""')}"`;
}

function metric(value:unknown){
 const number=Number(value??0);
 return Number.isFinite(number)?number:0;
}

export function buildPostsCsv(posts:CsvPost[],manualLikes=0){
 return buildDelimitedPosts(posts,',',csvCell,manualLikes);
}

function txtCell(value:unknown){
 // Embedded tabs/newlines must not create extra cells when pasted into Sheets.
 const text=String(value??'').replace(/[\t\r\n]+/g,' ');
 return /^[\s]*[=+@\-"]/.test(text)?`'${text}`:text;
}

export function buildPostsTxt(posts:CsvPost[],manualLikes=0){
 return buildDelimitedPosts(posts,'\t',txtCell,manualLikes);
}

function buildDelimitedPosts(posts:CsvPost[],separator:string,cell:(value:unknown)=>string,manualLikes:number){
 const groups=new Map<string,CsvPost[]>();
 posts.forEach(post=>{
  const mission=String(post.mission_name||'Sem missão').trim()||'Sem missão';
  groups.set(mission,[...(groups.get(mission)||[]),post]);
 });

 const lines:string[]=[];
 [...groups.entries()].forEach(([mission,rows],index)=>{
  if(index)lines.push('');
  lines.push(cell(`MISSÃO: ${mission}`));
  lines.push(['Data','Rede','Link','Visualizações',manualLikes>0?'Curtidas (X + manual)':'Curtidas'].map(cell).join(separator));
  [...rows]
   .sort((a,b)=>{
    const aTime=postPublishedDate(a)?.getTime()??Number.POSITIVE_INFINITY;
    const bTime=postPublishedDate(b)?.getTime()??Number.POSITIVE_INFINITY;
    return aTime-bTime;
   })
   .forEach(post=>{
    lines.push([
     postDateKey(postPublishedValue(post)),
     'X',
     post.post_url,
     metric(post.views),
     metric(post.likes),
    ].map(cell).join(separator));
   });
 });

 return lines.length?`${lines.join('\r\n')}\r\n`:'';
}

