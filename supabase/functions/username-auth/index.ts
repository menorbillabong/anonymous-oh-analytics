import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const origins=new Set(["https://anonymous-oh-analytics.vercel.app","http://localhost:3000"]);
const reply=(origin:string,body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":origins.has(origin)?origin:"https://anonymous-oh-analytics.vercel.app","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"}});
const normalize=(value:unknown)=>String(value??"").trim().toLowerCase();
async function sha256(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("")}

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")??"";
 if(req.method==="OPTIONS")return reply(origin,{ok:true});
 if(req.method!=="POST")return reply(origin,{error:"Método não permitido."},405);
 if(origin&&!origins.has(origin))return reply(origin,{error:"Origem não permitida."},403);
 try{
  const{action,username:rawUsername,password,email:rawEmail}=await req.json();
  const username=normalize(rawUsername);
  if(!/^[a-z0-9._-]{3,24}$/.test(username))return reply(origin,{error:"Use de 3 a 24 caracteres: letras, números, ponto, traço ou sublinhado."},400);
  const admin=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
  if(action==="resolve"){
   const{data}=await admin.from("username_credentials").select("auth_email").eq("username_normalized",username).maybeSingle();
   if(!data?.auth_email)return reply(origin,{error:"Usuário ou senha incorretos."},401);
   return reply(origin,{email:data.auth_email});
  }
  if(action==="migrate"){
   const email=normalize(rawEmail);
   if(!email||typeof password!=="string"||!password)return reply(origin,{error:"Preencha o e-mail antigo, o nome de usuário e a senha."},400);
   const{data:signedIn,error:signInError}=await admin.auth.signInWithPassword({email,password});
   if(signInError||!signedIn.user)return reply(origin,{error:"E-mail ou senha incorretos."},401);
   const{data:linked}=await admin.from("username_credentials").select("username_display").eq("user_id",signedIn.user.id).maybeSingle();
   if(linked)return reply(origin,{error:"Este cadastro já possui um nome de usuário."},409);
   const{data:taken}=await admin.from("username_credentials").select("user_id").eq("username_normalized",username).maybeSingle();
   if(taken)return reply(origin,{error:"Esse nome de usuário já está em uso."},409);
   const authEmail=signedIn.user.email??email;
   const{error:mappingError}=await admin.from("username_credentials").insert({username_normalized:username,username_display:String(rawUsername).trim(),user_id:signedIn.user.id,auth_email:authEmail});
   if(mappingError){const duplicate=mappingError.code==="23505";return reply(origin,{error:duplicate?"Esse cadastro ou nome de usuário já foi vinculado.":"Não foi possível migrar o cadastro agora."},duplicate?409:500)}
   await admin.auth.admin.updateUserById(signedIn.user.id,{user_metadata:{...signedIn.user.user_metadata,username:String(rawUsername).trim()}});
   return reply(origin,{email:authEmail,username:String(rawUsername).trim()});
  }
  if(action!=="signup")return reply(origin,{error:"Ação inválida."},400);
  if(typeof password!=="string"||password.length<6||password.length>72)return reply(origin,{error:"A senha deve ter entre 6 e 72 caracteres."},400);
  const{data:existing}=await admin.from("username_credentials").select("user_id").eq("username_normalized",username).maybeSingle();
  if(existing)return reply(origin,{error:"Esse nome de usuário já está em uso."},409);
  const hash=await sha256(username),authEmail=`u_${hash.slice(0,32)}@anonymous-oh-analytics.vercel.app`;
  const{data:created,error:createError}=await admin.auth.admin.createUser({email:authEmail,password,email_confirm:true,user_metadata:{username}});
  if(createError||!created.user)return reply(origin,{error:"Não foi possível criar a conta agora."},400);
  const{error:mappingError}=await admin.from("username_credentials").insert({username_normalized:username,username_display:String(rawUsername).trim(),user_id:created.user.id,auth_email:authEmail});
  if(mappingError){await admin.auth.admin.deleteUser(created.user.id);const duplicate=mappingError.code==="23505";return reply(origin,{error:duplicate?"Esse nome de usuário já está em uso.":"Não foi possível criar a conta agora."},duplicate?409:500)}
  return reply(origin,{email:authEmail,username:String(rawUsername).trim()},201);
 }catch{return reply(origin,{error:"Não foi possível concluir a solicitação."},400)}
});