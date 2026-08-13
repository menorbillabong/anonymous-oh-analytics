export type XMetrics={views:number|null;likes:number|null;reposts:number|null;comments:number|null;video_url?:string|null};
export async function fetchXMetrics(url:string):Promise<XMetrics>{const r=await fetch('/api/x-metrics',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});if(!r.ok)throw new Error('Falha ao buscar métricas');return r.json()}
