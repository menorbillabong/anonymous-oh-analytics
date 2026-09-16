// Use the same ordering as the visible dropdown; never fall back to a bonus.
export function firstNormalMissionId(profiles: {id:string|number;active?:boolean;reward?:number|string|null}[]):string {
 const profile=profiles.find(profile=>profile.active&&Number(profile.reward??0)===0);
 return profile?String(profile.id):'';
}
