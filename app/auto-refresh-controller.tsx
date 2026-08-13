'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';

type AutoConfig={active:boolean;hours:number};
type StoredTimer={deadline:number;hours:number};

const toSeconds=(hours:number)=>Math.max(1,Math.round((Number(hours)||.5)*3600));
const formatTime=(seconds:number)=>{const v=Math.max(0,Math.floor(seconds));const h=Math.floor(v/3600);const m=Math.floor((v%3600)/60);const s=v%60;return h>0?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`};
const timerKey=(uid:string)=>`aoh:auto-refresh-timer:${uid}`;

export default function AutoRefreshController(){
 const[config,setConfig]=useState<AutoConfig>({active:false,hours:.5});
 const[remaining,setRemaining]=useState(0);
 const[host,setHost]=useState<HTMLElement|null>(null);
 const[uid,setUid]=useState('');

 const saveDeadline=(userId:string,hours:number)=>{const deadline=Date.now()+toSeconds(hours)*1000;localStorage.setItem(timerKey(userId),JSON.stringify({deadline,hours} satisfies StoredTimer));setRemaining(Math.max(0,Math.ceil((deadline-Date.now())/1000)));return deadline};

 useEffect(()=>{
  let mounted=true;
  const loadConfig=async()=>{const{data:{session}}=await supabase.auth.getSession();if(!session||!mounted){if(mounted){setUid('');setConfig({active:false,hours:.5})}return}const userId=session.user.id;setUid(userId);const{data}=await supabase.from('user_settings').select('show_refresh_timer,refresh_interval').eq('user_id',userId).maybeSingle();if(mounted)setConfig({active:!!data?.show_refresh_timer,hours:Number(data?.refresh_interval||.5)})};
  loadConfig();
  const{data:auth}=supabase.auth.onAuthStateChange(()=>loadConfig());
  const changed=(event:Event)=>{const detail=(event as CustomEvent).detail||{};setConfig({active:!!detail.active,hours:Number(detail.hours||.5)})};
  window.addEventListener('aoh:auto-refresh-changed',changed);
  return()=>{mounted=false;auth.subscription.unsubscribe();window.removeEventListener('aoh:auto-refresh-changed',changed)};
 },[]);

 useEffect(()=>{
  if(!uid)return;
  if(!config.active){setRemaining(0);localStorage.removeItem(timerKey(uid));return}
  let stored:StoredTimer|null=null;
  try{stored=JSON.parse(localStorage.getItem(timerKey(uid))||'null')}catch{}
  const sameInterval=stored&&Number(stored.hours)===Number(config.hours);
  const stillValid=stored&&Number(stored.deadline)>Date.now();
  if(sameInterval&&stillValid){setRemaining(Math.max(0,Math.ceil((Number(stored!.deadline)-Date.now())/1000)));return}
  saveDeadline(uid,config.hours);
 },[uid,config.active,config.hours]);

 useEffect(()=>{
  if(!config.active||!uid)return;
  const tick=()=>{let stored:StoredTimer|null=null;try{stored=JSON.parse(localStorage.getItem(timerKey(uid))||'null')}catch{}const deadline=Number(stored?.deadline||0);setRemaining(Math.max(0,Math.ceil((deadline-Date.now())/1000)))};
  tick();const timer=window.setInterval(tick,1000);return()=>window.clearInterval(timer)
 },[config.active,config.hours,uid]);

 useEffect(()=>{if(!config.active||!uid||remaining!==0)return;const manual=document.querySelector<HTMLButtonElement>('.hero-actions .green-btn');saveDeadline(uid,config.hours);if(manual&&!manual.disabled)manual.click();else window.location.reload()},[remaining,config.active,config.hours,uid]);

 useEffect(()=>{const reset=(e:MouseEvent)=>{const el=e.target as HTMLElement|null;if(config.active&&uid&&el?.closest('.hero-actions .green-btn'))saveDeadline(uid,config.hours)};document.addEventListener('click',reset,true);return()=>document.removeEventListener('click',reset,true)},[config.active,config.hours,uid]);

 useEffect(()=>{
  if(!config.active){host?.remove();setHost(null);return}
  const attach=()=>{const nav=document.querySelector('.exact-nav');if(!nav)return;const panel=[...nav.querySelectorAll('button')].find(b=>b.textContent?.trim().includes('Painel'));if(!panel)return;let target=nav.querySelector<HTMLElement>('.auto-refresh-timer-host');if(!target){target=document.createElement('div');target.className='auto-refresh-timer-host';panel.insertAdjacentElement('afterend',target)}setHost(target)};
  attach();const observer=new MutationObserver(attach);observer.observe(document.body,{childList:true,subtree:true});return()=>{observer.disconnect();document.querySelector('.auto-refresh-timer-host')?.remove();setHost(null)};
 },[config.active]);

 if(!config.active||!host)return null;
 return createPortal(<div title="Tempo restante para a próxima atualização automática" style={{height:38,minWidth:84,padding:'0 9px',borderRadius:8,border:'1px solid #4d3a1f',background:'#20190f',color:'#f7bb55',display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontWeight:900,boxSizing:'border-box',boxShadow:'0 0 14px rgba(247,187,85,.08)'}}><span style={{fontSize:16}}>◷</span><span style={{display:'flex',flexDirection:'column',lineHeight:1.05}}><small style={{fontSize:7,letterSpacing:'.08em',color:'#a98d62'}}>AUTO</small><b style={{fontSize:10,fontVariantNumeric:'tabular-nums'}}>{formatTime(remaining)}</b></span></div>,host);
}
