'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import './profile-name-gate.css';

export default function ProfileNameGate({userId,open,initialName,onSaved}:{userId:string;open:boolean;initialName:string;onSaved:(name:string)=>void}){
 const[name,setName]=useState(initialName);
 const[busy,setBusy]=useState(false);
 const[message,setMessage]=useState('');

 useEffect(()=>{if(open){setName(initialName);setMessage('')}},[open,initialName]);

 async function save(){
  const clean=name.trim();
  if(clean.length<2||clean.length>40){setMessage('Escolha um nome entre 2 e 40 caracteres.');return}
  setBusy(true);setMessage('');
  const{error}=await supabase.from('user_settings').upsert({user_id:userId,app_name:clean,profile_name_confirmed:true,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  setBusy(false);
  if(error){setMessage('Não foi possível salvar o nome agora. Tente novamente.');return}
  onSaved(clean);
 }
 if(!open)return null;
 return <div className="profile-gate-overlay" role="presentation">
  <section className="profile-gate-card" role="dialog" aria-modal="true" aria-labelledby="profile-gate-title">
   <div className="profile-gate-mark">◉</div>
   <small>PRIMEIRO ACESSO</small>
   <h1 id="profile-gate-title">Escolha o nome do seu perfil</h1>
   <p>Esse nome será exibido no painel e na classificação. Você poderá alterá-lo depois nas configurações.</p>
   <label htmlFor="profile-gate-name">Nome do perfil</label>
   <input id="profile-gate-name" autoFocus maxLength={40} value={name} onChange={event=>{setName(event.target.value);setMessage('')}} onKeyDown={event=>{if(event.key==='Enter'&&!busy)void save()}} placeholder="Digite o nome que deseja usar" autoComplete="nickname"/>
   <div className="profile-gate-count">{name.trim().length}/40</div>
   {message&&<div className="profile-gate-message" role="alert">{message}</div>}
   <button type="button" disabled={busy||name.trim().length<2} onClick={save}>{busy?'SALVANDO...':'CONTINUAR PARA O PAINEL'}</button>
   <span className="profile-gate-note">É necessário escolher um nome para continuar.</span>
  </section>
 </div>
}
