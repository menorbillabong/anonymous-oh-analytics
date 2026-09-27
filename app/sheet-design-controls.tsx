'use client';

import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';
import {SHEET_DESIGNS,type SheetDesignId} from '@/lib/sheet-designs';
import './x-import-controls.css';
import './sheet-design-controls.css';

type Preview={fingerprint:string;tabName:string;normalCount:number;specialCount:number;capacity:number};
type Result={verified:boolean;backupTitle:string;backupUrl?:string};

export default function SheetDesignControls({userId,disabled,onBusyChange}:{userId:string;disabled:boolean;onBusyChange:(busy:boolean)=>void}){
  const [open,setOpen]=useState(false);
  const [design,setDesign]=useState<SheetDesignId>('design-1');
  const [preview,setPreview]=useState<Preview|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const [uncertain,setUncertain]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),gear=useRef<HTMLButtonElement>(null),lock=useRef(false);
  useEffect(()=>{if(open){const node=dialog.current;node?.showModal();return()=>{node?.close();gear.current?.focus()}}},[open]);

  function show(){setPreview(null);setConfirmed(false);setMessage('');setResult(null);setUncertain(false);setOpen(true)}
  async function run(apply:boolean){
    if(lock.current||disabled||(apply&&(!preview||!confirmed||uncertain)))return;
    lock.current=true;setBusy(true);onBusyChange(true);setMessage('');
    let submitted=false;
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session||session.user.id!==userId)throw new Error('Sua sessão mudou. Entre novamente.');
      submitted=apply;
      const response=await fetch(`/api/google-sheets/design${apply?'':`?design=${design}`}`,{
        method:apply?'POST':'GET',cache:'no-store',
        headers:{Authorization:`Bearer ${session.access_token}`,...(apply?{'Content-Type':'application/json'}:{})},
        ...(apply?{body:JSON.stringify({design,confirm:true,fingerprint:preview!.fingerprint})}:{}),
      });
      const data=await response.json();
      if(!response.ok){
        submitted=false;setPreview(null);setConfirmed(false);setUncertain(Boolean(data.checkSheet));
        throw new Error(data.error||'Não foi possível conferir a planilha.');
      }
      if(apply){setResult(data);setPreview(null);setConfirmed(false)}
      else {setPreview(data);setConfirmed(false)}
    }catch(error){
      if(submitted){setUncertain(true);setPreview(null);setMessage('A resposta foi interrompida. Confira sua aba e a cópia Backup AOH no Sheets antes de tentar novamente.')}
      else setMessage(error instanceof Error?error.message:'Não foi possível concluir.');
    }finally{lock.current=false;setBusy(false);onBusyChange(false);if(apply)window.dispatchEvent(new Event('sheets-cooldown-changed'))}
  }

  return <>
    <button ref={gear} data-appearance-button="sheets" className="sheets-sync-button sheets-adjustment-gear" type="button" aria-label="Escolher modelo da planilha" title="Escolher modelo da planilha" disabled={disabled||busy} onClick={show}>⚙</button>
    {open&&typeof document!=='undefined'&&createPortal(<dialog ref={dialog} className="x-handle-dialog sheet-design-dialog" aria-labelledby="sheet-design-title" onCancel={event=>{event.preventDefault();if(!busy)setOpen(false)}}>
      <header><h2 id="sheet-design-title">Modelo da planilha</h2><button type="button" aria-label="Fechar modelos" disabled={busy} onClick={()=>setOpen(false)}>×</button></header>
      {result?<div role="status">
        <h3>{result.verified?'Modelo aplicado e dados conferidos':'Modelo aplicado — confira a planilha'}</h3>
        <p>{result.verified?'A aba manteve seu nome e vínculo com o site.':'O Google confirmou a aplicação, mas não foi possível conferir todos os dados. Não reaplique antes de conferir.'}</p>
        <p>Cópia de segurança: {result.backupUrl?<a href={result.backupUrl} target="_blank" rel="noreferrer">{result.backupTitle}</a>:result.backupTitle}.</p>
      </div>:<>
        <p>Escolha um dos quatro modelos para transformar sua aba atual, mantendo o nome e o vínculo com o site.</p>
        <fieldset disabled={busy||uncertain} className="sheet-design-options"><legend>Modelo desejado</legend>{SHEET_DESIGNS.map(item=><label key={item.id} className={design===item.id?'selected':''}>
          <input type="radio" name="sheet-design" value={item.id} checked={design===item.id} onChange={()=>{setDesign(item.id);setPreview(null);setConfirmed(false);setMessage('')}}/>
          <span className="sheet-design-swatch" style={{background:item.color}} aria-hidden="true"/>
          <span><strong>{item.title}</strong><small>{item.description}</small></span>
        </label>)}</fieldset>
        <p>As fórmulas e o visual serão substituídos pelos do modelo. Os dados de perfil e publicações reconhecidos serão preservados; personalizações antigas permanecerão na cópia de segurança. Evite editar a aba no Sheets durante a aplicação.</p>
        {preview&&<div className="sheet-design-confirm">
          <strong>Aba: {preview.tabName}</strong>
          <p>{preview.normalCount} publicações normais e {preview.specialCount} especiais identificadas.</p>
          <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>Confirmo a transformação desta aba. Uma cópia Backup AOH será criada antes da substituição.</span></label>
        </div>}
        {message&&<p role="alert">{message}</p>}
      </>}
      <footer><button type="button" disabled={busy} onClick={()=>setOpen(false)}>{result||uncertain?'FECHAR':'CANCELAR'}</button>
        {!result&&!uncertain&&<button type="button" className="x-handle-save" disabled={busy||disabled||(!!preview&&!confirmed)} onClick={()=>void run(!!preview)}>{busy?'AGUARDE...':preview?'APLICAR À ABA ATUAL':'CONFERIR SEM ALTERAR'}</button>}
      </footer>
    </dialog>,document.body)}
  </>;
}
