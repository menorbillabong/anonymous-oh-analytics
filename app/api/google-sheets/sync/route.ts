import {createClient} from '@supabase/supabase-js';
import {NextResponse} from 'next/server';
import {syncGoogleSheet} from '@/lib/google-sheets';
import {parseManualAdjustment} from '@/lib/manual-like-adjustment';
import {formatCooldown} from '@/lib/sheets-cooldown';
import type {SheetPost} from '@/lib/google-sheets-plan';

export const dynamic='force-dynamic';

function userMessage(error:unknown){
  const message=error instanceof Error?error.message:String(error||'');
  if(message==='MANUAL_ADJUSTMENT_SHEET_MISMATCH')return{status:422,message:'O mês da planilha ou a coluna Likes não permite incluir todo o ajuste do período aberto. Confira essas configurações; nada foi alterado na planilha.'};
  if(message==='MANUAL_ADJUSTMENT_CHANGED')return{status:409,message:'O ajuste ou o período mudou durante a sincronização. Tente novamente; nada foi alterado na planilha.'};
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
  const permission=(claim||{}) as {allowed?:boolean;retry_after_seconds?:number;sheet_tab_name?:string;sheet_month?:string;cooldown_seconds?:number;cooldown_ends_at?:string};
  if(!permission.allowed){
    const retry=Math.max(1,Number(permission.retry_after_seconds||permission.cooldown_seconds||90));
    return NextResponse.json({error:`Aguarde ${formatCooldown(retry)} para atualizar novamente.`,retryAfterSeconds:retry},{status:429,headers:{'Retry-After':String(retry)}});
  }
  const cooldown=()=>({cooldownSeconds:permission.cooldown_seconds,retryAfterSeconds:Math.max(0,Math.ceil((Date.parse(permission.cooldown_ends_at||'')-Date.now())/1000)||0)});

  let normalCount=0,specialCount=0;
  try{
    const{data:adjustmentData,error:adjustmentError}=await supabase.rpc('get_my_manual_like_adjustment');
    if(adjustmentError)throw adjustmentError;
    const adjustment=parseManualAdjustment(adjustmentData);
    const posts:SheetPost[]=[];
    for(let offset=0;;offset+=500){
    const{data:page,error:postsError}=await supabase
      .from('posts')
      .select('id,post_url,network,published_at,x_published_at,counting_excluded,views,likes,special_reward,mission_name,sheets_is_special')
      .eq('user_id',user.id)
      .order('published_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+499);
    if(postsError)throw postsError;
    posts.push(...(page||[]));if(!page||page.length<500)break;
    }
    const result=await syncGoogleSheet(String(permission.sheet_tab_name||''),posts,String(permission.sheet_month||''),adjustment,async()=>{
      const{data,error}=await supabase.rpc('get_my_manual_like_adjustment');
      if(error||JSON.stringify(parseManualAdjustment(data))!==JSON.stringify(adjustment))throw new Error('MANUAL_ADJUSTMENT_CHANGED');
    });
    normalCount=result.normalCount;
    specialCount=result.specialCount;
    await supabase.rpc('complete_google_sheets_sync',{p_success:true,p_normal_count:normalCount,p_special_count:specialCount,p_error:null});
    return NextResponse.json({success:true,normalCount,specialCount,total:normalCount+specialCount,manualLikes:result.manualLikes,skippedOutsideMonth:result.skippedOutsideMonth,...cooldown()});
  }catch(error){
    const friendly=userMessage(error);
    await supabase.rpc('complete_google_sheets_sync',{p_success:false,p_normal_count:normalCount,p_special_count:specialCount,p_error:friendly.message});
    return NextResponse.json({error:friendly.message,...cooldown()},{status:friendly.status});
  }
}

