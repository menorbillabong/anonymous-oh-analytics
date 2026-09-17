'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';
import {formatCooldown} from '@/lib/sheets-cooldown';
import ManualLikeControls from './manual-like-controls';
import './google-sheets-sync.css';

type SyncResult={success?:boolean;normalCount?:number;specialCount?:number;total?:number;manualLikes?:number;cooldownSeconds?:number;retryAfterSeconds?:number;error?:string};

export default function GoogleSheetsSyncButton({userId,beforeSync}:{userId:string;beforeSync?:()=>Promise<unknown>}){
  const[enabled,setEnabled]=useState(false);
  const[running,setRunning]=useState(false);
  const[result,setResult]=useState<SyncResult|null>(null);
  const[cooldownUntil,setCooldownUntil]=useState(0);
  const[now,setNow]=useState(()=>Date.now());
  const statusRequest=useRef(0);

  const loadPermission=useCallback(async()=>{
    const request=++statusRequest.current;
    try{
      const{data,error}=await supabase.rpc('get_my_google_sheets_sync_status');
      if(request!==statusRequest.current)return;
      if(error||!data){setEnabled(false);return}
      setEnabled(data.enabled===true);
      const current=Date.now();
      setCooldownUntil(current+Math.max(0,Number(data.retry_after_seconds)||0)*1000);
      setNow(current);
    }catch{if(request===statusRequest.current)setEnabled(false)}
  },[userId]);

  useEffect(()=>{
    setEnabled(false);void loadPermission();
    const refresh=()=>{if(document.visibilityState==='visible')void loadPermission()};
    const timer=window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);
    window.addEventListener('sheets-cooldown-changed',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{++statusRequest.current;window.clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('sheets-cooldown-changed',refresh);document.removeEventListener('visibilitychange',refresh)};
  },[loadPermission]);
  useEffect(()=>{if(cooldownUntil<=Date.now())return;setNow(Date.now());const timer=window.setInterval(()=>{const current=Date.now();setNow(current);if(current>=cooldownUntil)window.clearInterval(timer)},1000);return()=>window.clearInterval(timer)},[cooldownUntil]);

  if(!enabled)return null;
  const remaining=Math.max(0,Math.ceil((cooldownUntil-now)/1000));

  async function sync(){
    if(running||remaining>0)return;
    setRunning(true);setResult(null);
    try{
      if(beforeSync&&await beforeSync()===false)throw new Error('Atualize as métricas antes de sincronizar a planilha.');
      const{data:{session}}=await supabase.auth.getSession();
      if(!session)throw new Error('Sua sessão expirou. Entre novamente.');
      const response=await fetch('/api/google-sheets/sync',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}});
      const data=await response.json() as SyncResult;
      ++statusRequest.current;
      if(data.retryAfterSeconds!==undefined){setCooldownUntil(Date.now()+Math.max(0,data.retryAfterSeconds)*1000);setNow(Date.now())}
      if(!response.ok){
        setResult({error:data.error||'Não foi possível atualizar a planilha.'});
        return;
      }
      setResult(data);
    }catch(error){
      setResult({error:error instanceof Error?error.message:'Não foi possível atualizar a planilha.'});
    }finally{await loadPermission();setRunning(false)}
  }

  return <>
    <div className="sheets-sync-control">
    <button className="sheets-sync-button" type="button" disabled={running||remaining>0} onClick={sync} title={remaining>0?`Disponível novamente em ${formatCooldown(remaining)}`:'Atualizar a aba vinculada no Google Sheets'}>
      ▦ <b>{running?'ATUALIZANDO PLANILHA...':remaining>0?`PLANILHA · ${formatCooldown(remaining)}`:'ATUALIZAR PLANILHA'}</b>
    </button>
    <ManualLikeControls userId={userId} disabled={running}/>
    </div>
    {result&&typeof document!=='undefined'&&createPortal(<div className="sheets-result-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setResult(null)}}>
      <section className={`sheets-result-dialog ${result.error?'error':'success'}`} role="dialog" aria-modal="true" aria-labelledby="sheets-result-title">
        <div className="sheets-result-icon">{result.error?'!':'✓'}</div>
        <h2 id="sheets-result-title">{result.error?'Atualização não concluída':'Planilha atualizada'}</h2>
        {result.error?<p>{result.error}</p>:<>
          <div className="sheets-result-counts"><span><small>NORMAL</small><strong>{Number(result.normalCount||0)}</strong></span><span><small>ESPECIAL</small><strong>{Number(result.specialCount||0)}</strong></span><span><small>TOTAL</small><strong>{Number(result.total||0)}</strong></span></div>
          <p>As colunas disponíveis foram atualizadas. Colunas ausentes ou sem título foram ignoradas com segurança; em missões especiais, Reward e Theme são preenchidos somente quando existem.</p>
          {Number(result.manualLikes)>0&&<p>Ajuste manual aplicado: +{Number(result.manualLikes).toLocaleString('pt-BR')} curtidas no total. A planilha identifica o acréscimo no cabeçalho, sem criar notas nas células.</p>}
        </>}
        <button type="button" onClick={()=>setResult(null)}>FECHAR</button>
      </section>
    </div>,document.body)}
  </>;
}

