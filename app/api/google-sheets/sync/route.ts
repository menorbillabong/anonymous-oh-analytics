import {createClient} from '@supabase/supabase-js';
import {NextResponse} from 'next/server';
import {syncGoogleSheet} from '@/lib/google-sheets';

export const dynamic='force-dynamic';

function userMessage(error:unknown){
  const message=error instanceof Error?error.message:String(error||'');
  if(message.includes('GOOGLE_SHEETS_SERVER_NOT_CONFIGURED'))return{status:503,message:'A conexão com o Google Sheets ainda não foi configurada no servidor.'};
  if(message.includes('GOOGLE_SHEETS_PERMISSION_DENIED'))return{status:403,message:'A planilha ainda não concedeu permissão de edição à conta de serviço.'};
  if(message.includes('GOOGLE_SHEETS_NOT_FOUND'))return{status:404,message:'Não encontrei a planilha ou a aba vinculada a este perfil.'};
  if(message.includes('cabeçalhos'))return{status:422,message};
  return{status:502,message:'Não foi possível atualizar a planilha agora.'};
}

export async function POST(request:Request){
  const authorization=request.headers.get('authorization')||'';
  const token=authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!token||!url||!key)return NextResponse.json({error:'Sessão inválida.'},{status:401});

  const supabase=createClient(url,key,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{headers:{Authorization:`Bearer ${token}`}},
  });
  const{data:{user},error:authError}=await supabase.auth.getUser(token);
  if(authError||!user)return NextResponse.json({error:'Sessão inválida.'},{status:401});

  const{data:claim,error:claimError}=await supabase.rpc('claim_google_sheets_sync');
  if(claimError)return NextResponse.json({error:'A atualização do Google Sheets não está liberada para este perfil.'},{status:403});
  const permission=(claim||{}) as {allowed?:boolean;retry_after_seconds?:number;sheet_tab_name?:string};
  if(!permission.allowed){
    const retry=Math.max(1,Number(permission.retry_after_seconds||300));
    return NextResponse.json({error:`Aguarde ${Math.ceil(retry/60)} minuto(s) para atualizar novamente.`,retryAfterSeconds:retry},{status:429,headers:{'Retry-After':String(retry)}});
  }

  let normalCount=0,specialCount=0;
  try{
    const{data:posts,error:postsError}=await supabase
      .from('posts')
      .select('post_url,published_at,views,likes,special_reward,mission_name,sheets_is_special')
      .eq('user_id',user.id)
      .order('published_at',{ascending:true});
    if(postsError)throw postsError;
    const result=await syncGoogleSheet(String(permission.sheet_tab_name||''),posts||[]);
    normalCount=result.normalCount;
    specialCount=result.specialCount;
    await supabase.rpc('complete_google_sheets_sync',{p_success:true,p_normal_count:normalCount,p_special_count:specialCount,p_error:null});
    return NextResponse.json({success:true,normalCount,specialCount,total:normalCount+specialCount,skippedOutsideMonth:result.skippedOutsideMonth,cooldownSeconds:300});
  }catch(error){
    const friendly=userMessage(error);
    await supabase.rpc('complete_google_sheets_sync',{p_success:false,p_normal_count:normalCount,p_special_count:specialCount,p_error:friendly.message});
    return NextResponse.json({error:friendly.message},{status:friendly.status});
  }
}


