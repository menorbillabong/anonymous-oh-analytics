'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Missions({userId}:{userId:string}){
 const [missions,setMissions]=useState<any[]>([]); const [name,setName]=useState(''); const [reward,setReward]=useState(0);
 async function load(){const {data}=await supabase.from('missions').select('*').eq('user_id',userId).order('created_at',{ascending:false});setMissions(data||[])}
 useEffect(()=>{load()},[userId]);
 async function create(){if(!name.trim())return;await supabase.from('missions').insert({user_id:userId,name:name.trim(),reward});setName('');setReward(0);await load()}
 const total=useMemo(()=>missions.reduce((a,m)=>a+Number(m.reward||0),0),[missions]);
 return <div><div className="panel"><div className="panel-title"><h3>Controle de missão</h3><span className="tag">Total {total}</span></div><div className="grid-2"><div className="field"><label>Nome da missão</label><input value={name} onChange={e=>setName(e.target.value)} /></div><div className="field"><label>Recompensa</label><input type="number" value={reward} onChange={e=>setReward(Number(e.target.value))}/></div></div><div style={{marginTop:12}}><button className="btn btn-primary" onClick={create}>Criar missão</button></div></div><div style={{height:12}}/>{missions.length?missions.map(m=><div className="panel" key={m.id} style={{marginBottom:10}}><div className="between row"><strong>{m.name}</strong><span className="green">{m.reward}</span></div></div>):<div className="empty">Nenhuma missão cadastrada.</div>}</div>
}
