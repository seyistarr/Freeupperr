import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync('supabase/migrations/20261116172043_chat_activity_authorization.sql','utf8');
const catalog=JSON.parse(readFileSync('docs/chat-upgrades/production-schema-readonly.json','utf8')).catalog;
const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const topic=n=>'chat-activity:'+uid(n);

test('activity migration against isolated production-shaped schema: RLS, idempotence, revocation and rollback',async t=>{
 const db=new PGlite();
 try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA realtime;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth,realtime TO anon,authenticated;
 CREATE TABLE public.conversations(id uuid PRIMARY KEY,user1_id uuid,user2_id uuid,is_group boolean DEFAULT false,is_note boolean DEFAULT false,permissions jsonb DEFAULT '{"send_messages":"everyone"}');
 CREATE TABLE public.conversation_members(conversation_id uuid REFERENCES conversations(id),user_id uuid,role text,UNIQUE(conversation_id,user_id));
 CREATE TABLE public.blocks(blocker_id uuid,blocked_id uuid);
 CREATE TABLE realtime.messages(id uuid DEFAULT gen_random_uuid(),topic text NOT NULL,extension text NOT NULL,payload jsonb);
 ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
 ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
 ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT ON realtime.messages TO anon,authenticated;
 CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('realtime.topic',true),'') $$;`);
 // Use the inspected production helper definitions, not a replacement authorization implementation.
 for(const name of ['is_blocked_between','can_send_in_conversation']) {
  const f=catalog.find(x=>x.section==='functions').detail.find(x=>x.proname===name);
  await db.exec(f.definition);
 }
 await db.exec(`INSERT INTO conversations VALUES('${uid(10)}','${uid(1)}','${uid(2)}',false,false,DEFAULT),
 ('${uid(11)}','${uid(1)}',NULL,true,false,DEFAULT),('${uid(12)}','${uid(1)}',NULL,false,true,DEFAULT);
 INSERT INTO conversation_members VALUES('${uid(11)}','${uid(1)}','owner'),('${uid(11)}','${uid(2)}','member');
 INSERT INTO realtime.messages(topic,extension) VALUES('${topic(10)}','broadcast'),('${topic(11)}','broadcast'),('unrelated','broadcast');`);
 const check=async(user,room,sql='SELECT public.can_use_chat_activity(realtime.topic()) AS allowed',role='authenticated')=>{
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user ? uid(user):''}',false); SELECT set_config('realtime.topic','${room}',false);`);
  try{return await db.query(sql);}finally{await db.exec('RESET ROLE');}
 };
 await db.exec(migration); await db.exec(migration);
 await t.test('authenticated direct participants; unrelated, malformed, null-auth and notes denied',async()=>{
  for(const user of [1,2]) assert.equal((await check(user,topic(10))).rows[0].allowed,true);
  for(const [user,room] of [[3,topic(10)],[null,topic(10)],[1,'typing:'+uid(10)],[1,'chat-activity:bad'],[1,topic(10)+':suffix'],[1,topic(12)]])
   assert.equal((await check(user,room)).rows[0].allowed,false);
  await assert.rejects(check(null,topic(10),'SELECT public.can_use_chat_activity(realtime.topic())','anon'),/permission denied/);
 });
 await t.test('receive and send policies work for actual authenticated roles',async()=>{
  assert.equal((await check(1,topic(10),'SELECT * FROM realtime.messages')).rows.length,3); // Realtime evaluates authorization by topic; rows are probes.
  assert.equal((await check(3,topic(10),'SELECT * FROM realtime.messages')).rows.length,0);
  await check(2,topic(10),`INSERT INTO realtime.messages(topic,extension) VALUES('${topic(10)}','broadcast')`);
  await assert.rejects(check(3,topic(10),`INSERT INTO realtime.messages(topic,extension) VALUES('${topic(10)}','broadcast')`),/row-level security/);
 });
 await t.test('group membership revocation cannot fall back to user1_id; send permissions are distinct',async()=>{
  assert.equal((await check(1,topic(11))).rows[0].allowed,true);
  await db.exec(`DELETE FROM conversation_members WHERE user_id='${uid(1)}';`);
  assert.equal((await check(1,topic(11))).rows[0].allowed,false);
  await db.exec(`UPDATE conversations SET permissions='{"send_messages":"admins"}' WHERE id='${uid(11)}';`);
  assert.equal((await check(2,topic(11))).rows[0].allowed,true);
  await assert.rejects(check(2,topic(11),`INSERT INTO realtime.messages(topic,extension) VALUES('${topic(11)}','broadcast')`),/row-level security/);
 });
 await t.test('blocking in either direction denies direct activity',async()=>{
  for(const pair of [[1,2],[2,1]]){
   await db.exec(`INSERT INTO blocks VALUES('${uid(pair[0])}','${uid(pair[1])}');`);
   assert.equal((await check(1,topic(10))).rows[0].allowed,false);
   assert.equal((await check(2,topic(10))).rows[0].allowed,false);
   await db.exec('DELETE FROM blocks');
  }
 });
 await t.test('future broad permissive policies cannot bypass guards; unrelated topics survive',async()=>{
  await db.exec('CREATE POLICY fixture_broad ON realtime.messages FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);');
  assert.equal((await check(3,topic(10),'SELECT * FROM realtime.messages')).rows.length,0);
  assert.equal((await check(null,topic(10),'SELECT * FROM realtime.messages','anon')).rows.length,0);
  await assert.rejects(check(3,topic(10),`INSERT INTO realtime.messages(topic,extension) VALUES('${topic(10)}','broadcast')`),/row-level security/);
  assert.ok((await check(3,'unrelated','SELECT * FROM realtime.messages')).rows.length>0);
 });
 await t.test('rollback removes only owned objects and preserves conversation and message rows',async()=>{
  const before=await db.query('SELECT * FROM conversations ORDER BY id');
  await db.exec(readFileSync('docs/chat-upgrades/rollback.REVIEW.sql','utf8'));
  assert.deepEqual((await db.query('SELECT * FROM conversations ORDER BY id')).rows,before.rows);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname='fixture_broad'")).rows[0].n,1);
 });
 } finally { await db.close(); }
});
