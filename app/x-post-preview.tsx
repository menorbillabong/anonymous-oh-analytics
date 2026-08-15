'use client';
import {useEffect,useMemo,useRef,useState} from 'react';

const xPostPattern=/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i;

type PreviewProps={post:any;compact?:boolean};

async function fetchPost(postUrl:string){
 const response=await fetch('/api/x-metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:postUrl})});
 if(!response.ok)return null;
 return response.json();
}

export function VideoPreview({url,poster,postUrl}:{url:string;poster?:string|null;postUrl?:string}){
 const ref=useRef<HTMLVideoElement>(null);
 const targetRef=useRef(1.2);
 const revealIdRef=useRef(0);
 const[frameReady,setFrameReady]=useState(false);
 const[resolvedPoster,setResolvedPoster]=useState(poster||'');
 useEffect(()=>{revealIdRef.current++;setResolvedPoster(poster||'');setFrameReady(false)},[poster,url]);
 useEffect(()=>{
  if(resolvedPoster||!postUrl||!xPostPattern.test(postUrl))return;
  let alive=true;
  fetchPost(postUrl).then(data=>{if(alive&&data?.thumbnail_url)setResolvedPoster(data.thumbnail_url)}).catch(()=>{});
  return()=>{alive=false};
 },[postUrl,resolvedPoster]);
 const revealDecodedFrame=()=>{const video=ref.current;if(!video||video.readyState<2||video.seeking)return;const revealId=++revealIdRef.current;let revealed=false;const reveal=()=>{if(revealed||revealId!==revealIdRef.current||ref.current!==video||video.readyState<2||video.seeking||Math.abs(video.currentTime-targetRef.current)>=.35)return;revealed=true;setFrameReady(true)};const fallback=window.setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(reveal)),250);const withFrame=video as HTMLVideoElement&{requestVideoFrameCallback?:(callback:(now:number,metadata:{mediaTime:number})=>void)=>number};if(withFrame.requestVideoFrameCallback)withFrame.requestVideoFrameCallback((_now,metadata)=>{if(Math.abs(metadata.mediaTime-targetRef.current)<.35){window.clearTimeout(fallback);requestAnimationFrame(reveal)}});else requestAnimationFrame(()=>requestAnimationFrame(reveal))};
 const seek=()=>{const video=ref.current;if(!video||video.readyState<1)return;try{const duration=Number.isFinite(video.duration)?video.duration:1.2;targetRef.current=Math.min(1.2,Math.max(0,duration-.05));video.pause();if(Math.abs(video.currentTime-targetRef.current)>.03)video.currentTime=targetRef.current;else if(!video.seeking)revealDecodedFrame()}catch{}};
 return <div className={`video-frame x-video-frame${frameReady?' is-frame-ready':''}`}>
  {!frameReady&&<div className="x-video-poster">{resolvedPoster?<img src={resolvedPoster} alt="Prévia do vídeo" onError={()=>setResolvedPoster('')}/>:<span>𝕏</span>}</div>}
  <video ref={ref} src={url} poster={resolvedPoster||undefined} controls playsInline preload="auto" muted onLoadedMetadata={seek} onLoadedData={seek} onDurationChange={seek} onSeeked={revealDecodedFrame}/>
 </div>;
}

function Media({data}:{data:any}){
 const images=useMemo(()=>Array.isArray(data?.image_urls)?data.image_urls.filter(Boolean):[],[data?.image_urls]);
 if(data?.video_url)return <VideoPreview url={data.video_url} poster={data.thumbnail_url} postUrl={data.post_url||data.url}/>;
 if(images.length)return <div className={`x-media-grid n${Math.min(images.length,4)}`}>{images.slice(0,4).map((url:string,index:number)=><img key={url+index} src={url} alt={`Mídia ${index+1} da publicação`}/>)}</div>;
 return null;
}

function number(value:any){return Number(value||0).toLocaleString('pt-BR')}
function dateTime(value:any){if(!value)return'';try{return new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}catch{return''}}

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
 const published=data.published_at||data.created_at||data.published_date;
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

