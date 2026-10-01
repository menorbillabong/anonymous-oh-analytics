import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {syncMissionSelectionsAfterSave,missionSyncPendingNotice} from '../lib/sync-mission-selections.ts';

test('reconciles with the authenticated RPC, without an arbitrary user id',async()=>{
  const calls:unknown[][]=[];
  assert.equal(await syncMissionSelectionsAfterSave({rpc:async(...args)=>{calls.push(args);return{error:null}}}),'');
  assert.deepEqual(calls,[['sync_my_mission_period_selections']]);
});
test('RPC or connection failure preserves successful save and offers recovery',async()=>{
  assert.equal(await syncMissionSelectionsAfterSave({rpc:async()=>({error:{message:'timeout'}})}),missionSyncPendingNotice);
  assert.equal(await syncMissionSelectionsAfterSave({rpc:async()=>{throw Error('offline')}}),missionSyncPendingNotice);
});
test('all classification save paths reconcile only after checking the write error',()=>{
  for(const path of ['post-library','mission-post-review','bulk-review-injector','dashboard']){
    const code=readFileSync(new URL(`../app/${path}.tsx`,import.meta.url),'utf8');
    const calls=[...code.matchAll(/await syncMissionSelectionsAfterSave\(supabase\)/g)];
    assert.equal(calls.length,path==='dashboard'?2:1,path);
    for(const call of calls){
      const prefix=code.slice(0,call.index);
      assert.match(prefix.slice(prefix.lastIndexOf('if(error)')>=0&&path!=='dashboard'?prefix.lastIndexOf('if(error)'):prefix.lastIndexOf('if (error)')),/return/);
    }
  }
});
