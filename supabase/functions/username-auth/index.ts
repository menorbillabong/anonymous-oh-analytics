import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const origins=new Set(["https://anonymous-oh-analytics.vercel.app","http://localhost:3000"]);
const previewOrigin=/^https:\/\/anonymous-oh-analytics(?:-[a-z0-9-]+)?-jf-anonymous\.vercel\.app$/;
const isAllowedOrigin=(origin:string)=>origins.has(origin)||previewOrigin.test(origin);
const reply=(origin:string,body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":isAllowedOrigin(origin)?origin:"https://anonymous-oh-analytics.vercel.app","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"}});
const normalize=(value:unknown)=>String(value??"").trim().toLowerCase();
const validUserId=(value:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value??""));
async function sha256(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("")}

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")??"";
 if(req.method==="OPTIONS")return reply(origin,{ok:true});
 if(req.method!=="POST")return reply(origin,{error:"Método não permitido."},405);
 if(origin&&!isAllowedOrigin(origin))return reply(origin,{error:"Origem não permitida."},403);
 try{
  const{action,username:rawUsername,password,email:rawEmail,targetUserId,reason:rawReason}=await req.json();
  const username=normalize(rawUsername);
  const admin=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
  if(action==="admin-update"){
   const authHeader=req.headers.get("authorization")??"";
   const token=authHeader.startsWith("Bearer ")?authHeader.slice(7).trim():"";
   if(!token)return reply(origin,{error:"Sessão administrativa inválida."},401);
   const{data:caller,error:callerError}=await admin.auth.getUser(token);
   if(callerError||!caller.user)return reply(origin,{error:"Sessão administrativa inválida."},401);
   const{data:adminRole,error:roleError}=await admin.from("admin_users").select("user_id").eq("user_id",caller.user.id).maybeSingle();
   if(roleError||!adminRole)return reply(origin,{error:"Acesso permitido somente para administradores."},403);
   if(!validUserId(targetUserId))return reply(origin,{error:"Conta de destino inválida."},400);
   const reason=String(rawReason??"").trim();
   if(reason.length<3||reason.length>300)return reply(origin,{error:"Informe um motivo entre 3 e 300 caracteres."},400);
   const usernameDisplay=String(rawUsername??"").trim();
   const changeUsername=Boolean(usernameDisplay);
   const changePassword=typeof password==="string"&&password.length>0;
   if(!changeUsername&&!changePassword)return reply(origin,{error:"Altere o nome de acesso ou informe uma nova senha."},400);
   if(changeUsername&&!/^[a-z0-9._-]{3,24}$/.test(username))return reply(origin,{error:"Use de 3 a 24 caracteres: letras, números, ponto, traço ou sublinhado."},400);
   if(changePassword&&(password.length<6||password.length>72))return reply(origin,{error:"A nova senha deve ter entre 6 e 72 caracteres."},400);

   const{data:target,error:targetError}=await admin.auth.admin.getUserById(String(targetUserId));
   if(targetError||!target.user)return reply(origin,{error:"Conta não encontrada."},404);
   const{data:oldCredential,error:credentialError}=await admin.from("username_credentials").select("username_normalized,username_display,user_id,auth_email").eq("user_id",String(targetUserId)).maybeSingle();
   if(credentialError)return reply(origin,{error:"Não foi possível consultar o acesso atual."},500);
   const usernameChanged=changeUsername&&username!==String(oldCredential?.username_normalized??"");

   if(usernameChanged){
    const{data:taken,error:takenError}=await admin.from("username_credentials").select("user_id").eq("username_normalized",username).maybeSingle();
    if(takenError)return reply(origin,{error:"Não foi possível verificar o nome de acesso."},500);
    if(taken&&String(taken.user_id)!==String(targetUserId))return reply(origin,{error:"Esse nome de usuário já está em uso."},409);
    const authEmail=String(oldCredential?.auth_email||target.user.email||"");
    if(!authEmail)return reply(origin,{error:"A conta não possui um acesso de autenticação válido."},400);
    const mapping=oldCredential
      ?admin.from("username_credentials").update({username_normalized:username,username_display:usernameDisplay,updated_at:new Date().toISOString()}).eq("user_id",String(targetUserId))
      :admin.from("username_credentials").insert({username_normalized:username,username_display:usernameDisplay,user_id:String(targetUserId),auth_email:authEmail});
    const{error:mappingError}=await mapping;
    if(mappingError){
     const duplicate=mappingError.code==="23505";
     return reply(origin,{error:duplicate?"Esse nome de usuário já está em uso.":"Não foi possível alterar o nome de acesso."},duplicate?409:500);
    }
   }

   const attributes:{password?:string;user_metadata?:Record<string,unknown>}={};
   if(changePassword)attributes.password=password;
   if(usernameChanged)attributes.user_metadata={...(target.user.user_metadata||{}),username:usernameDisplay};
   const{error:updateError}=await admin.auth.admin.updateUserById(String(targetUserId),attributes);
   if(updateError){
    if(usernameChanged){
     if(oldCredential){
      await admin.from("username_credentials").update({username_normalized:oldCredential.username_normalized,username_display:oldCredential.username_display,updated_at:new Date().toISOString()}).eq("user_id",String(targetUserId));
     }else{
      await admin.from("username_credentials").delete().eq("user_id",String(targetUserId));
     }
    }
    return reply(origin,{error:"Não foi possível alterar o acesso. Nenhuma alteração foi mantida."},500);
   }

   const{error:auditError}=await admin.from("admin_audit_logs").insert({
    admin_user_id:caller.user.id,
    target_user_id:String(targetUserId),
    action:"update_account_access",
    reason,
    metadata:{username_changed:usernameChanged,password_changed:changePassword},
   });
   if(auditError)return reply(origin,{error:"O acesso foi alterado, mas o registro de segurança falhou. Atualize o painel antes de tentar novamente.",updated:true},500);
   return reply(origin,{ok:true,username:usernameChanged?usernameDisplay:oldCredential?.username_display,passwordChanged:changePassword});
  }
  if(!/^[a-z0-9._-]{3,24}$/.test(username))return reply(origin,{error:"Use de 3 a 24 caracteres: letras, números, ponto, traço ou sublinhado."},400);
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

