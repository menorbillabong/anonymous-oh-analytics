'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';

export default function AutoRefreshController(){
 const[uid,setUid]=useState('');
 const[active,setActive]=useState(false);
 const[hours,setHours]=useState(.5);
 const[left,setLeft]=useState(0);
 const[ready,setReady]=useState(false);
 useEffect(()=>{setReady(true);supabase.auth.getSession().then(async({data})=>{const id=data.session?.user.id||'';setUid(id);if(!id)return;const{data:s}=await supabase.from('user_settings').select('show_refresh_timer,refresh_interval').eq('user_id',id).maybeSingle();const on=!!s?.show_refresh_timer;const h=Number(s?.refresh_interval||.5);setActive(on);setHours(h);setLeft(on?Math.round(h*3600):0)})},[]);
 useEffect(()=>{if(!uid)return;const onClick=(e:MouseEvent)=>{const row=(e.target as HTMLElement).closest('.toggle-row');if(!row||!row.textContent?.includes('Habilitar atualização automática'))return;setTimeout(async()=>{const button=row.querySelector('button.toggle');const on=!!button?.classList.contains('on');const select=document.querySelector('.settings-grid-full select') as HTMLSelectElement|null;const h=Number(select?.value||hours||.5);setActive(on);setHours(h);setLeft(on?Math.round(h*3600):0);await supabase.from('user_settings').update({show_refresh_timer:on,refresh_interval:h,updated_at:new Date().toISOString()}).eq('user_id',uid)},0)};
 const onChange=(e:Event)=>{const el=e.target as HTMLSelectElement;if(!el.matches('.settings-grid-full select'))return;const h=Number(el.value||.5);setHours(h);if(active)setLeft(Math.round(h*3600));supabase.from('user_settings').update({refresh_interval:h,updated_at:new Date().toISOString()}).eq('user_id',uid)};
 document.addEventListener('click',onClick);document.addEventListener('change',onChange);return()=>{document.removeEventListener('click',onClick);document.removeEventListener('change',onChange)}},[uid,hours,active]);
 useEffect(()=>{if(!active){setLeft(0);return}if(left<=0)setLeft(Math.round(hours*3600));const t=setInterval(()=>setLeft(v=>{if(v<=1){const manual=[...document.querySelectorAll('button')].find(b=>(b.textContent||'').toUpperCase().includes('ATUALIZAR AGORA')) as HTMLButtonElement|null;manual?.click();return Math.round(hours*3600)}return v-1}),1000);return()=>clearInterval(t)},[active,hours]);
 useEffect(()=>{const click=(e:MouseEvent)=>{const b=(e.target as HTMLElement).closest('button');if(active&&b&&(b.textContent||'').toUpperCase().includes('ATUALIZAR AGORA'))setLeft(Math.round(hours*3600))};document.addEventListener('click',click,true);return()=>document.removeEventListener('click',click,true)},[active,hours]);
 if(!ready||!active||left<=0)return null;const top=document.querySelector('.exact-topbar');if(!top)return null;return createPortal(<div className="wait-auto-timer" title="Próxima atualização automática"><span>↻</span><b>{fmt(left)}</b></div>,top);
}
function fmt(s:number){return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
