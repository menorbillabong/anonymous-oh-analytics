import test from 'node:test';
import assert from 'node:assert/strict';
import {firstNormalMissionId} from '../lib/mission-default.ts';
test('default skips bonus and inactive profiles and takes first normal in dropdown order',()=>{
 assert.equal(firstNormalMissionId([{id:1,active:true,reward:200},{id:2,active:false,reward:0},{id:3,active:true,reward:0},{id:4,active:true,reward:0}]),'3');
});
test('no active normal profile never silently defaults to a bonus',()=>{
 assert.equal(firstNormalMissionId([{id:1,active:true,reward:200}]),'');
 assert.equal(firstNormalMissionId([]),'');
 assert.equal(firstNormalMissionId([{id:2,active:true,reward:'0'}]),'2');
});
