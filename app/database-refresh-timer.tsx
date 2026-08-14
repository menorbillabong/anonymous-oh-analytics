'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';

type TimerState={active:boolean;hours:number;next:string|null};
const msFor=(hours:number)=>Math.max(1,Number(hours)||.5)*3600000;
const format=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),r=s%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`};

export default function DatabaseRefreshTimer(){
 const[uid,setUid]=useState('');
 const[state,setState]=useState<TimerState>({active:false,hours:.5,next:null});
 const[left,setLeft]=useState(0);
 const[host,setHost]=useState<HTMLElement|null>(null);
 const firing=useRef(false);

 const sync=async(userId:string)=>{
  const{data}=await supabase.from('user_settings').select('show_refresh_timer,refresh_interval,last_refresh_at,next_refresh_at').eq('user_id',userId).maybeSingle();
  if(!data)return;
  const active=!!data.show_refresh_timer,hours=Number(data.refresh_interval||.5);
  let next=data.next_refresh_at as string|null;
  if(active&&!next){
   const now=new Date(),nextDate=new Date(now.getTime()+msFor(hours));
   await supabase.from('user_settings').update({last_refresh_at:now.toISOString(),next_refresh_at:nextDate.toISOString()}).eq('user_id',userId);
   next=nextDate.toISOString();
  }
  setState({active,hours,next});
 };

 useEffect(()=>{let mounted=true;supabase.auth.getSession().then(({data})=>{const id=data.session?.user.id||'';if(mounted&&id){setUid(id);sync(id)}});const{data:auth}=supabase.auth.onAuthStateChange((_e,session)=>{const id=session?.user.id||'';setUid(id);if(id)sync(id);else setState({active:false,hours:.5,next:null})});return()=>{mounted=false;auth.subscription.unsubscribe()}},[]);

 useEffect(()=>{
  const changed=async(event:Event)=>{
   if(!uid)return;
   const detail=(event as CustomEvent).detail||{},active=!!detail.active,newHours=Number(detail.hours||.5);
   const{data}=await supabase.from('user_settings').select('refresh_interval,last_refresh_at,next_refresh_at').eq('user_id',uid).maybeSingle();
   const oldHours=Number(data?.refresh_interval||newHours);
   const now=Date.now();
   if(!active){
    await supabase.from('user_settings').update({next_refresh_at:null}).eq('user_id',uid);
    setState({active:false,hours:newHours,next:null});
    return;
   }
   let start:number;
   if(data?.last_refresh_at) start=new Date(data.last_refresh_at).getTime();
   else if(data?.next_refresh_at) start=new Date(data.next_refresh_at).getTime()-msFor(oldHours);
   else start=now;
   let nextMs=start+msFor(newHours);
   if(nextMs<=now) nextMs=now;
   const lastIso=new Date(start).toISOString(),nextIso=new Date(nextMs).toISOString();
   await supabase.from('user_settings').update({last_refresh_at:lastIso,next_refresh_at:nextIso}).eq('user_id',uid);
   setState({active:true,hours:newHours,next:nextIso});
  };
  window.addEventListener('aoh:auto-refresh-changed',changed as EventListener);return()=>window.removeEventListener('aoh:auto-refresh-changed',changed as EventListener)
 },[uid]);

 useEffect(()=>{if(!state.active||!state.next){setLeft(0);return}const tick=()=>setLeft(Math.max(0,Math.ceil((new Date(state.next!).getTime()-Date.now())/1000)));tick();const id=window.setInterval(tick,1000);return()=>window.clearInterval(id)},[state.active,state.next]);

 useEffect(()=>{
  if(!uid||!state.active||!state.next||left!==0||firing.current)return;
  firing.current=true;
  const run=async()=>{const now=new Date(),next=new Date(now.getTime()+msFor(state.hours));await supabase.from('user_settings').update({last_refresh_at:now.toISOString(),next_refresh_at:next.toISOString()}).eq('user_id',uid);setState(s=>({...s,next:next.toISOString()}));const button=[...document.querySelectorAll('button')].find(b=>(b.textContent||'').toUpperCase().includes('ATUALIZAR AGORA')) as HTMLButtonElement|undefined;if(button&&!button.disabled)button.click();window.setTimeout(()=>{firing.current=false},1200)};run()
 },[uid,state.active,state.next,state.hours,left]);

 useEffect(()=>{if(!state.active){document.querySelectorAll('.db-refresh-timer-host').forEach(el=>el.remove());setHost(null);return}const attach=()=>{const nav=document.querySelector('.exact-nav');if(!nav)return;const panel=[...nav.querySelectorAll('button')].find(b=>b.textContent?.trim().includes('Painel'));if(!panel)return;let target=nav.querySelector<HTMLElement>('.db-refresh-timer-host');if(!target){target=document.createElement('div');target.className='db-refresh-timer-host';panel.insertAdjacentElement('afterend',target)}setHost(target)};attach();const obs=new MutationObserver(attach);obs.observe(document.body,{childList:true,subtree:true});return()=>{obs.disconnect();document.querySelectorAll('.db-refresh-timer-host').forEach(el=>el.remove());setHost(null)}},[state.active]);

 if(!state.active||!host)return null;
 return createPortal(<div className="db-refresh-timer" title="Atualização automática" style={{height:38,minWidth:92,padding:'0 10px',borderRadius:8,border:'1px solid #6b4b1f',background:'#21180d',color:'#f7bb55',display:'flex',alignItems:'center',justifyContent:'center',gap:7,fontWeight:900,boxSizing:'border-box'}}><span>◷</span><b style={{fontSize:11,fontVariantNumeric:'tabular-nums'}}>{format(left)}</b></div>,host);
}
