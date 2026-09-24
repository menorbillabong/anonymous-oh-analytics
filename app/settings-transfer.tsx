'use client';

import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {supabase} from '@/lib/supabase';
import {buildSettingsPreset,parseSettingsPreset,portableSettings,PRESET_MAX_BYTES,PRESET_MAX_MISSIONS} from '@/lib/settings-preset';
import type {SiteLanguage} from '@/lib/i18n';
import type {Settings} from './full-settings';

const copy = {
  'pt-BR': {
    title:'▣ Gestão de Dados',help:'Exporte as configurações e os perfis de missão. Perfis com o mesmo nome e rede já existentes serão mantidos, sem duplicar.',
    permission:'O nome da sua conta será mantido. “Esta é uma missão especial” só será mantida se a conta que recebe tiver essa permissão. Permissões e publicações não são transferidas.',
    download:'⇩ Download',upload:'⇧ Carregar',busy:'Processando…',
    confirm:'Aplicar as configurações e adicionar os perfis de missão deste arquivo à conta atual? Os perfis já existentes não serão alterados.',
    invalid:'Arquivo inválido ou grande demais. Exporte um novo arquivo na conta de origem.',
    exportError:'Não foi possível exportar todos os perfis. Nenhum arquivo incompleto foi baixado.',
    importError:'Não foi possível confirmar a importação. Confira sua conexão e tente novamente; os perfis já existentes não serão duplicados.',
    session:'A conta mudou ou a sessão expirou. Entre novamente antes de continuar.',
    success:'Configurações importadas.',added:'Perfis adicionados',existing:'Perfis já existentes, mantidos sem alteração',unmarked:'Perfis importados sem marcar missão especial por falta de permissão',
    legacy:'Este arquivo antigo não contém perfis de missão. Para transferi-los, faça um novo download na conta de origem.',
  },
  en: {
    title:'▣ Data management',help:'Export settings and mission profiles. Existing profiles with the same name and network will be kept, without duplicates.',
    permission:'Your account name will be kept. “This is a special mission” is kept only if the receiving account has permission. Permissions and posts are not transferred.',
    download:'⇩ Download',upload:'⇧ Import',busy:'Processing…',
    confirm:'Apply settings and add the mission profiles in this file to the current account? Existing profiles will not be changed.',
    invalid:'Invalid or oversized file. Export a new file from the source account.',
    exportError:'Could not export all profiles. No incomplete file was downloaded.',
    importError:'Could not confirm the import. Check your connection and try again; existing profiles will not be duplicated.',
    session:'The account changed or the session expired. Sign in again before continuing.',
    success:'Settings imported.',added:'Profiles added',existing:'Existing profiles kept unchanged',unmarked:'Profiles imported without the special mission flag because permission is missing',
    legacy:'This older file does not contain mission profiles. Download a new file from the source account to transfer them.',
  },
  es: {
    title:'▣ Gestión de datos',help:'Exporta la configuración y los perfiles de misión. Los perfiles existentes con el mismo nombre y red se conservarán, sin duplicados.',
    permission:'El nombre de tu cuenta se conservará. “Esta es una misión especial” solo se conserva si la cuenta de destino tiene permiso. Los permisos y las publicaciones no se transfieren.',
    download:'⇩ Descargar',upload:'⇧ Cargar',busy:'Procesando…',
    confirm:'¿Aplicar la configuración y añadir los perfiles de misión de este archivo a la cuenta actual? Los perfiles existentes no se modificarán.',
    invalid:'Archivo inválido o demasiado grande. Exporta un archivo nuevo desde la cuenta de origen.',
    exportError:'No se pudieron exportar todos los perfiles. No se descargó ningún archivo incompleto.',
    importError:'No se pudo confirmar la importación. Revisa tu conexión e inténtalo de nuevo; los perfiles existentes no se duplicarán.',
    session:'La cuenta cambió o la sesión caducó. Inicia sesión de nuevo antes de continuar.',
    success:'Configuración importada.',added:'Perfiles añadidos',existing:'Perfiles existentes conservados sin cambios',unmarked:'Perfiles importados sin marcar misión especial por falta de permiso',
    legacy:'Este archivo antiguo no contiene perfiles de misión. Descarga un archivo nuevo desde la cuenta de origen para transferirlos.',
  },
};

export function SettingsTransfer({uid,settings,goal,language,onImported}:{uid:string;settings:Settings;goal:number;language:SiteLanguage;onImported:(settings:Settings)=>void}) {
  const fileRef=useRef<HTMLInputElement>(null),working=useRef(false),alive=useRef(true),owner=useRef(uid);
  owner.current=uid;
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const t=copy[language];
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  async function checkSession(){
    const {data,error}=await supabase.auth.getUser();
    if(error||data.user?.id!==uid||owner.current!==uid||!alive.current)throw new Error('SESSION_CHANGED');
  }
  function start(){if(working.current)return false;working.current=true;setBusy(true);setMessage('');return true;}
  function finish(){working.current=false;if(alive.current)setBusy(false);}
  async function download(){
    if(!start())return;
    try{
      await checkSession();
      const missions:unknown[]=[];
      // Supabase caps response rows; page explicitly so exports cannot silently truncate.
      for(let offset=0;offset<=PRESET_MAX_MISSIONS;offset+=500){
        const {data,error}=await supabase.from('mission_profiles')
          .select('name,network,description,multiplier,reward,submission_limit,color,active,is_special')
          .eq('user_id',uid).order('id',{ascending:true}).range(offset,offset+499);
        if(error||!data)throw new Error('EXPORT_FAILED');
        missions.push(...data);
        if(missions.length>PRESET_MAX_MISSIONS)throw new Error('EXPORT_FAILED');
        if(data.length<500)break;
      }
      const payload=buildSettingsPreset(settings,goal,language,missions);
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
      if(blob.size>PRESET_MAX_BYTES)throw new Error('EXPORT_FAILED');
      await checkSession();
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='perfil-anonymous-oh-config.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){if(alive.current)setMessage(error instanceof Error&&error.message==='SESSION_CHANGED'?t.session:t.exportError)}
    finally{finish()}
  }
  async function upload(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value='';
    if(!file||!start())return;
    let committed=false;
    try{
      if(file.size>PRESET_MAX_BYTES)throw new Error('INVALID_PRESET');
      let parsed;
      try{parsed=parseSettingsPreset(JSON.parse(await file.text()))}catch{throw new Error('INVALID_PRESET')}
      if(!window.confirm(t.confirm))return;
      await checkSession();
      const {data,error}=await supabase.rpc('import_my_settings_preset',{p_settings:parsed.settings,p_missions:parsed.missions});
      if(error||!data?.settings)throw new Error('IMPORT_FAILED');
      committed=true;
      if(!alive.current||owner.current!==uid)return;
      // Use the destination's persisted name, never a file value or an unsaved edit.
      const next={...settings,...portableSettings(data.settings),app_name:data.settings.app_name,profile_name_confirmed:data.settings.profile_name_confirmed} as Settings;
      setMessage([t.success,`${t.added}: ${data.imported_count}.`,`${t.existing}: ${data.existing_count}.`,
        data.special_unmarked_count?`${t.unmarked}: ${data.special_unmarked_count}.`:'',parsed.legacy?t.legacy:''].filter(Boolean).join(' '));
      onImported(next);
    }catch(error){
      if(alive.current&&!committed)setMessage(error instanceof Error&&error.message==='SESSION_CHANGED'?t.session:error instanceof Error&&error.message==='INVALID_PRESET'?t.invalid:t.importError);
    }finally{finish()}
  }
  return <article aria-busy={busy} data-testid="settings-transfer">
    <h3>{t.title}</h3><p>{t.help}</p><p>{t.permission}</p>
    <div><button disabled={busy} onClick={download}>{t.download}</button><button disabled={busy} onClick={()=>fileRef.current?.click()}>{t.upload}</button></div>
    <input aria-label={t.upload} hidden ref={fileRef} type="file" accept=".json,application/json" onChange={upload}/>
    {busy&&<p role="status">{t.busy}</p>}{message&&<p role="status" aria-live="polite">{message}</p>}
  </article>;
}
