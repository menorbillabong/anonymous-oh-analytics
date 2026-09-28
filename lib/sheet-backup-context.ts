import 'server-only';
import {createClient} from '@supabase/supabase-js';
export async function backupContext(request:Request){
  const token=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)throw new Error('Sessão inválida.');
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:{user},error}=await client.auth.getUser(token);if(error||!user)throw new Error('Sessão inválida.');
  async function permission(){
    const [{data:status,error:statusError},{data,error:configError}]=await Promise.all([client.rpc('get_my_google_sheets_sync_status'),client.from('google_sheets_user_config').select('enabled,sheet_tab_name,sheet_month').eq('user_id',user!.id).maybeSingle()]);
    if(statusError||configError||!status?.enabled||!data?.enabled||!data.sheet_tab_name)throw new Error('A atualização de planilha não está liberada para esta conta.');
    return {tab:String(data.sheet_tab_name),month:String(data.sheet_month||'')};
  }
  return {client,user,permission,config:await permission()};
}
