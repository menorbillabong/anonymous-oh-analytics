import test from 'node:test';
import assert from 'node:assert/strict';
import {suspendCardEffectsWhileScrolling} from '../lib/card-scroll-effects.ts';

test('scroll effects use passive listeners, one flag per burst, and restore after idle',()=>{
 const gridListeners=new Map<string,any>(),docListeners=new Map<string,any>();
 const timers=new Map<number,()=>void>();let next=0,writes=0,flag=false;
 const win={clearTimeout:(id:number)=>timers.delete(id),setTimeout:(fn:()=>void,ms:number)=>{assert.equal(ms,180);timers.set(++next,fn);return next}};
 const target=(listeners:Map<string,any>)=>({
  addEventListener:(name:string,fn:any,options:any)=>{assert.deepEqual(options,{passive:true,capture:true});listeners.set(name,fn)},
  removeEventListener:(name:string,fn:any,capture:boolean)=>{assert.equal(listeners.get(name),fn);assert.equal(capture,true);listeners.delete(name)},
 });
 const grid={...target(gridListeners),ownerDocument:{...target(docListeners),defaultView:win},
  setAttribute:(name:string,value:string)=>{assert.equal(name,'data-scroll-active');assert.equal(value,'true');flag=true;writes++},
  removeAttribute:(name:string)=>{assert.equal(name,'data-scroll-active');flag=false},
 } as unknown as HTMLElement;
 const clean=suspendCardEffectsWhileScrolling(grid);
 gridListeners.get('wheel')({ctrlKey:true,deltaY:1});assert.equal(flag,false);
 gridListeners.get('wheel')({deltaX:0,deltaY:0});assert.equal(flag,false);
 gridListeners.get('wheel')({deltaY:100});assert.equal(flag,true);
 docListeners.get('scroll')();docListeners.get('scroll')();
 assert.equal(writes,1);assert.equal(timers.size,1);
 const restore=[...timers.values()][0];timers.clear();restore();assert.equal(flag,false);
 docListeners.get('scroll')();assert.equal(flag,true);assert.equal(writes,2);
 clean();assert.equal(flag,false);assert.equal(timers.size,0);assert.equal(gridListeners.size,0);assert.equal(docListeners.size,0);
});

test('detached documents without a window need no listeners',()=>{
 const clean=suspendCardEffectsWhileScrolling({ownerDocument:{defaultView:null}} as HTMLElement);
 clean();
});
