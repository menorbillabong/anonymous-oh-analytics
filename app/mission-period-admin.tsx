'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {supabase} from '@/lib/supabase';
import {formatPostDate} from '@/lib/post-date';
import {missionSelectionError,parseMissionAutoFillTarget,type MissionSelectionPeriod} from '@/lib/mission-selection';
import './mission-selection-periods.css';

export default function MissionPeriodAdmin(){
 const [periods,setPeriods]=useState<MissionSelectionPeriod[]>([]);
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[limit,setLimit]=useState('');
 const [editing,setEditing]=useState<MissionSelectionPeriod|null>(null);
 const [deleting,setDeleting]=useState<MissionSelectionPeriod[]>([]);
 const [selected,setSelected]=useState<Set<string>>(new Set());
 const [loading,setLoading]=useState(true),[loadFailed,setLoadFailed]=useState(false);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const lock=useRef(false),selectAllRef=useRef<HTMLInputElement>(null),confirmRef=useRef<HTMLDivElement>(null);
 const selectedPeriods=periods.filter(period=>selected.has(period.id));
 const allSelected=periods.length>0&&selectedPeriods.length===periods.length;
 const disabled=busy||loading||deleting.length>0;
 async function load(){
  const {data,error}=await supabase.from('mission_selection_periods').select('id,start_date,end_date,per_user_limit,revision').order('start_date',{ascending:false});
  if(error){setLoadFailed(true);throw error;}
  const next=data||[];setPeriods(next);setLoadFailed(false);
  setSelected(current=>new Set([...current].filter(id=>next.some(period=>period.id===id))));
 }
 useEffect(()=>{void load().catch(()=>setNotice('Não foi possível carregar os períodos de missão.')).finally(()=>setLoading(false));},[]);
 useEffect(()=>{if(selectAllRef.current)selectAllRef.current.indeterminate=selectedPeriods.length>0&&!allSelected;},[selectedPeriods.length,allSelected]);
 useEffect(()=>{if(deleting.length)confirmRef.current?.focus();},[deleting]);
 async function refresh(){if(lock.current)return;setLoading(true);setDeleting([]);setSelected(new Set());try{await load();setNotice('Lista atualizada.');}catch{setNotice('Não foi possível atualizar os períodos.');}finally{setLoading(false);}}
 function toggle(id:string){setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});}
 function reset(){setEditing(null);setStart('');setEnd('');setLimit('');}
 function edit(period:MissionSelectionPeriod){
  setEditing(period);setDeleting([]);setStart(period.start_date);setEnd(period.end_date);setLimit(period.per_user_limit===null?'':String(period.per_user_limit));setNotice('');
 }
 async function save(event:FormEvent){
  event.preventDefault();if(lock.current)return;
  const count=parseMissionAutoFillTarget(limit);
  if(!start||!end||end<start||count===null){setNotice('Confira as datas e informe uma quantidade inteira igual ou maior que zero.');return;}
  lock.current=true;setBusy(true);setNotice('');
  try{
   const {error}=editing
    ?await supabase.rpc('update_mission_selection_period',{p_period:editing.id,p_revision:editing.revision,p_start:start,p_end:end,p_limit:count})
    :await supabase.rpc('create_mission_selection_period',{p_start:start,p_end:end,p_limit:count});
   if(error)throw error;
   reset();await load();setNotice(count===0?'Período salvo. Preenchimento automático desativado. Os vínculos existentes foram preservados e as seleções manuais continuam livres.':'Período salvo. Preenchimento automático conferido e vínculos existentes preservados.');
  }catch(error){setNotice(missionSelectionError(error as {message?:string}));}
  finally{lock.current=false;setBusy(false);}
 }
 async function remove(){
  if(lock.current||!deleting.length)return;lock.current=true;setBusy(true);setNotice('');
  const targets=deleting;
  try{
   const {error}=await supabase.rpc('delete_mission_selection_periods',{p_periods:targets.map(({id,revision})=>({id,revision}))});if(error)throw error;
   if(targets.some(period=>period.id===editing?.id))reset();setDeleting([]);setSelected(new Set());
   setPeriods(current=>current.filter(period=>!targets.some(target=>target.id===period.id)));
   const success=`${targets.length} ${targets.length===1?'período excluído':'períodos excluídos'}. As publicações, seus perfis e bônus foram preservados.`;
   try{await load();setNotice(success);}catch{setNotice(`${success} Não foi possível recarregar a lista; clique em Atualizar lista.`);}
  }catch(error){setDeleting([]);setSelected(new Set());setNotice(missionSelectionError(error as {message?:string}));try{await load();}catch{setLoadFailed(true);}}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="mission-period-admin" aria-labelledby="mission-period-admin-title">
  <h2 id="mission-period-admin-title">Períodos de Missão</h2>
  <p>Datas e quantidade válidas para todos, com contagem separada por usuário. A quantidade orienta apenas o preenchimento automático; seleções manuais são livres.</p>
  <p role="status" aria-live="polite" className="mission-period-message">{notice}</p>
  <div className="mission-period-admin-layout">
  <div className="mission-period-editor"><form onSubmit={save}><h3>{editing?'Editar período de missão':'Criar período de missão'}</h3><div className="mission-period-fields">
   <label>Data inicial<input type="date" required value={start} disabled={disabled} onChange={e=>setStart(e.target.value)}/></label>
   <label>Data final<input type="date" required min={start||undefined} value={end} disabled={disabled} onChange={e=>setEnd(e.target.value)}/></label>
   <label className="mission-period-fill-field">Preenchimento automático<input type="number" required min="0" max="2147483647" step="1" value={limit} disabled={disabled} aria-describedby="mission-auto-fill-help" onChange={e=>setLimit(e.target.value)}/></label>
  </div><div className="mission-period-admin-actions"><button type="submit" disabled={disabled}>{busy?'Aguarde…':editing?'Salvar alterações':'Criar período de missão'}</button>{editing&&<button type="button" disabled={disabled} onClick={reset}>Cancelar edição</button>}</div></form>
  <p id="mission-auto-fill-help">Use 0 para desativar o preenchimento automático deste período. As seleções manuais continuam livres.</p>
  <p>As duas datas estão incluídas. Publicações com bônus são vinculadas do período mais antigo para o mais novo nas datas compartilhadas. Alterar a quantidade não desfaz vínculos existentes.</p>
  </div>
  <div className="mission-period-list-panel" aria-labelledby="mission-period-list-title">
   <div className="mission-period-list-heading"><h3 id="mission-period-list-title">Períodos cadastrados <span>{periods.length}</span></h3><button type="button" className="mission-period-secondary" disabled={disabled} onClick={()=>void refresh()}>Atualizar lista</button></div>
   <div className="mission-period-list-tools"><label className="mission-period-check"><input ref={selectAllRef} type="checkbox" checked={allSelected} disabled={disabled||loadFailed||!periods.length} onChange={()=>setSelected(allSelected?new Set():new Set(periods.map(period=>period.id)))}/>Selecionar todos</label><span>{selectedPeriods.length} selecionados</span><button type="button" disabled={disabled||loadFailed||!selectedPeriods.length} onClick={()=>{setDeleting(selectedPeriods);setNotice('');}}>Excluir selecionados</button></div>
  {deleting.length>0&&<div ref={confirmRef} tabIndex={-1} className="mission-period-delete-confirm" role="group" aria-label="Confirmar exclusão dos períodos">
   <strong>Excluir {deleting.length} {deleting.length===1?'período selecionado':'períodos selecionados'}?</strong>
   <ul>{deleting.map(period=><li key={period.id}>{formatPostDate(period.start_date)} a {formatPostDate(period.end_date)}</li>)}</ul>
   <p>Isso retira o período para todos e desfaz apenas seus vínculos. Nenhuma publicação, perfil, bônus ou fechamento será apagado. Publicações com bônus poderão ser vinculadas a outros períodos elegíveis. Uma cópia dos vínculos será guardada para recuperação administrativa.</p>
   <div className="mission-period-admin-actions"><button type="button" disabled={busy} onClick={()=>void remove()}>{busy?'Excluindo…':'Confirmar exclusão'}</button><button type="button" disabled={busy} onClick={()=>setDeleting([])}>Cancelar exclusão</button></div>
  </div>}
  {loading?<p>Carregando períodos…</p>:loadFailed?<p>Lista indisponível. Clique em Atualizar lista para tentar novamente.</p>:!periods.length?<p className="mission-period-list-empty">Nenhum período cadastrado. Crie o primeiro ao lado.</p>:null}
  <ul className="mission-period-existing">{!loadFailed&&periods.map(period=><li className={`mission-period-definition${selected.has(period.id)?' is-selected':''}${editing?.id===period.id?' is-editing':''}`} key={period.id}>
   <label className="mission-period-check"><input type="checkbox" checked={selected.has(period.id)} disabled={disabled} aria-label={`Selecionar período ${formatPostDate(period.start_date)} a ${formatPostDate(period.end_date)}`} onChange={()=>toggle(period.id)}/><span className="mission-period-row-info">
   <strong>{formatPostDate(period.start_date)} a {formatPostDate(period.end_date)}</strong>
   <small>{period.per_user_limit===0?'Preenchimento automático desativado':period.per_user_limit===null?'Defina a quantidade para ativar o preenchimento automático':`${period.per_user_limit} por usuário no preenchimento automático`}</small>
   </span></label>
   <div className="mission-period-admin-actions"><button type="button" className="mission-period-secondary" disabled={disabled} aria-label={`Editar período ${formatPostDate(period.start_date)} a ${formatPostDate(period.end_date)}`} onClick={()=>edit(period)}>Editar</button><button type="button" className="mission-period-secondary" disabled={disabled} aria-label={`Excluir período ${formatPostDate(period.start_date)} a ${formatPostDate(period.end_date)}`} onClick={()=>{setDeleting([period]);setNotice('');}}>Excluir</button></div>
  </li>)}</ul>
  </div></div>
 </section>;
}
