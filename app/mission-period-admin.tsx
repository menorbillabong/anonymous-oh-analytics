'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {supabase} from '@/lib/supabase';
import {formatPostDate} from '@/lib/post-date';
import type {MissionSelectionPeriod} from '@/lib/mission-selection';
import './mission-selection-periods.css';

export default function MissionPeriodAdmin(){
 const [periods,setPeriods]=useState<MissionSelectionPeriod[]>([]);
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[limit,setLimit]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 async function load(){const {data,error}=await supabase.from('mission_selection_periods').select('id,start_date,end_date,per_user_limit').order('start_date',{ascending:false});if(error)throw error;setPeriods(data||[]);}
 useEffect(()=>{void load().catch(()=>setNotice('Não foi possível carregar os períodos de missão.'));},[]);
 async function create(event:FormEvent){
  event.preventDefault();if(busy)return;
  const count=limit===''?null:Number(limit);
  if(!start||!end||end<start||count!==null&&(!Number.isInteger(count)||count<1||count>2147483647)){setNotice('Confira as datas e use um limite inteiro positivo ou deixe em branco.');return;}
  setBusy(true);setNotice('');
  try{const {error}=await supabase.rpc('create_mission_selection_period',{p_start:start,p_end:end,p_limit:count});if(error)throw error;setStart('');setEnd('');setLimit('');await load();setNotice('Período criado e disponível para todos os usuários.');}
  catch{setNotice('Não foi possível concluir o cadastro. Atualize a página para conferir antes de tentar novamente.');}
  finally{setBusy(false);}
 }
 return <section className="mission-period-admin" aria-labelledby="mission-period-admin-title"><h2 id="mission-period-admin-title">Períodos de Missão</h2><p>Datas e limite válidos para todos. Cada usuário tem sua própria contagem.</p><form onSubmit={create}><div className="mission-period-fields"><label>Data inicial<input type="date" required value={start} disabled={busy} onChange={e=>setStart(e.target.value)}/></label><label>Data final<input type="date" required min={start||undefined} value={end} disabled={busy} onChange={e=>setEnd(e.target.value)}/></label><label>Limite por usuário (opcional)<input type="number" min="1" max="2147483647" step="1" placeholder="Sem limite" value={limit} disabled={busy} onChange={e=>setLimit(e.target.value)}/></label></div><button type="submit" disabled={busy}>{busy?'Criando…':'Criar período de missão'}</button></form><p>Em branco: sem limite de publicações elegíveis. As duas datas estão incluídas.</p><p role="status" className="mission-period-message">{notice}</p><div className="mission-period-existing">{periods.map(period=><p key={period.id}>{formatPostDate(period.start_date)} a {formatPostDate(period.end_date)}<small>{period.per_user_limit===null?'Sem limite':`${period.per_user_limit} publicações por usuário`}</small></p>)}</div></section>;
}
