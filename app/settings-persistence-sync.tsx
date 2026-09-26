'use client';
import {useEffect,useRef} from 'react';
import {supabase} from '@/lib/supabase';
import VideoThumbnailEnhancer from './video-thumbnail-enhancer';
import {THEME_COLOR_DEFAULTS} from '@/lib/edge-appearance';

function applyColors(s:any){const r=document.documentElement;r.style.setProperty('--aoh-accent',s?.accent_color||THEME_COLOR_DEFAULTS.accent_color);r.style.setProperty('--aoh-bg',s?.background_color||THEME_COLOR_DEFAULTS.background_color);r.style.setProperty('--aoh-surface',s?.surface_color||THEME_COLOR_DEFAULTS.surface_color);r.style.setProperty('--aoh-border',s?.border_color||THEME_COLOR_DEFAULTS.border_color)}

export default function SettingsPersistenceSync(){
 const uid=useRef(''),lastGoal=useRef('');
 useEffect(()=>{let stopped=false;supabase.auth.getSession().then(async({data})=>{const id=data.session?.user.id||'';if(!id||stopped)return;uid.current=id;const{data:s}=await supabase.from('user_settings').select('*').eq('user_id',id).maybeSingle();applyColors(s||{});const goal=String(Math.max(1,Number(s?.monthly_post_goal||60)));localStorage.setItem(`aoh:monthly-goal:${id}`,goal);lastGoal.current=goal});const goalTimer=setInterval(async()=>{const id=uid.current;if(!id)return;const goal=String(Math.max(1,Number(localStorage.getItem(`aoh:monthly-goal:${id}`)||60)));if(goal!==lastGoal.current){lastGoal.current=goal;await supabase.from('user_settings').update({monthly_post_goal:Number(goal),updated_at:new Date().toISOString()}).eq('user_id',id)}},1200);return()=>{stopped=true;clearInterval(goalTimer)}},[]);
 return <VideoThumbnailEnhancer/>;
}
