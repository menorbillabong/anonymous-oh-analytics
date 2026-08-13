'use client';
import {useEffect,useRef} from 'react';
import {supabase} from '@/lib/supabase';

function applyColors(s:any){
  const r=document.documentElement;
  r.style.setProperty('--aoh-accent',s?.accent_color||'#f6ad55');
  r.style.setProperty('--aoh-bg',s?.background_color||'#101010');
  r.style.setProperty('--aoh-surface',s?.surface_color||'#1e1e1e');
  r.style.setProperty('--aoh-border',s?.border_color||'#303030');
}

export default function SettingsPersistenceSync(){
  const uid=useRef('');
  const last=useRef('');

  useEffect(()=>{
    let stopped=false;
    supabase.auth.getSession().then(async({data})=>{
      const id=data.session?.user.id||'';
      if(!id||stopped)return;
      uid.current=id;
      const{data:s}=await supabase.from('user_settings').select('*').eq('user_id',id).maybeSingle();
      applyColors(s||{});
      const value=String(Math.max(1,Number(s?.monthly_post_goal||60)));
      localStorage.setItem(`aoh:monthly-goal:${id}`,value);
      last.current=value;
    });

    const goalTimer=setInterval(async()=>{
      const id=uid.current;
      if(!id)return;
      const value=String(Math.max(1,Number(localStorage.getItem(`aoh:monthly-goal:${id}`)||60)));
      if(value!==last.current){
        last.current=value;
        await supabase.from('user_settings').update({monthly_post_goal:Number(value),updated_at:new Date().toISOString()}).eq('user_id',id);
      }
    },1200);

    return()=>{
      stopped=true;
      clearInterval(goalTimer);
    };
  },[]);

  return null;
}
