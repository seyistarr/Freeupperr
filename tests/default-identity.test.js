import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {setup,register,profile} from './helpers/default-identity-fixture.js';
test('Google and email registration use existing database ID, ignore metadata and remain incomplete; repeat logins preserve custom identity',async()=>{
 const db=await setup();try{
 for(const provider of ['google','email']){
  const id=await register(db,provider,{username:'private@example.test',display_name:'private@example.test'});
  let p=await profile(db,id);assert.equal(p.id,id);assert.match(p.freeupper_id,/^FU[A-F0-9]{12}$/);
  assert.equal(p.username,p.freeupper_id.toLowerCase());assert.equal(p.display_username,p.username);assert.equal(p.display_name,'FreeUpper User');
  assert.equal(p.onboarding_completed,false);assert.equal(p.profile_setup_completed_at,null);
  const custom='custom_'+provider;await db.query('update profiles set username=$1,display_name=$2 where id=$3',[custom,'Custom Name',id]);
  await db.query("update auth.users set raw_user_meta_data='{\"display_name\":\"Changed Google Name\"}' where id=$1",[id]);
  let q=await profile(db,id);assert.equal(q.username,custom);assert.equal(q.display_name,'Custom Name');assert.equal(q.freeupper_id,p.freeupper_id);assert.deepEqual(q.created_at,p.created_at);
 }
 }finally{await db.close();}
});
test('many registration requests stay unique; duplicate IDs and usernames fail atomically; validation and RLS enforce boundaries',async()=>{
 const db=await setup();try{
 const ids=await Promise.all(Array.from({length:20},()=>register(db)));const rows=(await db.query('select username from profiles')).rows;
 assert.equal(new Set(rows.map(p=>p.username)).size,20);
 const a=await profile(db,ids[0]),b=await profile(db,ids[1]);
 await assert.rejects(db.query('update profiles set username=$1 where id=$2',[a.username,b.id]),/reserved/);
 await db.query("update profiles set username='custom' where id=$1",[a.id]);
 await assert.rejects(db.query("update profiles set username='CUSTOM' where id=$1",[b.id]),/Invalid/);
 await assert.rejects(db.query("update profiles set username='custom' where id=$1",[b.id]),/unique/);
 await assert.rejects(db.query("update profiles set display_name='private@example.test' where id=$1",[a.id]),/Invalid/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a.id]);await db.exec('set role authenticated');
 assert.equal((await db.query("update profiles set display_name='Attacker' where id=$1 returning id",[b.id])).rows.length,0);
 await assert.rejects(db.query('select * from identity_private.stage2_profile_backup'),/permission/);
 await assert.rejects(db.query('select public.handle_new_user()'),/permission/);
 await db.exec('reset role');
 }finally{await db.close();}
});
test('browser signup and recovery never derive names from email or manufacture a FreeUpper ID',async()=>{
 const auth=await readFile('auth.js','utf8');assert.doesNotMatch(auth,/email\.split|baseUsername|randomSuffix|display_name:.*metadata|username:.*metadata/);
 assert.match(auth,/signUp\(\{ email, password \}\)/);assert.match(auth,/provider: 'google'/);
 assert.equal((auth.match(/ignoreDuplicates: true/g)||[]).length,2);
 const schema=await readFile('supabase/migrations/20261015000000_profile_setup_completion.sql','utf8');assert.match(schema,/profile_setup_completed_at IS NOT NULL/);
 const mentions=await readFile('mentions.js','utf8');assert.match(mentions,/data-userid="\$\{m.userId\}"/);
});

test('forced repeated generator collisions abort Auth insertion without partial data; invalid IDs fail closed',async()=>{
 const db=await setup();try{
 await db.exec("alter table profiles alter freeupper_id set default 'FUAAAAAAAAAAAA'");
 await register(db);
 await assert.rejects(register(db),/unique/);
 assert.equal((await db.query('select count(*) n from auth.users')).rows[0].n,1);
 assert.equal((await db.query('select count(*) n from profiles')).rows[0].n,1);
 await db.exec("alter table profiles alter freeupper_id set default 'invalid'");await assert.rejects(register(db),/Invalid database/);
 assert.equal((await db.query('select count(*) n from auth.users')).rows[0].n,1);
 }finally{await db.close();}
});

test('authenticated missing-profile recovery gets backend defaults and cannot insert a different owner',async()=>{
 const db=await setup();try{
 const a=await register(db),b=await register(db);await db.query('delete from profiles where id=$1',[a]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);await db.exec('set role authenticated');
 await db.query("insert into profiles(id,username,display_name,onboarding_completed,profile_setup_completed_at) values($1,'private@example.test','private@example.test',true,now())",[a]);
 const p=await profile(db,a);assert.equal(p.username,p.freeupper_id.toLowerCase());assert.equal(p.display_name,'FreeUpper User');assert.equal(p.onboarding_completed,false);assert.equal(p.profile_setup_completed_at,null);
 await assert.rejects(db.query('insert into profiles(id) values($1)',[b]),/row-level security/);
 await db.exec('reset role');
 }finally{await db.close();}
});
