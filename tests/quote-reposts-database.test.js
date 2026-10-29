import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {setup,asRole,uid,migration} from './helpers/quote-database-fixture.js';
const read = path => readFile(new URL(path,import.meta.url),'utf8');
const owner=uid(1),follower=uid(2),mutual=uid(3),other=uid(4),privateOwner=uid(5),quoteOwner=uid(6);
const publish=(db,user,id,target=uid(100),fields={})=>asRole(db,'authenticated',user,'SELECT (public.create_quote_post($1,$2,$3::jsonb)).*',[id,target,JSON.stringify(fields)]);
async function scalar(db,sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}

test('quote migration: production-shaped RLS, lifecycle, counters, authorization and rollback',async t=>{
 const db=new PGlite();
 try {
 await setup(db);
 const baseline=new Map();
 for(const who of [owner,follower,mutual,other,null]) baseline.set(who,(await asRole(db,who?'authenticated':'anon',who,'SELECT id FROM posts ORDER BY id')).rows);
 await db.exec(migration);await db.exec(migration);
 await t.test('idempotent migration leaves publishing disabled and existing RLS results unchanged',async()=>{
  for(const [who,rows] of baseline)assert.deepEqual((await asRole(db,who?'authenticated':'anon',who,'SELECT id FROM posts ORDER BY id')).rows,rows);
  assert.equal((await asRole(db,'anon',null,'SELECT quote_repost_status()')).rows[0].quote_repost_status.publishingEnabled,false);
  await assert.rejects(publish(db,quoteOwner,uid(200)),/disabled/);
  await assert.rejects(asRole(db,'authenticated',quoteOwner,`INSERT INTO posts(id,user_id,title,visibility,is_quote,quoted_post_id) VALUES('${uid(200)}','${quoteOwner}','','public',true,'${uid(100)}')`),/disabled/);
  await assert.rejects(asRole(db,'authenticated',quoteOwner,'UPDATE privacy_v2_private.quote_repost_rollout SET publishing_enabled=true'),/permission denied/);
 });
 // LOCAL fixture only. No production SQL or staging project is used by any test.
 await db.exec('UPDATE privacy_v2_private.quote_repost_rollout SET publishing_enabled=true');
 await t.test('anonymous, unrelated, follower, mutual and owner target authorization',async()=>{
  for(const who of [null,other,follower,mutual,owner]) {
   const result=await asRole(db,who?'authenticated':'anon',who,'SELECT get_quotable_post($1) AS original',[uid(100)]);
   assert.equal(result.rows[0].original.id,uid(100));
   for(const target of [101,102,103,104,105,106,107,108,109])assert.equal((await asRole(db,who?'authenticated':'anon',who,'SELECT get_quotable_post($1) AS original',[uid(target)])).rows[0].original,null);
  }
  await assert.rejects(asRole(db,'anon',null,'SELECT create_quote_post($1,$2)',[uid(200),uid(100)]),/permission denied/);
  await assert.rejects(asRole(db,'authenticated',null,'SELECT create_quote_post($1,$2)',[uid(200),uid(100)]),/Not authorized/);
  await assert.rejects(publish(db,quoteOwner,'invalid'),/uuid/);
  await assert.rejects(publish(db,quoteOwner,uid(100),uid(100)),/Invalid quote identity/);
  await db.exec("SELECT set_config('request.jwt.claims','{\"is_anonymous\":true}',false)");
  await assert.rejects(publish(db,quoteOwner,uid(200)),/Not authorized/);
  await db.exec("SELECT set_config('request.jwt.claims','{}',false)");
  for(const who of [other,follower,mutual,owner,privateOwner]) for(const target of [101,102,103,104,105,106,107,108,109,999])await assert.rejects(publish(db,who,uid(200),uid(target)),/cannot be quoted/);
 });
 await t.test('quote-only and media/text create new independent posts; retry returns same ID',async()=>{
  const a=(await publish(db,quoteOwner,uid(200))).rows[0];
  assert.equal(a.id,uid(200));assert.notEqual(a.id,uid(100));assert.equal(a.user_id,quoteOwner);assert.equal(a.quoted_post_id,uid(100));assert.equal(a.content,'');assert.equal(a.repost_count,0);assert.equal(a.like_count,0);assert.equal(a.views,0);
  assert.equal((await publish(db,quoteOwner,uid(200))).rows[0].id,a.id);
  assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(100)}'`),1);
  const b=(await publish(db,quoteOwner,uid(201),uid(100),{content:'Comment',media:[{type:'image',url:'https://example.com/photo.jpg'}]})).rows[0];assert.equal(b.content,'Comment');assert.equal(b.media[0].url,'https://example.com/photo.jpg');
  await db.exec(`UPDATE posts SET like_count=7,comment_count=3,views=12,share_count=2,bookmark_count=4 WHERE id='${uid(200)}'`);
  const original=(await db.query('SELECT like_count,comment_count,views,share_count,bookmark_count FROM posts WHERE id=$1',[uid(100)])).rows[0];assert.deepEqual(original,{like_count:0,comment_count:0,views:0,share_count:0,bookmark_count:0});
  await assert.rejects(publish(db,other,uid(200)),/already used|duplicate|policy/);
  await assert.rejects(publish(db,quoteOwner,uid(202),uid(100),{user_id:owner}),/Unexpected/);
  await assert.rejects(publish(db,quoteOwner,uid(202),uid(100),{media:[{type:'image',url:'https://example.com/secret',asset_id:uid(8)}]}),/public image/);
 });
 await t.test('plain repost RPC contracts, direct row writes, repeated removal and canonical counters',async()=>{
  let r=(await asRole(db,'authenticated',other,'SELECT * FROM toggle_repost($1,$2,$3)',[uid(100),other,'video note'])).rows[0];assert.equal(r.count,3);assert.equal(r.out_comment,'video note');
  r=(await asRole(db,'authenticated',other,'SELECT * FROM toggle_repost($1,$2::text)',[uid(100),''])).rows[0];assert.equal(r.new_count,2);assert.equal(r.reposted,false);
  await db.exec(`INSERT INTO reposts(post_id,user_id) VALUES('${uid(100)}','${other}')`);assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(100)}'`),3);
  await db.exec(`DELETE FROM reposts WHERE user_id='${other}'`);await db.exec(`DELETE FROM reposts WHERE user_id='${other}'`);assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(100)}'`),2);
  await assert.rejects(asRole(db,'authenticated',other,`INSERT INTO reposts(post_id,user_id) VALUES('${uid(100)}','${other}')`),/permission denied/);
  await asRole(db,'authenticated',owner,`UPDATE posts SET repost_count=999 WHERE id='${uid(100)}'`);assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(100)}'`),2);
 });
 await t.test('soft deletion, restore and hard deletion of quotes reconcile counts once',async()=>{
  await asRole(db,'authenticated',quoteOwner,'SELECT delete_post($1)',[uid(200)]);assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(100)}'`),1);
  await asRole(db,'authenticated',quoteOwner,'SELECT delete_post($1)',[uid(200)]);assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(100)}'`),1);
  await asRole(db,'authenticated',quoteOwner,'SELECT restore_post($1)',[uid(200)]);assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(100)}'`),2);
  await asRole(db,'authenticated',quoteOwner,'SELECT permanently_delete_post($1)',[uid(201)]);assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(100)}'`),1);
 });
 await t.test('visibility, account privacy, moderation, hide-all and blocks revoke existing embeds',async()=>{
  const preview=async (who=other)=>(await asRole(db,'authenticated',who,'SELECT original FROM load_quote_references($1)',[[uid(200)]])).rows[0].original;
  assert.equal((await preview()).id,uid(100));
  for(const change of ["is_private=true","suspended=true","hide_all_posts=true"]) {
   await db.exec(`UPDATE profiles SET ${change} WHERE id='${owner}'`);assert.equal(await preview(),null);assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(100)}'`),0);
   await db.exec(`UPDATE profiles SET is_private=false,suspended=false,hide_all_posts=false WHERE id='${owner}'`);
  }
  for(const change of ["visibility='followers'","is_hidden=true","publishing_state='draft'"]) {
   await db.exec(`UPDATE posts SET ${change} WHERE id='${uid(100)}'`);assert.equal(await preview(),null);
   await db.exec(`UPDATE posts SET visibility='public',is_hidden=false,publishing_state='published' WHERE id='${uid(100)}'`);
  }
  await db.exec(`INSERT INTO blocks VALUES('${owner}','${other}')`);assert.equal(await preview(),null);await assert.rejects(publish(db,other,uid(202)),/cannot be quoted/);await db.exec('DELETE FROM blocks');
  await db.exec(`INSERT INTO blocks VALUES('${quoteOwner}','${owner}')`);assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(100)}'`),0);await db.exec('DELETE FROM blocks');
  await asRole(db,'authenticated',owner,'SELECT delete_post($1)',[uid(100)]);assert.equal(await preview(),null);
  await asRole(db,'authenticated',owner,'SELECT restore_post($1)',[uid(100)]);assert.equal((await preview()).id,uid(100));
 });
 await t.test('one-level projection omits nested references and validates permissions at publish time',async()=>{
  const q=(await asRole(db,'authenticated',other,'SELECT get_quotable_post($1) AS q',[uid(200)])).rows[0].q;
  assert(!('quoted_post_id' in q));assert(!('publish_payload' in q));assert(!('quotedPost' in q));
  await publish(db,other,uid(203),uid(200));assert.equal(await scalar(db,`SELECT repost_count FROM posts WHERE id='${uid(200)}'`),1);
  await db.exec(`UPDATE profiles SET is_private=true WHERE id='${owner}'`);await assert.rejects(publish(db,other,uid(204)),/cannot be quoted/);await db.exec(`UPDATE profiles SET is_private=false WHERE id='${owner}'`);
  await assert.rejects(asRole(db,'authenticated',other,'SELECT * FROM load_quote_references($1)',[Array(101).fill(uid(200))]),/At most/);
 });
 await t.test('private quote authors retain outer-post RLS and do not expose references to unrelated viewers',async()=>{
  await db.exec(`UPDATE profiles SET is_private=true WHERE id='${quoteOwner}'`);
  for(const [role,viewer] of [['anon',null],['authenticated',other]]) assert.equal((await asRole(db,role,viewer,'SELECT * FROM load_quote_references($1)',[[uid(200)]])).rows.length,0);
  assert.equal((await asRole(db,'authenticated',quoteOwner,'SELECT original FROM load_quote_references($1)',[[uid(200)]])).rows[0].original.id,uid(100));
  await db.exec(`INSERT INTO follows VALUES('${follower}','${quoteOwner}','active'); INSERT INTO privacy_v2_private.follow_approvals VALUES('${follower}','${quoteOwner}','owner')`);
  assert.equal((await asRole(db,'authenticated',follower,'SELECT original FROM load_quote_references($1)',[[uid(200)]])).rows[0].original.id,uid(100));
  await db.exec(`UPDATE profiles SET is_private=false WHERE id='${quoteOwner}'`);
 });
 await t.test('new or future original SELECT restrictions also govern embeds and direct quote INSERTs',async()=>{
  await db.exec(`CREATE POLICY fixture_extra_read_boundary ON posts AS RESTRICTIVE FOR SELECT TO authenticated USING(id<>'${uid(100)}'::uuid)`);
  assert.equal((await asRole(db,'authenticated',other,'SELECT get_quotable_post($1) AS original',[uid(100)])).rows[0].original,null);
  await assert.rejects(publish(db,other,uid(250)),/row-level security/);
  await assert.rejects(asRole(db,'authenticated',other,`INSERT INTO posts(id,user_id,title,visibility,is_quote,quoted_post_id) VALUES('${uid(251)}','${other}','','public',true,'${uid(100)}')`),/row-level security/);
  await db.exec('DROP POLICY fixture_extra_read_boundary ON posts');
 });
 await t.test('hard-deleted original preserves authored quote and unavailable marker',async()=>{

  await asRole(db,'authenticated',owner,'SELECT permanently_delete_post($1)',[uid(100)]);
  const q=(await db.query('SELECT id,is_quote,quoted_post_id,like_count FROM posts WHERE id=$1',[uid(200)])).rows[0];assert.equal(q.is_quote,true);assert.equal(q.quoted_post_id,null);assert.equal(q.like_count,7);
  assert.equal((await asRole(db,'anon',null,'SELECT original FROM load_quote_references($1)',[[uid(200)]])).rows[0].original,null);
  await assert.rejects(asRole(db,'authenticated',quoteOwner,`UPDATE posts SET is_quote=false WHERE id='${uid(200)}'`),/immutable/);
 });
 await t.test('normal post creation is unchanged; disable is safe; destructive rollback refuses authored quotes',async()=>{
  await asRole(db,'authenticated',owner,`INSERT INTO posts(user_id,title,visibility) VALUES('${owner}','Normal','public')`);
  await db.exec(await read('../docs/quote-reposts/disable.REVIEW.sql'));await assert.rejects(publish(db,other,uid(204),uid(200)),/disabled/);
  await assert.rejects(db.exec(await read('../docs/quote-reposts/rollback.REVIEW.sql')),/Quote rows exist/);await db.exec('ROLLBACK');
 });
 } finally {await db.close();}
});

test('unactivated migration rolls back fully and drift aborts safely',async()=>{
 const db=new PGlite();try{await setup(db);await db.exec(migration);await db.exec(await read('../docs/quote-reposts/rollback.REVIEW.sql'));assert.equal(await scalar(db,"SELECT count(*)::int FROM information_schema.columns WHERE table_name='posts' AND column_name='is_quote'"),0);
 await db.exec("CREATE OR REPLACE FUNCTION public.toggle_repost(p_post_id uuid,p_comment text DEFAULT '') RETURNS TABLE(reposted boolean,new_count integer,repost_comment text,reposted_at timestamptz) LANGUAGE sql AS $$ SELECT false,0,''::text,NULL::timestamptz $$");
 await assert.rejects(db.exec(migration),/Repost RPC drift/);await db.exec('ROLLBACK');
 }finally{await db.close();}
});
