'use client';

import { useEffect, useState } from 'react';
import Dashboard from './dashboard';
import DatabaseRefreshTimer from './database-refresh-timer';
import ReferencePreviewInjector from './reference-preview-injector';
import { supabase } from '@/lib/supabase';
import './globals.css';
import './auth.css';

type Mode = 'login' | 'signup' | 'migrate';

async function usernameAuth(action:'resolve'|'signup'|'migrate',username:string,password?:string,email?:string) {
  const {data,error}=await supabase.functions.invoke('username-auth',{body:{action,username,password,email}});
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
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [passwordConfirmation,setPasswordConfirmation]=useState('');
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
    if(mode==='migrate'&&!email.trim())return setMessage('Preencha o e-mail do cadastro antigo.');
    if(!/^[a-z0-9._-]{3,24}$/.test(normalized))return setMessage('Use de 3 a 24 caracteres: letras, números, ponto, traço ou sublinhado.');
    if(password.length<6)return setMessage('A senha precisa ter pelo menos 6 caracteres.');
    if(mode==='signup'&&password!==passwordConfirmation)return setMessage('As senhas não são iguais.');
    setBusy(true);
    try{
      const action=mode==='login'?'resolve':mode==='signup'?'signup':'migrate';
      const credentials=await usernameAuth(action,username.trim(),mode==='login'?undefined:password,mode==='migrate'?email.trim():undefined);
      const result=await supabase.auth.signInWithPassword({email:credentials.email,password});
      if(result.error)throw new Error(mode==='login'?'Usuário ou senha incorretos.':mode==='signup'?'Conta criada, mas não foi possível entrar.':'Cadastro migrado, mas não foi possível entrar.');
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível concluir a solicitação.')}
    finally{setBusy(false)}
  }

  if(loading)return <div className="auth-loading">ANONIMOUS_OH Analytics</div>;
  if(session)return <><Dashboard session={session}/><DatabaseRefreshTimer/><ReferencePreviewInjector/></>;

  return <main className="auth-shell">
    <header className="auth-topbar">
      <strong>AVALIAÇÃO DE MÉTRICAS</strong>
      <span><i/> ANONYMOUS_OH</span>
    </header>
    <div className="auth-stage"><section className="auth-card">
      <div className="auth-intro">
        <div className="auth-brand"><span className="auth-dot"/>ANONYMOUS_OH</div>
        <p className="auth-kicker">ANALYTICS V2</p>
        <h1>Transforme<br/>métricas em <span>crescimento.</span></h1>
        <p className="auth-copy">Analise suas publicações, acompanhe o cálculo das missões e gerencie sua performance em um único painel.</p>
        <div className="auth-summary">
          <div><small>PAINEL</small><b>Métricas em tempo real</b></div>
          <div><small>MISSÕES</small><b>Progresso organizado</b></div>
        </div>
      </div>
      <div className="auth-form-panel">
        <small className="auth-form-kicker">{mode==='login'?'ACESSO AO PAINEL':mode==='signup'?'NOVA CONTA':'CADASTRO ANTIGO'}</small>
        <h2>{mode==='login'?'Entrar':mode==='signup'?'Criar conta':'Migrar cadastro'}</h2>
        <p>{mode==='login'?'Use seu nome de usuário e sua senha.':mode==='signup'?'Escolha seu nome de usuário e uma senha segura.':'Informe o e-mail antigo e escolha seu nome de usuário.'}</p>
        <form onSubmit={submit}>
          {mode==='migrate'&&<>
            <label>E-mail do cadastro antigo</label>
            <input value={email} onChange={event=>setEmail(event.target.value)} type="email" autoComplete="email" placeholder="Seu e-mail antigo"/>
          </>}
          <label>{mode==='migrate'?'Novo nome de usuário':'Nome de usuário'}</label>
          <input value={username} onChange={event=>setUsername(event.target.value)} type="text" autoComplete="username" maxLength={24} placeholder="Seu nome de usuário"/>
          <label>Senha (mínimo 6 caracteres)</label>
          <input value={password} onChange={event=>setPassword(event.target.value)} type="password" autoComplete={mode==='login'?'current-password':'new-password'} placeholder="••••••••"/>
          {mode==='signup'&&<>
            <label>Confirmar senha</label>
            <input value={passwordConfirmation} onChange={event=>setPasswordConfirmation(event.target.value)} type="password" autoComplete="new-password" placeholder="••••••••"/>
          </>}
          <button type="submit" disabled={busy}>{busy?'AGUARDE...':mode==='login'?'ENTRAR':mode==='signup'?'CRIAR CONTA':'MIGRAR E ENTRAR'}</button>
        </form>
        {message&&<div className="auth-message">{message}</div>}
        {mode==='login'?<>
          <button className="auth-switch" disabled={busy} onClick={()=>{setMode('signup');setMessage('');setEmail('');setPassword('');setPasswordConfirmation('')}}>Não tem uma conta? Criar conta</button>
          <button className="auth-switch" disabled={busy} onClick={()=>{setMode('migrate');setMessage('');setEmail('');setPassword('');setPasswordConfirmation('')}}>Possui cadastro antigo? Migrar acesso</button>
        </>:<button className="auth-switch" disabled={busy} onClick={()=>{setMode('login');setMessage('');setEmail('');setPassword('');setPasswordConfirmation('')}}>Já tem um nome de usuário? Entrar</button>}
      </div>
    </section></div>
  </main>;
}
