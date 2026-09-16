import assert from 'node:assert/strict';
import test from 'node:test';
import {eligibleForMissionPeriod,missionSelectionError,type MissionSelectionPeriod} from '../lib/mission-selection.ts';
import {postDateKey} from '../lib/post-date.ts';
const period:MissionSelectionPeriod={id:'first',start_date:'2026-09-10',end_date:'2026-09-15',per_user_limit:3};
test('includes both endpoints and rejects publications outside dates',()=>{
 for(const date of ['2026-09-10','2026-09-15'])assert.equal(eligibleForMissionPeriod({id:1},date,period,[]),true);
 for(const date of ['','2026-09-09','2026-09-16'])assert.equal(eligibleForMissionPeriod({id:1},date,period,[]),false);
});
test('selected publication stays in its own window but not an overlapping one',()=>{
 const rows=[{post_id:1,period_id:'first',mission_profile_id:5}];
 assert.equal(eligibleForMissionPeriod({id:1,special_reward:200},'2026-09-15',period,rows,200),true);
 assert.equal(eligibleForMissionPeriod({id:1},'2026-09-15',{...period,id:'second',start_date:'2026-09-15',end_date:'2026-09-20'},rows),false);
 assert.equal(eligibleForMissionPeriod({id:1},'2026-09-15',{...period,id:'second'},[]),true);
});
test('unlinked bonus publications stay visible for manual linkage; closed normal posts do not',()=>{
 assert.equal(eligibleForMissionPeriod({id:1,special_reward:1},'2026-09-12',period,[]),true);
 assert.equal(eligibleForMissionPeriod({id:1},'2026-09-12',period,[],100),true);
 assert.equal(eligibleForMissionPeriod({id:1,counting_excluded:true},'2026-09-12',period,[]),false);
 assert.equal(eligibleForMissionPeriod({id:1,counting_excluded:true},'2026-09-12',period,[],100),true);
});
test('closed selected publication remains visible for reference',()=>{
 assert.equal(eligibleForMissionPeriod({id:1,counting_excluded:true},'2026-09-12',period,[{post_id:1,period_id:'first',mission_profile_id:3}]),true);
});
test('uses publication day in Sao Paulo at midnight boundaries',()=>{
 assert.equal(postDateKey('2026-09-16T02:59:59Z'),'2026-09-15');
 assert.equal(postDateKey('2026-09-16T03:00:00Z'),'2026-09-16');
});
test('server rejections have understandable messages',()=>{
 assert.match(missionSelectionError({message:'MISSION_PERIOD_LIMIT'}),/limite/);
 assert.match(missionSelectionError({message:'MISSION_PERIOD_ALREADY_ASSIGNED'}),/outro período/);
 assert.match(missionSelectionError({message:'MISSION_PERIOD_HAS_BONUS'}),/bônus/);
});
