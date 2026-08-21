'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '@/lib/supabase';
import {formatPostDate,postPublishedDate,postPublishedValue} from '@/lib/post-date';

export default function SiteUpgrades(){
 const[ready,setReady]=useState(false),[sessionActive,setSessionActive]=useState(false),[posts,setPosts]=useState<any[]>([]),[menu,setMenu]=useState(false),[password,setPassword]=useState(false);
 useEffect(()=>{let active=true;setReady(true);supabase.auth.getSession().then(async({data})=>{const id=data.session?.user.id||'';if(!active)return;setSessionActive(Boolean(id));if(!id)return;const{data:postsData}=await supabase.from('posts').select('*').eq('user_id',id);if(active)setPosts(postsData||[])});const{data:auth}=supabase.auth.onAuthStateChange((_event,session)=>{const signedIn=Boolean(session?.user.id);setSessionActive(signedIn);if(!signedIn){setMenu(false);setPassword(false);setPosts([])}});return()=>{active=false;auth.subscription.unsubscribe()}},[]);
 useEffect(()=>{if(!ready||!sessionActive)return;const click=(e:MouseEvent)=>{const el=(e.target as HTMLElement).closest('button');if(!el)return;const text=(el.textContent||'').trim().toUpperCase();if(el.classList.contains('user-pill')){e.preventDefault();e.stopImmediatePropagation();setMenu(value=>!value);return}if(text==='CSV'){e.preventDefault();e.stopImmediatePropagation();exportCsv(posts);return}if(el.classList.contains('report-btn')){e.preventDefault();e.stopImmediatePropagation();window.dispatchEvent(new Event('aoh:open-report'))}};document.addEventListener('click',click,true);return()=>document.removeEventListener('click',click,true)},[ready,sessionActive,posts]);
 useEffect(()=>{if(!menu)return;const outside=(e:PointerEvent)=>{const target=e.target as HTMLElement|null;if(target?.closest('.user-pill,.profile-menu'))return;setMenu(false)};document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true)},[menu]);
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(false);setPassword(false)}};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc)},[]);
 if(!ready||!sessionActive)return null;return <>{menu&&createPortal(<div className="profile-menu"><button onClick={()=>{setMenu(false);setPassword(true)}}>🔒 Alterar senha</button><button onClick={()=>{setMenu(false);void supabase.auth.signOut()}}>↪ Sair</button></div>,document.body)}{password&&createPortal(<Password close={()=>setPassword(false)}/>,document.body)}</>;
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
   .sort((a,b)=>{
    const aTime=postPublishedDate(a)?.getTime()??Number.POSITIVE_INFINITY;
    const bTime=postPublishedDate(b)?.getTime()??Number.POSITIVE_INFINITY;
    return aTime-bTime;
   })
   .forEach(post=>{
    const published=formatPostDate(postPublishedValue(post));
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


