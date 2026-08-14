import {NextResponse} from 'next/server';

function parsePostUrl(value:string){
 const m=value.trim().match(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([^/?#]+)\/status\/(\d+)/i);
 return m?{handle:m[1],id:m[2]}:null;
}
function bestVideo(media:any){
 const videos=Array.isArray(media?.videos)?media.videos:[];
 if(!videos.length)return {video_url:null,thumbnail_url:null};
 const v=videos[0];
 const formats=Array.isArray(v.formats)?v.formats.filter((x:any)=>/^https?:/i.test(x?.url||'')):[];
 formats.sort((a:any,b:any)=>Number(b.bitrate||0)-Number(a.bitrate||0));
 const video_url=formats[0]?.url||v.url||null;
 const thumbnail_url=v.thumbnail_url||v.thumbnail?.url||v.thumbnail||v.poster_url||v.poster||null;
 return {video_url,thumbnail_url};
}
async function fetchPublicPost(handle:string,id:string){
 const res=await fetch('https://api.fxtwitter.com/'+encodeURIComponent(handle)+'/status/'+id,{cache:'no-store'});
 if(!res.ok)throw new Error('Falha ao consultar a postagem');
 const json=await res.json();
 const t=json.tweet||json.status;
 if(!t)throw new Error('Postagem não encontrada');
 const created=t.created_at?new Date(t.created_at):null;
 const video=bestVideo(t.media);
 return {title:String(t.text||'Publicação do X').trim()||'Publicação do X',views:Number(t.views||0),likes:Number(t.likes||0),reposts:Number(t.retweets??t.reposts??0),comments:Number(t.replies||0),published_date:created&&!Number.isNaN(created.getTime())?created.toISOString().slice(0,10):null,published_at:created&&!Number.isNaN(created.getTime())?created.toISOString():null,image_urls:(t.media?.photos||[]).map((x:any)=>x?.url).filter(Boolean),video_url:video.video_url,thumbnail_url:video.thumbnail_url,author_handle:t.author?.screen_name||handle,author_name:t.author?.name||t.author?.display_name||t.author?.screen_name||handle,author_avatar:t.author?.avatar_url||t.author?.avatar||t.author?.profile_image_url||null,source:'auto'};
}
export async function POST(req:Request){try{const {url}=await req.json();if(!url)return NextResponse.json({error:'URL obrigatória'},{status:400});const parsed=parsePostUrl(url);if(!parsed)return NextResponse.json({error:'URL de postagem do X inválida'},{status:400});const data=await fetchPublicPost(parsed.handle,parsed.id);return NextResponse.json({...data,url});}catch(e:any){return NextResponse.json({error:e?.message||'Não foi possível coletar os dados da postagem.'},{status:502})}}
