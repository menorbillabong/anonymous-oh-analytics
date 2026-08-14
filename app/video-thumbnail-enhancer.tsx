'use client';
import {useEffect} from 'react';
import {supabase} from '@/lib/supabase';

const postPattern=/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i;

async function getMetrics(postUrl:string){
 const response=await fetch('/api/x-metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:postUrl})});
 if(!response.ok)return null;
 return response.json();
}

function bindVideo(video:HTMLVideoElement,postUrl?:string){
 if(video.dataset.aohThumbBound==='1')return;
 video.dataset.aohThumbBound='1';
 const frame=video.closest<HTMLElement>('.video-frame');
 if(!frame)return;
 let layer=frame.querySelector<HTMLElement>('.aoh-video-poster-layer');
 if(!layer){layer=document.createElement('div');layer.className='aoh-video-poster-layer';layer.textContent='𝕏';frame.appendChild(layer)}
 const showPoster=(url:string)=>{
  if(!url)return;
  video.poster=url;
  if(layer){layer.textContent='';const img=document.createElement('img');img.src=url;img.alt='Prévia do vídeo';layer.appendChild(img)}
 };
 const seek=()=>{try{const duration=Number.isFinite(video.duration)?video.duration:1.2;video.currentTime=Math.min(1.2,Math.max(0,duration-.05));video.pause()}catch{}};
 const ready=()=>{video.pause();video.classList.add('aoh-frame-ready');requestAnimationFrame(()=>layer?.remove())};
 video.addEventListener('loadedmetadata',seek);
 video.addEventListener('loadeddata',seek);
 video.addEventListener('seeked',ready,{once:true});
 const existing=video.getAttribute('poster');if(existing)showPoster(existing);
 const sourcePost=postUrl||video.dataset.aohPostUrl;
 if(sourcePost&&postPattern.test(sourcePost))getMetrics(sourcePost).then(data=>{if(data?.thumbnail_url)showPoster(data.thumbnail_url)}).catch(()=>{});
 if(video.readyState>=1)seek();
}

export default function VideoThumbnailEnhancer(){
 useEffect(()=>{
  let alive=true;
  const map=new Map<string,string>();
  let addTimer:number|undefined;
  const refreshMap=async()=>{const{data:{session}}=await supabase.auth.getSession();if(!session||!alive)return;const{data}=await supabase.from('posts').select('post_url,video_url').eq('user_id',session.user.id);for(const row of data||[]){if(row.video_url&&row.post_url)map.set(String(row.video_url),String(row.post_url))}scan()};
  const scanVideos=()=>document.querySelectorAll<HTMLVideoElement>('.video-frame video').forEach(video=>{const src=video.currentSrc||video.getAttribute('src')||'';bindVideo(video,video.dataset.aohPostUrl||map.get(src))});
  const bindAddPreview=()=>{const screen=document.querySelector<HTMLElement>('.add-publication-screen');if(!screen)return;const input=screen.querySelector<HTMLInputElement>('.add-publication-card .add-field input');if(!input||input.dataset.aohVideoPreview==='1')return;input.dataset.aohVideoPreview='1';const update=()=>{window.clearTimeout(addTimer);addTimer=window.setTimeout(async()=>{const url=input.value.trim();screen.querySelector('.aoh-add-video-preview')?.remove();if(!postPattern.test(url))return;const data=await getMetrics(url).catch(()=>null);if(!alive||!data?.video_url||!screen.isConnected)return;const host=document.createElement('div');host.className='aoh-add-video-preview';host.innerHTML='<small>PRÉVIA DO VÍDEO</small><div class="video-frame"><video controls playsinline preload="auto" muted></video></div>';const video=host.querySelector('video') as HTMLVideoElement;video.src=data.video_url;video.dataset.aohPostUrl=url;if(data.thumbnail_url)video.poster=data.thumbnail_url;input.closest('.add-field')?.insertAdjacentElement('afterend',host);bindVideo(video,url)},350)};input.addEventListener('input',update);if(postPattern.test(input.value.trim()))update()};
  const scan=()=>{scanVideos();bindAddPreview()};
  refreshMap();scan();
  const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true});
  return()=>{alive=false;window.clearTimeout(addTimer);observer.disconnect()}
 },[]);
 return null;
}
