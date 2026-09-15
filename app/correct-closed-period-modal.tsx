'use client';

import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {postDateKey} from '@/lib/post-date';

function correctionError(error:any){
 const message=String(error?.message||'');
 if(message.includes('TRACKING_PERIOD_CORRECTION_OVERLAP'))return'As datas escolhidas cruzam outro período aberto ou fechado.';
 if(message.includes('TRACKING_PERIOD_CORRECTION_NOT_AVAILABLE'))return'Este período não pode mais ser corrigido porque é anterior ao novo sistema ou suas publicações já foram removidas.';
 if(message.includes('TRACKING_PERIOD_CORRECTION_INVALID_DATES'))return'Confira as datas. O fim não pode ser anterior ao início nem estar no futuro.';
 if(message.includes('ARCHIVED_PERIOD_EMPTY'))return'Não existem publicações nesse intervalo.';
 return'Não foi possível corrigir este período agora.';
}

export default function CorrectClosedPeriodModal({row,onClose,onSuccess}:{row:any;onClose:()=>void;onSuccess:()=>void|Promise<void>}){
 const[start,setStart]=useState(String(row.period_start||''));
 const[end,setEnd]=useState(String(row.period_end||''));
 const[saving,setSaving]=useState(false);
 const[message,setMessage]=useState('');
 const today=postDateKey(new Date());
 const valid=Boolean(start&&end&&start<=end&&end<=today);
 async function save(){
  if(!valid)return;
  setSaving(true);setMessage('');
  const{error}=await supabase.rpc('correct_my_closed_period',{p_archive_id:Number(row.id),p_period_start:start,p_period_end:end});
  setSaving(false);
  if(error){setMessage(correctionError(error));return}
  await onSuccess();
 }
 return <div className="modal-backdrop archive-period-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose()}}>
  <section className="modal archive-period-modal" role="dialog" aria-modal="true" aria-labelledby="correct-period-title" onMouseDown={event=>event.stopPropagation()}>
   <div className="modal-head"><div><small>CORREÇÃO SEGURA</small><h2 id="correct-period-title">Corrigir período fechado</h2></div><button type="button" className="close-btn" aria-label="Fechar" disabled={saving} onClick={onClose}>×</button></div>
   <div className="modal-body">
    <p className="archive-intro">A contagem e o resumo serão recalculados automaticamente para o intervalo corrigido.</p>
    <div className="archive-date-grid"><label>Data de início<input type="date" value={start} max={end||today} onChange={event=>{setStart(event.target.value);setMessage('')}}/></label><label>Data final<input type="date" value={end} min={start} max={today} onChange={event=>{setEnd(event.target.value);setMessage('')}}/></label></div>
    {!valid&&<p className="archive-error">Informe um intervalo válido que não termine no futuro.</p>}
    {message&&<p className="archive-error">{message}</p>}
    <p className="archive-warning">Nenhuma publicação será apagada. Publicações que saírem do intervalo voltarão ao período atual; as que entrarem serão movidas para este histórico.</p>
   </div>
   <div className="modal-actions"><button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary archive-confirm" disabled={saving||!valid} onClick={save}>{saving?'CORRIGINDO...':'SALVAR CORREÇÃO'}</button></div>
  </section>
 </div>
}
