'use client';

import { useEffect, useState } from 'react';
import Dashboard from './dashboard';
import DatabaseRefreshTimer from './database-refresh-timer';
import ReferencePreviewInjector from './reference-preview-injector';
import { supabase } from '@/lib/supabase';
import './globals.css';
import './auth.css';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login'|'signup'>('login');
  const [message, setMessage] = useState('');
  useEffect(() => {supabase.auth.getSession().then(({ data }) => {setSession(data.session);setLoading(false);});const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {setSession(nextSession);});return () => listener.subscription.unsubscribe();}, []);
  async function submit(e: React.FormEvent) {e.preventDefault();setMessage('');if (!email || !password) return setMessage('Preencha e-mail e senha.');const result = mode === 'login' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });if (result.error) setMessage(result.error.message);else if (mode === 'signup' && !result.data.session) setMessage('Cadastro criado. Verifique seu e-mail para confirmar a conta.');}
  if (loading) return <div className="auth-loading">ANONIMOUS_OH Analytics</div>;
  if (session) return <><Dashboard session={session} /><DatabaseRefreshTimer/><ReferencePreviewInjector/></>;
  return (<main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="auth-dot"/>ANONIMOUS_OH</div><p className="auth-kicker">ANALYTICS V2</p><h1>Transforme<br/>métricas em <span>crescimento.</span></h1><p className="auth-copy">Analise suas publicações, acompanhe o cálculo das missões e gerencie sua performance em um único painel.</p><form onSubmit={submit}><label>Seu e-mail</label><input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Seu e-mail" /><label>Senha (mínimo 6 caracteres)</label><input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••" /><button type="submit">{mode === 'login' ? 'ENTRAR' : 'CRIAR CONTA'}</button></form>{message && <div className="auth-message">{message}</div>}<button className="auth-switch" onClick={()=>{setMode(mode==='login'?'signup':'login');setMessage('')}}>{mode === 'login' ? 'Não tem uma conta? Criar conta' : 'Já tem uma conta? Entrar'}</button></section></main>);
}
