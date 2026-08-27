'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';
import {formatPostDate,postDateParts,postPublishedDate} from '@/lib/post-date';
import './bulk-review-reference.css';

type ReviewPost={url:string;title:string;views:number;comments:number;reposts:number;likes:number;image_urls:string[];video_url:string|null;author_handle:string;author_name:string;author_avatar:string;published_date:string;x_published_at:string;mission_profile_id:string;duplicate:boolean;existing_url:string};
const statusId=(url:string)=>url.match(/\/status\/(\d+)/i)?.[1]||'';
const monthKey=(value:unknown)=>{const parts=postDateParts(value);return parts?`${parts.year}-${String(parts.month).padStart(2,'0')}`:''};
const isMonthlyLimitError=(error:any)=>String(error?.message||'').includes('MONTHLY_POST_LIMIT_REACHED');
function withinMonthlyLimit<T>(items:T[],existing:any[],goal:number,dateOf:(item:T)=>unknown){
 const counts=new Map<string,number>();
 for(const post of existing){const key=monthKey(postPublishedDate(post));if(key)counts.set(key,(counts.get(key)||0)+1)}
 const accepted:T[]=[],omitted:T[]=[];
 for(const item of items){const key=monthKey(dateOf(item))||monthKey(new Date());const used=counts.get(key)||0;if(used>=goal){omitted.push(item);continue}counts.set(key,used+1);accepted.push(item)}
 return{accepted,omitted};
}

export default function BulkReviewInjector(){
 const[posts,setPosts]=useState<ReviewPost[]>([]),[profiles,setProfiles]=useState<any[]>([]),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[mode,setMode]=useState<'cards'|'list'>('cards'),[msg,setMsg]=useState('');
 const validPosts=useMemo(()=>posts.filter(p=>!p.duplicate),[posts]);
 const closeReview=()=>{setOpen(false);setPosts([]);setMsg('')};
 const refreshProfiles=useCallback(async(userId?:string)=>{let resolvedUserId=userId;if(!resolvedUserId){const{data}=await supabase.auth.getUser();resolvedUserId=data.user?.id}if(!resolvedUserId)return[];const{data,error}=await supabase.from('mission_profiles').select('*').eq('user_id',resolvedUserId).order('name');if(error)return null;const next=data||[];setProfiles(next);return next},[]);
 useEffect(()=>{let active=true;const sync=async()=>{if(!active)return;await refreshProfiles()};void sync();const onProfilesChanged=()=>{void sync()};window.addEventListener('aoh:mission-profiles-changed',onProfilesChanged);return()=>{active=false;window.removeEventListener('aoh:mission-profiles-changed',onProfilesChanged)}},[refreshProfiles]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key!=='Escape')return;if(open){e.preventDefault();closeReview();return}const bulkBack=document.querySelector('.bulk-page .bulk-title>button') as HTMLButtonElement|null;if(bulkBack){e.preventDefault();bulkBack.click();return}const genericClose=document.querySelector('.modal-close,.dialog-close,[data-close-modal],[aria-label="Fechar"]') as HTMLButtonElement|null;if(genericClose){e.preventDefault();genericClose.click()}};const onNav=(e:MouseEvent)=>{if(!open)return;const t=e.target as HTMLElement|null;if(t?.closest?.('.exact-nav button'))closeReview()};window.addEventListener('keydown',onKey);document.addEventListener('click',onNav,true);return()=>{window.removeEventListener('keydown',onKey);document.removeEventListener('click',onNav,true)}},[open]);
 useEffect(()=>{const capture=async(e:MouseEvent)=>{
  const target=e.target as HTMLElement|null,btn=target?.closest?.('.bulk-process') as HTMLButtonElement|null;if(!btn||open||loading)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  const page=btn.closest('.bulk-page'),textarea=page?.querySelector('textarea') as HTMLTextAreaElement|null,select=page?.querySelector('select') as HTMLSelectElement|null;
  const urls=[...new Set((textarea?.value.match(/https?:\/\/[^\s]+/g)||[]).map(x=>x.replace(/[),.;]+$/,'')))].filter(x=>/https?:\/\/(www\.)?(x\.com|twitter\.com)\//i.test(x));
  if(!urls.length){setMsg('Nenhum link válido do X foi encontrado.');return}
  setLoading(true);setMsg('');const old=btn.textContent;btn.textContent='PROCESSANDO...';const mission=select?.value||'';
  try{
   const{data:{user}}=await supabase.auth.getUser();let existing:any[]=[],goal=60;
   if(user){const[{data:found},{data:settings}]=await Promise.all([supabase.from('posts').select('id,post_url,x_published_at,published_at,created_at').eq('user_id',user.id),supabase.from('user_settings').select('monthly_post_goal').eq('user_id',user.id).maybeSingle(),refreshProfiles(user.id)]);existing=found||[];goal=Math.max(1,Number(settings?.monthly_post_goal||60))}
   const existingByStatus=new Map<string,string>();for(const p of existing){const id=statusId(String(p.post_url||''));if(id&&!existingByStatus.has(id))existingByStatus.set(id,String(p.post_url||''))}
   const rows=await Promise.all(urls.map(async url=>{const id=statusId(url),existingUrl=id?existingByStatus.get(id)||'':'';if(existingUrl)return{url,title:'Postagem duplicada',views:0,comments:0,reposts:0,likes:0,image_urls:[],video_url:null,author_handle:'',author_name:'',author_avatar:'',published_date:new Date().toISOString().slice(0,10),x_published_at:'',mission_profile_id:mission,duplicate:true,existing_url:existingUrl};let d:any={};try{const r=await fetch('/api/x-metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});d=await r.json()}catch{}return{url,title:d.title||'Publicação do X',views:Number(d.views||0),comments:Number(d.comments||0),reposts:Number(d.reposts||0),likes:Number(d.likes||0),image_urls:Array.isArray(d.image_urls)?d.image_urls:[],video_url:d.video_url||null,author_handle:d.author_handle||'',author_name:d.author_name||d.author_handle||'X',author_avatar:d.author_avatar||'',published_date:d.published_date||new Date().toISOString().slice(0,10),x_published_at:d.published_at||'',mission_profile_id:mission,duplicate:false,existing_url:''}}));
   const duplicates=rows.filter(row=>row.duplicate),fresh=rows.filter(row=>!row.duplicate),limited=withinMonthlyLimit(fresh,existing,goal,row=>row.x_published_at||row.published_date);
   setPosts([...duplicates,...limited.accepted]);setOpen(true);
   if(limited.omitted.length)setMsg(`${limited.omitted.length} ${limited.omitted.length===1?'publicação não foi incluída':'publicações não foram incluídas'} porque a meta mensal de ${goal} foi atingida.`);
  }finally{setLoading(false);btn.textContent=old}
 };document.addEventListener('click',capture,true);return()=>document.removeEventListener('click',capture,true)},[open,loading,refreshProfiles]);
 const update=(i:number,p:Partial<ReviewPost>)=>setPosts(rows=>rows.map((x,n)=>n===i?{...x,...p}:x));
 async function saveAll(){
  if(!validPosts.length)return;setSaving(true);setMsg('');
  const{data:{user}}=await supabase.auth.getUser();if(!user){setSaving(false);return}
  const latestProfiles=await refreshProfiles(user.id);if(latestProfiles===null){setMsg('Não foi possível confirmar os dados das missões. Tente novamente.');setSaving(false);return}
  const missingMission=validPosts.some(post=>post.mission_profile_id&&!latestProfiles.some(profile=>String(profile.id)===String(post.mission_profile_id)));if(missingMission){setMsg('A lista de missões mudou. Revise a missão selecionada e tente novamente.');setSaving(false);return}
  const rows=validPosts.map(p=>{const mp=latestProfiles.find(x=>String(x.id)===String(p.mission_profile_id));return{user_id:user.id,title:p.title||'Publicação do X',post_url:p.url,published_at:p.published_date||null,x_published_at:p.x_published_at||null,views:p.views,likes:p.likes,reposts:p.reposts,comments:p.comments,mission_profile_id:mp?.id||null,mission_name:mp?.name||null,special_reward:Number(mp?.reward||0),network:'X',author_handle:p.author_handle||null,image_urls:p.image_urls||[],video_url:p.video_url||null,metrics_source:'auto',metrics_updated_at:new Date().toISOString()}});
  const[{data:existing},{data:settings}]=await Promise.all([supabase.from('posts').select('post_url,x_published_at,published_at,created_at').eq('user_id',user.id),supabase.from('user_settings').select('monthly_post_goal').eq('user_id',user.id).maybeSingle()]);
  const goal=Math.max(1,Number(settings?.monthly_post_goal||60)),existingIds=new Set((existing||[]).map((p:any)=>statusId(String(p.post_url||''))).filter(Boolean));
  const uniqueRows=rows.filter(r=>{const id=statusId(r.post_url);return id&&!existingIds.has(id)});
  if(!uniqueRows.length){setMsg('Todas as publicações desta revisão já estão no seu rastreador.');setSaving(false);setPosts(p=>p.map(x=>({...x,duplicate:true,existing_url:x.existing_url||x.url})));return}
  const limited=withinMonthlyLimit(uniqueRows,existing||[],goal,row=>row.x_published_at||row.published_at);
  if(!limited.accepted.length){setMsg(`Meta mensal de ${goal} publicações atingida.`);setSaving(false);return}
  const{error}=await supabase.from('posts').insert(limited.accepted);
  if(error){setMsg(isMonthlyLimitError(error)?`Meta mensal de ${goal} publicações atingida.`:'Não foi possível adicionar as publicações.');setSaving(false);return}
  if(limited.omitted.length){setMsg(`${limited.accepted.length} adicionadas. ${limited.omitted.length} não foram incluídas porque a meta mensal foi atingida.`);setSaving(false);setPosts(posts=>posts.filter(post=>limited.omitted.some(row=>row.post_url===post.url)));return}
  window.location.reload()
 }
 if(!open)return msg?createPortal(<div className="bulk-floating-msg">{msg}</div>,document.body):null;
 return createPortal(<div className="bulk-review-page"><div className="bulk-review-shell"><header className="bulk-review-top"><div><h1>Revisar epígrafe Posts</h1><p>Atribuir missões e adicionar os posts.</p></div><div className="bulk-review-actions"><button className="bulk-review-back" onClick={closeReview}>← Voltar</button><div className="bulk-view-switch"><button className={mode==='list'?'active':''} onClick={()=>setMode('list')}>☰</button><button className={mode==='cards'?'active':''} onClick={()=>setMode('cards')}>▦</button></div><button className="bulk-confirm" disabled={saving||!validPosts.length} onClick={saveAll}>{saving?'ADICIONANDO...':`Adicionar ${validPosts.length} ${validPosts.length===1?'publicação':'publicações'}`}</button></div></header><main className={`bulk-review-grid ${mode}`}>{posts.map((p,i)=><ReviewCard key={p.url} post={p} profiles={profiles} onChange={x=>update(i,x)}/>)}</main>{msg&&<div className="bulk-review-error">{msg}</div>}</div></div>,document.body)
}

function ReviewCard({post,profiles,onChange}:{post:ReviewPost;profiles:any[];onChange:(x:Partial<ReviewPost>)=>void}){if(post.duplicate)return <article className="bulk-review-card duplicate-card"><div className="bulk-duplicate-block"><strong>Postagem duplicada</strong><span>{post.url}</span><small>Este post já está no seu rastreador.</small></div><label>missão<div className="bulk-review-select"><i style={{background:profiles.find(x=>String(x.id)===String(post.mission_profile_id))?.color||'#38d27f'}}/><select disabled value={post.mission_profile_id}><option value="">Sem missão especial</option>{profiles.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div></label><label>Dados para postagem<input disabled type="date" value={post.published_date}/></label><div className="bulk-review-bonuses"><button disabled>Imagem em</button><button disabled>Bônus de Reprodução</button></div></article>;const media=[...post.image_urls.map(x=>({type:'img',src:x})),...(post.video_url?[{type:'video',src:post.video_url}]:[])],date=formatPostDate(post.x_published_at||post.published_date,true);return <article className="bulk-review-card"><div className="bulk-x-card"><div className="bulk-x-head">{post.author_avatar?<img src={post.author_avatar} alt=""/>:<span className="bulk-avatar-fallback">𝕏</span>}<div><strong>{post.author_name||post.author_handle}</strong><small>@{post.author_handle}</small></div><b>𝕏</b></div><p>{post.title}</p>{media.length>0&&<div className={`bulk-media count-${Math.min(media.length,4)}`}>{media.map((m,n)=>m.type==='img'?<img key={n} src={m.src} alt=""/>:<video key={n} src={m.src} controls muted playsInline/>)}</div>}<div className="bulk-x-stats"><span>◉ {post.views.toLocaleString('pt-BR')}</span><span>◯ {post.comments.toLocaleString('pt-BR')}</span><span>↻ {post.reposts.toLocaleString('pt-BR')}</span><span className="heart">♥ {post.likes.toLocaleString('pt-BR')}</span></div><div className="bulk-x-foot"><span>{date}</span><a href={post.url} target="_blank" rel="noreferrer">Ver no X ↗</a></div></div><label>missão<div className="bulk-review-select"><i style={{background:profiles.find(x=>String(x.id)===String(post.mission_profile_id))?.color||'#38d27f'}}/><select value={post.mission_profile_id} onChange={e=>onChange({mission_profile_id:e.target.value})}><option value="">Sem missão especial</option>{profiles.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div></label><label>Data da publicação no X<input type="date" value={post.published_date} disabled title="Data obtida automaticamente pelo link da publicação no X"/></label><div className="bulk-review-bonuses"><button disabled>Imagem em</button><button disabled>Bônus de Reprodução</button></div></article>}

