'use client';

import {useCallback,useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {Icon} from './ui-icons';
import './mission-control-v2.css';
import './mission-actions.css';

type Mission={id:string|number;name:string;description:string;multiplier:number;reward:number;submission_limit:number;color:string;active:boolean;is_special?:boolean};
const defaults={name:'',description:'',multiplier:2,reward:0,submissionLimit:0,color:'#54c27a'};

export default function MissionControlPage({uid,reloadProfiles}:{uid:string;reloadProfiles:()=>Promise<void>}){
 const[rows,setRows]=useState<Mission[]>([]),[name,setName]=useState(defaults.name),[description,setDescription]=useState(defaults.description),[multiplier,setMultiplier]=useState(defaults.multiplier),[reward,setReward]=useState(defaults.reward),[submissionLimit,setSubmissionLimit]=useState(defaults.submissionLimit),[color,setColor]=useState(defaults.color),[isSpecial,setIsSpecial]=useState(false),[sheetsEnabled,setSheetsEnabled]=useState(false);
 const[editing,setEditing]=useState<Mission|null>(null),[deleting,setDeleting]=useState<Mission|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{const[{data,error},{data:config}]=await Promise.all([supabase.from('mission_profiles').select('*').eq('user_id',uid).order('active',{ascending:false}).order('name'),supabase.from('google_sheets_user_config').select('enabled').eq('user_id',uid).maybeSingle()]);if(error){setNotice('Não foi possível carregar as missões.');return}setRows((data||[]) as Mission[]);setSheetsEnabled(Boolean(config?.enabled))},[uid]);
 useEffect(()=>{load()},[load]);

 function resetForm(){setName(defaults.name);setDescription(defaults.description);setMultiplier(defaults.multiplier);setReward(defaults.reward);setSubmissionLimit(defaults.submissionLimit);setColor(defaults.color);setIsSpecial(false);setEditing(null)}
 function startEdit(mission:Mission){setEditing(mission);setName(mission.name||'');setDescription(mission.description||'');setMultiplier(Number(mission.multiplier||defaults.multiplier));setReward(Number(mission.reward||0));setSubmissionLimit(Number(mission.submission_limit||0));setColor(mission.color||defaults.color);setIsSpecial(Boolean(mission.is_special));setNotice('');window.scrollTo({top:0,behavior:'smooth'})}

 async function save(){
  const cleanName=name.trim();if(!cleanName||busy||multiplier<=0||reward<0||submissionLimit<0)return;
  setBusy(true);setNotice('');const missionData={name:cleanName,description:description.trim(),multiplier:Number(multiplier),reward:Number(reward),submission_limit:Number(submissionLimit),color,...(sheetsEnabled?{is_special:isSpecial}:{})};
  const query=editing?supabase.from('mission_profiles').update(missionData).eq('id',editing.id).eq('user_id',uid):supabase.from('mission_profiles').insert({user_id:uid,network:'X',active:true,...missionData});
  const{error}=await query;if(error){setNotice(editing?'Não foi possível salvar as alterações.':'Não foi possível criar a missão.');setBusy(false);return}
  setNotice(editing?'Missão atualizada com sucesso.':'Missão criada com sucesso.');resetForm();await load();await reloadProfiles();setBusy(false);
 }

 async function confirmDelete(){
  if(!deleting||busy)return;setBusy(true);setNotice('');const{error}=await supabase.from('mission_profiles').delete().eq('id',deleting.id).eq('user_id',uid);
  if(error){setNotice('Não foi possível excluir a missão. Verifique se ela está sendo usada por alguma publicação.');setBusy(false);return}
  setNotice('Missão excluída com sucesso.');setDeleting(null);if(editing?.id===deleting.id)resetForm();await load();await reloadProfiles();setBusy(false);
 }

 return <section className="mission-control-reference">
  <div className="mission-control-create"><h2>{editing?'Editar missão':'Nova missão'}</h2><div className="mission-create-panel">
   <label>Nome da missão<input value={name} onChange={e=>setName(e.target.value)} autoFocus={!!editing}/></label>
   <label>Cor da missão<div className="mission-color-wrap"><input aria-label="Cor da missão" type="color" value={color} onChange={e=>setColor(e.target.value)}/></div></label>
   <label>Descrição<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={4}/></label>
   <label>Multiplicador de recompensa<input type="number" min="0.01" step="0.1" value={multiplier} onChange={e=>setMultiplier(Number(e.target.value))}/></label>
   <label>Bônus fixo<input type="number" min="0" value={reward} onChange={e=>setReward(Number(e.target.value))}/></label>
   {sheetsEnabled&&<label className="mission-special-option"><span><strong>Esta é uma missão especial</strong><small>As publicações irão para a área Special Mission da planilha.</small></span><input type="checkbox" checked={isSpecial} onChange={e=>setIsSpecial(e.target.checked)}/></label>}
   <label>Limite de envios (0 para ilimitado)<input type="number" min="0" step="1" value={submissionLimit} onChange={e=>setSubmissionLimit(Number(e.target.value))}/></label>
   <button className="mission-orange-btn create" disabled={busy||!name.trim()||multiplier<=0||reward<0||submissionLimit<0} onClick={save}><span>{editing?'✓':'＋'}</span>{busy?'SALVANDO...':editing?'Salvar alterações':'Criar missão'}</button>
   {editing&&<button className="mission-cancel-edit" type="button" disabled={busy} onClick={resetForm}>Cancelar edição</button>}{notice&&<p className="mission-notice" role="status">{notice}</p>}
  </div></div>
  <div className="mission-control-existing"><h2>Missões existentes</h2><div className="mission-existing-grid">{rows.map(mission=><article key={mission.id} className="mission-existing-card" style={{'--mission-color':mission.color||defaults.color} as React.CSSProperties}>
   <div className="mission-existing-main"><h3>{String(mission.name||'MISSÃO').toUpperCase()}</h3><p>{mission.description||'Sem descrição.'}</p><div className="mission-tags"><span>{Number(mission.multiplier||2).toLocaleString('pt-BR',{maximumFractionDigits:2})}X</span><span>BÔNUS {Number(mission.reward||0).toLocaleString('pt-BR')}</span><span>{mission.submission_limit>0?`${mission.submission_limit} MÁX.`:'ILIMITADO'}</span>{sheetsEnabled&&mission.is_special&&<span className="mission-special-tag">MISSÃO ESPECIAL</span>}</div></div>
   <div className="mission-card-actions"><button className="mission-edit-action" type="button" onClick={()=>startEdit(mission)} aria-label={`Editar missão ${mission.name}`} data-tooltip="Editar missão"><Icon name="edit" size={18}/></button><button className="mission-delete-action" type="button" onClick={()=>setDeleting(mission)} aria-label={`Excluir missão ${mission.name}`} data-tooltip="Excluir missão"><Icon name="trash" size={18}/></button></div>
  </article>)}{!rows.length&&<div className="empty-row">Crie sua primeira missão especial.</div>}</div></div>
  {deleting&&<div className="mission-delete-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setDeleting(null)}}><section className="mission-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="mission-delete-title">
   <div className="mission-delete-icon"><Icon name="trash" size={24}/></div><h2 id="mission-delete-title">Excluir missão</h2><p>Tem certeza de que deseja excluir a missão <strong>{deleting.name}</strong>?</p><small>Esta ação não pode ser desfeita.</small>
   <div><button className="mission-delete-confirm" type="button" disabled={busy} onClick={confirmDelete}>{busy?'EXCLUINDO...':'Excluir missão'}</button><button type="button" disabled={busy} onClick={()=>setDeleting(null)}>Cancelar</button></div>
  </section></div>}
 </section>
}

