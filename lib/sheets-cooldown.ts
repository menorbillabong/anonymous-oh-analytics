export function cooldownFromFields(minutes:string,seconds:string):number|null {
  if(!/^\d+$/.test(minutes)||!/^\d+$/.test(seconds))return null;
  const m=Number(minutes),s=Number(seconds),total=m*60+s;
  return Number.isSafeInteger(total)&&s<60&&total>=1&&total<=86400?total:null;
}

export function formatCooldown(seconds:number):string {
  const total=Number.isFinite(seconds)?Math.max(0,Math.ceil(seconds)):0;
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
}
