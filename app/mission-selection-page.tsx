'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {formatPostDate,postDateKey,postPublishedValue} from '@/lib/post-date';
import {eligibleForMissionPeriod,missionSelectionError,type MissionSelection,type MissionSelectionPeriod} from '@/lib/mission-selection';
import XPostPreview from './x-post-preview';
import './x-post-preview.css';
import './mission-post-review.css';
import './mission-selection-periods.css';

export default function MissionSelectionPage({uid,onClose,onSaved}:{uid:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const [periods,setPeriods]=useState<MissionSelectionPeriod[]>([]),[selectedPeriod,setSelectedPeriod]=useState('');
 const [posts,setPosts]=useState<any[]>([]),[profiles,setProfiles]=useState<any[]>([]),[selections,setSelections]=useState<MissionSelection[]>([]);
 const [profileId,setProfileId]=useState(''),[mode,setMode]=useState<'cards'|'list'>('cards');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[failed,setFailed]=useState(false);
 const lock=useRef(false);
 const load=useCallback(async()=>{
  const results=await Promise.all([supabase.from('mission_selection_periods').select('id,start_date,end_date,per_user_limit').order('start_date',{ascending:false}),supabase.from('mission_period_selections').select('post_id,period_id,mission_profile_id').eq('user_id',uid),supabase.from('posts').select('*').eq('user_id',uid).order('published_at',{ascending:false}),supabase.from('mission_profiles').select('*').eq('user_id',uid).order('name')]);
  const error=results.find(result=>result.error)?.error;if(error)throw error;
  const next=results[0].data as MissionSelectionPeriod[];setPeriods(next);setSelectedPeriod(current=>next.some(p=>p.id===current)?current:next[0]?.id||'');setSelections(results[1].data as MissionSelection[]);setPosts(results[2].data||[]);setProfiles(results[3].data||[]);setFailed(false);
 },[uid]);
 useEffect(()=>{void load().catch(()=>{setFailed(true);setNotice('Não foi possível carregar as publicações. Tente novamente.');}).finally(()=>setLoading(false));},[load]);
 const period=periods.find(p=>p.id===selectedPeriod);
 const bonusProfiles=profiles.filter(p=>p.active&&Number(p.reward)>0);
 const chosen=bonusProfiles.some(p=>String(p.id)===profileId)?profileId:String(bonusProfiles[0]?.id||'');
 const visible=useMemo(()=>period?posts.filter(post=>eligibleForMissionPeriod(post,postDateKey(postPublishedValue(post)),period,selections,Number(profiles.find(p=>String(p.id)===String(post.mission_profile_id))?.reward||0))):[],[period,posts,selections,profiles]);
 const count=selections.filter(row=>row.period_id===selectedPeriod).length;
 async function reload(){if(lock.current)return;setLoading(true);try{await load();setNotice('Lista atualizada.');}catch{setFailed(true);setNotice('Não foi possível atualizar a lista.');}finally{setLoading(false);}}
 async function toggle(post:any,assigned:boolean){
  if(lock.current||!period)return;lock.current=true;setBusy(true);setNotice('');
  try{const {error}=await supabase.rpc('set_my_mission_period_selection',{p_period:period.id,p_post:post.id,p_profile:assigned?null:Number(chosen)});if(error)throw error;await load();await onSaved();setNotice(assigned?'Publicação desmarcada. Você pode selecionar outra no lugar.':'Publicação selecionada e indisponível nos outros períodos.');}
  catch(error){setNotice(missionSelectionError(error as {message?:string}));try{await load();}catch{setFailed(true);}}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="mission-review-shell mission-selection-page"><header className="mission-review-top"><div><span className="mission-review-kicker">PAINEL</span><h1>Períodos de Missão</h1><p>Selecione suas publicações para um perfil de missão com bônus.</p></div><div className="mission-review-actions"><button type="button" className="mission-review-back" disabled={busy} onClick={onClose}>← Voltar</button><button type="button" className="mission-review-back" disabled={busy||loading} onClick={()=>void reload()}>Atualizar lista</button><div className="mission-review-switch"><button type="button" aria-label="Exibir em cartões" aria-pressed={mode==='cards'} className={mode==='cards'?'active':''} onClick={()=>setMode('cards')}>▦</button><button type="button" aria-label="Exibir em lista" aria-pressed={mode==='list'} className={mode==='list'?'active':''} onClick={()=>setMode('list')}>☰</button></div></div></header>
 <p className="mission-period-message" role="status" aria-live="polite">{loading?'Carregando…':notice}</p>
 {!loading&&!failed&&period&&<><div className="mission-period-toolbar"><div className="mission-period-fields"><label>Período<select value={selectedPeriod} disabled={busy} onChange={e=>{setSelectedPeriod(e.target.value);setNotice('');}}>{periods.map(p=><option key={p.id} value={p.id}>{formatPostDate(p.start_date)} a {formatPostDate(p.end_date)}</option>)}</select></label><label>Perfil para as novas seleções<select value={chosen} disabled={busy||!bonusProfiles.length} onChange={e=>setProfileId(e.target.value)}>{!bonusProfiles.length&&<option value="">Nenhum perfil ativo com bônus</option>}{bonusProfiles.map(p=><option key={p.id} value={p.id}>{p.name} (+{p.reward} CG)</option>)}</select></label></div></div><div className="mission-period-summary"><span>Datas inclusivas · suas publicações elegíveis</span><strong className="mission-period-count">{period.per_user_limit===null?`${count} selecionadas · Sem limite`:`${count} de ${period.per_user_limit} selecionadas`}</strong></div>{!bonusProfiles.length&&<p>Crie um perfil com bônus fixo no Centro de Controle da Missão para selecionar publicações.</p>}
 <div className={`mission-review-grid ${mode}`}>{visible.map(post=>{const assignment=selections.find(row=>String(row.post_id)===String(post.id)),assigned=Boolean(assignment),full=period.per_user_limit!==null&&count>=period.per_user_limit;return <article className="mission-review-card" key={post.id}><div className="mission-review-preview"><XPostPreview post={post}/></div><div className={`mission-period-choice${assigned?' selected':''}`}><strong>{assigned?`Selecionada • ${profiles.find(p=>String(p.id)===String(assignment?.mission_profile_id))?.name||post.mission_name||'Missão com bônus'}`:'Disponível para missão'}</strong><button type="button" disabled={busy||Boolean(post.counting_excluded)||(!assigned&&(full||!chosen))} onClick={()=>void toggle(post,assigned)}>{post.counting_excluded?'Período fechado':assigned?'Desmarcar publicação':full?'Limite atingido':'Selecionar para missão'}</button></div></article>;})}</div>{!visible.length&&<p className="mission-period-empty">Nenhuma publicação elegível neste período.</p>}<p className="mission-period-empty">Publicações com bônus já atribuído não entram em outra seleção. As selecionadas aqui continuam visíveis para correção.</p></>}
 {!loading&&!failed&&!period&&<p className="mission-period-empty">O administrador ainda não cadastrou períodos de missão.</p>}
 </section>;
}
