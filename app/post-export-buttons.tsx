'use client';
import {useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {buildPostsCsv,buildPostsTxt} from '@/lib/csv-export';
import {exportMessages,loadCurrentPeriodExport} from '@/lib/current-period-export';
import {normalizeLanguage,translateUiText} from '@/lib/i18n';

export default function PostExportButtons({userId}:{userId:string}){
 const lock=useRef(false);
 const [busy,setBusy]=useState(false);
 async function download(format:'csv'|'txt'){
  if(lock.current)return;
  lock.current=true;
  setBusy(true);
  try{
   const {posts,manualLikes}=await loadCurrentPeriodExport(supabase,userId);
   const output=format==='csv'?buildPostsCsv(posts,manualLikes):buildPostsTxt(posts,manualLikes);
   const url=URL.createObjectURL(new Blob(['\ufeff'+output],{type:format==='csv'?'text/csv;charset=utf-8':'text/plain;charset=utf-8'}));
   const link=document.createElement('a');
   link.href=url;
   link.download=`publicacoes-periodo-atual.${format}`;
   document.body.appendChild(link);
   link.click();
   link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){
   const message=error instanceof Error&&Object.values(exportMessages).includes(error.message)?error.message:exportMessages.failed;
   window.alert(translateUiText(message,normalizeLanguage(document.documentElement.lang)));
  }finally{
   lock.current=false;
   setBusy(false);
  }
 }
 return <div className="split-btn" aria-busy={busy}>
  <button type="button" disabled={busy} title="Exportar período atual em TXT com tabulações para o Google Sheets" onClick={()=>void download('txt')}>TXT</button>
  <button type="button" disabled={busy} title="Exportar período atual em CSV" onClick={()=>void download('csv')}>CSV</button>
 </div>;
}
