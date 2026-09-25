import test from 'node:test';
import assert from 'node:assert/strict';
import {whenNearViewport} from '../lib/near-viewport.ts';

test('media shares one observer, loads once near the viewport and cleans up',()=>{
 const original=globalThis.IntersectionObserver;
 let created=0,disconnected=0,callback:(entries:any[])=>void=()=>{};
 const observed=new Set<Element>();
 globalThis.IntersectionObserver=class {
  constructor(cb:any,options:any){created++;callback=cb;assert.equal(options.rootMargin,'600px 0px')}
  observe(el:Element){observed.add(el)}
  unobserve(el:Element){observed.delete(el)}
  disconnect(){disconnected++}
 } as any;
 try{
  const a={} as Element,b={} as Element;
  let loaded=0;
  const cleanA=whenNearViewport(a,()=>loaded++),cleanB=whenNearViewport(b,()=>loaded++);
  assert.equal(created,1);assert.equal(loaded,0);
  callback([{target:a,isIntersecting:false}]);assert.equal(loaded,0);
  callback([{target:a,isIntersecting:true}]);assert.equal(loaded,1);assert.equal(observed.has(a),false);
  callback([{target:a,isIntersecting:true}]);assert.equal(loaded,1);
  cleanB();callback([{target:b,isIntersecting:true}]);assert.equal(loaded,1);
  cleanA();assert.equal(observed.size,0);assert.equal(disconnected,1);
 }finally{globalThis.IntersectionObserver=original}
});

test('browsers without IntersectionObserver still show media',()=>{
 const original=globalThis.IntersectionObserver;
 try{
  globalThis.IntersectionObserver=undefined as any;
  let loaded=false;const cleanup=whenNearViewport({} as Element,()=>{loaded=true});
  assert.equal(loaded,true);cleanup();
 }finally{globalThis.IntersectionObserver=original}
});
