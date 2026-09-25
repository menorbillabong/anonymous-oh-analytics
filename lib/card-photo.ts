/** Display-only variant. Never persist this URL or use it for expanded media. */
export function cardPhotoUrl(original:string):string{
 try{
  const url=new URL(original);
  if(url.protocol!=='https:'||url.hostname!=='pbs.twimg.com'||url.port||url.username||url.password)return original;
  // Only X photo assets: leave videos, avatars, GIFs and other providers alone.
  const photo=url.pathname.match(/^\/media\/([\w-]+)(?:\.(jpg|jpeg|png|webp)(?::(?:orig|large|medium|small|thumb))?)?$/i);
  if(!photo)return original;
  const format=photo[2]||url.searchParams.get('format');
  if(!format||! /^(jpg|jpeg|png|webp)$/i.test(format))return original;
  url.pathname=url.pathname.replace(/:(orig|large|medium|small|thumb)$/i,'');
  url.searchParams.set('name','small');
  return url.toString();
 }catch{return original}
}
