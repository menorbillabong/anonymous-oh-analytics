'use client';
import {useEffect} from 'react';
import RefreshCountdown from './refresh-countdown';

export default function SimpleRefreshCounter(){
 useEffect(()=>{
  const reveal=()=>document.querySelectorAll('.refresh-countdown-host [title="Tempo restante para a próxima atualização"]').forEach(el=>el.removeAttribute('title'));
  reveal();
  const observer=new MutationObserver(reveal);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['title']});
  return()=>observer.disconnect();
 },[]);
 return <RefreshCountdown/>;
}
