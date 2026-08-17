export const POST_TIME_ZONE='America/Sao_Paulo';

const dateOnlyPattern=/^\d{4}-\d{2}-\d{2}$/;

export function parsePostDate(value:any):Date|null{
 if(!value)return null;
 const text=String(value);
 const date=new Date(dateOnlyPattern.test(text)?`${text}T12:00:00-03:00`:text);
 return Number.isNaN(date.getTime())?null:date;
}

export function postPublishedValue(post:any){
 return post?.x_published_at||post?.published_at||post?.published_date||post?.created_at||null;
}

export function postPublishedDate(post:any){
 return parsePostDate(postPublishedValue(post));
}

export function postDateParts(value:any){
 const date=value instanceof Date?value:parsePostDate(value);
 if(!date)return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:POST_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const get=(type:Intl.DateTimeFormatPartTypes)=>Number(parts.find(part=>part.type===type)?.value||0);
 const year=get('year'),month=get('month'),day=get('day');
 if(!year||!month||!day)return null;
 return{year,month:month-1,day,key:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`};
}

export function postDateKey(value:any){
 return postDateParts(value)?.key||'';
}

export function formatPostDate(value:any,withTime=false){
 const date=parsePostDate(value);
 if(!date)return'';
 const options:Intl.DateTimeFormatOptions={timeZone:POST_TIME_ZONE,day:'2-digit',month:'2-digit',year:'numeric'};
 if(withTime){options.hour='2-digit';options.minute='2-digit';options.second='2-digit'}
 return new Intl.DateTimeFormat('pt-BR',options).format(date);
}

