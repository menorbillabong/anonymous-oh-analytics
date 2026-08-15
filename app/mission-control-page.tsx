'use client';

import {useCallback,useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import './mission-control-v2.css';
import './mission-actions.css';

type Mission={id:string|number;name:string;reward:number;color:string;active:boolean};

const defaults={name:'',reward:0,color:'#54c27a'};

export default function MissionControlPage({uid,reloadProfiles}:{uid:string;reloadProfiles:()=>Promise<void>}){
 const[rows,setRows]=useState<Mission[]>([]);
 const[name,setName]=useState(defaults.name);
 const[reward,setReward]=useState(defaults.reward);
 const[color,setColor]=useState(defaults.color);
 const[editing,setEditing]=useState<Mission|null>(null);
 const[deleting,setDeleting]=useState<Mission|null>(null);
 const[busy,setBusy]=useState(false);
 const[notice,setNotice]=useState('');

 const load=useCallback(async()=>{
  const{data,error}=await supabase.from('mission_profiles').select('*').eq('user_id',uid).order('active',{ascending:false}).order('name');
  if(error){setNotice('Não foi possível carregar as missões.');return}
  setRows((data||[]) as Mission[]);
 },[uid]);

 useEffect(()=>{load()},[load]);

 function resetForm(){setName(defaults.name);setReward(defaults.reward);setColor(defaults.color);setEditing(null)}
 function startEdit(mission:Mission){setEditing(mission);setName(mission.name||'');setReward(Number(mission.reward||0));setColor(mission.color||defaults.color);setNotice('');window.scrollTo({top:0,behavior:'smooth'})}

 async function save(){
  const cleanName=name.trim();if(!cleanName||busy)return;
  setBusy(true);setNotice('');
  const query=editing
   ?supabase.from('mission_profiles').update({name:cleanName,reward:Number(reward),color}).eq('id',editing.id).eq('user_id',uid)
   :supabase.from('mission_profiles').insert({user_id:uid,name:cleanName,network:'X',reward:Number(reward),color,active:true});
  const{error}=await query;
  if(error){setNotice(editing?'Não foi possível salvar as alterações.':'Não foi possível criar a missão.');setBusy(false);return}
  setNotice(editing?'Missão atualizada com sucesso.':'Missão criada com sucesso.');resetForm();await load();await reloadProfiles();setBusy(false);
 }

 async function confirmDelete(){
  if(!deleting||busy)return;setBusy(true);setNotice('');
  const{error}=await supabase.from('mission_profiles').delete().eq('id',deleting.id).eq('user_id',uid);
  if(error){setNotice('Não foi possível excluir a missão. Verifique se ela está sendo usada por alguma publicação.');setBusy(false);return}
  setNotice('Missão excluída com sucesso.');setDeleting(null);if(editing?.id===deleting.id)resetForm();await load();await reloadProfiles();setBusy(false);
 }

 return <section className="mission-control-reference">
  <div className="mission-control-create">
   <h2>{editing?'Editar missão':'Adicionar nova missão'}</h2>
   <div className="mission-create-panel">
    <label>Nome da missão<input value={name} onChange={e=>setName(e.target.value)} autoFocus={!!editing}/></label>
    <label>Cor da missão<div className="mission-color-wrap"><input aria-label="Cor da missão" type="color" value={color} onChange={e=>setColor(e.target.value)}/></div></label>
    <label>Bônus fixo<input type="number" min="0" value={reward} onChange={e=>setReward(Number(e.target.value))}/></label>
    <button className="mission-orange-btn create" disabled={busy||!name.trim()} onClick={save}><span>{editing?'✓':'＋'}</span>{busy?'SALVANDO...':editing?'Salvar alterações':'Criar missão'}</button>
    {editing&&<button className="mission-cancel-edit" type="button" disabled={busy} onClick={resetForm}>Cancelar edição</button>}
    {notice&&<p className="mission-notice" role="status">{notice}</p>}
   </div>
  </div>
  <div className="mission-control-existing">
   <h2>Missões existentes</h2>
   <div className="mission-existing-grid">{rows.map(mission=><article key={mission.id} className="mission-existing-card" style={{'--mission-color':mission.color||defaults.color} as React.CSSProperties}>
    <div className="mission-existing-main"><h3>{String(mission.name||'MISSÃO').toUpperCase()}</h3><p>Engajamento (Curtidas) × 2</p><div className="mission-tags"><span>2X</span><span>{mission.active?'ATIVA':'ARQUIVADA'}</span></div></div>
    <div className="mission-card-actions">
     <button className="mission-edit-action" type="button" onClick={()=>startEdit(mission)} aria-label={`Editar missão ${mission.name}`} title="Editar missão">✎</button>
     <button className="mission-delete-action" type="button" onClick={()=>setDeleting(mission)} aria-label={`Excluir missão ${mission.name}`} title="Excluir missão">♲</button>
    </div>
   </article>)}{!rows.length&&<div className="empty-row">Crie sua primeira missão especial.</div>}</div>
  </div>
  {deleting&&<div className="mission-delete-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setDeleting(null)}}>
   <section className="mission-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="mission-delete-title">
    <div className="mission-delete-icon">♲</div><h2 id="mission-delete-title">Excluir missão</h2>
    <p>Tem certeza de que deseja excluir a missão <strong>{deleting.name}</strong>?</p><small>Esta ação não pode ser desfeita.</small>
    <div><button className="mission-delete-confirm" type="button" disabled={busy} onClick={confirmDelete}>{busy?'EXCLUINDO...':'Excluir missão'}</button><button type="button" disabled={busy} onClick={()=>setDeleting(null)}>Cancelar</button></div>
   </section>
  </div>}
 </section>
}
