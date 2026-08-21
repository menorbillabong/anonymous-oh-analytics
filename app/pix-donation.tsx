'use client';

import Image from 'next/image';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import styles from './pix-donation.module.css';

const PIX_COPY_AND_PASTE='00020126820014BR.GOV.BCB.PIX01368e0287a5-a6c4-4505-aa76-7a630f5a0b3a0220Obrigado por apoiar 5204000053039865802BR5925JOAO FERNANDO VIEIRA SERR6011SAO GONCALO62070503***6304CC49';

export default function PixDonation(){
 const[sessionActive,setSessionActive]=useState(false);
 const[open,setOpen]=useState(false);
 const[copyStatus,setCopyStatus]=useState('');
 const triggerRef=useRef<HTMLButtonElement>(null);
 const closeRef=useRef<HTMLButtonElement>(null);
 const dialogRef=useRef<HTMLElement>(null);

 useEffect(()=>{
  let active=true;
  supabase.auth.getSession().then(({data})=>{if(active)setSessionActive(Boolean(data.session))});
  const{data:listener}=supabase.auth.onAuthStateChange((_event,session)=>{
   setSessionActive(Boolean(session));
   if(!session)setOpen(false);
  });
  return()=>{active=false;listener.subscription.unsubscribe()};
 },[]);

 useEffect(()=>{
  if(!open)return;
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  closeRef.current?.focus();
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){
    setOpen(false);
    return;
   }
   if(event.key!=='Tab'||!dialogRef.current)return;
   const focusable=Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button,summary'));
   if(!focusable.length)return;
   const first=focusable[0],last=focusable[focusable.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  };
  window.addEventListener('keydown',onKeyDown);
  return()=>{
   document.body.style.overflow=previousOverflow;
   window.removeEventListener('keydown',onKeyDown);
   triggerRef.current?.focus();
  };
 },[open]);

 async function copyPix(){
  try{
   await navigator.clipboard.writeText(PIX_COPY_AND_PASTE);
   setCopyStatus('Código Pix copiado com sucesso.');
  }catch{
   const field=document.createElement('textarea');
   field.value=PIX_COPY_AND_PASTE;
   field.style.position='fixed';
   field.style.opacity='0';
   document.body.appendChild(field);
   field.select();
   const copied=document.execCommand('copy');
   field.remove();
   setCopyStatus(copied?'Código Pix copiado com sucesso.':'Não foi possível copiar. Use o QR Code acima.');
  }
 }

 if(!sessionActive)return null;

 return <div className={styles.root}>
  <button ref={triggerRef} type="button" className={styles.trigger} onClick={()=>{setCopyStatus('');setOpen(true)}} aria-haspopup="dialog">
   <span aria-hidden="true">♥</span><b>Apoiar</b>
  </button>
  {open&&<div className={styles.backdrop}>
   <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="pix-donation-title" aria-describedby="pix-donation-description">
    <button ref={closeRef} type="button" className={styles.close} aria-label="Fechar janela de doação" onClick={()=>setOpen(false)}>×</button>
    <small>APOIE O PROJETO</small>
    <h2 id="pix-donation-title">Doação por Pix</h2>
    <p id="pix-donation-description">Escaneie o QR Code e escolha livremente o valor no aplicativo do seu banco.</p>
    <div className={styles.qrFrame}>
     <Image src="/pix/qrcode-bradesco.jpg" alt="QR Code Pix do Bradesco para doação sem valor definido" width={250} height={250} unoptimized/>
    </div>
    <button type="button" className={styles.copyButton} onClick={copyPix}><span aria-hidden="true">▣</span> Copiar Pix</button>
    <details className={styles.codeDetails}>
     <summary>Ver código Pix Copia e Cola</summary>
     <code>{PIX_COPY_AND_PASTE}</code>
    </details>
    <p className={styles.safetyNote}>Confira o nome do recebedor no seu banco antes de confirmar.</p>
    <div className={styles.copyStatus} role="status" aria-live="polite">{copyStatus}</div>
   </section>
  </div>}
 </div>;
}
