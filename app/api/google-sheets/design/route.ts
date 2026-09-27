import {createClient} from '@supabase/supabase-js';
import {NextResponse} from 'next/server';
import {sheetDesign} from '@/lib/sheet-designs';
import {prepareSheetDesign,applySheetDesign} from '@/lib/sheet-design-service';

export const dynamic='force-dynamic';
export const maxDuration=60;
class RequestError extends Error{constructor(message:string,public status=422){super(message)}}
async function context(request:Request){
  const token=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!token||!url||!key)throw new RequestError('Sessão inválida.',401);
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:{user},error}=await client.auth.getUser(token);
  if(error||!user)throw new RequestError('Sessão inválida.',401);
  async function config(){
    const [{data:status,error:statusError},{data,error:configError}]=await Promise.all([
      client.rpc('get_my_google_sheets_sync_status'),
      client.from('google_sheets_user_config').select('enabled,sheet_tab_name,sheet_month').eq('user_id',user!.id).maybeSingle(),
    ]);
    if(statusError||configError||!status?.enabled||!data?.enabled||!data.sheet_tab_name)throw new RequestError('A atualização de planilha não está liberada para este usuário.',403);
    return {tab:String(data.sheet_tab_name),month:String(data.sheet_month||'')};
  }
  return {client,config,permission:await config()};
}
function failed(error:unknown){
  const message=error instanceof Error?error.message:'';
  if(error instanceof RequestError)return NextResponse.json({error:message},{status:error.status});
  if(message.startsWith('GOOGLE_'))return NextResponse.json({error:'Não foi possível acessar o Google Sheets. Confira a conexão e a permissão de edição.'},{status:502});
  return NextResponse.json({error:message||'Não foi possível conferir o modelo.'},{status:422});
}
export async function GET(request:Request){
  try{
    const {permission}=await context(request),id=new URL(request.url).searchParams.get('design');
    if(!sheetDesign(id))throw new RequestError('Modelo inválido.');
    const prepared=await prepareSheetDesign(permission.tab,id,permission.month);
    return NextResponse.json({fingerprint:prepared.fingerprint,tabName:permission.tab,normalCount:prepared.plan.normalCount,specialCount:prepared.plan.specialCount,capacity:prepared.plan.capacity},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return failed(error)}
}
export async function POST(request:Request){
  let completion:(success:boolean,message:string|null)=>Promise<void> = async()=>{};
  let submitted=false;
  try{
    const {client,permission,config}=await context(request);
    const body=await request.json();
    if(!sheetDesign(body.design)||body.confirm!==true||!/^[a-f0-9]{64}$/.test(body.fingerprint||''))throw new RequestError('Confira e confirme o modelo antes de aplicar.');
    // The same server-side claim serializes design changes and normal Sheets synchronization.
    const {data:claim,error}=await client.rpc('claim_google_sheets_sync');
    if(error)throw new RequestError('A atualização de planilha não está liberada para este usuário.',403);
    if(!claim?.allowed)throw new RequestError('Há uma atualização em andamento ou um tempo de espera ativo. Aguarde e confira novamente.',429);
    let normalCount=0,specialCount=0;
    completion=async(success,message)=>{await client.rpc('complete_google_sheets_sync',{p_success:success,p_normal_count:normalCount,p_special_count:specialCount,p_error:message})};
    if(claim.sheet_tab_name!==permission.tab||String(claim.sheet_month||'')!==permission.month)throw new RequestError('O vínculo da planilha mudou. Confira novamente.',409);
    // Read only AFTER acquiring the shared claim; a previous sync may have just completed.
    const prepared=await prepareSheetDesign(permission.tab,body.design,permission.month);
    if(prepared.fingerprint!==body.fingerprint)throw new RequestError('A aba ou o modelo mudou desde a conferência. Confira novamente antes de aplicar.',409);
    normalCount=prepared.plan.normalCount;specialCount=prepared.plan.specialCount;
    const result=await applySheetDesign(prepared,async()=>{
      const current=await config();
      if(current.tab!==permission.tab||current.month!==permission.month)throw new RequestError('O vínculo ou a permissão da planilha mudou. Confira novamente.',409);
      submitted=true;
    });
    await completion(true,null).catch(()=>{});
    return NextResponse.json(result);
  }catch(error){
    const message=submitted?'Não foi possível confirmar o resultado. Confira sua aba e a cópia “Backup AOH” no Sheets antes de tentar novamente.':error instanceof Error?error.message:'Falha ao aplicar modelo.';
    await completion(false,message).catch(()=>{});
    return submitted?NextResponse.json({error:message,checkSheet:true},{status:502}):failed(error);
  }
}
