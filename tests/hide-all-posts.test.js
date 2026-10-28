import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
const owner='00000000-0000-4000-8000-000000000001', follower='00000000-0000-4000-8000-000000000002', stranger='00000000-0000-4000-8000-000000000003', mutual='00000000-0000-4000-8000-000000000004', pending='00000000-0000-4000-8000-000000000005';
test('protected asset authorization preserves every production predicate except the added hide condition',async()=>{
 const baseline=await readFile('tests/fixtures/hide-all-posts.sql','utf8');
 const migration=await readFile('docs/cloudflare/hide-all-posts.REVIEW.sql','utf8');
 const extract=source=>source.match(/CREATE OR REPLACE FUNCTION public.authorize_protected_asset[\s\S]*?\$function\$\s*;/)[0];
 const normalize=source=>source.replace(/\s+/g,' ').trim();
 const reviewed=extract(migration).replace('-- hide-all-posts-v2\n','').replace('   AND (p.user_id=p_viewer OR NOT coalesce(owner_profile.hide_all_posts,false))\n','');
 assert.equal(normalize(reviewed),normalize(extract(baseline)));
});
test('reviewed migration enforces production authorization and can be reapplied and safely rolled back',async t=>{
 const db=new PGlite();
 try {
 await db.exec(await readFile('tests/fixtures/hide-all-posts.sql','utf8'));
 const migration=await readFile('docs/cloudflare/hide-all-posts.REVIEW.sql','utf8');
 const as=async(role,user,sql,args=[])=>{await db.exec('SET ROLE '+role);try{
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[user||'',role]);return await db.query(sql,args);
 }finally{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");}};
 for(const user of [owner,follower,stranger,mutual,pending])await db.query("INSERT INTO profiles(id,username,display_name) VALUES($1,'test','Test')",[user]);
 for(const [a,b,approval] of [[follower,owner,true],[mutual,owner,true],[owner,mutual,true],[pending,owner,false]]){
  await db.query('INSERT INTO follows(follower_id,following_id) VALUES($1,$2)',[a,b]);
  if(approval)await db.query("INSERT INTO privacy_v2_private.follow_approvals VALUES($1,$2,'owner')",[a,b]);
 }
 const ids={};
 for(const audience of ['public','followers','friends','only_me']){
  ids[audience]=(await db.query("INSERT INTO posts(user_id,title,content,visibility,sound_id,media_url) VALUES($1,'hello','hello',$2,'test-sound','https://res.cloudinary.com/test/video/upload/test.mp4') RETURNING id",[owner,audience])).rows[0].id;
  await db.query('INSERT INTO post_short_links VALUES($1,$2)',['code'+audience,ids[audience]]);
 }
 const asset='00000000-0000-4000-8000-000000000006';
 await db.query("INSERT INTO post_media_assets VALUES($1,$2,$3,'ready','authenticated')",[asset,ids.followers,owner]);
 await db.query("UPDATE posts SET media=jsonb_build_array(jsonb_build_object('asset_id',$1::text)) WHERE id=$2",[asset,ids.followers]);
 await db.query("INSERT INTO reposts(post_id,user_id,comment) VALUES($1,$2,'repost')",[ids.public,follower]);
 await db.query('INSERT INTO bookmarks(post_id,user_id) VALUES($1,$2)',[ids.public,follower]);
 const comment=(await db.query("INSERT INTO comments(post_id,user_id,message) VALUES($1,$2,'reply') RETURNING id",[ids.public,follower])).rows[0].id;
 await db.query("INSERT INTO notifications(type,receiver_id,actor_id,post_id) VALUES('like',$1,$2,$3)",[follower,owner,ids.public]);
 const count=async(role,user)=>(await as(role,user,'SELECT id FROM posts')).rows.length;
 const media=async(viewer)=>(await as('service_role',null,'SELECT authorize_protected_asset($1,$2) ok',[asset,viewer])).rows[0].ok;
 await t.test('original failure is reproduced with real ACLs; migration is idempotent',async()=>{
  await assert.rejects(as('authenticated',owner,'UPDATE profiles SET hide_all_posts=true WHERE id=$1',[owner]),/permission denied/);
  const before=(await db.query('SELECT to_jsonb(p) row FROM posts p ORDER BY id')).rows;
  await db.exec(migration);await db.exec(migration);
  assert.deepEqual((await db.query('SELECT to_jsonb(p) row FROM posts p ORDER BY id')).rows,before);
  await db.exec(await readFile('docs/cloudflare/hide-all-posts.VERIFY.sql','utf8'));
 });
 await t.test('original audiences, approved follows and media rules survive',async()=>{
  assert.equal(await count('authenticated',owner),4);assert.equal(await count('authenticated',follower),2);
  assert.equal(await count('authenticated',mutual),3);assert.equal(await count('authenticated',pending),1);
  assert.equal(await count('authenticated',stranger),1);assert.equal(await count('anon',null),1);
  assert.equal(await media(owner),true);assert.equal(await media(follower),true);assert.equal(await media(mutual),true);
  for(const viewer of [pending,stranger,null])assert.equal(await media(viewer),false);
  await db.query("UPDATE post_media_assets SET status='pending' WHERE id=$1",[asset]);assert.equal(await media(owner),false);
  await db.query("UPDATE post_media_assets SET status='ready' WHERE id=$1",[asset]);
  await db.query("UPDATE posts SET media='[]' WHERE id=$1",[ids.followers]);assert.equal(await media(follower),false);
  await db.query("UPDATE posts SET media=jsonb_build_array(jsonb_build_object('asset_id',$1::text)) WHERE id=$2",[asset,ids.followers]);
  assert.equal((await as('anon',null,'SELECT * FROM add_view($1,NULL,NULL)',[ids.public])).rows[0].counted,false);
  assert.equal((await as('authenticated',mutual,"SELECT * FROM toggle_bookmark($1,$2)",[ids.friends,mutual])).rows[0].bookmarked,true);
  await assert.rejects(as('authenticated',follower,'SELECT * FROM toggle_post_like($1)',[ids.friends]),/Post unavailable/);
  await assert.rejects(as('authenticated',mutual,'SELECT * FROM toggle_post_like($1)',[ids.only_me]),/Post unavailable/);
  for(const role of ['anon','authenticated'])await assert.rejects(as(role,role==='authenticated'?owner:null,'SELECT authorize_protected_asset($1,$2)',[asset,owner]),/permission denied/);
  await as('service_role',null,'SELECT 1');
  await db.query('UPDATE profiles SET is_private=true WHERE id=$1',[owner]);
  assert.equal(await count('anon',null),0);assert.equal(await count('authenticated',pending),0);assert.equal(await count('authenticated',follower),2);
  await db.query('UPDATE profiles SET is_private=false WHERE id=$1',[owner]);
 });
 await t.test('other accounts and anonymous callers cannot update the owner or escalate profile privileges',async()=>{
  for(const user of [follower,mutual,stranger])assert.equal((await as('authenticated',user,'UPDATE profiles SET hide_all_posts=true WHERE id=$1 RETURNING id',[owner])).rows.length,0);
  assert.equal((await as('anon',null,'UPDATE profiles SET hide_all_posts=true WHERE id=$1 RETURNING id',[owner])).rows.length,0);
  await assert.rejects(as('authenticated',owner,'SELECT is_admin,phone,suspended FROM profiles'),/permission denied/);
  await assert.rejects(as('authenticated',owner,'UPDATE profiles SET is_admin=true WHERE id=$1',[owner]),/Only administrators/);
  assert.equal((await as('authenticated',owner,'SELECT is_admin_user($1) ok',[owner])).rows[0].ok,false);
  await assert.rejects(as('anon',null,'SELECT is_admin_user($1)',[owner]),/permission denied/);
  // A real administrator retains the existing authorization rule; a supplied UUID cannot impersonate it.
  await db.query('UPDATE profiles SET is_admin=true WHERE id=$1',[stranger]);
  assert.equal((await as('authenticated',stranger,'SELECT is_admin_user($1) ok',[stranger])).rows[0].ok,true);
  assert.equal((await as('authenticated',stranger,'UPDATE profiles SET hide_follower_count=true WHERE id=$1 RETURNING id',[owner])).rows.length,1);
  await db.query('UPDATE profiles SET is_admin=false WHERE id=$1',[stranger]);
 });
 await t.test('hide preserves owner reads and denies feeds, profiles, direct IDs, relations, public metadata and count RPCs',async()=>{
  await as('authenticated',owner,'UPDATE profiles SET hide_all_posts=true WHERE id=$1 RETURNING id',[owner]);
  assert.equal(await count('authenticated',owner),4);assert.equal(await media(owner),true);
  assert.equal((await as('authenticated',owner,"SELECT * FROM search_posts('hello')")).rows.length,1);
  for(const user of [follower,mutual,pending,stranger]){
   assert.equal(await count('authenticated',user),0);assert.equal(await media(user),false);
   assert.equal((await as('authenticated',user,'SELECT * FROM posts WHERE id=$1',[ids.public])).rows.length,0);
   assert.equal((await as('authenticated',user,'SELECT * FROM posts WHERE user_id=$1',[owner])).rows.length,0);
   assert.equal((await as('authenticated',user,"SELECT * FROM search_posts('hello')")).rows.length,0);
   for(const table of ['comments','repost_feed_items','bookmarks','notifications']) assert.equal((await as('authenticated',user,'SELECT * FROM '+table)).rows.length,0);
   assert.equal((await as('authenticated',user,'SELECT * FROM get_bookmarks()')).rows.length,0);
   assert.equal((await as('authenticated',user,'SELECT * FROM get_notifications()')).rows.length,0);
   for(const [sql,args] of [
    ['SELECT * FROM add_view($1,$2,$3)',[ids.public,user,'session']],
    ['SELECT * FROM toggle_post_like($1)',[ids.public]],
    ["SELECT * FROM toggle_repost($1,'')",[ids.public]],
    ["SELECT * FROM toggle_repost($1,$2,'')",[ids.public,user]],
    ['SELECT * FROM toggle_bookmark($1)',[ids.public]],
    ['SELECT * FROM toggle_bookmark($1,$2)',[ids.public,user]],
    ['SELECT * FROM record_share($1,$2)',[ids.public,user]],
    ['SELECT * FROM toggle_comment_like($1)',[comment]],
    ['SELECT * FROM toggle_comment_like($1,$2)',[comment,user]]
   ]) await assert.rejects(as('authenticated',user,sql,args),/Post unavailable/);
   await assert.rejects(as('authenticated',user,'SELECT privacy_v2_private.session_post_readable($1)',[ids.public]),/permission denied/);
  }
  assert.equal(await count('anon',null),0);assert.equal(await media(null),false);
  for(const [role,user] of [['authenticated',follower],['anon',null]]){
   for(const fn of ['get_public_post_by_short_code','get_public_short_code_for_post']){
    const arg=fn==='get_public_short_code_for_post'?ids.public:'codepublic';
    assert.equal((await as(role,user,`SELECT * FROM ${fn}($1)`,[arg])).rows.length,0);
   }
   assert.equal((await as(role,user,"SELECT * FROM get_sound_stats('test-sound')")).rows[0].video_count,0);
  }
  for(const fn of ['get_public_post_seo_metadata','get_public_video_seo']) assert.equal((await as('anon',null,`SELECT * FROM ${fn}('codepublic')`)).rows.length,0);
  assert.equal((await as('anon',null,'SELECT * FROM list_public_post_sitemap()')).rows.length,0);
  await assert.rejects(as('anon',null,"SELECT * FROM search_posts('hello')"),/permission denied/);
  await assert.rejects(as('anon',null,'SELECT * FROM add_view($1,NULL,NULL)',[ids.public]),/Post unavailable/);
  assert.equal((await db.query('SELECT count(*) n FROM posts')).rows[0].n,4);
 });
 await t.test('owners can edit hidden posts and unauthorized owners cannot',async()=>{
  const r=await as('authenticated',owner,'SELECT (edit_post($1,$2)).content AS content',[ids.public,'edited']);assert.equal(r.rows[0].content,'edited');
  await assert.rejects(as('authenticated',stranger,'SELECT edit_post($1,$2)',[ids.public,'stolen']),/not owned/);
  assert.equal((await as('authenticated',owner,"SELECT * FROM toggle_post_like($1)",[ids.public])).rows[0].liked,true);
  const disposable=(await db.query("INSERT INTO posts(user_id,title,visibility) VALUES($1,'isolated management fixture','public') RETURNING id",[owner])).rows[0].id;
  await assert.rejects(as('authenticated',follower,'SELECT delete_post($1)',[disposable]),/not owned/);
  await as('authenticated',owner,'SELECT delete_post($1)',[disposable]);
  assert.equal((await db.query('SELECT is_deleted FROM posts WHERE id=$1',[disposable])).rows[0].is_deleted,true);
  await db.query('DELETE FROM posts WHERE id=$1',[disposable]);
  await assert.rejects(db.exec(await readFile('docs/cloudflare/hide-all-posts.ROLLBACK.sql','utf8')),/Unsafe rollback/);await db.exec('ROLLBACK');
 });
 await t.test('unhide restores original permissions; suspension, retired metadata and service ACLs stay enforced',async()=>{
  await as('authenticated',owner,'UPDATE profiles SET hide_all_posts=false WHERE id=$1',[owner]);
  assert.equal(await count('authenticated',owner),4);assert.equal(await count('authenticated',follower),2);assert.equal(await count('authenticated',mutual),3);assert.equal(await count('anon',null),1);
  assert.equal(await media(follower),true);
  const original=(await db.query('SELECT visibility FROM posts ORDER BY visibility')).rows;
  assert.deepEqual(original.map(x=>x.visibility),['followers','friends','only_me','public']);
  assert.equal((await as('anon',null,"SELECT * FROM get_public_post_by_short_code('codepublic')")).rows.length,1);
  assert.equal((await as('anon',null,'SELECT * FROM list_public_post_sitemap()')).rows.length,1);
  await db.query('UPDATE profiles SET suspended=true WHERE id=$1',[owner]);
  assert.equal(await count('authenticated',follower),0);assert.equal(await media(follower),false);
  assert.equal((await as('anon',null,"SELECT * FROM get_public_post_by_short_code('codepublic')")).rows.length,0);
  await db.query('UPDATE profiles SET suspended=false WHERE id=$1',[owner]);
  await db.query('INSERT INTO privacy_v2_private.post_deletions(post_id,owner_id,permanent) VALUES($1,$2,true)',[ids.only_me,owner]);
  assert.equal(await count('authenticated',owner),3);
  await assert.rejects(as('authenticated',owner,'SELECT * FROM toggle_post_like($1)',[ids.only_me]),/Post unavailable/);
  await db.exec('DELETE FROM privacy_v2_private.post_deletions');
 });
 await t.test('rollback restores reviewed baselines, then migration reapplies',async()=>{
  await db.exec(await readFile('docs/cloudflare/hide-all-posts.ROLLBACK.sql','utf8'));
  await assert.rejects(as('authenticated',owner,'UPDATE profiles SET hide_all_posts=true WHERE id=$1',[owner]),/permission denied/);
  await db.exec(migration);assert.equal(await count('authenticated',owner),4);
 });
 await t.test('unreviewed function changes abort migration before changing post rows',async()=>{
  const saved=(await db.query("SELECT pg_get_functiondef('public.search_posts(text,integer)'::regprocedure) definition")).rows[0].definition;
  await db.exec(saved.replace('AS $function$','AS $function$\n-- later unreviewed edit\n'));
  await assert.rejects(db.exec(migration),/Unreviewed function drift/);await db.exec('ROLLBACK');
  await db.exec(saved);
  await db.exec(await readFile('docs/cloudflare/hide-all-posts.VERIFY.sql','utf8'));
  assert.equal(await count('authenticated',owner),4);
 });
 } finally {await db.close();}
});
test('settings cache only changes after a confirmed owner row; switch waits and reverts on failure',async()=>{
 const source=await readFile('settings.js','utf8');
 for(const result of [{data:null,error:null},{data:null,error:{message:'denied'}},{data:{id:owner},error:null}]){
  let release, cached=0;
  const pending=new Promise(resolve=>release=resolve);
  const user={id:owner,isLoggedIn:true};
  const window={sb:{from:()=>({update:()=>({eq:()=>({select:()=>({single:()=>pending})})})})},AuthUser:{getCurrentUser:()=>user,updateCurrentUser:()=>cached++}};
  vm.runInNewContext(source,{window,console,document:{dispatchEvent(){}},CustomEvent:class{}});
  const save=window.SettingsAPI.updateFlags({hideAllPosts:true});
  assert.equal(cached,0); release(result);
  if(result.data){await save;assert.equal(cached,1);}else{await assert.rejects(save);assert.equal(cached,0);}
 }
 const html=await readFile('settings.html','utf8');
 const handler=html.match(/window.toggleHideAllPosts = async function\(\) \{[\s\S]*?\n            \};/)[0];
 let reject; const pending=new Promise((_,r)=>reject=r),toggle={checked:true,disabled:false},toasts=[];
 const window={SettingsAPI:{updateFlags:()=>pending}};
 vm.runInNewContext(handler,{window,document:{getElementById:()=>toggle},showToast:(...args)=>toasts.push(args)});
 const change=window.toggleHideAllPosts();assert.equal(toggle.disabled,true);assert.equal(toasts.length,0);
 reject(new Error('denied'));await change;assert.equal(toggle.checked,false);assert.equal(toggle.disabled,false);assert.equal(toasts[0][1],'r');
});
