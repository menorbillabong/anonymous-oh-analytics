import {BUTTON_APPEARANCE,isHexColor} from './edge-appearance.ts';
// Portable preferences only: never export account names, IDs, grants, posts or periods.
export const PRESET_MAX_BYTES = 1024 * 1024;
export const PRESET_MAX_MISSIONS = 1000;
const settingsKeys = ['border_glow_intensity','button_colors','matrix_enabled','matrix_color','x_handle','panel_action_layout','ranking_opt_in','refresh_interval','show_refresh_timer','cap_unlocked','crystalgin_limit','accent_color','background_color','surface_color','border_color','language','monthly_post_goal'] as const;
const booleanKeys = new Set(['matrix_enabled','ranking_opt_in','show_refresh_timer','cap_unlocked']);
const colorKeys = new Set(['matrix_color','accent_color','background_color','surface_color','border_color']);
export type PortableMission = {name:string;network:string;description:string;multiplier:number;reward:number;submission_limit:number;color:string;active:boolean;is_special:boolean};
export type SettingsPreset = {format:'anonymous-oh-settings';version:7;settings:Record<string,unknown>;monthly_post_goal:number;mission_profiles:PortableMission[]};
function object(value:unknown): value is Record<string,unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function invalid():never { throw new Error('INVALID_PRESET'); }
function numberIn(value:unknown,min:number,max:number,integer=false):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isSafeInteger(value)))invalid();
  return value;
}
export function portableSettings(value:unknown):Record<string,unknown> {
  if(!object(value))invalid();
  const result:Record<string,unknown>={};
  for(const key of settingsKeys){
    if(!(key in value))continue;
    let item=value[key];
    if(key==='border_glow_intensity')numberIn(item,0,100,true);
    else if(key==='button_colors'){
      if(!object(item)||Object.keys(item).some(id=>!BUTTON_APPEARANCE.some(button=>button.id===id))||Object.values(item).some(color=>!isHexColor(color)))invalid();
      item={...item};
    }
    else if(booleanKeys.has(key)){if(typeof item!=='boolean')invalid();}
    else if(colorKeys.has(key)){if(typeof item!=='string'||!/^#[0-9a-f]{6}$/i.test(item))invalid();}
    else if(key==='crystalgin_limit'||key==='monthly_post_goal')numberIn(item,1,2147483647,true);
    else if(key==='refresh_interval'){if(![.5,1,3,6,12,24].includes(item as number))invalid();}
    else if(key==='language'){if(!['pt-BR','en','es'].includes(item as string))invalid();}
    else if(key==='panel_action_layout'){if(!['classic','organized'].includes(item as string))invalid();}
    else if(key==='x_handle'){if(typeof item!=='string')invalid();item=item.trim().replace(/^@/,'');if(item!==''&&!/^[A-Za-z0-9_]{1,15}$/.test(item as string))invalid();}
    result[key]=item;
  }
  return result;
}
export function portableMission(value:unknown):PortableMission {
  if(!object(value))invalid();
  const {name,network,description,multiplier,reward,submission_limit,color,active,is_special}=value;
  if(typeof name!=='string'||!name.trim()||name.trim().length>200||typeof network!=='string'||!network.trim()||network.trim().length>40||typeof description!=='string'||description.length>5000||typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)||typeof active!=='boolean'||typeof is_special!=='boolean')invalid();
  return {name:name.trim(),network:network.trim(),description,multiplier:numberIn(multiplier,0.000001,1000000),reward:numberIn(reward,0,Number.MAX_SAFE_INTEGER,true),submission_limit:numberIn(submission_limit,0,2147483647,true),color,active,is_special};
}
export function parseSettingsPreset(value:unknown) {
  if(!object(value)||value.format!=='anonymous-oh-settings'||!object(value.settings))invalid();
  if(value.version!==undefined&&(typeof value.version!=='number'||!Number.isInteger(value.version)||value.version<1||value.version>7))invalid();
  const settings=portableSettings(value.settings);
  if(value.monthly_post_goal!==undefined)settings.monthly_post_goal=numberIn(value.monthly_post_goal,1,2147483647,true);
  const legacy=value.mission_profiles===undefined;
  if(legacy&&value.version===7)invalid();
  if(!legacy&&(!Array.isArray(value.mission_profiles)||value.mission_profiles.length>PRESET_MAX_MISSIONS))invalid();
  const missions=legacy?[]:(value.mission_profiles as unknown[]).map(portableMission);
  return {settings,missions,legacy};
}
export function buildSettingsPreset(settings:unknown,goal:number,language:string,missions:unknown[]):SettingsPreset {
  if(!object(settings)||missions.length>PRESET_MAX_MISSIONS)invalid();
  return {format:'anonymous-oh-settings',version:7,settings:portableSettings({...settings,language,monthly_post_goal:goal}),monthly_post_goal:numberIn(goal,1,2147483647,true),mission_profiles:missions.map(portableMission)};
}
