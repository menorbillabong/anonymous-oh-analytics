'use client';

import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';
import {SHEET_DESIGNS,type SheetDesignId} from '@/lib/sheet-designs';
import './x-import-controls.css';
import './sheet-design-controls.css';

type Preview={fingerprint:string;tabName:string;normalCount:number;specialCount:number;capacity:number;discardedCells:number};
type Result={verified:boolean};
type BackupInfo={createdAt:string;expiresAt:string;tabName:string};

export default function SheetDesignControls({userId,disabled,onBusyChange}:{userId:string;disabled:boolean;onBusyChange:(busy:boolean)=>void}){
  const [open,setOpen]=useState(false);
  const [design,setDesign]=useState<SheetDesignId>('design-1');
  const [preview,setPreview]=useState<Preview|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [messageError,setMessageError]=useState(false);
  const [backupLoaded,setBackupLoaded]=useState(false);
  const [backupAction,setBackupAction]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const [uncertain,setUncertain]=useState(false);
  const [backupPanel,setBackupPanel]=useState(false);
  const [backup,setBackup]=useState<BackupInfo|null>(null);
  const [restoreFingerprint,setRestoreFingerprint]=useState('');
  const [restoreConfirmed,setRestoreConfirmed]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),gear=useRef<HTMLButtonElement>(null),lock=useRef(false);
  useEffect(()=>{if(open){const node=dialog.current;node?.showModal();return()=>{node?.close();gear.current?.focus()}}},[open]);

  function show(){setPreview(null);setConfirmed(false);setMessage('');setResult(null);setUncertain(false);setBackupPanel(false);setBackup(null);setRestoreFingerprint('');setRestoreConfirmed(false);setOpen(true)}
  async function runBackup(action:'status'|'save'|'preview'|'restore'){
    if(lock.current||disabled||(action==='restore'&&(!restoreConfirmed||!restoreFingerprint||!backup)))return;
    lock.current=true;setBusy(true);onBusyChange(true);setMessage('');setMessageError(false);setBackupAction(action);
    if(action==='status'){setBackup(null);setBackupLoaded(false);setRestoreFingerprint('');setRestoreConfirmed(false);}
    let submitted=false;
    try{
      const {data:{session}}=await supabase.auth.getSession();if(!session||session.user.id!==userId)throw new Error('Sua sessão mudou. Entre novamente.');
      const write=action==='save'||action==='restore';submitted=action==='restore';
      const response=await fetch(`/api/google-sheets/backup${action==='preview'?'?preview=restore':''}`,{method:write?'POST':'GET',cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,...(write?{'Content-Type':'application/json'}:{})},...(write?{body:JSON.stringify({action,confirm:restoreConfirmed,fingerprint:restoreFingerprint,backupCreatedAt:backup?.createdAt})}:{})});
      const data=await response.json();if(!response.ok){submitted=Boolean(data.checkSheet);throw new Error(data.error||'Não foi possível acessar o backup.');}
      if(action==='restore'){setRestoreFingerprint('');setRestoreConfirmed(false);setPreview(null);setMessage('O Google confirmou a restauração na mesma aba. Confira sua planilha antes de continuar.');}
      else{setBackup(data.backup);setBackupLoaded(true);setRestoreFingerprint(data.fingerprint||'');setRestoreConfirmed(false);if(action==='save')setMessage('Backup salvo com sucesso no site por 7 dias. Você já pode conferir a restauração abaixo. Nenhuma aba foi criada no Sheets.');}
    }catch(error){setMessageError(true);if(submitted)setUncertain(true);setMessage(submitted?'Confira a aba antes de tentar restaurar novamente; a resposta foi interrompida.':error instanceof Error?error.message:'Falha no backup.');}
    finally{lock.current=false;setBusy(false);setBackupAction('');onBusyChange(false);if(action==='restore')window.dispatchEvent(new Event('sheets-cooldown-changed'));}
  }
  async function run(apply:boolean){
    if(lock.current||disabled||(apply&&(!preview||!confirmed||uncertain)))return;
    lock.current=true;setBusy(true);onBusyChange(true);setMessage('');setMessageError(false);
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
      setMessageError(true);
      if(submitted){setUncertain(true);setPreview(null);setMessage('A resposta foi interrompida. Confira sua aba cadastrada antes de tentar novamente.')}
      else setMessage(error instanceof Error?error.message:'Não foi possível concluir.');
    }finally{lock.current=false;setBusy(false);onBusyChange(false);if(apply)window.dispatchEvent(new Event('sheets-cooldown-changed'))}
  }

  return <>
    <button ref={gear} data-appearance-button="sheets" className="sheets-sync-button sheets-adjustment-gear" type="button" aria-label="Escolher modelo da planilha" title="Escolher modelo da planilha" disabled={disabled||busy} onClick={show}>⚙</button>
    {open&&typeof document!=='undefined'&&createPortal(<dialog ref={dialog} className="x-handle-dialog sheet-design-dialog" aria-labelledby="sheet-design-title" onCancel={event=>{event.preventDefault();if(!busy)setOpen(false)}}>
      <header><h2 id="sheet-design-title">{backupPanel?'Backup da planilha':'Modelo da planilha'}</h2><button type="button" aria-label="Fechar modelos" disabled={busy} onClick={()=>setOpen(false)}>×</button></header>
      {message&&<div className={`sheet-operation-message ${messageError?'error':'success'}`} role={messageError?'alert':'status'}><strong>{messageError?'Operação não concluída':'Operação concluída'}</strong><p>{message}</p></div>}
      {backupPanel?<section aria-label="Backup da planilha">
        <p>Uma única cópia da aba cadastrada fica guardada no site por 7 dias. Criar outra substitui a anterior somente depois de salvar com sucesso. Nenhuma aba extra é criada no Sheets.</p>
        {backup?<p className="sheet-backup-summary"><strong>✓ Backup disponível</strong><br/>Aba: <strong>{backup.tabName}</strong><br/>Criado em {new Date(backup.createdAt).toLocaleString('pt-BR')}<br/>Válido até {new Date(backup.expiresAt).toLocaleString('pt-BR')}</p>:<p>{backupAction==='status'?'Consultando backup…':backupLoaded?'Não há backup válido para a aba cadastrada.':'Não foi possível confirmar se há um backup salvo.'}</p>}
        {!uncertain&&<div className="sheet-backup-actions"><button className="x-handle-save" disabled={busy||disabled} onClick={()=>void runBackup('save')}>{backupAction==='save'?'SALVANDO BACKUP…':backup?'SUBSTITUIR BACKUP':'CRIAR BACKUP'}</button><button disabled={busy||disabled||!backup} onClick={()=>void runBackup('preview')}>{backupAction==='preview'?'CONFERINDO…':'RESTAURAR BACKUP…'}</button></div>}
        {!backup&&<p>Restaurar fica disponível após salvar um backup com sucesso.</p>}
        {restoreFingerprint&&!uncertain&&<div className="sheet-design-confirm"><p>Restaurar substitui o conteúdo e o visual atuais desta aba pelos do backup. Alterações posteriores ao backup serão perdidas.</p><label><input type="checkbox" checked={restoreConfirmed} onChange={event=>setRestoreConfirmed(event.target.checked)} disabled={busy}/><span>Confirmo a restauração da aba {backup?.tabName}.</span></label><button className="x-handle-save" disabled={busy||disabled||!restoreConfirmed} onClick={()=>void runBackup('restore')}>RESTAURAR BACKUP</button></div>}
      </section>:result?<div role="status">
        <h3>{result.verified?'Modelo aplicado e dados conferidos':'Modelo aplicado — confira a planilha'}</h3>
        <p>{result.verified?'A aba manteve seu nome e vínculo com o site.':'O Google confirmou a aplicação, mas não foi possível conferir todos os dados. Não reaplique antes de conferir.'}</p>
        <p>Nenhuma aba extra foi criada. O backup manual, se você o criou, continua disponível no site até vencer.</p>
      </div>:<>
        <p>Escolha um dos quatro modelos para transformar sua aba atual, mantendo o nome e o vínculo com o site.</p>
        <fieldset disabled={busy||uncertain} className="sheet-design-options"><legend>Modelo desejado</legend>{SHEET_DESIGNS.map(item=><label key={item.id} className={design===item.id?'selected':''}>
          <input type="radio" name="sheet-design" value={item.id} checked={design===item.id} onChange={()=>{setDesign(item.id);setPreview(null);setConfirmed(false);setMessage('')}}/>
          <span className="sheet-design-swatch" style={{background:item.color}} aria-hidden="true"/>
          <span><strong>{item.title}</strong><small>{item.description}</small></span>
        </label>)}</fieldset>
        <p>As fórmulas e o visual serão substituídos pelos do modelo. Os dados de perfil e publicações reconhecidos serão preservados. Colunas extras e personalizações fora do modelo serão removidas. Use BACKUP antes de aplicar se quiser guardar a versão atual por 7 dias. Não há backup automático. Evite editar a aba no Sheets durante a aplicação.</p>
        {preview&&<div className="sheet-design-confirm">
          <strong>Aba: {preview.tabName}</strong>
          <p>{preview.normalCount} publicações normais e {preview.specialCount} especiais identificadas.</p>
          {!!preview.discardedCells&&<p>{preview.discardedCells} células com dados extras fora das colunas reconhecidas serão removidas.</p>}
          <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>Confirmo a substituição do visual, fórmulas e colunas extras nesta aba, sem criar backup automático.</span></label>
        </div>}
        {!preview&&!uncertain&&<p>Etapa 1 de 2: confira o modelo. O botão Aplicar será liberado somente se a conferência terminar sem erros.</p>}
      </>}
      <footer>{!backupPanel?<button type="button" className="x-handle-save" disabled={busy||disabled} onClick={()=>{setBackupPanel(true);setMessage('');void runBackup('status')}}>BACKUP</button>:<button type="button" disabled={busy} onClick={()=>{setBackupPanel(false);setMessage('');setPreview(null);setConfirmed(false)}}>VOLTAR</button>}
        <button type="button" disabled={busy} onClick={()=>setOpen(false)}>{result||uncertain?'FECHAR':'CANCELAR'}</button>
        {!backupPanel&&!result&&!uncertain&&<button type="button" className="x-handle-save" disabled={busy||disabled||(!!preview&&!confirmed)} onClick={()=>void run(!!preview)}>{busy?'AGUARDE...':preview?'APLICAR À ABA ATUAL':'CONFERIR SEM ALTERAR'}</button>}
      </footer>
    </dialog>,document.body)}
  </>;
}
