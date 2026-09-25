'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {formatPostDate} from '@/lib/post-date';

const xPostPattern=/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i;

type PreviewProps={post:any;compact?:boolean};

async function fetchPost(postUrl:string){
 const response=await fetch('/api/x-metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:postUrl})});
 if(!response.ok)return null;
 return response.json();
}

export function VideoPreview({url,poster,postUrl}:{url:string;poster?:string|null;postUrl?:string}){
 return <VideoFrame key={url} url={url} poster={poster} postUrl={postUrl}/>;
}

function VideoFrame({url,poster,postUrl}:{url:string;poster?:string|null;postUrl?:string}){
 const ref=useRef<HTMLVideoElement>(null);
 const targetRef=useRef(1.2);
 const prepared=useRef(false);
 const cancelReveal=useRef<()=>void>(()=>{});
 const[frameReady,setFrameReady]=useState(false);
 const[resolvedPoster,setResolvedPoster]=useState(poster||'');
 useEffect(()=>{setResolvedPoster(poster||'')},[poster]);
 useEffect(()=>()=>cancelReveal.current(),[]);
 useEffect(()=>{
  if(resolvedPoster||!postUrl||!xPostPattern.test(postUrl))return;
  let alive=true;
  fetchPost(postUrl).then(data=>{if(alive&&data?.thumbnail_url)setResolvedPoster(data.thumbnail_url)}).catch(()=>{});
  return()=>{alive=false};
 },[postUrl,resolvedPoster]);
 const revealDecodedFrame=()=>{
  const video=ref.current;
  if(prepared.current||!video||video.readyState<2||video.seeking)return;
  cancelReveal.current();
  let cancelled=false,raf=0,frame=0;
  const reveal=()=>{
   if(cancelled||prepared.current||ref.current!==video||video.readyState<2||video.seeking||Math.abs(video.currentTime-targetRef.current)>=.35)return;
   prepared.current=true;cancelReveal.current();setFrameReady(true);
  };
  // A paused seek does not consistently fire requestVideoFrameCallback in all
  // browsers. Keep the decoded-data fallback and cancel both paths on unmount.
  const fallback=window.setTimeout(()=>{raf=requestAnimationFrame(()=>{raf=requestAnimationFrame(reveal)})},250);
  if(video.requestVideoFrameCallback)frame=video.requestVideoFrameCallback((_now,metadata)=>{
   if(Math.abs(metadata.mediaTime-targetRef.current)<.35)raf=requestAnimationFrame(reveal);
  });
  cancelReveal.current=()=>{cancelled=true;clearTimeout(fallback);cancelAnimationFrame(raf);if(frame)video.cancelVideoFrameCallback?.(frame)};
 };
 const seek=()=>{const video=ref.current;if(prepared.current||!video||video.readyState<1)return;try{const duration=Number.isFinite(video.duration)?video.duration:1.2;targetRef.current=Math.min(1.2,Math.max(0,duration-.05));video.pause();if(Math.abs(video.currentTime-targetRef.current)>.03)video.currentTime=targetRef.current;else if(!video.seeking)revealDecodedFrame()}catch{}};
 const userPlayback=()=>{prepared.current=true;cancelReveal.current();setFrameReady(true)};
 return <div className={`video-frame x-video-frame${frameReady?' is-frame-ready':''}`}>
  {!frameReady&&<div className="x-video-poster">{resolvedPoster?<img src={resolvedPoster} alt="Prévia do vídeo" onError={()=>setResolvedPoster('')}/>:<span>𝕏</span>}</div>}
  {/* Retain buffering for the real preview frame and normal playback. */}
  <video ref={ref} data-aoh-preview-managed="react" src={url} poster={resolvedPoster||undefined} controls playsInline preload="auto" muted onPlay={userPlayback} onLoadedMetadata={seek} onLoadedData={seek} onDurationChange={seek} onSeeked={revealDecodedFrame}/>
 </div>;
}

function Media({data}:{data:any}){
 const images=useMemo(()=>Array.isArray(data?.image_urls)?data.image_urls.filter(Boolean):[],[data?.image_urls]);
 if(data?.video_url)return <VideoPreview url={data.video_url} poster={data.thumbnail_url} postUrl={data.post_url||data.url}/>;
 if(images.length)return <div className={`x-media-grid n${Math.min(images.length,4)}`}>{images.slice(0,4).map((url:string,index:number)=><img key={url+index} src={url} alt={`Mídia ${index+1} da publicação`}/>)}</div>;
 return null;
}

function number(value:any){return Number(value||0).toLocaleString('pt-BR')}
function dateTime(value:any){return formatPostDate(value,true)}

export default function XPostPreview({post,compact=false}:PreviewProps){
 const[data,setData]=useState<any>(post||{});
 const[loading,setLoading]=useState(false);
 const postUrl=post?.post_url||post?.url||'';
 useEffect(()=>{setData(post||{})},[post]);
 useEffect(()=>{
  if(!postUrl||!xPostPattern.test(postUrl))return;
  let alive=true;setLoading(true);
  fetchPost(postUrl).then(fresh=>{if(alive&&fresh)setData((old:any)=>({...old,...fresh,post_url:postUrl,text:fresh.text||fresh.title||old.text||old.title}))}).catch(()=>{}).finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[postUrl]);
 const handle=String(data.author_handle||'').replace(/^@/,'');
 const text=data.text||data.title||'Publicação do X';
 const published=data.x_published_at||data.published_at||data.published_date||data.created_at;
 return <article className={`x-reference-preview${compact?' compact':''}`}>
  <header className="x-preview-head">
   <div className="x-preview-author">{data.author_avatar?<img src={data.author_avatar} alt={data.author_name||handle||'Autor'}/>:<span className="x-avatar-fallback">𝕏</span>}<div><strong>{data.author_name||handle||'Autor da publicação'}</strong><small>{handle?`@${handle}`:'X'}</small></div></div>
   <span className="x-logo">𝕏</span>
  </header>
  <div className="x-preview-text">{text}</div>
  <Media data={{...data,post_url:postUrl}}/>
  <div className="x-preview-metrics"><span>◉ <b>{number(data.views)}</b><small>Views</small></span><span>◯ <b>{number(data.comments)}</b><small>Comentários</small></span><span>↻ <b>{number(data.reposts)}</b><small>Reposts</small></span><span>♥ <b>{number(data.likes)}</b><small>Curtidas</small></span></div>
  <footer className="x-preview-footer"><time>{dateTime(published)}{loading?' · atualizando…':''}</time>{postUrl&&<a href={postUrl} target="_blank" rel="noopener noreferrer">View on X ↗</a>}</footer>
 </article>;
}

