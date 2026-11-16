import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setup,asUser,publish,uid,migration} from './helpers/chat-activity-fixture.js';

test('server-assigned activity identity and per-event RLS with production-shaped authorization',async t=>{
 const db=new PGlite();
 try{
 await setup(db);await db.exec(migration);
 await t.test('RPC derives sender from auth.uid; own source cannot impersonate another member',async()=>{
  await publish(db,uid(1));
  const rows=(await asUser(db,uid(2),'SELECT * FROM public.chat_activity')).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].user_id,uid(1));assert.equal(rows[0].kind,'recording');
  await assert.rejects(asUser(db,uid(1),`INSERT INTO public.chat_activity(conversation_id,user_id) VALUES('${uid(11)}','${uid(2)}')`),/permission denied/);
  await assert.rejects(asUser(db,null,'SELECT * FROM public.chat_activity',[],'anon'),/permission denied/);
  await assert.rejects(publish(db,null),/unavailable/);
 });
 await t.test('current direct participants allowed, outsider and notes denied, blocks apply in both directions',async()=>{
  await publish(db,uid(1),uid(10));
  assert.equal((await asUser(db,uid(2),'SELECT * FROM public.get_chat_activity($1)',[uid(10)])).rows.length,1);
  await assert.rejects(publish(db,uid(4),uid(10)),/unavailable/);
  await assert.rejects(publish(db,uid(1),uid(12)),/unavailable/);
  for(const pair of [[1,2],[2,1]]){
   await db.exec(`INSERT INTO blocks VALUES('${uid(pair[0])}','${uid(pair[1])}');`);
   await assert.rejects(publish(db,uid(1),uid(10),2),/unavailable/);
   assert.equal((await asUser(db,uid(2),'SELECT * FROM public.chat_activity WHERE conversation_id=$1',[uid(10)])).rows.length,0);
   await db.exec('DELETE FROM blocks');
  }
 });
 await t.test('continuing subscriber loses per-event access after membership removal; reconnect snapshot denied',async()=>{
  const read=()=>asUser(db,uid(3),'SELECT * FROM public.chat_activity WHERE conversation_id=$1',[uid(11)]);
  assert.equal((await read()).rows.length,1);
  await db.exec(`DELETE FROM conversation_members WHERE user_id='${uid(3)}';`);
  await publish(db,uid(1),uid(11),2);
  assert.equal((await read()).rows.length,0);
  await assert.rejects(asUser(db,uid(3),'SELECT * FROM public.get_chat_activity($1)',[uid(11)]),/unavailable/);
  await assert.rejects(publish(db,uid(3),uid(11),3),/unavailable/);
  // A removed owner cannot fall back to the legacy user1_id column.
  await db.exec(`DELETE FROM conversation_members WHERE user_id='${uid(1)}';`);
  await assert.rejects(publish(db,uid(1),uid(11),3),/unavailable/);
  await db.exec(`INSERT INTO conversation_members VALUES('${uid(11)}','${uid(1)}','owner');`);
 });
 await t.test('admin-only group sending, server deadlines, and replay sequence protection',async()=>{
  await db.exec(`UPDATE conversations SET permissions='{"send_messages":"admins"}' WHERE id='${uid(11)}';`);
  await assert.rejects(publish(db,uid(2),uid(11),2),/unavailable/);
  await publish(db,uid(1),uid(11),10,{kind:'photo',stage:'uploading'});
  assert.equal((await publish(db,uid(1),uid(11),9,{kind:'video'})).rows[0].accepted,false);
  const row=(await asUser(db,uid(2),'SELECT * FROM public.chat_activity WHERE conversation_id=$1',[uid(11)])).rows[0];
  assert.equal(row.sequence,10);assert.equal(row.kind,'photo');
  assert.equal(new Date(row.expires_at)-new Date(row.updated_at),7000);
  await assert.rejects(publish(db,uid(1),uid(11),11,{kind:'filename.mp4'}),/Invalid activity/);
  await publish(db,uid(1),uid(11),11,{kind:null,active:false});
  assert.equal((await asUser(db,uid(2),'SELECT * FROM public.get_chat_activity($1)',[uid(11)])).rows.length,0);
 });
 await t.test('broad grants/permissive policies cannot bypass table or Broadcast guards',async()=>{
  await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.chat_activity TO anon,authenticated;
  CREATE POLICY fixture_broad ON public.chat_activity FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
  CREATE POLICY fixture_broad_rt ON realtime.messages FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
  INSERT INTO realtime.messages(topic,extension) VALUES('unrelated','broadcast');`);
  assert.equal((await asUser(db,uid(4),'SELECT * FROM public.chat_activity')).rows.length,0);
  assert.equal((await asUser(db,null,'SELECT * FROM public.chat_activity',[],'anon')).rows.length,0);
  assert.equal((await asUser(db,uid(1),`UPDATE public.chat_activity SET user_id='${uid(2)}' RETURNING *`)).rows.length,0);
 });
 await t.test('permissive conversation UPDATE cannot rewrite identity or let non-admins change send rules',async()=>{
  await db.exec(`GRANT SELECT,UPDATE ON conversations TO authenticated;
   CREATE POLICY fixture_broad_conv ON conversations FOR ALL TO authenticated USING(true) WITH CHECK(true);`);
  await assert.rejects(asUser(db,uid(4),`UPDATE conversations SET is_group=false WHERE id='${uid(11)}'`),/identity requires/);
  await assert.rejects(asUser(db,uid(2),`UPDATE conversations SET permissions='{"send_messages":"everyone"}' WHERE id='${uid(11)}'`),/administrators/);
  await asUser(db,uid(1),`UPDATE conversations SET permissions='{"send_messages":"everyone"}' WHERE id='${uid(11)}'`);
 });
 await t.test('role RPC rejects non-member/null-owner bypass and keeps current owner role management',async()=>{
  await assert.rejects(asUser(db,uid(4),'SELECT public.set_member_role($1,$2,$3)',[uid(11),uid(2),'admin']),/current group owner/);
  await assert.rejects(asUser(db,uid(2),'SELECT public.set_member_role($1,$2,$3)',[uid(11),uid(2),'admin']),/current group owner/);
  await asUser(db,uid(1),'SELECT public.set_member_role($1,$2,$3)',[uid(11),uid(2),'admin']);
  assert.equal((await db.query('SELECT role FROM conversation_members WHERE user_id=$1',[uid(2)])).rows[0].role,'admin');
 });
 await t.test('legacy private activity channels are quarantined even with broad permissive policies',async()=>{
  for(const user of [uid(1),uid(3),uid(4)]){
   await db.exec(`SELECT set_config('realtime.topic','chat-activity:${uid(11)}',false);`);
   assert.equal((await asUser(db,user,'SELECT * FROM realtime.messages')).rows.length,0);
   await assert.rejects(asUser(db,user,`INSERT INTO realtime.messages(topic,extension) VALUES('chat-activity:${uid(11)}','broadcast')`),/row-level security/);
  }
  await db.exec("SELECT set_config('realtime.topic','unrelated',false);");
  assert.equal((await asUser(db,uid(4),'SELECT * FROM realtime.messages')).rows.length,1);
 });
 await t.test('private database channel admits current participants, rejects revoked/outsiders and denies client broadcasts',async()=>{
  const topic='chat-activity-db:'+uid(11);
  for(const [user,expected] of [[uid(1),true],[uid(2),true],[uid(3),false],[uid(4),false]]) {
   assert.equal((await asUser(db,user,'SELECT public.can_join_chat_activity($1) AS allowed',[topic])).rows[0].allowed,expected);
   await db.exec(`SELECT set_config('realtime.topic','${topic}',false);`);
   await assert.rejects(asUser(db,user,`INSERT INTO realtime.messages(topic,extension) VALUES('${topic}','broadcast')`),/row-level security/);
  }
 });
 await t.test('rollback preserves conversations and unrelated policies; leaves Broadcast quarantine',async()=>{
  const before=(await db.query('SELECT * FROM conversations ORDER BY id')).rows;
  await db.exec(readFileSync('docs/chat-upgrades/rollback.REVIEW.sql','utf8'));
  assert.deepEqual((await db.query('SELECT * FROM conversations ORDER BY id')).rows,before);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname='fixture_broad_rt'")).rows[0].n,1);
 });
 }finally{await db.close();}
});
