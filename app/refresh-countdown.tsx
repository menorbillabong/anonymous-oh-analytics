'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';

const msFor=(hours:number)=>Math.max(.5,Number(hours)||.5)*3600000;
const formatTime=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),r=s%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`};

type TimerData={active:boolean;hours:number;last:string|null;next:string|null};

export default function RefreshCountdown(){
 const[uid,setUid]=useState('');
 const[data,setData]=useState<TimerData>({active:false,hours:.5,last:null,next:null});
 const[left,setLeft]=useState(0);
 const[host,setHost]=useState<HTMLElement|null>(null);

 const load=async(userId:string)=>{
  const{data:s}=await supabase.from('user_settings').select('show_refresh_timer,refresh_interval,last_refresh_at,next_refresh_at').eq('user_id',userId).maybeSingle();
  if(!s)return;
  const active=!!s.show_refresh_timer;
  const hours=Number(s.refresh_interval||.5);
  let last=(s.last_refresh_at as string|null)||null;
  let next=(s.next_refresh_at as string|null)||null;
  if(active&&!next){
   const start=last?new Date(last).getTime():Date.now();
   if(!last)last=new Date(start).toISOString();
   next=new Date(start+msFor(hours)).toISOString();
   await supabase.from('user_settings').update({last_refresh_at:last,next_refresh_at:next}).eq('user_id',userId);
  }
  setData({active,hours,last,next});
 };

 useEffect(()=>{
  let mounted=true;
  supabase.auth.getSession().then(({data:s})=>{const id=s.session?.user.id||'';if(mounted){setUid(id);if(id)load(id)}});
  const{data:auth}=supabase.auth.onAuthStateChange((_event,session)=>{const id=session?.user.id||'';setUid(id);if(id)load(id);else setData({active:false,hours:.5,last:null,next:null})});
  return()=>{mounted=false;auth.subscription.unsubscribe()};
 },[]);

 useEffect(()=>{
  const changed=async(event:Event)=>{
   if(!uid)return;
   const detail=(event as CustomEvent).detail||{};
   const active=!!detail.active;
   const newHours=Number(detail.hours||.5);
   const{data:s}=await supabase.from('user_settings').select('refresh_interval,last_refresh_at,next_refresh_at').eq('user_id',uid).maybeSingle();
   const oldHours=Number(s?.refresh_interval||newHours);
   if(!active){
    await supabase.from('user_settings').update({next_refresh_at:null}).eq('user_id',uid);
    setData({active:false,hours:newHours,last:s?.last_refresh_at||null,next:null});
    return;
   }
   const now=Date.now();
   let start=s?.last_refresh_at?new Date(s.last_refresh_at).getTime():NaN;
   if(!Number.isFinite(start)&&s?.next_refresh_at)start=new Date(s.next_refresh_at).getTime()-msFor(oldHours);
   if(!Number.isFinite(start))start=now;
   const nextMs=start+msFor(newHours);
   const lastIso=new Date(start).toISOString();
   const nextIso=new Date(Math.max(now,nextMs)).toISOString();
   await supabase.from('user_settings').update({last_refresh_at:lastIso,next_refresh_at:nextIso}).eq('user_id',uid);
   setData({active:true,hours:newHours,last:lastIso,next:nextIso});
  };
  window.addEventListener('aoh:auto-refresh-changed',changed as EventListener);
  return()=>window.removeEventListener('aoh:auto-refresh-changed',changed as EventListener);
 },[uid]);

 useEffect(()=>{
  if(!data.active||!data.next){setLeft(0);return}
  const tick=()=>setLeft(Math.max(0,Math.ceil((new Date(data.next!).getTime()-Date.now())/1000)));
  tick();const timer=window.setInterval(tick,1000);return()=>window.clearInterval(timer);
 },[data.active,data.next]);

 useEffect(()=>{
  if(!data.active){document.querySelectorAll('.refresh-countdown-host').forEach(el=>el.remove());setHost(null);return}
  const attach=()=>{const nav=document.querySelector('.exact-nav');if(!nav)return;const panel=[...nav.querySelectorAll('button')].find(b=>b.textContent?.trim().includes('Painel'));if(!panel)return;let target=nav.querySelector<HTMLElement>('.refresh-countdown-host');if(!target){target=document.createElement('div');target.className='refresh-countdown-host';panel.insertAdjacentElement('afterend',target)}setHost(target)};
  attach();const observer=new MutationObserver(attach);observer.observe(document.body,{childList:true,subtree:true});return()=>{observer.disconnect();document.querySelectorAll('.refresh-countdown-host').forEach(el=>el.remove());setHost(null)};
 },[data.active]);

 if(!data.active||!host)return null;
 return createPortal(<div title="Tempo restante para a próxima atualização" style={{height:38,minWidth:92,padding:'0 10px',borderRadius:8,border:'1px solid #6b4b1f',background:'#21180d',color:'#f7bb55',display:'flex',alignItems:'center',justifyContent:'center',gap:7,fontWeight:900,boxSizing:'border-box'}}><span>◷</span><b style={{fontSize:11,fontVariantNumeric:'tabular-nums'}}>{formatTime(left)}</b></div>,host);
}
