import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup, profile} from './helpers/default-identity-fixture.js';

const migration=await readFile('supabase/migrations/20261112174353_google_signup_display_name.sql','utf8');
const rollback=await readFile('docs/identity/google-display-name-rollback.sql','utf8');
async function database(apply=true){
 const db=await setup();
 await db.exec(`alter table auth.users add raw_app_meta_data jsonb default '{}';
 create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),provider text,identity_data jsonb,created_at timestamptz default now());`);
 if(apply) await db.exec(migration);
 return db;
}
async function signup(db,{provider='google',data={full_name:'Samantha Johnson'},email='canary@example.test',metadata={full_name:'Untrusted Browser Name'},beforeCommit}={}){
 await db.exec('begin');
 try{
 const id=(await db.query('insert into auth.users(email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3) returning id',[email,{provider},metadata])).rows[0].id;
 assert.equal((await profile(db,id)).display_name,'FreeUpper User','profile precedes provider identity');
 await db.query('insert into auth.identities(user_id,provider,identity_data) values($1,$2,$3)',[id,provider,data]);
 if(beforeCommit) await beforeCommit(id);
 await db.exec('commit');return id;
 }catch(e){await db.exec('rollback');throw e;}
}

test('new Google signup reads the trusted identity after creation, preserves ID defaults and incompleteness',async()=>{
 const db=await database();try{
 const id=await signup(db);const p=await profile(db,id);
 assert.equal(p.display_name,'Samantha Johnson');assert.equal(p.id,id);
 assert.match(p.freeupper_id,/^FU[0-9A-F]{12}$/);assert.equal(p.username,p.freeupper_id.toLowerCase());assert.equal(p.display_username,p.username);
 assert.equal(p.profile_setup_completed_at,null);assert.equal(p.onboarding_completed,false);
 const result=(await db.query('select * from get_public_profile_by_username($1)',[p.username])).rows[0];
 assert.equal(result.display_name,p.display_name);assert.equal(result.profile_id,id);assert.equal('email' in result,false);
 assert.equal((await db.query('select * from get_public_profile_by_username($1)',['canary@example.test'])).rows.length,0);
 }finally{await db.close();}
});
test('missing, invalid, email and email-local-part Google names retain the private default',async()=>{
 const db=await database();try{
 for(const data of [{},{full_name:null},{full_name:123},{full_name:' '},{full_name:'A'},{full_name:'A'.repeat(41)},{full_name:'canary@example.test'},{full_name:'CANARY'},{full_name:'Alternate',email:'alternate@example.test'},{full_name:'<script>Oops</script>'},{full_name:'\u200b\u202e'}]){
 const id=await signup(db,{data});assert.equal((await profile(db,id)).display_name,'FreeUpper User',JSON.stringify(data));
 }
 }finally{await db.close();}
});
test('provider name fallback, whitespace, Unicode and control sanitation follow existing name limits',async()=>{
 const db=await database();try{
 for(const [data,expected] of [[{name:'Samantha Johnson'},'Samantha Johnson'],[{full_name:'  Samantha\t Johnson\n '},'Samantha Johnson'],[{full_name:'Zoë 李'},'Zoë 李'],[{full_name:'Sa\u0001mantha \u202eJohnson'},'Samantha Johnson'],[{full_name:'N'.repeat(40)},'N'.repeat(40)]]){
 const id=await signup(db,{data});assert.equal((await profile(db,id)).display_name,expected);
 }
 }finally{await db.close();}
});
test('email signup and spoofed browser metadata cannot initialize Google names',async()=>{
 const db=await database();try{
 const id=await signup(db,{provider:'email',data:{full_name:'Spoofed Name'}});assert.equal((await profile(db,id)).display_name,'FreeUpper User');
 await db.exec('begin');const missing=(await db.query("insert into auth.users(raw_app_meta_data,raw_user_meta_data) values('{\"provider\":\"google\"}','{\"full_name\":\"Browser Spoof\"}') returning id")).rows[0].id;await db.exec('commit');
 assert.equal((await profile(db,missing)).display_name,'FreeUpper User');
 }finally{await db.close();}
});
test('repeat login and provider linking never overwrite a default or customized existing identity',async()=>{
 const db=await database(false);try{
 const old=await signup(db,{data:{full_name:'Old Google Name'}}); // no initializer installed yet
 const before=await profile(db,old);await db.exec(migration);
 assert.deepEqual(await profile(db,old),before);
 const id=await signup(db);await db.query("update profiles set username='personal_name',display_name='Chosen Name' where id=$1",[id]);const custom=await profile(db,id);
 for(const target of [old,id]){
 await db.query("update auth.users set raw_user_meta_data='{\"full_name\":\"Changed Name\"}' where id=$1",[target]);
 await db.query("update auth.identities set identity_data='{\"full_name\":\"Changed Name\"}' where user_id=$1",[target]);
 await db.query("insert into auth.identities(user_id,provider,identity_data) values($1,'google','{\"full_name\":\"Linked Name\"}')",[target]);
 }
 assert.deepEqual(await profile(db,old),before);assert.deepEqual(await profile(db,id),custom);
 }finally{await db.close();}
});
test('custom changes made within signup are preserved by the deferred initializer',async()=>{
 const db=await database();try{
 const id=await signup(db,{beforeCommit:async id=>db.query("update profiles set display_name='Chosen During Signup' where id=$1",[id])});
 assert.equal((await profile(db,id)).display_name,'Chosen During Signup');
 }finally{await db.close();}
});
test('same Google full names do not collide with unique usernames; failed signup rolls back',async()=>{
 const db=await database();try{
 const ids=[];for(let i=0;i<12;i++)ids.push(await signup(db));
 const rows=(await db.query('select * from profiles')).rows;
 assert.equal(new Set(rows.map(p=>p.username)).size,12);assert.ok(rows.every(p=>p.display_name==='Samantha Johnson'));
 await assert.rejects(signup(db,{beforeCommit:async()=>{throw new Error('abort signup');}}),/abort signup/);
 assert.equal((await db.query('select count(*) n from profiles')).rows[0].n,12);
 }finally{await db.close();}
});
test('Auth identities and private initializer cannot be written or invoked by browser database roles',async()=>{
 const db=await database();try{
 const fn=(await db.query("select prosecdef,proconfig from pg_proc where oid='identity_private.initialize_google_display_name()'::regprocedure")).rows[0];
 assert.equal(fn.prosecdef,true);assert.ok(fn.proconfig.includes('search_path=\"\"'));
 for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role}`);
 await assert.rejects(db.query("insert into auth.identities(provider) values('google')"),/permission/);
 await assert.rejects(db.query('select identity_private.initialize_google_display_name()'),/permission/);
 await db.exec('reset role');
 }
 await db.exec('create role supabase_auth_admin; grant usage on schema auth to supabase_auth_admin; grant select,insert on auth.users,auth.identities to supabase_auth_admin; grant select on profiles to supabase_auth_admin; set role supabase_auth_admin');
 const backendId=await signup(db);assert.equal((await profile(db,backendId)).display_name,'Samantha Johnson');
 await db.exec('reset role');
 const id=await signup(db);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');
 await db.query("update profiles set display_name='My Own Name' where id=$1",[id]);
 assert.equal((await profile(db,id)).display_name,'My Own Name');
 await assert.rejects(db.query("update profiles set display_name='canary@example.test' where id=$1",[id]),/Invalid display name/);
 await db.exec('reset role');
 }finally{await db.close();}
});
test('rollback removes only the initializer and leaves previously created profile identities intact',async()=>{
 const db=await database();try{
 const id=await signup(db);const before=await profile(db,id);
 await db.exec(rollback);
 assert.deepEqual(await profile(db,id),before);
 const next=await signup(db);assert.equal((await profile(db,next)).display_name,'FreeUpper User');
 }finally{await db.close();}
});
