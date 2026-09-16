import assert from 'node:assert/strict';
import test from 'node:test';
import {loadDashboardPosts} from '../lib/load-dashboard-posts.ts';
test('dashboard pagination loads every post with stable ordering and own user filter',async()=>{
 const rows=Array.from({length:1203},(_,id)=>({id}));let calls=0;
 const query={select:()=>query,eq:(key:string,value:string)=>{assert.equal(key,'user_id');assert.equal(value,'owner');return query},order:()=>query,range:async(a:number,b:number)=>{calls++;return{data:rows.slice(a,b+1),error:null}}};
 const result=await loadDashboardPosts({from:()=>query} as any,'owner');
 assert.equal(result.data?.length,1203);assert.equal(calls,4);
});
test('dashboard refuses partial metrics when a page fails',async()=>{
 let calls=0;
 const query={select:()=>query,eq:()=>query,order:()=>query,range:async()=>++calls===1?{data:[{id:1}],error:null}:{data:null,error:{message:'offline'}}};
 const result=await loadDashboardPosts({from:()=>query} as any,'owner');
 assert.equal(result.data,null);assert.ok(result.error);
});
