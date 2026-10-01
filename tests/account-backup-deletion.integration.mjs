// Isolated in-memory database: never connects to the production service.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
const db=new PGlite();
const admin='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
const session='00000000-0000-0000-0000-000000000003';
const backup='00000000-0000-0000-0000-000000000004',retained='00000000-0000-0000-0000-000000000005',pending='00000000-0000-0000-0000-000000000006';
const read=name=>readFile(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
const rows=async sql=>(await db.query(sql)).rows;
const login=async(id,sid=session)=>db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({session_id:sid})]);
await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
 create function private.is_admin(id uuid) returns boolean language sql stable as $$select id='${admin}'::uuid$$;
 create table auth.users(id uuid primary key);
 create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
 insert into auth.users values('${admin}'),('${other}');insert into auth.sessions values('${session}','${admin}',null);
 create table public.posts(id integer primary key,user_id uuid,title text);
 insert into public.posts values(1,'${other}','preserve');
 create table public.admin_audit_logs(id bigint generated always as identity primary key,admin_user_id uuid,action text,
 reason text,metadata jsonb,constraint admin_audit_logs_action_check check(action in ('delete_inactive_account','suspend')));
 create table private.account_deletion_backups(id uuid primary key,target_user_id uuid,deleted_at timestamptz,snapshot jsonb);
 alter table private.account_deletion_backups enable row level security;
 insert into private.account_deletion_backups values('${backup}','${other}',now(),'{"sensitive":"fixture"}'),('${retained}','${other}',now(),'{"keep":true}'),('${pending}','${other}',null,'{}');
 grant usage on schema public,private,auth to authenticated,anon,service_role;`);
// Exercise the same session check used in production, not a permissive mock.
const source=await read('20260920151815_safe_account_review_and_activity');
const start=source.indexOf('create function private.require_account_review_admin()');
const end=source.indexOf('create function private.admin_preview_account_review',start);
await db.exec(source.slice(start,end));
await db.exec(await read('20261001175111_admin_delete_account_backup'));
const snapshot=async()=>({backups:await rows('select * from private.account_deletion_backups order by id'),users:await rows('select * from auth.users order by id'),posts:await rows('select * from public.posts order by id'),logs:await rows('select * from public.admin_audit_logs order by id')});
const before=await snapshot();
const remove=(id=backup,confirmation='EXCLUIR')=>db.query('select public.admin_delete_account_backup($1,$2) as result',[id,confirmation]);
for(const role of ['anon','service_role']){await db.exec(`set role ${role}`);await assert.rejects(remove(),/permission denied/);await db.exec('reset role');}
await db.exec('set role authenticated');
for(const [id,sid] of [['',session],[other,session],[admin,retained]]){await login(id,sid);await assert.rejects(remove(),/Sessão administrativa/);}
await db.exec('reset role');await db.exec("update auth.sessions set not_after=now()-interval '1 minute'");
await login(admin);await db.exec('set role authenticated');await assert.rejects(remove(),/Sessão administrativa/);
await db.exec('reset role');await db.exec('update auth.sessions set not_after=null');await db.exec('set role authenticated');
for(const confirmation of ['',null,'ERRADO'])await assert.rejects(remove(backup,confirmation),/Digite EXCLUIR/);
await assert.rejects(remove(pending),/ainda não concluída/);
await assert.rejects(remove('ffffffff-ffff-ffff-ffff-ffffffffffff'),/Cópia não encontrada/);
await assert.rejects(db.exec('delete from private.account_deletion_backups'),/permission denied/);
await db.exec('reset role');assert.deepEqual(await snapshot(),before);
// A failed audit prevents deletion, rather than losing the recovery copy silently.
await db.exec(`create function private.fail_audit() returns trigger language plpgsql as $$begin raise exception 'TEST_AUDIT_FAILURE';end$$;
 create trigger fail_audit before insert on public.admin_audit_logs for each row execute function private.fail_audit();`);
await db.exec('set role authenticated');await assert.rejects(remove(),/TEST_AUDIT_FAILURE/);await db.exec('reset role');
assert.deepEqual(await snapshot(),before);
await db.exec('drop trigger fail_audit on public.admin_audit_logs;drop function private.fail_audit();set role authenticated');
assert.deepEqual((await remove()).rows[0].result,{deleted:true,backup_id:backup});
await assert.rejects(remove(),/Cópia não encontrada/);
await db.exec('reset role');const after=await snapshot();
assert.deepEqual(after.backups,before.backups.filter(row=>row.id!==backup));
assert.deepEqual(after.users,before.users);assert.deepEqual(after.posts,before.posts);
assert.equal(after.logs.length,1);assert.equal(after.logs[0].action,'delete_account_backup');
assert.deepEqual(after.logs[0].metadata,{backup_id:backup});
await db.exec(`insert into public.admin_audit_logs(action) values('suspend')`);
await assert.rejects(db.exec("insert into public.admin_audit_logs(action) values('arbitrary-action')"),/admin_audit_logs_action_check/);
await db.close();
console.log('PASS: anonymous/nonadmin/revoked session denied; explicit confirmation; pending backups protected; audit failure rollback; only selected backup removed; users/posts/other backups intact; retry safe; original audit constraint retained.');
