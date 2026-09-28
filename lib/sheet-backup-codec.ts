import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {DesignSheet} from './sheet-design-plan.ts';

export type SheetBackup={version:1;userId:string;spreadsheetId:string;createdAt:string;expiresAt:string;sheet:DesignSheet};
function key(secret:string){if(!secret)throw new Error('Backup não configurado no servidor.');return Buffer.from(hkdfSync('sha256',secret.replace(/\\n/g,'\n'),'aoh-sheet-backup-v1','encryption',32))}
export function sealBackup(backup:SheetBackup,secret:string){
  const json=Buffer.from(JSON.stringify(backup));
  if(json.length>32*1024*1024)throw new Error('Esta aba excede o tamanho suportado pelo backup do site.');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);
  cipher.setAAD(Buffer.from(backup.userId));
  return ['v1',iv.toString('base64'),cipher.update(gzipSync(json)).toString('base64'),cipher.final().toString('base64'),cipher.getAuthTag().toString('base64')].join('.');
}
export function openBackup(encoded:string,secret:string,userId:string,spreadsheetId:string,now=Date.now()):SheetBackup{
  try{
    const [version,iv,data,tail,tag,...extra]=encoded.split('.');if(version!=='v1'||extra.length)throw new Error();
    if([iv,data,tail,tag].some(part=>typeof part!=='string'||Buffer.from(part,'base64').toString('base64')!==part))throw new Error();
    const cipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(iv,'base64'));
    cipher.setAAD(Buffer.from(userId));cipher.setAuthTag(Buffer.from(tag,'base64'));
    const compressed=Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.update(Buffer.from(tail,'base64')),cipher.final()]);
    const result=JSON.parse(gunzipSync(compressed,{maxOutputLength:32*1024*1024}).toString()) as SheetBackup;
    const created=Date.parse(result.createdAt),expiry=Date.parse(result.expiresAt);
    if(result.version!==1||result.userId!==userId||result.spreadsheetId!==spreadsheetId||!Number.isFinite(created)||!Number.isFinite(expiry)||created>now+60000||expiry<=now||expiry-created>7*86400000||expiry<=created)throw new Error();
    return result;
  }catch{throw new Error('O backup expirou, foi alterado ou não pertence a esta conta e planilha.');}
}
