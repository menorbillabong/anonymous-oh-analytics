import {formatPostDate,postPublishedDate,postPublishedValue} from './post-date.ts';

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

export function buildPostsCsv(posts:CsvPost[]){
 const groups=new Map<string,CsvPost[]>();
 posts.forEach(post=>{
  const mission=String(post.mission_name||'Sem missão').trim()||'Sem missão';
  groups.set(mission,[...(groups.get(mission)||[]),post]);
 });

 const lines:string[]=[];
 [...groups.entries()].forEach(([mission,rows],index)=>{
  if(index)lines.push('');
  lines.push(csvCell(`MISSÃO: ${mission}`));
  lines.push(['Data','Rede','Link','Visualizações','Curtidas'].map(csvCell).join(','));
  [...rows]
   .sort((a,b)=>{
    const aTime=postPublishedDate(a)?.getTime()??Number.POSITIVE_INFINITY;
    const bTime=postPublishedDate(b)?.getTime()??Number.POSITIVE_INFINITY;
    return aTime-bTime;
   })
   .forEach(post=>{
    lines.push([
     formatPostDate(postPublishedValue(post)),
     'X',
     post.post_url,
     metric(post.views),
     metric(post.likes),
    ].map(csvCell).join(','));
   });
 });

 return lines.length?`${lines.join('\r\n')}\r\n`:'';
}

