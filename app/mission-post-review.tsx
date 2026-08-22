'use client';

import {useEffect,useMemo,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';
import {formatPostDate,postPublishedValue} from '@/lib/post-date';
import XPostPreview from './x-post-preview';
import './x-post-preview.css';
import './mission-post-review.css';

type MissionProfile={id:string|number;name:string;color?:string;active?:boolean;is_special?:boolean};
type AssignmentMap=Record<string,string>;

type MissionPostReviewProps={
 profile:MissionProfile;
 posts:any[];
 profiles:MissionProfile[];
 onClose:()=>void;
 onSaved:()=>Promise<void>;
};

function profileColor(profile?:MissionProfile){const value=String(profile?.color||'').trim();return /^#[0-9a-f]{3,8}$/i.test(value)?value:'#38d27f'}

export default function MissionPostReview({profile,posts,profiles,onClose,onSaved}:MissionPostReviewProps){
 const[reviewPosts]=useState(()=>posts.filter(post=>String(post.mission_profile_id)===String(profile.id)));
 const initialAssignments=useMemo(()=>Object.fromEntries(reviewPosts.map(post=>[String(post.id),String(post.mission_profile_id||'')])),[reviewPosts]);
 const[baseline,setBaseline]=useState<AssignmentMap>(initialAssignments);
 const[assignments,setAssignments]=useState<AssignmentMap>(initialAssignments);
 const[mode,setMode]=useState<'cards'|'list'>('cards');
 const[saving,setSaving]=useState(false);
 const[confirming,setConfirming]=useState(false);
 const[message,setMessage]=useState('');
 const changes=useMemo(()=>reviewPosts.flatMap(post=>{
  const postId=String(post.id),next=assignments[postId]??'';
  return next===(baseline[postId]??'')?[]:[{post_id:Number(post.id),mission_profile_id:next?Number(next):null}];
 }),[reviewPosts,assignments,baseline]);

 useEffect(()=>{
  const previous=document.body.style.overflow;
  document.body.style.overflow='hidden';
  return()=>{document.body.style.overflow=previous};
 },[]);

 useEffect(()=>{
  const close=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||saving)return;
   event.preventDefault();
   if(confirming){setConfirming(false);return}
   onClose();
  };
  window.addEventListener('keydown',close);
  return()=>window.removeEventListener('keydown',close);
 },[confirming,saving,onClose]);

 function changeMission(postId:string,missionProfileId:string){
  setAssignments(current=>({...current,[postId]:missionProfileId}));
  setMessage('');
 }

 async function saveChanges(){
  if(!changes.length||saving)return;
  setSaving(true);setMessage('');
  const{error}=await supabase.rpc('reassign_my_mission_posts',{p_changes:changes});
  if(error){setSaving(false);setConfirming(false);setMessage('Não foi possível salvar as alterações. Nada foi modificado.');return}
  setBaseline({...assignments});
  setConfirming(false);
  setMessage(`${changes.length} ${changes.length===1?'publicação alterada':'publicações alteradas'} com sucesso.`);
  await onSaved();
  setSaving(false);
 }

 const availableProfiles=profiles.filter(candidate=>candidate.active||String(candidate.id)===String(profile.id));
 return createPortal(<div className="mission-review-page"><div className="mission-review-shell">
  <header className="mission-review-top">
   <div><span className="mission-review-kicker">DESEMPENHO POR MISSÃO</span><h1>Publicações de {profile.name}</h1><p>Revise as publicações e altere o perfil selecionado quando precisar.</p></div>
   <div className="mission-review-actions"><button type="button" className="mission-review-back" disabled={saving} onClick={onClose}>← Voltar</button><div className="mission-review-switch" aria-label="Modo de exibição"><button type="button" className={mode==='list'?'active':''} aria-label="Exibir em lista" title="Lista" onClick={()=>setMode('list')}>☰</button><button type="button" className={mode==='cards'?'active':''} aria-label="Exibir em cartões" title="Cartões" onClick={()=>setMode('cards')}>▦</button></div>{changes.length>0&&<button type="button" className="mission-review-save" disabled={saving} onClick={()=>setConfirming(true)}>{saving?'SALVANDO...':'Salvar alterações'}</button>}</div>
  </header>
  <div className="mission-review-count"><i style={{background:profileColor(profile),boxShadow:`0 0 12px ${profileColor(profile)}`}}/><strong>{reviewPosts.length}</strong> {reviewPosts.length===1?'publicação ligada':'publicações ligadas'} a este perfil</div>
  {reviewPosts.length?<main className={`mission-review-grid ${mode}`}>{reviewPosts.map(post=>{
   const selectedId=assignments[String(post.id)]??'',selectedProfile=profiles.find(candidate=>String(candidate.id)===selectedId),color=profileColor(selectedProfile);
   return <article className="mission-review-card" key={post.id} style={{'--mission-review-color':color} as CSSProperties}>
    <div className="mission-review-preview"><XPostPreview post={post}/></div>
    <div className="mission-review-fields"><div className="mission-review-post-meta"><span>{formatPostDate(postPublishedValue(post))}</span><a href={post.post_url} target="_blank" rel="noreferrer">Ver no X ↗</a></div><label>PERFIL DA PUBLICAÇÃO<div className="mission-review-select"><i style={{background:color}}/><select value={selectedId} onChange={event=>changeMission(String(post.id),event.target.value)}><option value="">Sem missão</option>{availableProfiles.map(candidate=><option key={String(candidate.id)} value={String(candidate.id)}>{candidate.name}</option>)}</select></div></label><div className="mission-review-status"><span>{selectedProfile?.is_special?'MISSÃO ESPECIAL':'MISSÃO NORMAL'}</span><small>Reward e Theme históricos serão preservados.</small></div></div>
   </article>;
  })}</main>:<div className="mission-review-empty">Nenhuma publicação está ligada a este perfil.</div>}
  {message&&<div className={`mission-review-message ${message.includes('sucesso')?'success':'error'}`} role="status" aria-live="polite">{message}</div>}
  {confirming&&<div className="mission-review-confirm-overlay" role="presentation"><section className="mission-review-confirm" role="dialog" aria-modal="true" aria-labelledby="mission-review-confirm-title"><h2 id="mission-review-confirm-title">Confirmar alterações?</h2><p>{changes.length} {changes.length===1?'publicação terá o perfil alterado':'publicações terão seus perfis alterados'}. Valores históricos, métricas e datas serão mantidos.</p><div><button type="button" disabled={saving} onClick={()=>setConfirming(false)}>CANCELAR</button><button type="button" className="confirm" disabled={saving} onClick={saveChanges}>{saving?'SALVANDO...':'CONFIRMAR E SALVAR'}</button></div></section></div>}
 </div></div>,document.body);
}

