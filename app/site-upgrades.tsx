'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';

export default function SiteUpgrades(){
 const[ready,setReady]=useState(false),[posts,setPosts]=useState<any[]>([]),[menu,setMenu]=useState(false),[password,setPassword]=useState(false);
 useEffect(()=>{setReady(true);supabase.auth.getSession().then(async({data})=>{const id=data.session?.user.id||'';if(!id)return;const{data:postsData}=await supabase.from('posts').select('*').eq('user_id',id);setPosts(postsData||[])})},[]);
 useEffect(()=>{if(!ready)return;const click=(e:MouseEvent)=>{const el=(e.target as HTMLElement).closest('button');if(!el)return;const text=(el.textContent||'').trim().toUpperCase();if(el.classList.contains('user-pill')){e.preventDefault();e.stopImmediatePropagation();setMenu(value=>!value);return}if(text==='CSV'){e.preventDefault();e.stopImmediatePropagation();exportCsv(posts);return}if(el.classList.contains('report-btn')){e.preventDefault();e.stopImmediatePropagation();window.dispatchEvent(new Event('aoh:open-report'))}};document.addEventListener('click',click,true);return()=>document.removeEventListener('click',click,true)},[ready,posts]);
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(false);setPassword(false)}};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc)},[]);
 if(!ready)return null;return <>{menu&&createPortal(<div className="profile-menu"><button onClick={()=>{setMenu(false);setPassword(true)}}>🔒 Alterar senha</button><button onClick={()=>supabase.auth.signOut()}>↪ Sair</button></div>,document.body)}{password&&createPortal(<Password close={()=>setPassword(false)}/>,document.body)}</>;
}
function exportCsv(posts:any[]){
 const groups=new Map<string,any[]>();
 posts.forEach(post=>{
  const mission=String(post.mission_name||'Sem missão').trim()||'Sem missão';
  groups.set(mission,[...(groups.get(mission)||[]),post]);
 });
 let output='';
 [...groups.entries()].forEach(([mission,rows],index)=>{
  if(index)output+='\n';
  output+=`MISSÃO: ${mission}\nData,Rede,Link,Visualizações,Curtidas\n`;
  [...rows]
   .sort((a,b)=>new Date(a.published_date||a.created_at).getTime()-new Date(b.published_date||b.created_at).getTime())
   .forEach(post=>{
    const published=new Date(post.published_date||post.created_at).toLocaleDateString('pt-BR');
    const url=String(post.post_url||'').replaceAll('"','""');
    output+=`"${published}","X","${url}",${Number(post.views||0)},${Number(post.likes||0)}\n`;
   });
 });
 const link=document.createElement('a');
 link.href=URL.createObjectURL(new Blob(['\ufeff'+output],{type:'text/csv;charset=utf-8'}));
 link.download='publicacoes-por-missao.csv';
 link.click();
 setTimeout(()=>URL.revokeObjectURL(link.href),500);
}
function Password({close}:{close:()=>void}){const[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);async function submit(){if(password.length<8)return setMessage('A senha precisa ter pelo menos 8 caracteres.');if(password!==confirmation)return setMessage('As senhas não são iguais.');setBusy(true);const{error}=await supabase.auth.updateUser({password});setBusy(false);setMessage(error?'Não foi possível alterar a senha.':'Senha alterada com sucesso.')}return <div className="upgrade-backdrop"><div className="upgrade-password"><button className="upgrade-x" onClick={close}>×</button><small>SEGURANÇA DA CONTA</small><h2>Alterar senha</h2><label>Nova senha<input type="password" value={password} onChange={event=>setPassword(event.target.value)}/></label><label>Confirmar nova senha<input type="password" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>{message&&<p>{message}</p>}<div><button onClick={close}>Cancelar</button><button className="upgrade-primary" disabled={busy} onClick={submit}>{busy?'ALTERANDO...':'ALTERAR SENHA'}</button></div></div></div>}

