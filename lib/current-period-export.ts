import type {SupabaseClient} from '@supabase/supabase-js';
import type {CsvPost} from './csv-export.ts';
import {postDateKey,postPublishedValue} from './post-date.ts';
import {isActiveCountingPost} from './publication-period.ts';
import {postIsWithinPeriod} from './tracking-period.ts';
import {applyManualLikes,distributeManualLikes,parseManualAdjustment} from './manual-like-adjustment.ts';

type ExportPost=CsvPost & {user_id?:string;counting_excluded?:boolean};
type ExportPeriod={id:number;start_date:string};

export const exportMessages={
 session:'Sua sessão expirou. Entre novamente para exportar.',
 noPeriod:'Abra um período antes de exportar as publicações.',
 changed:'O período mudou durante a exportação. Tente novamente.',
 adjustmentChanged:'O ajuste de curtidas mudou durante a exportação. Tente novamente.',
 empty:'Nenhuma publicação encontrada no período atual para exportar.',
 failed:'Não foi possível preparar o arquivo. Tente novamente.',
};

export function currentPeriodExportPosts(posts:ExportPost[],period:ExportPeriod|null,today:string){
 if(!period?.id||!period.start_date)return [];
 return posts.filter(post=>isActiveCountingPost(post)&&postIsWithinPeriod(postPublishedValue(post),period.start_date,today));
}

export async function loadCurrentPeriodExport(client:SupabaseClient,expectedUserId:string,now=new Date()){
 const {data:auth,error:authError}=await client.auth.getUser();
 if(authError||auth.user?.id!==expectedUserId)throw new Error(exportMessages.session);
 const {data:period,error:periodError}=await client.rpc('get_my_active_period');
 if(periodError)throw new Error(exportMessages.failed);
 if(!period?.id||!period.start_date)throw new Error(exportMessages.noPeriod);
 const {data:adjustmentData,error:adjustmentError}=await client.rpc('get_my_manual_like_adjustment');
 if(adjustmentError||!adjustmentData)throw new Error(exportMessages.failed);
 const adjustment=parseManualAdjustment(adjustmentData);
 if(adjustment.period_id!==Number(period.id)||adjustment.start_date!==period.start_date)throw new Error(exportMessages.changed);
 const posts:ExportPost[]=[];
 // Page explicitly so the API's default row cap cannot silently truncate exports.
 for(let offset=0;;){
  const {data,error}=await client.from('posts')
   .select('id,user_id,mission_name,post_url,views,likes,x_published_at,published_at,created_at,counting_excluded')
   .eq('user_id',expectedUserId).eq('counting_excluded',false)
   .order('id',{ascending:true}).range(offset,offset+499);
  if(error||!data)throw new Error(exportMessages.failed);
  if(!data.length)break;
  posts.push(...data.filter(post=>post.user_id===expectedUserId));
  offset+=data.length;
 }
 // A close/correction in another tab must not yield an export of an old period.
 const [{data:latest,error:latestError},{data:latestAuth,error:latestAuthError},{data:latestAdjustment,error:latestAdjustmentError}]=await Promise.all([
  client.rpc('get_my_active_period'),client.auth.getUser(),client.rpc('get_my_manual_like_adjustment'),
 ]);
 if(latestAuthError||latestAuth.user?.id!==expectedUserId)throw new Error(exportMessages.session);
 if(latestError||latestAdjustmentError||!latestAdjustment)throw new Error(exportMessages.failed);
 if(latest?.id!==period.id||latest?.start_date!==period.start_date)throw new Error(exportMessages.changed);
 if(JSON.stringify(parseManualAdjustment(latestAdjustment))!==JSON.stringify(adjustment))throw new Error(exportMessages.adjustmentChanged);
 const current=currentPeriodExportPosts(posts,period,postDateKey(now));
 if(!current.length)throw new Error(exportMessages.empty);
 // Allocate once over the entire eligible period, never once per page or mission.
 const allocation=distributeManualLikes(current,adjustment,postDateKey(now));
 const manualLikes=[...allocation.values()].reduce((sum,value)=>sum+value,0);
 return {posts:manualLikes?applyManualLikes(current,allocation):current,manualLikes};
}
