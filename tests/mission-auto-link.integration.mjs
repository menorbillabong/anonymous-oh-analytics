// Isolated PostgreSQL-compatible fixture. Never connects to production.
// PGLITE_TEST_MODULE must point to the installed @electric-sql/pglite module.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
const db=new PGlite();
const admin='00000000-0000-0000-0000-000000000001';
const alice='00000000-0000-0000-0000-000000000002';
const bob='00000000-0000-0000-0000-000000000003';
const read=name=>readFile(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
const rows=async sql=>(await db.query(sql)).rows;
const scalar=async sql=>Object.values((await rows(sql))[0])[0];
const login=async id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
await db.exec(`
create role anon;create role authenticated;create schema auth;create schema private;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function private.account_active(id uuid) returns boolean language sql stable as $$select id is not null$$;
create function private.is_admin(id uuid) returns boolean language sql stable as $$select id='${admin}'::uuid$$;
create table auth.users(id uuid primary key);
insert into auth.users values('${admin}'),('${alice}'),('${bob}');
create table public.mission_profiles(id bigint primary key,user_id uuid references auth.users,name text,active boolean default true,reward integer);
create table public.posts(id bigint primary key,user_id uuid references auth.users,mission_profile_id bigint references public.mission_profiles,
 mission_name text,published_at date,x_published_at timestamptz,created_at timestamptz default now(),counting_excluded boolean default false,
 special_reward integer default 0,likes integer default 0);
create table public.mission_periods(user_id uuid,month date,status text);
grant usage on schema auth,private,public to authenticated,anon;
insert into public.mission_profiles values(1,'${alice}','Normal',true,0),(2,'${alice}','Bonus',true,200),
 (3,'${bob}','Normal',true,0),(4,'${bob}','Bonus',true,200);
`);
await db.exec(await read('20260916003201_add_shared_mission_selection_periods'));
await db.exec(await read('20260916025152_mission_period_management_and_legacy_assignment'));
await db.exec(await read('20260922190930_allow_zero_mission_auto_fill'));
await db.exec(await read('20261001061917_link_bonus_on_mission_period_save'));
await login(admin);

// Posts predate creation; only compatible bonus posts link, separately per user.
await db.exec(`insert into public.posts(id,user_id,mission_profile_id,published_at,special_reward,likes) values
 (10,'${alice}',2,'2090-01-10',200,17),(11,'${alice}',2,'2090-01-15',200,23),
 (12,'${alice}',2,'2090-01-15',200,31),(13,'${alice}',1,'2090-01-12',0,41),
 (14,'${bob}',4,'2090-01-10',200,53),(15,'${alice}',2,'2089-12-01',200,61);`);
const postsBefore=await rows('select * from public.posts order by id');
const first=await scalar("select public.create_mission_selection_period('2090-01-01','2090-01-15',2)");
assert.deepEqual(await rows('select post_id::int from public.mission_period_selections order by post_id'),[{post_id:10},{post_id:11},{post_id:14}]);
const second=await scalar("select public.create_mission_selection_period('2090-01-15','2090-01-31',1)");
assert.equal(await scalar('select period_id from public.mission_period_selections where post_id=12'),second);
assert.deepEqual(await rows('select * from public.posts order by id'),postsBefore,'auto linkage must not alter dates, bonuses, metrics or profiles');
const linksBefore=await rows('select * from public.mission_period_selections order by post_id');
await login(alice);
assert.equal(await scalar('select public.sync_my_mission_period_selections()'),0);
assert.deepEqual(await rows('select * from public.mission_period_selections order by post_id'),linksBefore,'repeat reconciliation preserves selections');

// Explicit manual selection is still allowed beyond automatic capacity.
await db.exec(`select public.set_my_mission_period_selection('${first}',13,2);`);
assert.equal(await scalar(`select count(*)::int from public.mission_period_selections where period_id='${first}' and user_id='${alice}'`),3);
await db.exec(`select public.set_my_mission_period_selection('${first}',13,null);`);
assert.equal(await scalar('select mission_profile_id::int from public.posts where id=13'),1);
assert.equal(await scalar('select public.sync_my_mission_period_selections()'),0,'deselction cannot be undone automatically');
await assert.rejects(db.exec("update public.posts set mission_profile_id=1 where id=10"),/Períodos de Missão/);

// Zero does not auto-fill. Enabling capacity reconciles and preserves existing links.
await login(admin);
await db.exec(`insert into public.posts(id,user_id,mission_profile_id,published_at) values(20,'${alice}',2,'2090-02-05');`);
const zero=await scalar("select public.create_mission_selection_period('2090-02-01','2090-02-10',0)");
assert.equal(await scalar('select count(*)::int from public.mission_period_selections where post_id=20'),0);
await db.exec(`select public.update_mission_selection_period('${zero}',1,'2090-02-01','2090-02-10',2);`);
assert.equal(await scalar('select period_id from public.mission_period_selections where post_id=20'),zero);
await assert.rejects(db.exec(`select public.update_mission_selection_period('${zero}',1,'2090-02-01','2090-02-10',3)`),/MISSION_PERIOD_STALE/);
await assert.rejects(db.exec(`select public.update_mission_selection_period('${zero}',2,'2090-02-06','2090-02-10',3)`),/MISSION_PERIOD_LINKED_OUTSIDE_DATES/);

// Classification save followed by authenticated reconciliation, including X timezone.
await db.exec(`insert into public.posts(id,user_id,mission_profile_id,published_at,x_published_at) values
 (21,'${alice}',1,'2090-02-11','2090-02-11T01:00:00Z'),(22,'${bob}',4,'2090-02-05',null);`);
await db.exec('update public.posts set mission_profile_id=2 where id=21');
await login(alice);
await db.exec('set role authenticated');
assert.equal(await scalar('select public.sync_my_mission_period_selections()'),1);
assert.equal(await scalar('select period_id from public.mission_period_selections where post_id=21'),zero,'X local date Feb 10, not supplied Feb 11');
assert.equal(await scalar('select count(*)::int from public.mission_period_selections where post_id=22'),0,'own RPC cannot sync another user');
await assert.rejects(db.exec(`select private.link_bonus_posts_for_mission_period('${zero}')`),/permission denied/);
await assert.rejects(db.exec("select public.create_mission_selection_period('2091-01-01','2091-01-10',2)"),/MISSION_PERIOD_ADMIN_REQUIRED/);
await db.exec('reset role');
assert.equal(await scalar('select count(*)::int from public.mission_period_selections where post_id=22'),0);
await login(bob);
assert.equal(await scalar('select public.sync_my_mission_period_selections()'),1,'capacity is per user');

// Null definitions remain pending; zero overlap does not block a positive window.
await login(admin);
await db.exec(`insert into public.mission_selection_periods(start_date,end_date,per_user_limit,created_by)
 values('2090-03-01','2090-03-10',null,'${admin}');
 insert into public.posts(id,user_id,mission_profile_id,published_at) values
 (30,'${alice}',2,'2090-03-05'),(31,'${alice}',2,'2090-04-10');`);
await scalar("select public.create_mission_selection_period('2090-03-01','2090-03-15',2)");
assert.equal(await scalar('select count(*)::int from public.mission_period_selections where post_id=30'),0);
await scalar("select public.create_mission_selection_period('2090-04-01','2090-04-10',0)");
const positive=await scalar("select public.create_mission_selection_period('2090-04-10','2090-04-20',1)");
assert.equal(await scalar('select period_id from public.mission_period_selections where post_id=31'),positive);

// Admin edits/deletion preserve profiles and rewards. No anonymous writes.
await db.exec(`select public.update_mission_selection_period('${first}',1,'2090-01-01','2090-01-15',0);`);
assert.equal(await scalar('select count(*)::int from public.mission_period_selections where post_id in(10,11,14)'),3);
const preserved=await rows('select * from public.posts order by id');
await db.exec(`select public.delete_mission_selection_period('${first}',2);`);
assert.deepEqual(await rows('select * from public.posts order by id'),preserved);
await login('');
await assert.rejects(db.exec("select public.create_mission_selection_period('2091-01-01','2091-01-10',2)"),/MISSION_PERIOD_ADMIN_REQUIRED/);
await assert.rejects(db.exec('select public.sync_my_mission_period_selections()'),/MISSION_PERIOD_AUTH_REQUIRED/);
// Bulk deletion: authorization, stale screens, atomic rollback and preservation.
await db.exec(await read('20261001070518_bulk_delete_mission_selection_periods'));
await login(admin);
const batchPeriods=await rows('select id,revision from public.mission_selection_periods order by id limit 2');
const batchSql=items=>`select public.delete_mission_selection_periods('${JSON.stringify(items)}'::jsonb)`;
const snapshot=async()=>({
 periods:await rows('select * from public.mission_selection_periods order by id'),
 links:await rows('select * from public.mission_period_selections order by post_id'),
 posts:await rows('select * from public.posts order by id'),
 profiles:await rows('select * from public.mission_profiles order by id'),
 closures:await rows('select * from public.mission_periods order by user_id'),
 audit:await rows('select * from private.mission_selection_period_audit order by id'),
});
const beforeBulk=await snapshot();
await assert.rejects(db.exec(batchSql([batchPeriods[0],{...batchPeriods[1],revision:999}])),/MISSION_PERIOD_STALE/);
await assert.rejects(db.exec(batchSql([batchPeriods[0],{id:'ffffffff-ffff-ffff-ffff-ffffffffffff',revision:1}])),/MISSION_PERIOD_STALE/);
for(const invalid of [[],[batchPeriods[0],batchPeriods[0]],[{id:batchPeriods[0].id}],{},null]){
 await assert.rejects(db.exec(batchSql(invalid)),/MISSION_PERIOD_BULK_INVALID/);
}
await login(alice);await db.exec('set role authenticated');
await assert.rejects(db.exec(batchSql(batchPeriods)),/MISSION_PERIOD_ADMIN_REQUIRED/);
await db.exec('reset role');await login('');
await assert.rejects(db.exec(batchSql(batchPeriods)),/MISSION_PERIOD_ADMIN_REQUIRED/);
await db.exec('set role anon');
await assert.rejects(db.exec(batchSql(batchPeriods)),/permission denied/);
await db.exec('reset role');await login(admin);
assert.deepEqual(await snapshot(),beforeBulk,'rejected batches leave every row untouched');
// Force the second delete to fail after the first one would have run.
await db.exec(`create function private.fail_second_test_delete() returns trigger language plpgsql as $$begin
 if old.id='${batchPeriods[1].id}'::uuid then raise exception 'TEST_DELETE_FAILURE';end if;return old;end$$;
 create trigger test_delete_failure before delete on public.mission_selection_periods for each row execute function private.fail_second_test_delete();`);
await assert.rejects(db.exec(batchSql(batchPeriods)),/TEST_DELETE_FAILURE/);
assert.deepEqual(await snapshot(),beforeBulk,'partial failure rolls back all deletions and audit writes');
await db.exec('drop trigger test_delete_failure on public.mission_selection_periods;drop function private.fail_second_test_delete()');
await db.exec('set role authenticated');
assert.equal(await scalar(batchSql(batchPeriods)),2);
await db.exec('reset role');
const afterBulk=await snapshot();
const deletedIds=new Set(batchPeriods.map(period=>period.id));
assert.deepEqual(afterBulk.periods,beforeBulk.periods.filter(period=>!deletedIds.has(period.id)));
assert.deepEqual(afterBulk.links,beforeBulk.links.filter(link=>!deletedIds.has(link.period_id)));
for(const key of ['posts','profiles','closures'])assert.deepEqual(afterBulk[key],beforeBulk[key],`${key} must be preserved`);
assert.equal(afterBulk.audit.length,beforeBulk.audit.length+2,'one recovery audit per deleted period');
await db.close();
console.log('PASS: period creation/edit, post classification reconciliation, overlaps, per-user limits, zero/null, manual excess/removal, existing links, snapshot preservation, timezone, admin/owner/anonymous permissions and period deletion.');
