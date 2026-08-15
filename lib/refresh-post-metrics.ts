import {supabase} from './supabase';

const xPostPattern=/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i;
const batchSize=4;

type RefreshProgress=(finished:number,total:number)=>void;

export type MetricsRefreshResult={attempted:number;succeeded:number;failed:number};

function metric(value:unknown,fallback:unknown){
 const number=Number(value);
 return Number.isFinite(number)&&number>=0?number:Number(fallback||0);
}

async function fetchMetrics(postUrl:string){
 const response=await fetch('/api/x-metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:postUrl})});
 const data=await response.json();
 if(!response.ok||data?.error)throw new Error(data?.error||'Falha ao coletar métricas');
 return data;
}

export async function refreshStoredPostMetrics(posts:any[],userId:string,onProgress?:RefreshProgress):Promise<MetricsRefreshResult>{
 const targets=posts.filter(post=>post?.id&&xPostPattern.test(String(post.post_url||'')));
 let succeeded=0,failed=0,finished=0;
 onProgress?.(0,targets.length);
 for(let start=0;start<targets.length;start+=batchSize){
  const batch=targets.slice(start,start+batchSize);
  await Promise.all(batch.map(async post=>{
   try{
    const data=await fetchMetrics(String(post.post_url));
    const{error}=await supabase.from('posts').update({
     views:metric(data.views,post.views),
     likes:metric(data.likes,post.likes),
     reposts:metric(data.reposts,post.reposts),
     comments:metric(data.comments,post.comments),
     metrics_source:data.source||'auto',
     metrics_updated_at:new Date().toISOString(),
    }).eq('id',post.id).eq('user_id',userId);
    if(error)throw error;
    succeeded++;
   }catch{failed++}
   finally{finished++;onProgress?.(finished,targets.length)}
  }));
 }
 return{attempted:targets.length,succeeded,failed};
}
