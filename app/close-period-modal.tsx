'use client';

import {useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {monthlyReward} from '@/lib/reward';
import {postDateKey,postPublishedDate} from '@/lib/post-date';

type ClosePeriodModalProps={
 posts:any[];
 crystalginLimit:number;
 onClose:()=>void;
 onSuccess:()=>void;
};

function archiveErrorMessage(error:any){
 const message=String(error?.message||'');
 if(message.includes('ARCHIVED_PERIOD_DUPLICATE'))return'Este mesmo período já foi fechado.';
 if(message.includes('ARCHIVED_PERIOD_EMPTY'))return'Não há publicações nesse período.';
 if(message.includes('ARCHIVED_PERIOD_INVALID_DATES'))return'Confira as datas escolhidas. A data final não pode ser futura.';
 return'Não foi possível fechar o período agora.';
}

export default function ClosePeriodModal({posts,crystalginLimit,onClose,onSuccess}:ClosePeriodModalProps){
 const[start,setStart]=useState('');
 const[end,setEnd]=useState('');
 const[saving,setSaving]=useState(false);
 const[message,setMessage]=useState('');
 const today=postDateKey(new Date());
 const valid=Boolean(start&&end&&start<=end&&end<=today);
 const selectedPosts=useMemo(()=>valid?posts.filter(post=>{
  const date=postDateKey(postPublishedDate(post));
  return Boolean(date&&date>=start&&date<=end);
 }):[],[posts,start,end,valid]);
 const reward=useMemo(()=>monthlyReward(selectedPosts),[selectedPosts]);
 const total=Math.min(reward.raw,crystalginLimit);

 async function confirmPeriod(){
  if(!valid||!selectedPosts.length)return;
  setSaving(true);
  setMessage('');
  const{error}=await supabase.rpc('close_period',{p_period_start:start,p_period_end:end});
  setSaving(false);
  if(error){setMessage(archiveErrorMessage(error));return}
  onSuccess();
 }

 return <div className="modal-backdrop archive-period-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose()}}>
  <section className="modal archive-period-modal" role="dialog" aria-modal="true" aria-labelledby="archive-period-title" onMouseDown={event=>event.stopPropagation()}>
   <div className="modal-head">
    <div><small>HISTÓRICO PROTEGIDO</small><h2 id="archive-period-title">Fechar período</h2></div>
    <button type="button" className="close-btn" aria-label="Fechar" disabled={saving} onClick={onClose}>×</button>
   </div>
   <div className="modal-body">
    <p className="archive-intro">Escolha o início e o final da missão. Serão consideradas somente as publicações feitas no X dentro dessas datas.</p>
    <div className="archive-date-grid">
     <label>Data de início<input autoFocus type="date" value={start} max={end||today} onChange={event=>{setStart(event.target.value);setMessage('')}}/></label>
     <label>Data final<input type="date" value={end} min={start||undefined} max={today} onChange={event=>{setEnd(event.target.value);setMessage('')}}/></label>
    </div>
    <div className="archive-summary" aria-live="polite">
     <div><small>PUBLICAÇÕES</small><strong>{selectedPosts.length.toLocaleString('pt-BR')}</strong></div>
     <div><small>VISUALIZAÇÕES</small><strong>{reward.views.toLocaleString('pt-BR')}</strong></div>
     <div><small>CURTIDAS</small><strong>{reward.likes.toLocaleString('pt-BR')}</strong></div>
     <div><small>RECOMPENSA</small><strong>{total.toLocaleString('pt-BR')} CG</strong></div>
    </div>
    {!start||!end?<p className="archive-helper">Selecione as duas datas para visualizar o resumo.</p>:!valid?<p className="archive-error">A data final deve ser igual ou posterior à inicial e não pode ser futura.</p>:!selectedPosts.length?<p className="archive-error">Nenhuma publicação do X foi encontrada nesse intervalo.</p>:null}
    {message&&<p className="archive-error">{message}</p>}
    <p className="archive-warning">Após confirmar, as datas não poderão ser alteradas. O registro será excluído automaticamente 40 dias depois, sem apagar as publicações originais.</p>
   </div>
   <div className="modal-actions">
    <button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button>
    <button type="button" className="btn btn-primary archive-confirm" disabled={saving||!valid||!selectedPosts.length} onClick={confirmPeriod}>{saving?'FECHANDO...':'CONFIRMAR FECHAMENTO'}</button>
   </div>
  </section>
 </div>
}

