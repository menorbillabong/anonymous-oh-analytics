'use client';
import {useCallback,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';

type TimerState={active:boolean;hours:number;next:string|null};
const format=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),r=s%60;return h>0?`${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`};

export default function DatabaseRefreshTimer(){
 const[uid,setUid]=useState('');
 const[state,setState]=useState<TimerState>({active:false,hours:.5,next:null});
 const[left,setLeft]=useState(0);
 const[host,setHost]=useState<HTMLElement|null>(null);

 const sync=useCallback(async(userId:string)=>{
  const{data}=await supabase.from('user_settings').select('show_refresh_timer,refresh_interval,last_refresh_at,next_refresh_at').eq('user_id',userId).maybeSingle();
  if(!data)return;
  const active=!!data.show_refresh_timer,hours=Number(data.refresh_interval||.5);
  const next=data.next_refresh_at as string|null;
  setState({active,hours,next});
 },[]);

 useEffect(()=>{let mounted=true;supabase.auth.getSession().then(({data})=>{const id=data.session?.user.id||'';if(mounted&&id){setUid(id);sync(id)}});const{data:auth}=supabase.auth.onAuthStateChange((_e,session)=>{const id=session?.user.id||'';setUid(id);if(id)sync(id);else setState({active:false,hours:.5,next:null})});return()=>{mounted=false;auth.subscription.unsubscribe()}},[sync]);

 useEffect(()=>{
  const changed=()=>{if(uid)window.setTimeout(()=>sync(uid),200)};
  window.addEventListener('aoh:auto-refresh-changed',changed as EventListener);return()=>window.removeEventListener('aoh:auto-refresh-changed',changed as EventListener)
 },[uid,sync]);

 useEffect(()=>{
  if(!uid)return;
  const refresh=()=>sync(uid);
  const visible=()=>{if(document.visibilityState==='visible')refresh()};
  const poll=window.setInterval(refresh,15000);
  window.addEventListener('focus',refresh);
  document.addEventListener('visibilitychange',visible);
  return()=>{window.clearInterval(poll);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visible)};
 },[uid,sync]);

 useEffect(()=>{if(!state.active||!state.next){setLeft(0);return}const tick=()=>setLeft(Math.max(0,Math.ceil((new Date(state.next!).getTime()-Date.now())/1000)));tick();const id=window.setInterval(tick,1000);return()=>window.clearInterval(id)},[state.active,state.next]);

 useEffect(()=>{if(!state.active){document.querySelectorAll('.db-refresh-timer-host').forEach(el=>el.remove());setHost(null);return}const attach=()=>{const topbar=document.querySelector('.exact-topbar');if(!topbar)return;const brand=topbar.querySelector('.exact-brand');if(!brand)return;let target=topbar.querySelector<HTMLElement>(':scope > .db-refresh-timer-host');if(!target){target=document.createElement('div');target.className='db-refresh-timer-host';brand.insertAdjacentElement('afterend',target)}setHost(target)};attach();const obs=new MutationObserver(attach);obs.observe(document.body,{childList:true,subtree:true});return()=>{obs.disconnect();document.querySelectorAll('.db-refresh-timer-host').forEach(el=>el.remove());setHost(null)}},[state.active]);

 if(!state.active||!host)return null;
 return createPortal(<div className="db-refresh-timer" title="Atualização automática" aria-label={`Sincronização automática em ${format(left)}`}><span className="db-refresh-clock" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8.515 1.019A7 7 0 0 0 8 1V0a8 8 0 0 1 .589.022zm2.004.45a7 7 0 0 0-.985-.299l.219-.976q.576.129 1.126.342zm1.37.71a7 7 0 0 0-.439-.27l.493-.87a8 8 0 0 1 .979.654l-.615.789a7 7 0 0 0-.418-.302zm1.834 1.79a7 7 0 0 0-.653-.796l.724-.69q.406.429.747.91zm.744 1.352a7 7 0 0 0-.214-.468l.893-.45a8 8 0 0 1 .45 1.088l-.95.313a7 7 0 0 0-.179-.483m.53 2.507a7 7 0 0 0-.1-1.025l.985-.17q.1.58.116 1.17zm-.131 1.538q.05-.254.081-.51l.993.123a8 8 0 0 1-.23 1.155l-.964-.267q.069-.247.12-.501m-.952 2.379q.276-.436.486-.908l.914.405q-.24.54-.555 1.038zm-.964 1.205q.183-.183.35-.378l.758.653a8 8 0 0 1-.401.432z"/><path d="M8 1a7 7 0 1 0 4.95 11.95l.707.707A8.001 8.001 0 1 1 8 0z"/><path d="M7.5 3a.5.5 0 0 1 .5.5v5.21l3.248 1.856a.5.5 0 0 1-.496.868l-3.5-2A.5.5 0 0 1 7 9V3.5a.5.5 0 0 1 .5-.5"/></svg></span><span className="db-refresh-copy"><span>SYNC EM:</span><b>{format(left)}</b></span></div>,host);
}
