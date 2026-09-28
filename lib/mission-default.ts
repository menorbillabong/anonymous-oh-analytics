// Built-in identity survives renames. The fallback supports older cached data.
export function firstNormalMissionId(profiles: {id:string|number;active?:boolean;reward?:number|string|null;builtin_kind?:string|null}[]):string {
 const profile=profiles.find(profile=>profile.active&&profile.builtin_kind==='normal')
  ??profiles.find(profile=>profile.active&&Number(profile.reward??0)===0);
 return profile?String(profile.id):'';
}
