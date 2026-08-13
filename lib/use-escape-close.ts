import { useEffect } from 'react';
export function useEscapeClose(open:boolean,onClose:()=>void){useEffect(()=>{if(!open)return;const h=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h)},[open,onClose])}
