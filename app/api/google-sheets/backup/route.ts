import {NextResponse} from 'next/server';
import {backupContext} from '@/lib/sheet-backup-context';
import {sealBackup,openBackup} from '@/lib/sheet-backup-codec';
import {nativeSnapshot} from '@/lib/sheet-native-snapshot';
import {readRegisteredSheet,sheetFingerprint,restoreRegisteredSheet} from '@/lib/sheet-design-service';

export const dynamic='force-dynamic';
export const maxDuration=120;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
function failed(error:unknown){const message=error instanceof Error?error.message:'Falha no backup.';return json({error:message.startsWith('GOOGLE_')?'Não foi possível acessar a planilha cadastrada.':message},message==='Sessão inválida.'?401:422)}
async function saved(ctx:Awaited<ReturnType<typeof backupContext>>){
  const {data,error}=await ctx.client.from('google_sheets_site_backup').select('snapshot,expires_at').eq('user_id',ctx.user.id).maybeSingle();
  if(error)throw new Error('Não foi possível consultar o backup do site.');
  if(!data||Date.parse(data.expires_at)<=Date.now())return null;
  return openBackup(data.snapshot,process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!,ctx.user.id,process.env.GOOGLE_SHEETS_SPREADSHEET_ID!);
}
export async function GET(request:Request){
  try{
    const ctx=await backupContext(request),backup=await saved(ctx);
    if(!backup)return json({backup:null});
    if(backup.sheet.properties.title!==ctx.config.tab)return json({backup:null});
    const info={createdAt:backup.createdAt,expiresAt:backup.expiresAt,tabName:backup.sheet.properties.title};
    if(new URL(request.url).searchParams.get('preview')!=='restore')return json({backup:info});
    const current=await readRegisteredSheet(ctx.config.tab);
    if(current.target.properties.sheetId!==backup.sheet.properties.sheetId)throw new Error('A aba cadastrada mudou. Este backup não pode ser aplicado a ela.');
    return json({backup:info,fingerprint:sheetFingerprint(current.target)});
  }catch(error){return failed(error)}
}
export async function POST(request:Request){
  let submitted=false,completion:(success:boolean,message:string|null)=>Promise<void>=async()=>{};
  try{
    const ctx=await backupContext(request),body=await request.json();
    if(body.action!=='save'&&body.action!=='restore')throw new Error('Ação inválida.');
    if(body.action==='save'){
      const current=await readRegisteredSheet(ctx.config.tab),sheet=nativeSnapshot(current.target),now=Date.now(),createdAt=new Date(now).toISOString(),expiresAt=new Date(now+7*86400000).toISOString();
      const snapshot=sealBackup({version:1,userId:ctx.user.id,spreadsheetId:current.spreadsheetId,createdAt,expiresAt,sheet},process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!);
      const permission=await ctx.permission();if(permission.tab!==ctx.config.tab)throw new Error('A aba cadastrada mudou. Tente novamente.');
      // Atomic upsert; a failed save never deletes the existing snapshot.
      const {error}=await ctx.client.from('google_sheets_site_backup').upsert({user_id:ctx.user.id,snapshot},{onConflict:'user_id'});
      if(error)throw new Error('Não foi possível salvar o novo backup. A cópia anterior não foi removida.');
      return json({backup:{createdAt,expiresAt,tabName:ctx.config.tab}});
    }
    if(body.confirm!==true||!/^[a-f0-9]{64}$/.test(body.fingerprint||'')||typeof body.backupCreatedAt!=='string')throw new Error('Confira e confirme a restauração.');
    const {data:claim,error}=await ctx.client.rpc('claim_google_sheets_sync');
    if(error||!claim?.allowed)throw new Error('Há uma atualização em andamento ou um tempo de espera ativo. Aguarde.');
    completion=async(success,message)=>{await ctx.client.rpc('complete_google_sheets_sync',{p_success:success,p_normal_count:0,p_special_count:0,p_error:message})};
    if(claim.sheet_tab_name!==ctx.config.tab)throw new Error('A aba cadastrada mudou. Confira novamente.');
    const backup=await saved(ctx);if(!backup||backup.createdAt!==body.backupCreatedAt)throw new Error('O backup mudou ou expirou. Confira novamente.');
    if(backup.sheet.properties.title!==ctx.config.tab)throw new Error('A aba cadastrada mudou. Confira novamente.');
    const current=await readRegisteredSheet(ctx.config.tab);
    if(sheetFingerprint(current.target)!==body.fingerprint)throw new Error('A planilha mudou desde a conferência. Confira novamente.');
    const result=await restoreRegisteredSheet(current,backup.sheet,async()=>{const permission=await ctx.permission();if(permission.tab!==ctx.config.tab)throw new Error('O vínculo da planilha mudou.');submitted=true;});
    await completion(true,null).catch(()=>{});return json(result);
  }catch(error){
    const message=submitted?'A resposta foi interrompida. Confira a aba cadastrada antes de tentar restaurar novamente.':error instanceof Error?error.message:'Falha no backup.';
    await completion(false,message).catch(()=>{});return submitted?json({error:message,checkSheet:true},502):failed(error);
  }
}
