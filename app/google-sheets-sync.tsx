'use client';

import {useCallback,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';
import './google-sheets-sync.css';

type SyncResult={success?:boolean;normalCount?:number;specialCount?:number;total?:number;cooldownSeconds?:number;retryAfterSeconds?:number;error?:string};

export default function GoogleSheetsSyncButton({userId,beforeSync}:{userId:string;beforeSync?:()=>Promise<unknown>}){
  const[enabled,setEnabled]=useState(false);
  const[running,setRunning]=useState(false);
  const[result,setResult]=useState<SyncResult|null>(null);
  const[cooldownUntil,setCooldownUntil]=useState(0);
  const[now,setNow]=useState(()=>Date.now());

  const loadPermission=useCallback(async()=>{
    const{data}=await supabase.from('google_sheets_user_config').select('enabled,sheet_tab_name,last_sync_started_at').eq('user_id',userId).maybeSingle();
    setEnabled(Boolean(data?.enabled&&String(data?.sheet_tab_name||'').trim()));
    const started=data?.last_sync_started_at?new Date(data.last_sync_started_at).getTime():0;
    if(started)setCooldownUntil(started+300000);
  },[userId]);

  useEffect(()=>{void loadPermission()},[loadPermission]);
  useEffect(()=>{if(cooldownUntil<=Date.now())return;setNow(Date.now());const timer=window.setInterval(()=>{const current=Date.now();setNow(current);if(current>=cooldownUntil)window.clearInterval(timer)},1000);return()=>window.clearInterval(timer)},[cooldownUntil]);

  if(!enabled)return null;
  const remaining=Math.max(0,Math.ceil((cooldownUntil-now)/1000));

  async function sync(){
    if(running||remaining>0)return;
    setRunning(true);setResult(null);
    try{
      if(beforeSync)await beforeSync();
      const{data:{session}}=await supabase.auth.getSession();
      if(!session)throw new Error('Sua sessão expirou. Entre novamente.');
      const response=await fetch('/api/google-sheets/sync',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}});
      const data=await response.json() as SyncResult;
      if(!response.ok){
        if(data.retryAfterSeconds)setCooldownUntil(Date.now()+data.retryAfterSeconds*1000);
        setResult({error:data.error||'Não foi possível atualizar a planilha.'});
        return;
      }
      setCooldownUntil(Date.now()+Number(data.cooldownSeconds||300)*1000);
      setNow(Date.now());
      setResult(data);
    }catch(error){
      setResult({error:error instanceof Error?error.message:'Não foi possível atualizar a planilha.'});
    }finally{setRunning(false)}
  }

  return <>
    <button className="sheets-sync-button" type="button" disabled={running||remaining>0} onClick={sync} title={remaining>0?`Disponível novamente em ${Math.ceil(remaining/60)} minuto(s)`:'Atualizar a aba vinculada no Google Sheets'}>
      ▦ <b>{running?'ATUALIZANDO PLANILHA...':remaining>0?`PLANILHA · ${Math.ceil(remaining/60)} MIN`:'ATUALIZAR MINHA PLANILHA'}</b>
    </button>
    {result&&typeof document!=='undefined'&&createPortal(<div className="sheets-result-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setResult(null)}}>
      <section className={`sheets-result-dialog ${result.error?'error':'success'}`} role="dialog" aria-modal="true" aria-labelledby="sheets-result-title">
        <div className="sheets-result-icon">{result.error?'!':'✓'}</div>
        <h2 id="sheets-result-title">{result.error?'Atualização não concluída':'Planilha atualizada'}</h2>
        {result.error?<p>{result.error}</p>:<>
          <div className="sheets-result-counts"><span><small>NORMAL</small><strong>{Number(result.normalCount||0)}</strong></span><span><small>ESPECIAL</small><strong>{Number(result.specialCount||0)}</strong></span><span><small>TOTAL</small><strong>{Number(result.total||0)}</strong></span></div>
          <p>As colunas disponíveis foram atualizadas. Colunas ausentes ou sem título foram ignoradas com segurança; em missões especiais, Reward e Theme são preenchidos somente quando existem.</p>
        </>}
        <button type="button" onClick={()=>setResult(null)}>FECHAR</button>
      </section>
    </div>,document.body)}
  </>;
}

