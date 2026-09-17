'use client';

import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {cooldownFromFields,formatCooldown} from '@/lib/sheets-cooldown';

export default function AdminSheetsCooldown(){
  const[minutes,setMinutes]=useState('1');
  const[seconds,setSeconds]=useState('30');
  const[saved,setSaved]=useState<number|null>(null);
  const[loading,setLoading]=useState(true);
  const[working,setWorking]=useState(false);
  const[notice,setNotice]=useState('');

  useEffect(()=>{
    let active=true;
    async function load(){
      try{
        const{data,error}=await supabase.from('google_sheets_sync_settings').select('cooldown_seconds').eq('singleton',true).single();
        if(error||!data)throw new Error();
        if(active){setSaved(data.cooldown_seconds);setMinutes(String(Math.floor(data.cooldown_seconds/60)));setSeconds(String(data.cooldown_seconds%60))}
      }catch{if(active)setNotice('Não foi possível carregar o tempo de espera. Reabra esta aba para tentar novamente.')}
      finally{if(active)setLoading(false)}
    }
    void load();
    return()=>{active=false};
  },[]);

  const duration=cooldownFromFields(minutes,seconds);
  async function save(event:React.FormEvent){
    event.preventDefault();
    if(duration===null||working||saved===null)return;
    setWorking(true);setNotice('');
    try{
      const{data,error}=await supabase.from('google_sheets_sync_settings').update({cooldown_seconds:duration}).eq('singleton',true).select('cooldown_seconds').single();
      if(error||!data)throw new Error();
      setSaved(data.cooldown_seconds);
      setNotice('Tempo salvo para todos os usuários.');
      window.dispatchEvent(new Event('sheets-cooldown-changed'));
    }catch{setNotice('Não foi possível salvar. Confira sua conexão e sua permissão de administrador.')}
    finally{setWorking(false)}
  }

  return <section className="admin-panel">
    <div className="admin-panel-head"><div><small>GOOGLE SHEETS</small><h2>Tempo de espera da planilha</h2></div><span className="admin-counter">{saved===null?'—':formatCooldown(saved)}</span></div>
    <p className="admin-panel-copy">Defina o intervalo entre atualizações da planilha. Vale para todos, com uma contagem individual por usuário.</p>
    <form className="admin-form" onSubmit={save}>
      <label><span>Minutos</span><input type="number" min="0" max="1440" step="1" required value={minutes} disabled={loading||working||saved===null} onChange={event=>setMinutes(event.target.value)}/></label>
      <label><span>Segundos</span><input type="number" min="0" max="59" step="1" required value={seconds} disabled={loading||working||saved===null} onChange={event=>setSeconds(event.target.value)}/></label>
      <p className="admin-form-note">Use de 1 segundo a 24 horas. A alteração também recalcula as esperas em andamento.</p>
      {duration===null&&<p role="alert">Informe um tempo válido entre 1 segundo e 24 horas.</p>}
      <button className="admin-primary" type="submit" disabled={loading||working||saved===null||duration===null||duration===saved}>{loading?'CARREGANDO...':working?'SALVANDO...':'SALVAR TEMPO DE ESPERA'}</button>
      <p role="status" aria-live="polite" className="admin-form-note">{notice}</p>
    </form>
  </section>;
}
