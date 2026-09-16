'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';
import {emptyManualAdjustment,MAX_MANUAL_LIKES,parseManualAdjustment,validManualLikes} from '@/lib/manual-like-adjustment';
import './x-import-controls.css';

export default function ManualLikeControls({userId,disabled=false}:{userId:string;disabled?:boolean}){
  const[config,setConfig]=useState(emptyManualAdjustment);
  const[open,setOpen]=useState(false);
  const[amount,setAmount]=useState('0');
  const[enabled,setEnabled]=useState(false);
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  const gear=useRef<HTMLButtonElement>(null);
  const lock=useRef(false);
  const refresh=useCallback(async()=>{
    const{data,error}=await supabase.rpc('get_my_manual_like_adjustment');
    const next=error?emptyManualAdjustment:parseManualAdjustment(data);
    setConfig(next);
    return {next,error};
  },[userId]);
  useEffect(()=>{void refresh();const update=()=>void refresh();window.addEventListener('focus',update);return()=>window.removeEventListener('focus',update)},[refresh]);
  useEffect(()=>{if(open){dialog.current?.showModal();return()=>{dialog.current?.close();gear.current?.focus()}}},[open]);
  async function show(){
    if(lock.current)return;
    lock.current=true;setBusy(true);setMessage('');
    try{
      const{next,error}=await refresh();
      if(error||!next.allowed){setMessage('O ajuste manual não está liberado para este perfil.');return}
      setAmount(String(next.amount));setEnabled(next.enabled);setOpen(true);
    }catch{setMessage('Não foi possível carregar o ajuste. Tente novamente.')}
    finally{lock.current=false;setBusy(false)}
  }
  async function save(event:React.FormEvent){
    event.preventDefault();if(lock.current)return;
    const number=Number(amount);
    if(!amount.trim()||!validManualLikes(number)){setMessage(`Informe uma quantidade inteira entre 0 e ${MAX_MANUAL_LIKES}.`);return}
    lock.current=true;setBusy(true);setMessage('');
    try{
      const{data:{user}}=await supabase.auth.getUser();
      if(user?.id!==userId)throw new Error('Sua sessão mudou. Entre novamente.');
      const{data,error}=await supabase.rpc('save_my_manual_like_adjustment',{p_period_id:config.period_id,p_amount:number,p_enabled:enabled});
      if(error){
        if(error.message.includes('NOT_ALLOWED'))throw new Error('O administrador retirou a liberação deste ajuste.');
        if(error.message.includes('PERIOD_CHANGED'))throw new Error('O período mudou. Feche esta janela e abra novamente.');
        throw new Error('Não foi possível salvar o ajuste. Nenhuma confirmação foi recebida.');
      }
      setConfig(parseManualAdjustment(data));setOpen(false);
      setMessage('Ajuste salvo. Atualize a planilha para aplicar a alteração nela.');
      window.dispatchEvent(new Event('aoh:manual-adjustment-changed'));
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível salvar.')}
    finally{lock.current=false;setBusy(false)}
  }
  return <>
    {config.allowed&&<button ref={gear} type="button" className="sheets-sync-button sheets-adjustment-gear" aria-label="Configurar ajuste manual de curtidas" title="Configurar ajuste manual de curtidas" disabled={busy||disabled} onClick={()=>void show()}>⚙</button>}
    {!open&&message&&<span className="sheets-adjustment-feedback" role="status">{message}</span>}
    {open&&typeof document!=='undefined'&&createPortal(<dialog ref={dialog} className="x-handle-dialog sheets-adjustment-dialog" aria-labelledby="manual-likes-title" onCancel={event=>{event.preventDefault();if(!busy)setOpen(false)}}>
      <form onSubmit={save}>
        <header><h2 id="manual-likes-title">Ajuste manual de curtidas</h2><button type="button" aria-label="Fechar ajuste" disabled={busy} onClick={()=>setOpen(false)}>×</button></header>
        <p>Quantidade extra total para o período aberto. Ela será distribuída entre as publicações atuais, sem acumular a cada atualização.</p>
        <label htmlFor="manual-likes-amount">Curtidas extras no total</label>
        <input id="manual-likes-amount" type="number" min="0" max={MAX_MANUAL_LIKES} step="1" required value={amount} onChange={event=>setAmount(event.target.value)} disabled={busy||!config.period_id}/>
        <label className="sheets-adjustment-switch"><input type="checkbox" role="switch" checked={enabled} onChange={event=>setEnabled(event.target.checked)} disabled={busy||!config.period_id}/><span>Ativar ajuste manual</span></label>
        <p>As curtidas reais do X permanecem preservadas. O painel e a planilha identificam o acréscimo manual e o incluem no cálculo. Relatórios, classificação e histórico continuam com os valores reais.</p>
        {!config.period_id&&<p role="alert">Abra um período antes de configurar o ajuste.</p>}
        {message&&<p role="alert">{message}</p>}
        <footer><button type="button" disabled={busy} onClick={()=>setOpen(false)}>CANCELAR</button><button className="x-handle-save" disabled={busy||!config.period_id} type="submit">{busy?'SALVANDO...':'SALVAR'}</button></footer>
      </form>
    </dialog>,document.body)}
  </>;
}
