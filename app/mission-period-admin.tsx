'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {supabase} from '@/lib/supabase';
import {formatPostDate} from '@/lib/post-date';
import {missionSelectionError,type MissionSelectionPeriod} from '@/lib/mission-selection';
import './mission-selection-periods.css';

export default function MissionPeriodAdmin(){
 const [periods,setPeriods]=useState<MissionSelectionPeriod[]>([]);
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[limit,setLimit]=useState('');
 const [editing,setEditing]=useState<MissionSelectionPeriod|null>(null);
 const [deleting,setDeleting]=useState<MissionSelectionPeriod|null>(null);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const lock=useRef(false);
 async function load(){
  const {data,error}=await supabase.from('mission_selection_periods').select('id,start_date,end_date,per_user_limit,revision').order('start_date',{ascending:false});
  if(error)throw error;setPeriods(data||[]);
 }
 useEffect(()=>{void load().catch(()=>setNotice('Não foi possível carregar os períodos de missão.'));},[]);
 function reset(){setEditing(null);setStart('');setEnd('');setLimit('');}
 function edit(period:MissionSelectionPeriod){
  setEditing(period);setDeleting(null);setStart(period.start_date);setEnd(period.end_date);setLimit(period.per_user_limit===null?'':String(period.per_user_limit));setNotice('');
 }
 async function save(event:FormEvent){
  event.preventDefault();if(lock.current)return;
  const count=Number(limit);
  if(!start||!end||end<start||!Number.isInteger(count)||count<1||count>2147483647){setNotice('Confira as datas e informe uma quantidade inteira maior que zero.');return;}
  lock.current=true;setBusy(true);setNotice('');
  try{
   const {error}=editing
    ?await supabase.rpc('update_mission_selection_period',{p_period:editing.id,p_revision:editing.revision,p_start:start,p_end:end,p_limit:count})
    :await supabase.rpc('create_mission_selection_period',{p_start:start,p_end:end,p_limit:count});
   if(error)throw error;
   reset();await load();setNotice('Período salvo. Os vínculos existentes foram preservados. O preenchimento automático será conferido quando cada usuário abrir Períodos de Missão.');
  }catch(error){setNotice(missionSelectionError(error as {message?:string}));}
  finally{lock.current=false;setBusy(false);}
 }
 async function remove(){
  if(lock.current||!deleting)return;lock.current=true;setBusy(true);setNotice('');
  try{
   const {error}=await supabase.rpc('delete_mission_selection_period',{p_period:deleting.id,p_revision:deleting.revision});if(error)throw error;
   if(editing?.id===deleting.id)reset();setDeleting(null);await load();setNotice('Período excluído. As publicações, seus perfis e bônus foram preservados.');
  }catch(error){setNotice(missionSelectionError(error as {message?:string}));}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="mission-period-admin" aria-labelledby="mission-period-admin-title">
  <h2 id="mission-period-admin-title">Períodos de Missão</h2>
  <p>Datas e quantidade válidas para todos, com contagem separada por usuário. A quantidade orienta apenas o preenchimento automático; seleções manuais são livres.</p>
  <form onSubmit={save}><h3>{editing?'Editar período de missão':'Criar período de missão'}</h3><div className="mission-period-fields">
   <label>Data inicial<input type="date" required value={start} disabled={busy} onChange={e=>setStart(e.target.value)}/></label>
   <label>Data final<input type="date" required min={start||undefined} value={end} disabled={busy} onChange={e=>setEnd(e.target.value)}/></label>
   <label>Quantidade para preenchimento automático<input type="number" required min="1" max="2147483647" step="1" value={limit} disabled={busy} onChange={e=>setLimit(e.target.value)}/></label>
  </div><div className="mission-period-admin-actions"><button type="submit" disabled={busy}>{busy?'Aguarde…':editing?'Salvar alterações':'Criar período de missão'}</button>{editing&&<button type="button" disabled={busy} onClick={reset}>Cancelar edição</button>}</div></form>
  <p>As duas datas estão incluídas. Publicações com bônus são vinculadas do período mais antigo para o mais novo nas datas compartilhadas. Alterar a quantidade não desfaz vínculos existentes.</p>
  <p role="status" aria-live="polite" className="mission-period-message">{notice}</p>
  {deleting&&<div className="mission-period-delete-confirm" role="group" aria-label="Confirmar exclusão do período">
   <strong>Excluir {formatPostDate(deleting.start_date)} a {formatPostDate(deleting.end_date)}?</strong>
   <p>Isso retira o período para todos e desfaz apenas seus vínculos. Nenhuma publicação, perfil, bônus ou fechamento será apagado. Publicações com bônus poderão ser vinculadas a outros períodos elegíveis. Uma cópia dos vínculos será guardada para recuperação administrativa.</p>
   <div className="mission-period-admin-actions"><button type="button" disabled={busy} onClick={()=>void remove()}>Confirmar exclusão</button><button type="button" disabled={busy} onClick={()=>setDeleting(null)}>Cancelar exclusão</button></div>
  </div>}
  <div className="mission-period-existing">{periods.map(period=><div className="mission-period-definition" key={period.id}>
   <strong>{formatPostDate(period.start_date)} a {formatPostDate(period.end_date)}</strong>
   <small>{period.per_user_limit===null?'Defina a quantidade para ativar o preenchimento automático':`${period.per_user_limit} por usuário no preenchimento automático`}</small>
   <div className="mission-period-admin-actions"><button type="button" disabled={busy} aria-label={`Editar período ${formatPostDate(period.start_date)} a ${formatPostDate(period.end_date)}`} onClick={()=>edit(period)}>Editar</button><button type="button" disabled={busy} aria-label={`Excluir período ${formatPostDate(period.start_date)} a ${formatPostDate(period.end_date)}`} onClick={()=>{setDeleting(period);setNotice('');}}>Excluir</button></div>
  </div>)}</div>
 </section>;
}
