import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const ids=['9341af03-e007-4fc6-9c23-b06073379088','a0a53cb6-be86-4862-b267-f7f43d4cf324','5b5bd4b3-22df-41e7-8e6e-2dae82ee68df'];
const excluded='1568563e-592f-4dd4-8efa-ee9429aebacb',follower='00000000-0000-4000-8000-000000000001',mutual='00000000-0000-4000-8000-000000000002';
const [owner]=ids,fields={source:'studio',title:'Private caption',content:'Secret words',tags:[],comments_hidden:false};
const plan=[{slot:0,type:'image',role:'media'}];
test('permanent beta: exact publisher scope, parent metadata, deletion and maintenance authorization',async t=>{
 const db=new PGlite();
 try{
  await db.exec(await readFile('tests/fixtures/production-protected-workflow.sql','utf8'));
  for(const suffix of ['_temporary_production_verification.sql','_permanent_controlled_privacy_beta.sql']){
   if(suffix.includes('permanent'))await db.exec(await readFile('tests/fixtures/production-beta-dependencies.sql','utf8'));
   const name=(await readdir('supabase/migrations')).find(n=>n.endsWith(suffix));assert.ok(name);await db.exec(await readFile('supabase/migrations/'+name,'utf8'));
  }
  for(const id of [...ids,excluded,follower,mutual])await db.query('INSERT INTO public.profiles(id) VALUES($1)',[id]);
  for(const id of [...ids,excluded]){
   await db.query('INSERT INTO privacy_v2_private.protected_publisher_allowlist VALUES($1,true)',[id]);
   await db.query('INSERT INTO privacy_v2_private.test_publishers(user_id) VALUES($1)',[id]);
  }
  const rpc=async(name,args=[])=>(await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1))}) value`,args)).rows[0].value;
  const uuid=async()=>(await db.query('SELECT gen_random_uuid() id')).rows[0].id;
  const as=async(role,user,sql,args=[])=>{await db.exec('SET ROLE '+role);try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user||'']);return await db.query(sql,args);}finally{await db.exec('RESET ROLE');}};
  async function create(who=owner,audience='followers'){
   const id=await uuid();await rpc('create_protected_draft',[who,id,audience,plan,fields]);return id;
  }
  async function publish(id,who=owner){
   const publicId='freeupper-protected-v2/'+who+'/asset_'+(await uuid()).replaceAll('-','');
   await rpc('protected_publish_transition',[who,id,'reserve',{slot:0,public_id:publicId}]);
   const ref=await rpc('protected_publish_transition',[who,id,'register',{slot:0,public_id:publicId,cloudinary_asset_id:(await uuid()).replaceAll('-',''),resource_type:'image',format:'jpg'}]);
   await rpc('protected_publish_transition',[who,id,'publish',{}]);return ref.asset_id;
  }
  await t.test('installation does not activate gates; verification cannot be revived',async()=>{
   assert.equal((await rpc('protected_first_release_status')).publishing,false);
   await assert.rejects(create(),/remains disabled/);
   await db.exec("UPDATE privacy_v2_private.verification_control SET enabled=true,started_at=now(),expires_at=now()+interval '1 day'");
   await assert.rejects(rpc('create_verification_draft',[owner,await uuid(),'only_me',plan,fields]),/has ended/);
   assert.equal((await rpc('protected_publishing_access',[owner,null])).mode,'disabled');
  });
  await db.exec('UPDATE privacy_v2_private.release_control SET restricted_enabled=true,delivery_verified=true,publishing_verified=true');
  await t.test('exactly three immutable account IDs may create; expanding old lists cannot grant firstuser publishing',async()=>{
   for(const who of ids){assert.equal((await rpc('protected_publishing_access',[who,null])).mode,'production');await create(who);}
   assert.equal(await rpc('protected_publisher_beta_allowed',[excluded]),false);
   assert.equal((await rpc('protected_publishing_access',[excluded,null])).mode,'disabled');
   await assert.rejects(create(excluded),/publisher not approved/);
   await assert.rejects(as('authenticated',excluded,'SELECT public.create_protected_draft($1,$2,$3,$4,$5)',[excluded,await uuid(),'only_me',plan,fields]),/permission denied/);
  });
  for(const [from,to]of [[follower,owner],[mutual,owner],[owner,mutual],[excluded,owner]]){
   await db.query("INSERT INTO public.follows VALUES($1,$2,'active')",[from,to]);
   await db.query("INSERT INTO privacy_v2_private.follow_approvals VALUES($1,$2,'public_auto')",[from,to]);
  }
  for(const [audience,allowed]of [['followers',[owner,follower,mutual,excluded]],['friends',[owner,mutual]],['only_me',[owner]]]){
   await t.test(audience+' authorizes media and child metadata consistently, including firstuser viewing',async()=>{
    const id=await create(owner,audience),asset=await publish(id);
    await db.query('INSERT INTO public.comments(post_id,user_id,content) VALUES($1,$2,$3)',[id,owner,'Private discussion']);
    await db.query('INSERT INTO public.reposts(post_id,user_id,comment) VALUES($1,$2,$3)',[id,owner,'Private repost caption']);
    await db.query('INSERT INTO public.notifications(post_id,receiver_id,content) VALUES($1,$2,$3)',[id,excluded,'Mention']);
    if(!allowed.includes(excluded))assert.equal((await db.query('SELECT * FROM public.notifications WHERE post_id=$1',[id])).rows.length,0,'unrelated recipient never gets a push notification');
    for(const viewer of [owner,follower,mutual,excluded,null]){
     const expected=allowed.includes(viewer);assert.equal(await rpc('authorize_protected_asset',[asset,viewer]),expected);
     for(const table of ['posts','comments','reposts']){
      const rows=await as(viewer?'authenticated':'anon',viewer,`SELECT * FROM public.${table} WHERE ${table==='posts'?'id':'post_id'}=$1`,[id]);assert.equal(rows.rows.length,expected?1:0,table+':'+viewer);
     }
    }
    await assert.rejects(db.query('UPDATE public.posts SET media_url=$1 WHERE id=$2',['https://res.cloudinary.com/secret',id]),/opaque registry/);
   });
  }
  await t.test('unfollow revokes both metadata and media without changing publisher eligibility',async()=>{
   const id=await create(),asset=await publish(id);
   await db.query('DELETE FROM public.follows WHERE follower_id=$1 AND following_id=$2',[follower,owner]);
   assert.equal(await rpc('authorize_protected_asset',[asset,follower]),false);
   assert.equal((await as('authenticated',follower,'SELECT * FROM public.posts WHERE id=$1',[id])).rows.length,0);
  });
  await t.test('direct DELETE retains tombstone, immediately revokes delivery and preserves delayed cleanup, including after release is disabled',async()=>{
   const id=await create(),asset=await publish(id);
   await db.exec('UPDATE privacy_v2_private.release_control SET restricted_enabled=false');
   await db.query('DELETE FROM public.posts WHERE id=$1',[id]);
   assert.equal(await rpc('authorize_protected_asset',[asset,owner]),false);
   const row=(await db.query('SELECT * FROM public.posts WHERE id=$1',[id])).rows[0];assert.equal(row.is_deleted,true);
   const intent=(await db.query('SELECT * FROM public.post_upload_intents WHERE post_id=$1',[id])).rows[0];assert.equal(intent.cleanup_pending,true);assert.equal(intent.state,'cleanup');
   assert.ok(new Date(intent.cleanup_after)-new Date(intent.created_at)>=65*60000);
   assert.equal((await rpc('claim_protected_cleanup_batch',[10])).length,0);
   await assert.rejects(db.query('UPDATE public.posts SET is_deleted=false WHERE id=$1',[id]),/retired/);
   await db.query("UPDATE public.post_upload_intents SET cleanup_after=now()-interval '1 minute' WHERE post_id=$1",[id]);
   const [claim]=await rpc('claim_protected_cleanup_batch',[10]);assert.equal(claim.post_id,id);
   await rpc('complete_protected_cleanup',[claim.id,claim.lease,false]);
   assert.equal((await db.query('SELECT cleanup_pending FROM public.post_upload_intents WHERE id=$1',[claim.id])).rows[0].cleanup_pending,true);
   await db.query("UPDATE public.post_upload_intents SET cleanup_after=now()-interval '1 minute' WHERE post_id=$1",[id]);
   const [retry]=await rpc('claim_protected_cleanup_batch',[10]);await rpc('complete_protected_cleanup',[retry.id,retry.lease,true]);
   await db.query('DELETE FROM public.posts WHERE id=$1',[id]);
   assert.equal((await db.query('SELECT cleanup_pending FROM public.post_upload_intents WHERE id=$1',[claim.id])).rows[0].cleanup_pending,false,'idempotent deletion');
   await db.exec('UPDATE privacy_v2_private.release_control SET restricted_enabled=true');
  });
  await t.test('Public post and its discussion remain readable, and normal Public deletion remains physical',async()=>{
   const id=await uuid();await db.query("INSERT INTO public.posts(id,user_id,title,visibility) VALUES($1,$2,'Public','public')",[id,owner]);
   await db.query('INSERT INTO public.comments(post_id,content) VALUES($1,$2)',[id,'Public discussion']);
   for(const table of ['posts','comments'])assert.equal((await as('anon',null,`SELECT * FROM public.${table} WHERE ${table==='posts'?'id':'post_id'}=$1`,[id])).rows.length,1);
   await db.query('DELETE FROM public.posts WHERE id=$1',[id]);assert.equal((await db.query('SELECT * FROM public.posts WHERE id=$1',[id])).rows.length,0);
  });
  await t.test('maintenance keys fail closed and browser roles cannot authorize maintenance or write evidence',async()=>{
   const token='ab'.repeat(32);assert.equal(await rpc('protected_cleanup_worker_authorized',[token]),false);
   await db.query("INSERT INTO privacy_v2_private.cleanup_worker_key VALUES(true,encode(sha256(convert_to($1,'UTF8')),'hex'),true)",[token]);
   assert.equal(await rpc('protected_cleanup_worker_authorized',[token]),true);assert.equal(await rpc('protected_cleanup_worker_authorized',['cd'.repeat(32)]),false);
   for(const sig of ['public.protected_cleanup_worker_authorized(text)','public.record_protected_security_audit(jsonb)','public.expire_protected_drafts()'])
    for(const role of ['anon','authenticated'])assert.equal((await db.query('SELECT has_function_privilege($1,$2,$3) ok',[role,sig,'EXECUTE'])).rows[0].ok,false);
   assert.equal((await rpc('protected_first_release_status')).legacy_conversion,false);
  });
 }finally{await db.close();}
});
