export function xStatusId(value:unknown){
 return String(value||'').match(/\/status\/(\d+)/i)?.[1]||'';
}

export function withoutExistingXPosts<T>(items:T[],existingUrls:unknown[],urlOf:(item:T)=>unknown){
 const seen=new Set(existingUrls.map(xStatusId).filter(Boolean));
 const accepted:T[]=[];
 let hiddenDuplicateCount=0;
 for(const item of items){
  const id=xStatusId(urlOf(item));
  if(id&&seen.has(id)){hiddenDuplicateCount++;continue}
  if(id)seen.add(id);
  accepted.push(item);
 }
 return{accepted,hiddenDuplicateCount};
}
