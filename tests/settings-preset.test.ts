import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSettingsPreset,parseSettingsPreset,portableSettings} from '../lib/settings-preset.ts';

const mission={name:'Fotos',network:'X',description:'Fotos especiais',multiplier:2,reward:200,submission_limit:0,color:'#54c27a',active:true,is_special:true};
test('preset round trip includes special checkbox and strips account identifiers and grants',()=>{
  const preset=buildSettingsPreset({app_name:'Teste',matrix_enabled:false,matrix_color:'#123456',user_id:'foreign',is_admin:true},60,'es',[{...mission,id:99,user_id:'foreign'}]);
  const parsed=parseSettingsPreset(JSON.parse(JSON.stringify(preset)));
  assert.deepEqual(parsed.missions,[mission]);assert.equal(parsed.settings.language,'es');assert.equal(parsed.settings.matrix_enabled,false);
  assert.equal('user_id' in parsed.settings,false);assert.equal('is_admin' in parsed.settings,false);assert.equal(parsed.legacy,false);
});
test('old settings files work without inventing mission profiles or overwriting missing preferences',()=>{
  const parsed=parseSettingsPreset({format:'anonymous-oh-settings',version:6,settings:{accent_color:'#abcdef'},monthly_post_goal:45});
  assert.equal(parsed.legacy,true);assert.deepEqual(parsed.missions,[]);assert.deepEqual(parsed.settings,{accent_color:'#abcdef',monthly_post_goal:45});
});
test('corrupt or unsupported presets are rejected before writes',()=>{
  for(const value of [null,[],{}, {format:'anonymous-oh-settings',version:8,settings:{}},{format:'anonymous-oh-settings',version:7,settings:{}},{format:'anonymous-oh-settings',settings:{matrix_enabled:'false'}},{format:'anonymous-oh-settings',settings:{app_name:'a'}},{format:'anonymous-oh-settings',settings:{refresh_interval:0}},{format:'anonymous-oh-settings',settings:{},mission_profiles:[{...mission,reward:-1}]},{format:'anonymous-oh-settings',settings:{},mission_profiles:[{...mission,is_special:'true'}]}])assert.throws(()=>parseSettingsPreset(value));
});
test('mission limits and malformed numbers cannot pass through',()=>{
  assert.throws(()=>buildSettingsPreset({},60,'pt-BR',Array(1001).fill(mission)));
  for(const value of [NaN,Infinity,1.5,0,2147483648])assert.throws(()=>portableSettings({monthly_post_goal:value}));
  assert.throws(()=>buildSettingsPreset({},60,'pt-BR',[{...mission,multiplier:0}]));
  assert.deepEqual(portableSettings({x_handle:' @example '}),{x_handle:'example'});
});
