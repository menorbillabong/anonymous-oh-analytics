'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';

const SORT_KEY='aoh:post-sort-asc';

export default function PostSortEnhancer(){
 const[asc,setAsc]=useState(()=>typeof window!=='undefined'&&localStorage.getItem(SORT_KEY)==='1');
 const[head,setHead]=useState<Element|null>(null);
 useEffect(()=>{
  localStorage.setItem(SORT_KEY,asc?'1':'0');
  const timer=setInterval(()=>{
   document.querySelectorAll('.ref-summary-tail').forEach((e:any)=>e.style.display='none');
   setHead(document.querySelector('.exact-posts .posts-head'));
   const container=document.querySelector('.post-view.list .ref-list')||document.querySelector('.post-view.cards .ref-card-grid');
   if(!container)return;
   const selector=container.classList.contains('ref-list')?'.ref-list-row':'.ref-card';
   const nodes=[...container.querySelectorAll(selector)] as HTMLElement[];
   nodes.sort((a,b)=>(asc?1:-1)*(dateOf(a)-dateOf(b)));
   nodes.forEach(n=>container.appendChild(n));
  },700);
  return()=>clearInterval(timer)
 },[asc]);
 if(!head)return null;
 const label=asc?'Mais antigas primeiro':'Mais recentes primeiro';
 return createPortal(<>
  <style>{`.exact-posts .posts-head{justify-content:flex-start!important;gap:10px}.exact-posts .posts-head h2{order:0;margin:0}.exact-posts .posts-head>div{order:2;margin-left:auto}.exact-posts .post-sort-button{order:1;display:inline-flex;align-items:center;gap:6px;border-radius:7px!important;padding:7px 10px!important;color:#d7d9df!important;transition:.18s ease}.exact-posts .post-sort-button:hover{border-color:#f4a640!important;color:#f4a640!important;background:#241a0e!important}.exact-posts .post-sort-button .sort-date-icon{font-size:14px;line-height:1;color:#f4a640}.exact-posts .post-sort-button .sort-date-label{font-size:8px;letter-spacing:.04em}`}</style>
  <button className="post-sort-button" type="button" title={`Ordenar por data: ${label}`} aria-label={`Ordenar publicações por data. ${label}`} onClick={()=>setAsc(v=>!v)}>
   <span className="sort-date-icon" aria-hidden="true">{asc?'↑':'↓'}</span><span className="sort-date-label">DATA</span>
  </button>
 </>,head)
}

function dateOf(el:HTMLElement){
 const txt=[...el.querySelectorAll('small')].map(x=>x.textContent||'').find(x=>/\d{1,2}\/\d{1,2}\/\d{4}/.test(x))||'';
 const m=txt.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
 return m?new Date(Number(m[3]),Number(m[2])-1,Number(m[1])).getTime():0
}
