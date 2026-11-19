// Disposable PGlite only. Never connects to hosted Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setup,asUser,uid} from './helpers/chat-activity-fixture.js';
const hardening=readFileSync('supabase/migrations/20261119192845_chat_receipts_metadata_hardening.sql','utf8');
test('release receipt and conversation protections preserve authorized operations under broad legacy grants',async t=>{
 const db=new PGlite();
 try {
  await setup(db);
  await db.exec(`ALTER TABLE conversations
   ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now(),
   ADD COLUMN typing_users uuid[] DEFAULT '{}', ADD COLUMN group_name text, ADD COLUMN group_avatar text,
   ADD COLUMN group_description text, ADD COLUMN invite_code text, ADD COLUMN invite_enabled boolean DEFAULT true,
   ADD COLUMN disappearing_duration integer DEFAULT 0, ADD COLUMN pinned_message_id uuid,
   ADD COLUMN last_message_id uuid, ADD COLUMN last_sender_id uuid, ADD COLUMN last_message_at timestamptz,
   ADD COLUMN muted_by uuid[] DEFAULT '{}', ADD COLUMN archived_by uuid[] DEFAULT '{}',
   ADD COLUMN pinned_by uuid[] DEFAULT '{}', ADD COLUMN hidden_by uuid[] DEFAULT '{}',
   ADD COLUMN theme_url text, ADD COLUMN bubble_color text, ADD COLUMN note_name text, ADD COLUMN note_avatar text;
   UPDATE conversations SET owner_id='${uid(1)}',created_by='${uid(1)}';
   CREATE TABLE group_join_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid REFERENCES conversations(id),user_id uuid REFERENCES auth.users(id),status text DEFAULT 'pending',created_at timestamptz DEFAULT now(),UNIQUE(conversation_id,user_id));
   CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations(id),sender_id uuid,created_at timestamptz DEFAULT now());
   CREATE TABLE message_reads(message_id uuid REFERENCES messages(id),user_id uuid REFERENCES auth.users(id),read_at timestamptz DEFAULT now(),PRIMARY KEY(message_id,user_id));
   ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;
   GRANT SELECT,INSERT,UPDATE,DELETE ON conversations,messages,message_reads TO authenticated;
   GRANT SELECT ON message_reads TO anon;
   CREATE POLICY fixture_legacy_conversations ON conversations FOR ALL TO authenticated USING(true) WITH CHECK(true);
   CREATE POLICY "members can view reads" ON message_reads FOR SELECT USING(true);
   CREATE POLICY reads_select_policy ON message_reads FOR SELECT USING(user_id=auth.uid());
   CREATE POLICY reads_insert_policy ON message_reads FOR INSERT WITH CHECK(user_id=auth.uid());
   INSERT INTO messages(id,conversation_id,sender_id) VALUES('${uid(100)}','${uid(10)}','${uid(1)}'),('${uid(101)}','${uid(11)}','${uid(1)}'),('${uid(102)}','${uid(12)}','${uid(1)}');`);
  await db.exec(`INSERT INTO message_reads VALUES('${uid(100)}','${uid(2)}','2001-01-01');`);
  const snapshot=async()=>Promise.all(['conversations','conversation_members','messages','message_reads','group_join_requests'].map(async table=>(await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
  const before=await snapshot();
  await db.exec(hardening);await db.exec(hardening);
  await t.test('repeat installation preserves all existing conversation/member/message/receipt/request rows',async()=>{
   assert.deepEqual(await snapshot(),before);
  });
  const insert=(user,msg)=>asUser(db,uid(user),'INSERT INTO message_reads VALUES($1,$2,$3) ON CONFLICT(message_id,user_id) DO UPDATE SET read_at=excluded.read_at RETURNING *',[uid(msg),uid(user),'2099-01-01']);
  const rows=(user)=>asUser(db,user?uid(user):null,'SELECT * FROM message_reads',[],user?'authenticated':'anon');
  await t.test('direct and group receipt visibility; own authenticated upsert keeps original server timestamp',async()=>{
   const first=await insert(2,100);assert(new Date(first.rows[0].read_at).getFullYear()<2099);
   assert.equal((await insert(2,100)).rows[0].read_at.getTime(),first.rows[0].read_at.getTime());
   await insert(2,101);assert.equal((await rows(1)).rows.length,2);assert.equal((await rows(3)).rows.length,1);
  });
  await t.test('outsider, anonymous, forged reader and unrelated receipt inserts denied',async()=>{
   assert.equal((await rows(4)).rows.length,0);assert.equal((await rows(null)).rows.length,0);
   await assert.rejects(insert(4,100),/row-level security/);
   await assert.rejects(asUser(db,uid(1),'INSERT INTO message_reads VALUES($1,$2,now())',[uid(100),uid(3)]),/row-level security/);
   await assert.rejects(insert(3,100),/row-level security/);
  });
  await t.test('notes remain owner-only and direct blocking removes receipt access',async()=>{
   await insert(1,102);await assert.rejects(insert(2,102),/row-level security/);
   await db.exec(`INSERT INTO blocks VALUES('${uid(2)}','${uid(1)}');`);
   assert.equal((await asUser(db,uid(2),'SELECT * FROM message_reads WHERE message_id=$1',[uid(100)])).rows.length,0);
   await assert.rejects(insert(2,100),/row-level security/);await db.exec('DELETE FROM blocks');
  });
  await t.test('removed group reader loses access, including own old receipt and legacy user1 owner',async()=>{
   await db.exec(`DELETE FROM conversation_members WHERE conversation_id='${uid(11)}' AND user_id='${uid(2)}';`);
   assert.equal((await asUser(db,uid(2),'SELECT * FROM message_reads WHERE message_id=$1',[uid(101)])).rows.length,0);
   await assert.rejects(insert(2,101),/row-level security/);
   await db.exec(`DELETE FROM conversation_members WHERE conversation_id='${uid(11)}' AND user_id='${uid(1)}';`);
   assert.equal((await asUser(db,uid(1),'SELECT * FROM message_reads WHERE message_id=$1',[uid(101)])).rows.length,0);
   await assert.rejects(asUser(db,uid(1),'UPDATE conversations SET group_name=$1 WHERE id=$2',['forged',uid(11)]),/Not a current group member/);
   await db.exec(`INSERT INTO conversation_members VALUES('${uid(11)}','${uid(1)}','owner'),('${uid(11)}','${uid(2)}','member');`);
  });
  await t.test('future broad permissive receipt policies cannot bypass restrictive guards or mutate receipt identity',async()=>{
   await db.exec('CREATE POLICY fixture_receipts_broad ON message_reads FOR ALL TO authenticated USING(true) WITH CHECK(true)');
   assert.equal((await rows(4)).rows.length,0);await assert.rejects(insert(4,100),/row-level security/);
   await assert.rejects(asUser(db,uid(2),'UPDATE message_reads SET message_id=$1 WHERE message_id=$2',[uid(101),uid(100)]),/identity is immutable/);
   assert.equal((await asUser(db,uid(2),'DELETE FROM message_reads RETURNING *')).rows.length,0);
  });
  await t.test('ordinary member cannot change administrative fields or identity; admin changes remain valid',async()=>{
   for(const [field,value] of [['invite_enabled',false],['invite_code','forged'],['group_name','forged'],['disappearing_duration',60],['owner_id',uid(2)],['id',uid(99)],['created_at','2099-01-01'],['typing_users',[uid(3)]]]){
    await assert.rejects(asUser(db,uid(2),`UPDATE conversations SET ${field}=$1 WHERE id=$2`,[value,uid(11)]),{code:'42501'});
   }
   await asUser(db,uid(1),'UPDATE conversations SET group_name=$1,invite_enabled=false,disappearing_duration=60 WHERE id=$2',['Approved',uid(11)]);
   await asUser(db,uid(1),`UPDATE conversations SET permissions='{"edit_group_info":"everyone"}' WHERE id=$1`,[uid(11)]);
   await asUser(db,uid(2),'UPDATE conversations SET group_name=$1 WHERE id=$2',['Member edit allowed',uid(11)]);
  });
  await t.test('own preferences, direct settings and note edits work; other participant preferences and cross-room pins denied',async()=>{
   await asUser(db,uid(1),'UPDATE conversations SET muted_by=$1 WHERE id=$2',[[uid(1)],uid(11)]);
   await asUser(db,uid(2),'UPDATE conversations SET muted_by=$1,theme_url=$2 WHERE id=$3',[[uid(1),uid(2)],'local-theme',uid(11)]);
   await assert.rejects(asUser(db,uid(2),'UPDATE conversations SET muted_by=$1 WHERE id=$2',[[uid(2)],uid(11)]),/another participant/);
   await asUser(db,uid(2),'UPDATE conversations SET disappearing_duration=60 WHERE id=$1',[uid(10)]);
   await asUser(db,uid(1),'UPDATE conversations SET note_name=$1 WHERE id=$2',['My note',uid(12)]);
   await assert.rejects(asUser(db,uid(2),'UPDATE conversations SET pinned_message_id=$1 WHERE id=$2',[uid(100),uid(11)]),/belong to this conversation/);
   await asUser(db,uid(2),'UPDATE conversations SET pinned_message_id=$1 WHERE id=$2',[uid(101),uid(11)]);
  });
  await t.test('real nested message trigger maintains last-message metadata; direct forgery denied',async()=>{
   const def=JSON.parse(readFileSync('docs/chat-upgrades/production-release-readonly.json','utf8')).catalog.functions.find(f=>f.name==='update_conversation_last_message').definition;
   await db.exec(def+'; CREATE TRIGGER fixture_last AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message();');
   await assert.rejects(asUser(db,uid(2),'UPDATE conversations SET last_sender_id=$1 WHERE id=$2',[uid(2),uid(11)]),/server maintained/);
   await asUser(db,uid(2),'INSERT INTO messages(id,conversation_id,sender_id) VALUES($1,$2,$3)',[uid(105),uid(11),uid(2)]);
   assert.equal((await db.query('SELECT last_message_id FROM conversations WHERE id=$1',[uid(11)])).rows[0].last_message_id,uid(105));
  });
  await t.test('group RPCs require current membership, secure defaults and explicit permission for non-admin edits/invites',async()=>{
   await asUser(db,uid(1),`UPDATE conversations SET permissions='{}' WHERE id=$1`,[uid(11)]);
   for(const actor of [uid(2),uid(4),null]){
    await assert.rejects(asUser(db,actor,'SELECT update_group_info($1,$2)',[uid(11),'Bad']),{code:'42501'});
    await assert.rejects(asUser(db,actor,'SELECT get_or_create_invite_code($1)',[uid(11)]),{code:'42501'});
   }
   await asUser(db,uid(1),'SELECT update_group_info($1,$2)',[uid(11),'Owner edit']);
   const code=(await asUser(db,uid(1),'SELECT get_or_create_invite_code($1) AS code',[uid(11)])).rows[0].code;
   assert.match(code,/^[0-9a-f]{32}$/);
   await asUser(db,uid(1),`UPDATE conversations SET permissions='{"edit_group_info":"everyone","invite_via_link":"everyone"}' WHERE id=$1`,[uid(11)]);
   await asUser(db,uid(2),'SELECT update_group_info($1,$2)',[uid(11),'Allowed member edit']);
   assert.equal((await asUser(db,uid(2),'SELECT get_or_create_invite_code($1) AS code',[uid(11)])).rows[0].code,code);
   await assert.rejects(asUser(db,null,'SELECT get_or_create_invite_code($1)',[uid(11)],'anon'),/permission denied/);
  });
  await t.test('invite joins authenticate and pending requests cannot self-approve through a NULL caller role',async()=>{
   await asUser(db,uid(1),`UPDATE conversations SET invite_enabled=true,permissions='{"approve_new_members":true}' WHERE id=$1`,[uid(11)]);
   const code=(await asUser(db,uid(1),'SELECT get_or_create_invite_code($1) AS code',[uid(11)])).rows[0].code;
   await assert.rejects(asUser(db,null,'SELECT join_group_via_code($1)',[code],'anon'),/permission denied/);
   await assert.rejects(asUser(db,null,'SELECT join_group_via_code($1)',[code]),{code:'42501'});
   const r=await asUser(db,uid(4),'SELECT join_group_via_code($1) AS result',[code]);assert.equal(r.rows[0].result.status,'pending_approval');
   const request=(await db.query('SELECT id FROM group_join_requests WHERE user_id=$1',[uid(4)])).rows[0].id;
   for(const actor of [uid(2),uid(4),null]) await assert.rejects(asUser(db,actor,'SELECT resolve_join_request($1,true)',[request]),{code:'42501'});
   assert.equal((await db.query('SELECT * FROM conversation_members WHERE user_id=$1',[uid(4)])).rows.length,0);
   await asUser(db,uid(1),'SELECT resolve_join_request($1,true)',[request]);
   assert.equal((await db.query('SELECT role FROM conversation_members WHERE user_id=$1',[uid(4)])).rows[0].role,'member');
   await assert.rejects(asUser(db,uid(1),'SELECT resolve_join_request($1,false)',[request]),{code:'42501'});
   assert.equal((await asUser(db,uid(4),'SELECT join_group_via_code($1) AS result',[code])).rows[0].result.status,'already_member');
   await asUser(db,uid(1),'UPDATE conversations SET invite_enabled=false WHERE id=$1',[uid(11)]);
   await assert.rejects(asUser(db,uid(4),'SELECT join_group_via_code($1)',[code]),{code:'42501'});
  });
  await t.test('activity feature rollback retains receipt/membership and metadata protections',async()=>{
   await db.exec(readFileSync('docs/chat-upgrades/rollback.REVIEW.sql','utf8'));
   await assert.rejects(insert(3,100),/row-level security/);
   await assert.rejects(asUser(db,uid(2),'UPDATE conversations SET invite_enabled=true WHERE id=$1',[uid(11)]),{code:'42501'});
   await assert.rejects(asUser(db,uid(4),'SELECT set_member_role($1,$2,$3)',[uid(11),uid(2),'admin']),{code:'42501'});
  });
 } finally {await db.close();}
});
