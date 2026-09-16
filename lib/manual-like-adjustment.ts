import {postDateKey,postPublishedDate} from './post-date.ts';

export const MAX_MANUAL_LIKES=1_000_000;
export type ManualLikeAdjustment={
  allowed:boolean; enabled:boolean; amount:number; seed:string;
  period_id:number|null; start_date:string; revision:string;
};
export const emptyManualAdjustment:ManualLikeAdjustment={allowed:false,enabled:false,amount:0,seed:'',period_id:null,start_date:'',revision:''};
export function validManualLikes(value:unknown){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=MAX_MANUAL_LIKES;}
export function parseManualAdjustment(value:any):ManualLikeAdjustment{
  return {allowed:value?.allowed===true,enabled:value?.enabled===true,amount:validManualLikes(value?.amount)?value.amount:0,
    seed:String(value?.seed||''),period_id:value?.period_id?Number(value.period_id):null,start_date:String(value?.start_date||''),revision:String(value?.revision||'')};
}
export function manualPostKey(post:any){
  const match=String(post.post_url||'').match(/(?:x\.com|twitter\.com)\/[^/?#]+\/status\/(\d+)/i);
  return match?`x:${match[1]}`:String(post.id||post.post_url||'');
}
function weight(seed:string,key:string){
  let hash=2166136261;
  for(const char of `${seed}:${key}`)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  return 1+hash%1000;
}
/** Deterministic random allocation: refreshing never adds a second adjustment. Raw posts are never mutated. */
export function distributeManualLikes(posts:any[],config:ManualLikeAdjustment,today=postDateKey(new Date())):Map<string,number>{
  const result=new Map<string,number>();
  if(!config.allowed||!config.enabled||!config.period_id||!config.start_date||!config.seed||!validManualLikes(config.amount)||!config.amount)return result;
  const keys=[...new Set(posts.filter(post=>{
    const date=postDateKey(postPublishedDate(post));
    return !post.counting_excluded&&date>=config.start_date&&date<=today&&Boolean(manualPostKey(post));
  }).map(manualPostKey))].sort();
  if(!keys.length)return result;
  const weights=keys.map(key=>({key,weight:weight(config.seed,key)}));
  const sum=weights.reduce((total,item)=>total+item.weight,0);
  const shares=weights.map(item=>({...item,amount:Math.floor(config.amount*item.weight/sum),remainder:(config.amount*item.weight)%sum}));
  let remaining=config.amount-shares.reduce((total,item)=>total+item.amount,0);
  shares.sort((a,b)=>b.remainder-a.remainder||(a.key<b.key?-1:a.key>b.key?1:0));
  for(const share of shares)result.set(share.key,share.amount+(remaining-->0?1:0));
  return result;
}
export function adjustedLikes(post:any,allocation:Map<string,number>){return Math.max(0,Number(post.likes)||0)+(allocation.get(manualPostKey(post))||0);}
export function applyManualLikes(posts:any[],allocation:Map<string,number>){
  const seen=new Set<string>();
  return posts.map(post=>{
    const key=manualPostKey(post),extra=seen.has(key)?0:allocation.get(key)||0;
    seen.add(key);
    return {...post,likes:Math.max(0,Number(post.likes)||0)+extra};
  });
}
