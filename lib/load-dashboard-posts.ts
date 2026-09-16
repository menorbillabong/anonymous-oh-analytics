import type {SupabaseClient} from '@supabase/supabase-js';
/** Load complete metrics so a row limit cannot change a manual allocation. */
export async function loadDashboardPosts(client:SupabaseClient,userId:string){
 const posts:any[]=[];
 for(let offset=0;;){
  const {data,error}=await client.from('posts').select('*').eq('user_id',userId)
   .order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);
  if(error)return{data:null,error};
  if(!data?.length)return{data:posts,error:null};
  posts.push(...data);offset+=data.length;
 }
}
