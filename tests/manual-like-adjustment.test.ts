import assert from 'node:assert/strict';
import test from 'node:test';
import {adjustedLikes,distributeManualLikes,emptyManualAdjustment,manualPostKey,parseManualAdjustment,validManualLikes} from '../lib/manual-like-adjustment.ts';
import {monthlyReward} from '../lib/reward.ts';
const config={allowed:true,enabled:true,amount:150,seed:'unique-period-seed',period_id:1,start_date:'2026-09-01',revision:'1'};
const posts=Array.from({length:23},(_,i)=>({id:i+1,post_url:`https://x.com/a/status/${i+1}`,published_at:'2026-09-10',likes:10,views:100}));
const sum=(map:Map<string,number>)=>[...map.values()].reduce((a,b)=>a+b,0);
test('150 extras are exact, stable across refreshes and order, without mutating real metrics',()=>{
 const before=JSON.stringify(posts),allocation=distributeManualLikes(posts,config,'2026-09-16');
 assert.equal(sum(allocation),150);assert.deepEqual(allocation,distributeManualLikes([...posts].reverse(),config,'2026-09-16'));
 const calculated=posts.map(post=>({...post,likes:adjustedLikes(post,allocation)}));
 assert.equal(monthlyReward(calculated).likes,380);
 assert.equal(monthlyReward(calculated).raw-monthlyReward(posts).raw,300);
 assert.equal(JSON.stringify(posts),before);
 assert.equal(sum(distributeManualLikes(posts.map(p=>({...p,likes:99})),config,'2026-09-16')),150);
});
test('revoked, disabled, no period, no posts, zero and invalid amounts never add likes',()=>{
 for(const variant of [{...config,allowed:false},{...config,enabled:false},{...config,period_id:null},{...config,amount:0},{...config,amount:-1},{...config,amount:1.5},emptyManualAdjustment])assert.equal(sum(distributeManualLikes(posts,variant)),0);
 assert.equal(sum(distributeManualLikes([],config)),0);
 for(const value of [NaN,Infinity,'150',-1,1000001])assert.equal(validManualLikes(value),false);
 assert.equal(parseManualAdjustment(null).allowed,false);
});
test('only current, non-closed publications qualify and canonical duplicates count once',()=>{
 const rows=[posts[0],{...posts[0],post_url:'https://twitter.com/a/status/1/photo/1'},
 {...posts[1],published_at:'2026-08-31'}, {...posts[2],counting_excluded:true},
 {...posts[3],published_at:'2026-10-01'}, {...posts[4],published_at:'invalid'}];
 const allocation=distributeManualLikes(rows,config,'2026-09-16');
 assert.equal(allocation.size,1);assert.equal(allocation.get(manualPostKey(posts[0])),150);
});
test('small totals and large sets always remain integer and exact',()=>{
 for(const amount of [1,2,150,1000000]){
 const allocation=distributeManualLikes(posts,{...config,amount},'2026-09-16');
 assert.equal(sum(allocation),amount);assert.ok([...allocation.values()].every(n=>Number.isInteger(n)&&n>=0));
 }
});
