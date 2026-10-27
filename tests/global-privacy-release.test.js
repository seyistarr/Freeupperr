import test from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const owner='9341af03-e007-4fc6-9c23-b06073379088',outside='1568563e-592f-4dd4-8efa-ee9429aebacb',mutual='a0a53cb6-be86-4862-b267-f7f43d4cf324';
const fields={source:'studio',title:'Private test',content:'',tags:[],comments_hidden:false},plan=[{slot:0,type:'image',role:'media'}];
test('global release retains genuine identity, evidence, audience and deletion boundaries',async t=>{const db=new PGlite();try{
 await db.exec(await readFile('tests/fixtures/production-protected-workflow.sql','utf8'));
 const migrations=await readdir('supabase/migrations');
 for(const suffix of ['_temporary_production_verification.sql','_permanent_controlled_privacy_beta.sql','_global_privacy_release.sql']){
  if(suffix.includes('permanent'))await db.exec(await readFile('tests/fixtures/production-beta-dependencies.sql','utf8'));
  if(suffix.includes('global'))await db.exec("CREATE TABLE auth.users(id uuid PRIMARY KEY,is_anonymous boolean DEFAULT false); ALTER TABLE public.profiles ADD COLUMN username text; ALTER TABLE privacy_v2_private.release_control ADD CONSTRAINT release_control_restricted_enabled_check CHECK(restricted_enabled=false)");
  await db.exec(await readFile('supabase/migrations/'+migrations.find(n=>n.endsWith(suffix)),'utf8'));
 }
 for(const id of [owner,outside,mutual]){await db.query('INSERT INTO public.profiles(id) VALUES($1)',[id]);await db.query('INSERT INTO auth.users(id) VALUES($1)',[id]);}
 const rpc=async(name,args=[])=>(await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1))}) value`,args)).rows[0].value;
 const id=async()=>(await db.query('SELECT gen_random_uuid() id')).rows[0].id;
 const as=async(role,user,sql,args=[])=>{await db.exec('SET ROLE '+role);try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user||'']);return await db.query(sql,args);}finally{await db.exec('RESET ROLE');}};
 async function create(who=outside,audience='only_me'){const post=await id();await rpc('create_protected_draft',[who,post,audience,plan,fields]);return post;}
 async function publish(post,who=outside){const pub='freeupper-protected-v2/'+who+'/asset_'+(await id()).replaceAll('-','');await rpc('protected_publish_transition',[who,post,'reserve',{slot:0,public_id:pub}]);const ref=await rpc('protected_publish_transition',[who,post,'register',{slot:0,public_id:pub,cloudinary_asset_id:(await id()).replaceAll('-',''),resource_type:'image',format:'jpg'}]);await rpc('protected_publish_transition',[who,post,'publish',{}]);return ref.asset_id;}
 await t.test('global eligibility does not require either historical publisher list; nonexistent, suspended, anonymous and profile-only identities fail',async()=>{
  for(const who of [owner,outside,mutual])assert.equal(await rpc('protected_publisher_beta_allowed',[who]),true);
  assert.equal(await rpc('protected_publisher_beta_allowed',[await id()]),false);
  await db.query('UPDATE public.profiles SET suspended=true WHERE id=$1',[outside]);assert.equal(await rpc('protected_publisher_beta_allowed',[outside]),false);await db.query('UPDATE public.profiles SET suspended=false WHERE id=$1',[outside]);
  await db.query('UPDATE auth.users SET is_anonymous=true WHERE id=$1',[outside]);assert.equal(await rpc('protected_publisher_beta_allowed',[outside]),false);await db.query('UPDATE auth.users SET is_anonymous=false WHERE id=$1',[outside]);
  await db.query('DELETE FROM auth.users WHERE id=$1',[outside]);assert.equal(await rpc('protected_publisher_beta_allowed',[outside]),false);await db.query('INSERT INTO auth.users(id) VALUES($1)',[outside]);
 });
 await t.test('activation fails without real-shaped storage evidence and remains disabled after installation',async()=>{
  assert.equal((await rpc('protected_first_release_status')).publishing,false);await assert.rejects(db.exec('UPDATE privacy_v2_private.release_control SET restricted_enabled=true,delivery_verified=true,publishing_verified=true'),/release_control_verified_activation/);
  await assert.rejects(create(),/remains disabled/);
 });
 // Synthetic records are confined to this isolated database, never production.
 await db.query('INSERT INTO privacy_v2_private.security_audits(results) VALUES($1)',[{expired_urls_denied:true,assets:[{valid_download_status:200,expired_download_status:401}]}]);
 await db.exec('UPDATE privacy_v2_private.release_control SET restricted_enabled=true,delivery_verified=true,publishing_verified=true');
 await t.test('all eligible users receive production readiness and legacy conversion stays false',async()=>{
  for(const who of [owner,outside,mutual]){assert.equal((await rpc('protected_publishing_access',[who,null])).mode,'production');const result=await as('authenticated',who,'SELECT public.protected_studio_beta_status() value');assert.equal(result.rows[0].value.ready,true);}
  assert.deepEqual(await rpc('protected_first_release_status'),{version:1,delivery:true,publishing:true,legacy_conversion:false});assert.equal((await rpc('protected_first_capabilities')).new_protected_posts,true);assert.equal((await rpc('protected_publishing_capabilities')).ready,true);
  await assert.rejects(as('anon',null,'SELECT public.create_protected_draft($1,$2,$3,$4,$5)',[outside,await id(),'only_me',plan,fields]),/permission denied/);
 });
 await t.test('a previously excluded owner can publish; service audience changes immediately update media and metadata authorization',async()=>{
  const post=await create(outside,'followers'),asset=await publish(post);
  await db.query("INSERT INTO public.follows VALUES($1,$2,'active')",[mutual,outside]);await db.query("INSERT INTO privacy_v2_private.follow_approvals VALUES($1,$2,'public_auto')",[mutual,outside]);
  assert.equal(await rpc('authorize_protected_asset',[asset,mutual]),true);
  // Fixture equivalent of the existing service-only reviewed transition.
  await as('service_role',null,"UPDATE public.posts SET visibility='friends' WHERE id=$1",[post]);assert.equal(await rpc('authorize_protected_asset',[asset,mutual]),false,'one-way follower denied');
  await db.query("INSERT INTO public.follows VALUES($1,$2,'active')",[outside,mutual]);await db.query("INSERT INTO privacy_v2_private.follow_approvals VALUES($1,$2,'public_auto')",[outside,mutual]);assert.equal(await rpc('authorize_protected_asset',[asset,mutual]),true);
  await as('service_role',null,"UPDATE public.posts SET visibility='only_me' WHERE id=$1",[post]);assert.equal(await rpc('authorize_protected_asset',[asset,mutual]),false);assert.equal(await rpc('authorize_protected_asset',[asset,outside]),true);
  await assert.rejects(as('authenticated',outside,"UPDATE public.posts SET visibility='followers' WHERE id=$1",[post]),/reviewed transition|permission denied/);
  await assert.rejects(as('service_role',null,"UPDATE public.posts SET visibility='public' WHERE id=$1",[post]),/Protected post visibility invalid/);
 });
 await t.test('normal protected deletion revokes delivery, retains assets for seven days, and restores safely; permanent deletion is irreversible',async()=>{
  const post=await create(),asset=await publish(post);
  await as('authenticated',outside,'SELECT public.delete_post($1)',[post]);assert.equal(await rpc('authorize_protected_asset',[asset,outside]),false);
  assert.equal((await db.query('SELECT status FROM public.post_media_assets WHERE id=$1',[asset])).rows[0].status,'ready');
  const deletion=(await db.query('SELECT * FROM privacy_v2_private.post_deletions WHERE post_id=$1',[post])).rows[0];assert.equal(deletion.permanent,false);assert.ok(new Date(deletion.purge_after)-new Date(deletion.deleted_at)>=7*86400000);
  await assert.rejects(as('authenticated',owner,'SELECT public.restore_post($1)',[post]),/not owned/);
  await as('authenticated',outside,'SELECT public.restore_post($1)',[post]);assert.equal(await rpc('authorize_protected_asset',[asset,outside]),true);
  await as('authenticated',outside,'SELECT public.permanently_delete_post($1)',[post]);assert.equal(await rpc('authorize_protected_asset',[asset,outside]),false);
  await assert.rejects(as('authenticated',outside,'SELECT public.restore_post($1)',[post]),/cannot be restored/);
  const intent=(await db.query('SELECT * FROM public.post_upload_intents WHERE post_id=$1',[post])).rows[0];assert.equal(intent.cleanup_pending,true);assert.ok(new Date(intent.cleanup_after)-new Date(intent.created_at)>=65*60000);
 });
 await t.test('expired deletions and cancelled drafts queue cleanup without early destruction; Public restoration and permanent deletion also work',async()=>{
  const post=await create(),asset=await publish(post);await as('authenticated',outside,'SELECT public.delete_post($1)',[post]);await db.query("UPDATE privacy_v2_private.post_deletions SET purge_after=now()-interval '1 second' WHERE post_id=$1",[post]);await rpc('expire_protected_drafts');assert.equal((await db.query('SELECT status FROM public.post_media_assets WHERE id=$1',[asset])).rows[0].status,'failed');await assert.rejects(as('authenticated',outside,'SELECT public.restore_post($1)',[post]),/cannot be restored/);
  const draft=await create();await rpc('protected_publish_transition',[outside,draft,'reserve',{slot:0,public_id:'freeupper-protected-v2/'+outside+'/asset_'+'1'.repeat(32)}]);await rpc('protected_publish_transition',[outside,draft,'cancel',{}]);assert.equal((await db.query('SELECT cleanup_pending FROM public.post_upload_intents WHERE post_id=$1',[draft])).rows[0].cleanup_pending,true);
  const pub=await id();await db.query("INSERT INTO public.posts(id,user_id,title,visibility) VALUES($1,$2,'Public','public')",[pub,outside]);await as('authenticated',outside,'SELECT public.delete_post($1)',[pub]);await as('authenticated',outside,'SELECT public.restore_post($1)',[pub]);assert.equal((await as('anon',null,'SELECT id FROM public.posts WHERE id=$1',[pub])).rows.length,1);await as('authenticated',outside,'SELECT public.permanently_delete_post($1)',[pub]);assert.equal((await db.query('SELECT id FROM public.posts WHERE id=$1',[pub])).rows.length,0);
 });
}finally{await db.close();}});
