'use client';

import { useEffect, useState } from 'react';
import Dashboard from './dashboard';
import DatabaseRefreshTimer from './database-refresh-timer';
import ReferencePreviewInjector from './reference-preview-injector';
import { supabase } from '@/lib/supabase';
import './globals.css';
import './auth.css';

type Mode = 'login' | 'signup';

async function usernameAuth(action:'resolve'|'signup',username:string,password?:string) {
  const {data,error}=await supabase.functions.invoke('username-auth',{body:{action,username,password}});
  if(error){
    let message='Não foi possível concluir a solicitação.';
    try{const payload=await (error as any).context?.json();if(payload?.error)message=payload.error}catch{}
    throw new Error(message);
  }
  if(data?.error)throw new Error(data.error);
  return data as {email:string;username?:string};
}

export default function Home() {
  const [loading,setLoading]=useState(true);
  const [session,setSession]=useState<any>(null);
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [mode,setMode]=useState<Mode>('login');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    let active=true;
    supabase.auth.getSession().then(({data})=>{if(active){setSession(data.session);setLoading(false)}});
    const{data:listener}=supabase.auth.onAuthStateChange((_event,nextSession)=>setSession(nextSession));
    return()=>{active=false;listener.subscription.unsubscribe()};
  },[]);

  async function submit(event:React.FormEvent){
    event.preventDefault();
    setMessage('');
    const normalized=username.trim().toLowerCase();
    if(!normalized||!password)return setMessage('Preencha o nome de usuário e a senha.');
    if(!/^[a-z0-9._-]{3,24}$/.test(normalized))return setMessage('Use de 3 a 24 caracteres: letras, números, ponto, traço ou sublinhado.');
    if(password.length<6)return setMessage('A senha precisa ter pelo menos 6 caracteres.');
    setBusy(true);
    try{
      const credentials=await usernameAuth(mode==='login'?'resolve':'signup',username.trim(),mode==='signup'?password:undefined);
      const result=await supabase.auth.signInWithPassword({email:credentials.email,password});
      if(result.error)throw new Error(mode==='login'?'Usuário ou senha incorretos.':'Conta criada, mas não foi possível entrar.');
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível concluir a solicitação.')}
    finally{setBusy(false)}
  }

  if(loading)return <div className="auth-loading">ANONIMOUS_OH Analytics</div>;
  if(session)return <><Dashboard session={session}/><DatabaseRefreshTimer/><ReferencePreviewInjector/></>;

  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-brand"><span className="auth-dot"/>ANONIMOUS_OH</div>
    <p className="auth-kicker">ANALYTICS V2</p>
    <h1>Transforme<br/>métricas em <span>crescimento.</span></h1>
    <p className="auth-copy">Analise suas publicações, acompanhe o cálculo das missões e gerencie sua performance em um único painel.</p>
    <form onSubmit={submit}>
      <label>Nome de usuário</label>
      <input value={username} onChange={event=>setUsername(event.target.value)} type="text" autoComplete="username" maxLength={24} placeholder="Seu nome de usuário"/>
      <label>Senha (mínimo 6 caracteres)</label>
      <input value={password} onChange={event=>setPassword(event.target.value)} type="password" autoComplete={mode==='login'?'current-password':'new-password'} placeholder="••••••••"/>
      <button type="submit" disabled={busy}>{busy?'AGUARDE...':mode==='login'?'ENTRAR':'CRIAR CONTA'}</button>
    </form>
    {message&&<div className="auth-message">{message}</div>}
    <button className="auth-switch" disabled={busy} onClick={()=>{setMode(mode==='login'?'signup':'login');setMessage('');setPassword('')}}>
      {mode==='login'?'Não tem uma conta? Criar conta':'Já tem uma conta? Entrar'}
    </button>
  </section></main>;
}
