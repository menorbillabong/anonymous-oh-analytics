'use client';
import {useEffect} from 'react';
import {supabase} from '@/lib/supabase';

const postPattern=/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i;
async function getMetrics(postUrl:string){const response=await fetch('/api/x-metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:postUrl})});return response.ok?response.json():null}

function bind(video:HTMLVideoElement,postUrl?:string,knownPoster?:string){
 if(video.dataset.aohThumbBound==='1'||!postUrl||!postPattern.test(postUrl))return;
 video.dataset.aohThumbBound='1';
 const frame=(video.closest('.video-frame')||video.parentElement) as HTMLElement|null;
 if(!frame)return;
 frame.style.position='relative';frame.style.overflow='hidden';video.style.opacity='0';
 const layer=document.createElement('div');layer.className='aoh-video-poster-layer';layer.style.cssText='position:absolute;inset:0;z-index:6;display:grid;place-items:center;overflow:hidden;background:linear-gradient(135deg,#2d1b09,#6b3d0b);color:#f7bb55;font-size:28px;font-weight:900;pointer-events:none';layer.textContent='𝕏';frame.appendChild(layer);
 const showPoster=(url:string)=>{if(!url)return;video.poster=url;layer.textContent='';const image=document.createElement('img');image.src=url;image.alt='Prévia do vídeo';image.style.cssText='width:100%;height:100%;display:block;object-fit:contain;background:#050505';image.onerror=()=>{image.remove();layer.textContent='𝕏'};layer.appendChild(image)};
 if(knownPoster)showPoster(knownPoster);else getMetrics(postUrl).then(data=>showPoster(data?.thumbnail_url||'')).catch(()=>{});
 let target=1.2,revealId=0;
 const revealDecodedFrame=()=>{if(video.readyState<2||video.seeking||!layer.isConnected)return;const id=++revealId;let revealed=false;const reveal=()=>{if(revealed||id!==revealId||video.readyState<2||video.seeking||Math.abs(video.currentTime-target)>=.35||!layer.isConnected)return;revealed=true;video.pause();video.style.opacity='1';video.style.transition='opacity .16s ease';layer.remove()};const fallback=window.setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(reveal)),250);const withFrame=video as HTMLVideoElement&{requestVideoFrameCallback?:(callback:(now:number,metadata:{mediaTime:number})=>void)=>number};if(withFrame.requestVideoFrameCallback)withFrame.requestVideoFrameCallback((_now,metadata)=>{if(Math.abs(metadata.mediaTime-target)<.35){window.clearTimeout(fallback);requestAnimationFrame(reveal)}});else requestAnimationFrame(()=>requestAnimationFrame(reveal))};
 const seek=()=>{if(video.readyState<1)return;try{const duration=Number.isFinite(video.duration)?video.duration:1.2;target=Math.min(1.2,Math.max(0,duration-.05));video.pause();if(Math.abs(video.currentTime-target)>.03)video.currentTime=target;else if(!video.seeking)revealDecodedFrame()}catch{}};
 video.addEventListener('loadedmetadata',seek);video.addEventListener('loadeddata',seek);video.addEventListener('durationchange',seek);video.addEventListener('seeked',revealDecodedFrame);if(video.readyState>=1)seek();
}

export default function VideoThumbnailEnhancer(){
 useEffect(()=>{let alive=true;const map=new Map<string,string>();let addTimer:number|undefined;
  const bindAddPreview=()=>{const screen=document.querySelector<HTMLElement>('.add-publication-screen');if(!screen)return;const input=screen.querySelector<HTMLInputElement>('.add-publication-card .add-field input');if(!input||input.dataset.aohVideoPreview==='1')return;input.dataset.aohVideoPreview='1';const update=()=>{window.clearTimeout(addTimer);addTimer=window.setTimeout(async()=>{const url=input.value.trim();screen.querySelector('.aoh-add-video-preview')?.remove();if(!postPattern.test(url))return;const data=await getMetrics(url).catch(()=>null);if(!alive||!screen.isConnected||!data?.video_url)return;const host=document.createElement('div');host.className='aoh-add-video-preview';host.style.cssText='margin:12px 0 16px;border:1px solid #303030;border-radius:9px;overflow:hidden;background:#090909';host.innerHTML='<div style="padding:9px 11px;color:#858b94;font-size:9px;font-weight:900;border-bottom:1px solid #262626">PRÉVIA DO VÍDEO</div><div class="video-frame" style="min-height:260px;max-height:460px;background:#050505"><video controls playsinline preload="auto" muted style="width:100%;height:100%;max-height:460px;object-fit:contain;background:#050505"></video></div>';const preview=host.querySelector('video') as HTMLVideoElement;preview.src=data.video_url;if(data.thumbnail_url)preview.poster=data.thumbnail_url;input.closest('.add-field')?.insertAdjacentElement('afterend',host);bind(preview,url,data.thumbnail_url||'')},350)};input.addEventListener('input',update);if(postPattern.test(input.value.trim()))update()};
  const bindPreviewVideos=(selector:string)=>{document.querySelectorAll<HTMLVideoElement>(selector).forEach(video=>{const root=video.closest('.x-reference-preview,.bulk-x-card');const link=root?.querySelector<HTMLAnchorElement>('a[href]');bind(video,link?.href,video.poster)})};
  const scan=()=>{document.querySelectorAll<HTMLVideoElement>('.video-frame video').forEach(video=>{const src=video.currentSrc||video.getAttribute('src')||'';const postUrl=video.dataset.aohPostUrl||map.get(src);if(postUrl)bind(video,postUrl,video.poster)});bindPreviewVideos('.x-reference-preview video');bindPreviewVideos('.bulk-media video');bindAddPreview()};
  supabase.auth.getSession().then(async({data})=>{const uid=data.session?.user.id;if(!uid||!alive)return;const{data:rows}=await supabase.from('posts').select('post_url,video_url').eq('user_id',uid);for(const row of rows||[]){if(row.video_url&&row.post_url)map.set(String(row.video_url),String(row.post_url))}scan()});scan();const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true});return()=>{alive=false;window.clearTimeout(addTimer);observer.disconnect()}
 },[]);return null;
}

