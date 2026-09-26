'use client';

import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import styles from './pwa.module.css';

type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
const InstallContext=createContext<{event:InstallEvent|null;installed:boolean;ready:boolean;clear:()=>void}>({event:null,installed:false,ready:false,clear:()=>{}});

// Online-only: no service worker, response cache, background sync or auth changes.
export function PwaProvider({children}:{children:ReactNode}){
  const [event,setEvent]=useState<InstallEvent|null>(null);
  const [installed,setInstalled]=useState(false);
  const [offline,setOffline]=useState(false);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const display=window.matchMedia('(display-mode: standalone)');
    const mode=()=>setInstalled(display.matches||!!(navigator as Navigator&{standalone?:boolean}).standalone);
    const connection=()=>setOffline(!navigator.onLine);
    const available=(e:Event)=>{e.preventDefault();setEvent(e as InstallEvent)};
    const completed=()=>{setInstalled(true);setEvent(null)};
    mode();connection();setReady(true);
    window.addEventListener('beforeinstallprompt',available);
    window.addEventListener('appinstalled',completed);
    window.addEventListener('online',connection);window.addEventListener('offline',connection);
    display.addEventListener('change',mode);
    return ()=>{
      window.removeEventListener('beforeinstallprompt',available);
      window.removeEventListener('appinstalled',completed);
      window.removeEventListener('online',connection);window.removeEventListener('offline',connection);
      display.removeEventListener('change',mode);
    };
  },[]);
  return <InstallContext.Provider value={{event,installed,ready,clear:()=>setEvent(null)}}>
    {children}
    {offline&&<div className={styles.offline} role="status">Sem conexão. Este aplicativo precisa de internet. Reconecte antes de salvar ou atualizar dados.</div>}
  </InstallContext.Provider>;
}

export function PwaInstall(){
  const {event,installed,ready,clear}=useContext(InstallContext);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  function help(){dialog.current?.showModal()}
  async function install(){
    if(busy)return;
    if(!event){setMessage('');help();return;}
    setBusy(true);setMessage('');
    try{
      await event.prompt();
      const choice=await event.userChoice;
      setMessage(choice.outcome==='accepted'?'Instalação confirmada no navegador. Procure o ícone OH Analytics no seu dispositivo.':'Instalação cancelada. Você pode continuar usando o site normalmente.');
    }catch{setMessage('Não foi possível abrir a instalação. Use a opção de instalar aplicativo no menu do navegador.');}
    finally{clear();setBusy(false);help()}
  }
  if(!ready||installed)return null;
  return <>
    <button className={styles.headerButton} type="button" disabled={busy} onClick={()=>void install()}><span aria-hidden="true">↓</span> {busy?'Aguardando…':'Instalar aplicativo'}</button>
    <dialog ref={dialog} className={styles.help} aria-labelledby="pwa-title">
      <h2 id="pwa-title">Instalar aplicativo</h2>
      {message&&<p role="status">{message}</p>}
      <p>Abra o OH Analytics em uma janela própria, com os mesmos dados e funções do site. Requer internet.</p>
      <p>No Chrome ou Edge, procure <strong>Instalar aplicativo</strong> na barra de endereço ou no menu do navegador. Se já instalou, abra pelo ícone OH Analytics.</p>
      <p>No iPhone ou iPad: Safari → Compartilhar → Adicionar à Tela de Início. No Android: procure Instalar aplicativo ou Adicionar à tela inicial no menu.</p>
      <p>A instalação é opcional. A disponibilidade depende do navegador.</p>
      <button type="button" autoFocus onClick={()=>dialog.current?.close()}>Fechar</button>
    </dialog>
  </>;
}
