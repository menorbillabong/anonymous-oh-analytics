'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';

function applyColors(s:any){const r=document.documentElement;r.style.setProperty('--aoh-accent',s?.accent_color||'#f6ad55');r.style.setProperty('--aoh-bg',s?.background_color||'#101010');r.style.setProperty('--aoh-surface',s?.surface_color||'#1e1e1e');r.style.setProperty('--aoh-border',s?.border_color||'#303030')}
function secondsFor(hours:number){return Math.max(1,Math.round(hours*3600))}
function formatTime(seconds:number){return `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor((seconds%3600)/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`}

export default function SettingsPersistenceSync(){
 const uid=useRef(''),lastGoal=useRef('');
 const[ready,setReady]=useState(false),[active,setActive]=useState(false),[hours,setHours]=useState(.5),[left,setLeft]=useState(0);
 useEffect(()=>{setReady(true);let stopped=false;supabase.auth.getSession().then(async({data})=>{const id=data.session?.user.id||'';if(!id||stopped)return;uid.current=id;const{data:s}=await supabase.from('user_settings').select('*').eq('user_id',id).maybeSingle();applyColors(s||{});const h=Number(s?.refresh_interval||.5),on=!!s?.show_refresh_timer;setHours(h);setActive(on);setLeft(on?secondsFor(h):0);const goal=String(Math.max(1,Number(s?.monthly_post_goal||60)));localStorage.setItem(`aoh:monthly-goal:${id}`,goal);lastGoal.current=goal});const goalTimer=setInterval(async()=>{const id=uid.current;if(!id)return;const goal=String(Math.max(1,Number(localStorage.getItem(`aoh:monthly-goal:${id}`)||60)));if(goal!==lastGoal.current){lastGoal.current=goal;await supabase.from('user_settings').update({monthly_post_goal:Number(goal),updated_at:new Date().toISOString()}).eq('user_id',id)}},1200);const onSettings=(event:Event)=>{const detail=(event as CustomEvent).detail||{};const h=Number(detail.hours||.5),on=!!detail.active;setHours(h);setActive(on);setLeft(on?secondsFor(h):0)};window.addEventListener('aoh:auto-refresh-changed',onSettings as EventListener);return()=>{stopped=true;clearInterval(goalTimer);window.removeEventListener('aoh:auto-refresh-changed',onSettings as EventListener)}},[]);
 useEffect(()=>{const select=document.querySelector('.settings-grid-full select') as HTMLSelectElement|null;if(select)select.disabled=!active},[active,ready,left]);
 useEffect(()=>{if(!active){setLeft(0);return}setLeft(secondsFor(hours));const timer=setInterval(()=>setLeft(current=>{if(current<=1){const updateButton=[...document.querySelectorAll('button')].find(button=>(button.textContent||'').toUpperCase().includes('ATUALIZAR AGORA')) as HTMLButtonElement|null;updateButton?.click();return secondsFor(hours)}return current-1}),1000);return()=>clearInterval(timer)},[active,hours]);
 useEffect(()=>{const resetOnManual=(event:MouseEvent)=>{if(!active)return;const button=(event.target as HTMLElement).closest('button');if(button&&(button.textContent||'').toUpperCase().includes('ATUALIZAR AGORA'))setLeft(secondsFor(hours))};document.addEventListener('click',resetOnManual,true);return()=>document.removeEventListener('click',resetOnManual,true)},[active,hours]);
 if(!ready||!active||left<=0)return null;const topbar=document.querySelector('.exact-topbar');if(!topbar)return null;return createPortal(<div className="auto-timer-pill" title="Próxima atualização automática"><span>↻</span><b>{formatTime(left)}</b></div>,topbar)
}
