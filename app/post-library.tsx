'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useEscapeClose} from '@/lib/use-escape-close';
import {monthlyReward,postContribution} from '@/lib/reward';
import XPostPreview,{VideoPreview} from './x-post-preview';
import './x-post-preview.css';
import './post-experience.css';

type MissionProfile={
 id?:string|number;
 name?:string;
 reward?:number;
 active?:boolean;
 description?:string;
 limit?:string|number|null;
 color?:string;
};

type PostLibraryProps={
 userId:string;
 posts:any[];
 reload:()=>Promise<void>;
 view?:'list'|'cards';
 profiles?:MissionProfile[];
 capUnlocked?:boolean;
};

export default function PostLibrary({userId,posts,reload,view,profiles=[],capUnlocked=false}:PostLibraryProps){
 const[expanded,setExpanded]=useState<any>(null);
 const[edit,setEdit]=useState<any>(null);
 const[selectedIds,setSelectedIds]=useState<Set<string>>(new Set());
 const[deletingSelected,setDeletingSelected]=useState(false);
 const[sortAsc,setSortAsc]=useState(false);
 const selectAllRef=useRef<HTMLInputElement>(null);
 useEscapeClose(!!edit,()=>setEdit(null));

 const effectiveView=view||(typeof window!=='undefined'&&localStorage.getItem('aoh:post-view')==='cards'?'cards':'list');
 const reward=monthlyReward(posts,capUnlocked);
 const missionCrystal=posts.reduce((total,post)=>total+postContribution(post),0);
 const sortedPosts=useMemo(()=>[...posts].sort((a,b)=>(sortAsc?1:-1)*(postDateValue(a)-postDateValue(b))),[posts,sortAsc]);
 const selectableIds=useMemo(()=>posts.map(post=>String(post.id)),[posts]);
 const selectedCount=selectedIds.size;
 const allSelected=selectableIds.length>0&&selectableIds.every(id=>selectedIds.has(id));
 const someSelected=selectedCount>0&&!allSelected;

 useEffect(()=>{
  setSelectedIds(previous=>{
   const allowed=new Set(selectableIds);
   const next=new Set([...previous].filter(id=>allowed.has(id)));
   if(next.size===previous.size&&[...next].every(id=>previous.has(id)))return previous;
   return next;
  });
 },[selectableIds]);

 useEffect(()=>{
  if(selectAllRef.current)selectAllRef.current.indeterminate=someSelected;
 },[someSelected]);

 useEffect(()=>{
  const sync=()=>setSortAsc(localStorage.getItem('aoh:post-sort-asc')==='1');
  const onSort=(event:Event)=>setSortAsc(Boolean((event as CustomEvent<{asc:boolean}>).detail?.asc));
  sync();
  window.addEventListener('storage',sync);
  window.addEventListener('aoh:post-sort-change',onSort);
  return()=>{window.removeEventListener('storage',sync);window.removeEventListener('aoh:post-sort-change',onSort)};
 },[]);

 function openEditor(post:any){
  setEdit({...post,edit_date:dateInputValue(post.published_at||post.created_at)});
 }

 function toggleExpanded(id:any){
  setExpanded((current:any)=>current===id?null:id);
 }

 async function save(){
  if(!edit)return;
  const missionProfile=profiles.find(profile=>String(profile.id)===String(edit.mission_profile_id));
  const payload:any={
   title:edit.title,
   post_url:edit.post_url,
   views:Number(edit.views),
   likes:Number(edit.likes),
   reposts:Number(edit.reposts),
   comments:Number(edit.comments),
   video_url:edit.video_url||null,
   metrics_updated_at:new Date().toISOString(),
  };
  if(edit.edit_date)payload.created_at=mergePostDate(edit.created_at,edit.edit_date);
  if(profiles.length){
   payload.mission_profile_id=missionProfile?.id||null;
   payload.mission_name=missionProfile?.name||null;
   payload.special_reward=Number(missionProfile?.reward||0);
  }
  const{error}=await supabase.from('posts').update(payload).eq('id',edit.id).eq('user_id',userId);
  if(error){alert('Não foi possível atualizar a publicação.');return}
  setEdit(null);
  await reload();
 }

 async function removePost(post:any){
  if(!post?.id)return;
  if(!confirm('Excluir esta publicação? Esta ação não pode ser desfeita.'))return;
  const{error}=await supabase.from('posts').delete().eq('id',post.id).eq('user_id',userId);
  if(error){alert('Não foi possível excluir a publicação.');return}
  setSelectedIds(previous=>{const next=new Set(previous);next.delete(String(post.id));return next});
  setExpanded(null);
  if(edit?.id===post.id)setEdit(null);
  await reload();
 }

 function toggleOne(id:any){
  const key=String(id);
  setSelectedIds(previous=>{
   const next=new Set(previous);
   if(next.has(key))next.delete(key);else next.add(key);
   return next;
  });
 }

 function toggleAll(){
  setSelectedIds(allSelected?new Set():new Set(selectableIds));
 }

 async function removeSelected(){
  if(!selectedCount||deletingSelected)return;
  const ids=[...selectedIds];
  if(!confirm(`Excluir ${selectedCount} publicação(ões) selecionada(s)? Esta ação não pode ser desfeita.`))return;
  setDeletingSelected(true);
  const{error}=await supabase.from('posts').delete().in('id',ids).eq('user_id',userId);
  setDeletingSelected(false);
  if(error){alert('Não foi possível excluir as publicações selecionadas.');return}
  if(expanded&&selectedIds.has(String(expanded)))setExpanded(null);
  if(edit?.id&&selectedIds.has(String(edit.id)))setEdit(null);
  setSelectedIds(new Set());
  await reload();
 }

 if(effectiveView==='list')return <>
  <SummaryTail posts={posts} reward={reward} missionCrystal={missionCrystal}/>
  <div className="ref-list">
   {selectedCount>0&&<div className="ref-selection-bar">
    <strong>{selectedCount} selecionado{selectedCount===1?'':'s'}</strong>
    <button type="button" disabled={deletingSelected} onClick={removeSelected}>🗑 {deletingSelected?'EXCLUINDO...':'EXCLUIR SELECIONADOS'}</button>
   </div>}
   <div className="ref-list-head">
    <input ref={selectAllRef} className="ref-select-check" type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar todas as publicações"/>
    <b>POST⌄</b><b>ENGAJAMENTO</b><b>CURTIDAS</b><b>COMENTÁRIOS</b><b>REPOSTS</b><b>VIEWS</b><b>CRYSTGIN</b><b>AÇÕES</b>
   </div>
   {sortedPosts.map(post=>{
    const engagement=Number(post.likes||0)+Number(post.comments||0)+Number(post.reposts||0);
    const selected=selectedIds.has(String(post.id));
    const isExpanded=expanded===post.id;
    const missionProfile=findMissionProfile(post,profiles);
    return <div
     className={`ref-list-row${selected?' selected':''}${isExpanded?' is-expanded':''}`}
     key={post.id}
     tabIndex={0}
     aria-expanded={isExpanded}
     onClick={()=>toggleExpanded(post.id)}
     onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleExpanded(post.id)}}}
    >
     <input className="ref-select-check" type="checkbox" checked={selected} onClick={event=>event.stopPropagation()} onChange={()=>toggleOne(post.id)} aria-label={`Selecionar ${post.title||'publicação'}`}/>
     <div className="ref-post-cell">
      <button type="button" className="ref-edit-square" onClick={event=>{event.stopPropagation();openEditor(post)}} aria-label="Editar publicação">✎</button>
      <div><strong>𝕏 <span>{post.mission_name||post.title||'Publicação'}</span> ↗</strong><small>{formatDate(post.created_at)}</small></div>
     </div>
     <b>{engagement.toLocaleString('pt-BR')}</b>
     <span>{Number(post.likes||0).toLocaleString('pt-BR')}</span>
     <span>{Number(post.comments||0).toLocaleString('pt-BR')}</span>
     <span>{Number(post.reposts||0).toLocaleString('pt-BR')}</span>
     <span>{Number(post.views||0).toLocaleString('pt-BR')}</span>
     <strong className="ref-orange">{postContribution(post).toLocaleString('pt-BR')}</strong>
     <div className="post-actions-menu-wrap" onClick={event=>event.stopPropagation()}>
      <button type="button" className="ref-more" onClick={()=>openEditor(post)} aria-label="Editar publicação pelo menu de ações">•••</button>
     </div>
     {isExpanded&&<div className="ref-expanded" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
      <ExpandedPost post={post} reward={reward} missionProfile={missionProfile} capUnlocked={capUnlocked} onDelete={()=>removePost(post)}/>
     </div>}
    </div>;
   })}
  </div>
  {edit&&<EditPostModal edit={edit} setEdit={setEdit} save={save} profiles={profiles} onDelete={()=>removePost(edit)}/>}
 </>;

 return <>
  <SummaryTail posts={posts} reward={reward} missionCrystal={missionCrystal}/>
  <div className="ref-card-grid">
   {sortedPosts.map(post=><article className="ref-card" key={post.id}>
    <div className="ref-media"><span className="x-badge">𝕏</span><Media post={post}/><button type="button" className="ref-open" onClick={()=>window.open(post.post_url,'_blank','noopener,noreferrer')} aria-label="Abrir publicação no X">↗</button></div>
    <div className="ref-card-info"><strong className="ref-mission">{post.mission_name||post.title||'PUBLICAÇÃO'}</strong><small>{formatDate(post.created_at)}</small><div className="ref-inline-metrics"><span>◉ {Number(post.views||0).toLocaleString('pt-BR')}</span><span>◯ {Number(post.comments||0).toLocaleString('pt-BR')}</span><span>↻ {Number(post.reposts||0).toLocaleString('pt-BR')}</span><span className="heart">♥ {Number(post.likes||0).toLocaleString('pt-BR')}</span></div></div>
    <div className="ref-card-foot"><span>⌁ <b>{Number(post.likes||0).toLocaleString('pt-BR')}</b></span><strong>{postContribution(post).toLocaleString('pt-BR')}</strong><small>Crystgin</small><button type="button" className="ref-pencil" onClick={()=>openEditor(post)} aria-label="Editar publicação">✎</button></div>
   </article>)}
  </div>
  {edit&&<EditPostModal edit={edit} setEdit={setEdit} save={save} profiles={profiles} onDelete={()=>removePost(edit)}/>}
 </>;
}

function SummaryTail({posts,reward,missionCrystal}:{posts:any[];reward:any;missionCrystal:number}){
 return <div className="ref-summary-tail"><div className="ref-summary-total"><b>TOTAL</b><strong>{posts.length}</strong><strong>{reward.views.toLocaleString('pt-BR')}</strong><strong>{reward.likes.toLocaleString('pt-BR')}</strong><strong>{missionCrystal.toLocaleString('pt-BR')}</strong></div><div className="ref-reward-line"><span>RECOMPENSA BÁSICA (MÍN. 10 POSTAGENS)</span><b>+ {reward.base.toLocaleString('pt-BR')} CG</b></div><div className="ref-reward-line"><span>BÔNUS DE VISUALIZAÇÕES (COLCHETES)</span><b>+ {reward.viewsReward.toLocaleString('pt-BR')} CG</b></div><div className="ref-official"><strong>TOTAL OFICIAL (COM CAP)</strong><b>{reward.total.toLocaleString('pt-BR')}</b></div></div>;
}

export function EditPostModal({edit,setEdit,save,profiles,onDelete}:{edit:any;setEdit:(value:any)=>void;save:()=>Promise<void>|void;profiles:MissionProfile[];onDelete:()=>Promise<void>|void}){
 const[saving,setSaving]=useState(false);
 const images=Array.isArray(edit.image_urls)?edit.image_urls.filter(Boolean):[];
 const lastUpdate=edit.metrics_updated_at||edit.updated_at||edit.created_at;
 async function handleSave(){setSaving(true);await save();setSaving(false)}
 return <div className="edit-post-overlay" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)setEdit(null)}}>
  <section className="edit-post-modal" role="dialog" aria-modal="true" aria-labelledby="edit-post-title">
   <div className="edit-post-head"><div><h2 id="edit-post-title">EDITAR POST</h2><p>Atualize as métricas de engajamento e outros detalhes do post.</p></div><button type="button" className="edit-post-close" onClick={()=>setEdit(null)} aria-label="Fechar">×</button></div>
   <div className="edit-post-scroll">
    <XPostPreview post={edit}/>
    <div className="edit-post-fields">
     <h3 className="edit-section-title">MÉTRICAS DE ENGAJAMENTO</h3>
     <div className="metric-input-grid">
      {([['Visualizações','views'],['Comentários','comments'],['Reposts','reposts'],['Curtidas','likes']] as const).map(([label,key])=><label key={key}>{label}<input type="number" min="0" value={edit[key]||0} onChange={event=>setEdit({...edit,[key]:Number(event.target.value)})}/></label>)}
     </div>
     <div className="edit-post-secondary-grid">
      <label>Data da publicação<input type="date" value={edit.edit_date||''} onChange={event=>setEdit({...edit,edit_date:event.target.value})}/></label>
      <label>Missão<select value={edit.mission_profile_id||''} onChange={event=>setEdit({...edit,mission_profile_id:event.target.value})}><option value="">Sem missão especial</option>{profiles.map(profile=><option key={String(profile.id)} value={String(profile.id)}>{profile.name}</option>)}</select></label>
     </div>
     <h3 className="edit-section-title">BÔNUS</h3>
     <div className="edit-bonus-status"><span className={images.length?'active':''}>● Imagem em destaque</span><span className={edit.video_url?'active':''}>● Bônus de reprodução</span></div>
     <details className="edit-advanced-fields">
      <summary>Detalhes adicionais da publicação</summary>
      <label>Título / texto<input value={edit.title||''} onChange={event=>setEdit({...edit,title:event.target.value})}/></label>
      <label>Link<input value={edit.post_url||''} onChange={event=>setEdit({...edit,post_url:event.target.value})}/></label>
      <label>URL do vídeo<input value={edit.video_url||''} onChange={event=>setEdit({...edit,video_url:event.target.value})}/></label>
     </details>
     <section className="edit-history-card"><h3>HISTÓRICO DE MODIFICAÇÕES</h3><p><span>Última atualização registrada</span><b>{formatDateTime(lastUpdate)||'Sem registro anterior'}</b></p><div><span>Views <b>{Number(edit.views||0).toLocaleString('pt-BR')}</b></span><span>Curtidas <b>{Number(edit.likes||0).toLocaleString('pt-BR')}</b></span><span>Crystgin <b>{postContribution(edit).toLocaleString('pt-BR')}</b></span></div></section>
     <div className="edit-post-actions"><button type="button" className="delete" onClick={onDelete}>🗑 EXCLUIR POST</button><span/><button type="button" className="cancel" onClick={()=>setEdit(null)}>CANCELAR</button><button type="button" className="save" disabled={saving} onClick={handleSave}>{saving?'ATUALIZANDO...':'ATUALIZAR'}</button></div>
    </div>
   </div>
  </section>
 </div>;
}

function formatDate(value:any){if(!value)return'';try{return new Date(value).toLocaleDateString('pt-BR')}catch{return''}}
function postDateValue(post:any){const value=new Date(post?.created_at||0).getTime();return Number.isFinite(value)?value:0}
function formatDateTime(value:any){if(!value)return'';try{return new Date(value).toLocaleString('pt-BR')}catch{return''}}
function dateInputValue(value:any){if(!value)return'';try{return new Date(value).toISOString().slice(0,10)}catch{return''}}
function mergePostDate(original:any,date:string){const current=original?new Date(original):new Date();const[year,month,day]=date.split('-').map(Number);if(!year||!month||!day)return original;current.setFullYear(year,month-1,day);return current.toISOString()}
function findMissionProfile(post:any,profiles:MissionProfile[]){return profiles.find(profile=>String(profile.id)===String(post.mission_profile_id))||profiles.find(profile=>profile.name===post.mission_name)}

function Media({post}:{post:any}){
 const images=Array.isArray(post.image_urls)?post.image_urls.filter(Boolean):[];
 if(post.video_url)return <VideoPreview url={post.video_url} poster={post.thumbnail_url} postUrl={post.post_url}/>;
 if(images.length)return <img src={images[0]} alt="Mídia da publicação"/>;
 return <div className="ref-media-empty">𝕏</div>;
}

function ExpandedPost({post,reward,missionProfile,capUnlocked,onDelete}:{post:any;reward:any;missionProfile?:MissionProfile;capUnlocked:boolean;onDelete:()=>void}){
 return <div className="post-expanded-shell"><PostExpandedDetails post={post} reward={reward} missionProfile={missionProfile} capUnlocked={capUnlocked} onDelete={onDelete}/><XPostPreview post={post}/></div>;
}

export function PostExpandedDetails({post,reward,missionProfile,capUnlocked,onDelete}:{post:any;reward:any;missionProfile?:MissionProfile;capUnlocked:boolean;onDelete:()=>void}){
 const likes=Number(post.likes||0);
 const special=Number(post.special_reward||0);
 const contribution=postContribution(post);
 const mission=missionProfile?.name||post.mission_name||'SEM MISSÃO';
 const limit=missionProfile?.limit??post.mission_limit??'Ilimitado';
 const description=missionProfile?.description||post.mission_description||'Engajamento calculado pela Fórmula Oficial V2: Curtidas × 2, somado ao bônus especial quando aplicável.';
 return <section className="post-expanded-info">
  <div className="mission-overview"><small>PERFIL / MISSÃO</small><h3>{mission}</h3><p>{description}</p></div>
  <div className="mission-rule-grid"><div><small>MULTIPLICADOR</small><b>× 2</b></div><div><small>BÔNUS</small><b>{special.toLocaleString('pt-BR')} CG</b></div><div><small>LIMITE</small><b>{String(limit)}</b></div></div>
  <div className="calc-detail-head"><div><span className="formula-badge">FÓRMULA OFICIAL V2</span><h4>Detalhamento do Cálculo de Crystgin</h4></div><strong>◆ {contribution.toLocaleString('pt-BR')} CG</strong></div>
  <div className="calc-detail-grid"><div><small>CONTRIBUIÇÃO INDIVIDUAL</small><b>{contribution.toLocaleString('pt-BR')} CG</b></div><div><small>VIEWS</small><b>{Number(post.views||0).toLocaleString('pt-BR')}</b></div><div><small>CURTIDAS × 2</small><b>{(likes*2).toLocaleString('pt-BR')} CG</b></div><div><small>RECOMPENSA BÁSICA</small><b>{reward.base.toLocaleString('pt-BR')} CG mensal</b></div><div><small>RECOMPENSA DE VIEWS</small><b>{reward.viewsReward.toLocaleString('pt-BR')} CG mensal</b></div><div><small>RECOMPENSA DE ENGAJAMENTO</small><b>{(likes*2).toLocaleString('pt-BR')} CG desta publicação</b></div><div><small>MISSÕES ESPECIAIS</small><b>{special.toLocaleString('pt-BR')} CG</b></div><div className="calc-total"><small>CRYSTGIN TOTAL</small><b>{contribution.toLocaleString('pt-BR')} CG</b></div><div><small>CAP MENSAL</small><b>{capUnlocked?'Desbloqueado':'30.000 CG'}</b></div><div className="calc-month-total"><small>TOTAL MENSAL OFICIAL</small><b>{reward.total.toLocaleString('pt-BR')} CG</b></div></div>
  <div className="post-expanded-actions"><button type="button" className="post-delete-button" onClick={onDelete}>🗑 EXCLUIR PUBLICAÇÃO</button></div>
 </section>;
}


