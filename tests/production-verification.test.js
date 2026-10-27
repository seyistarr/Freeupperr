import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const migrationName = (await readdir('supabase/migrations')).find(name => name.endsWith('_temporary_production_verification.sql'));
assert.ok(migrationName);
const migration = await readFile('supabase/migrations/' + migrationName, 'utf8');
const owner='9341af03-e007-4fc6-9c23-b06073379088', other='a0a53cb6-be86-4862-b267-f7f43d4cf324', third='5b5bd4b3-22df-41e7-8e6e-2dae82ee68df';
const excluded='1568563e-592f-4dd4-8efa-ee9429aebacb', follower='00000000-0000-4000-8000-000000000001',mutual='00000000-0000-4000-8000-000000000002',stranger='00000000-0000-4000-8000-000000000003';
const fields={source:'studio',title:'Verification fixture',content:'',tags:[],comments_hidden:false};
const imagePlan=[{slot:0,type:'image',role:'media'}];
test('temporary verification preserves global gates, service privileges, audience checks and cleanup isolation', async t=>{
 const db=new PGlite();
 try {
  await db.exec(await readFile('tests/fixtures/production-protected-workflow.sql','utf8'));
  await db.exec(migration);
  for(const id of [owner,other,third,excluded,follower,mutual,stranger]) await db.query('INSERT INTO public.profiles(id) VALUES($1)',[id]);
  for(const id of [owner,other,third]) {
   await db.query('INSERT INTO privacy_v2_private.protected_publisher_allowlist VALUES($1,true)',[id]);
   await db.query('INSERT INTO privacy_v2_private.test_publishers(user_id) VALUES($1)',[id]);
  }
  async function as(role,user,sql,params=[]) {
   await db.exec('SET ROLE '+role);
   try {await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user||'']);return await db.query(sql,params);}
   finally {await db.exec('RESET ROLE');}
  }
  const rpc=async(name,params,placeholders)=> (await as('service_role',null,`SELECT public.${name}(${placeholders||params.map((_,i)=>'$'+(i+1)).join(',')}) value`,params)).rows[0].value;
  const newId=async()=> (await db.query('SELECT gen_random_uuid() id')).rows[0].id;
  const create=async(who=owner,audience='followers',plan=imagePlan,id=null)=>{id||=await newId();await rpc('create_verification_draft',[who,id,audience,plan,fields]);return id;};
  async function publish(id,who=owner,plan=imagePlan){
   const refs=[];
   for(const entry of plan){
    const publicId='freeupper-protected-v2/'+who+'/asset_'+String(entry.slot).padStart(32,'0');
    await rpc('protected_publish_transition',[who,id,'reserve',{slot:entry.slot,public_id:publicId}]);
    refs.push(await rpc('protected_publish_transition',[who,id,'register',{slot:entry.slot,public_id:publicId,cloudinary_asset_id: (await newId()).replaceAll('-',''),resource_type:entry.type,format:entry.type==='video'?'mp4':'jpg'}]));
   }
   await rpc('protected_publish_transition',[who,id,'publish',{}]);return refs;
  }
  await t.test('disabled verification and normal production paths both fail closed',async()=>{
   await assert.rejects(create(),/Verification publisher unavailable/);
   await assert.rejects(rpc('create_protected_draft',[owner,await newId(),'only_me',imagePlan,fields]),/remains disabled/);
  });
  await db.exec("UPDATE privacy_v2_private.verification_control SET enabled=true,started_at=now(),expires_at=now()+interval '7 days'");
  await t.test('exactly three accounts qualify, even if another account is added to the older allowlists',async()=>{
   for(const id of [owner,other,third]) assert.equal((await rpc('protected_publishing_access',[id,null])).mode,'verification');
   await db.query('INSERT INTO privacy_v2_private.protected_publisher_allowlist VALUES($1,true)',[excluded]);
   await db.query('INSERT INTO privacy_v2_private.test_publishers(user_id) VALUES($1)',[excluded]);
   assert.equal((await rpc('protected_publishing_access',[excluded,null])).mode,'disabled');
   await assert.rejects(create(excluded),/Verification publisher unavailable/);
   await db.query('DELETE FROM privacy_v2_private.protected_publisher_allowlist WHERE user_id=$1',[excluded]);
   await db.query('DELETE FROM privacy_v2_private.test_publishers WHERE user_id=$1',[excluded]);
  });
  await t.test('clients cannot call privileged verification RPCs, insert markers or forge restricted posts',async()=>{
   await assert.rejects(as('authenticated',owner,'SELECT public.create_verification_draft($1,$2,$3,$4,$5)',[owner,await newId(),'only_me',imagePlan,fields]),/permission denied/);
   await assert.rejects(as('authenticated',owner,'INSERT INTO privacy_v2_private.verification_posts(post_id,owner_id,expires_at) VALUES($1,$2,now()+interval \'1 hour\')',[await newId(),owner]),/permission denied/);
   await assert.rejects(as('authenticated',owner,"INSERT INTO public.posts(user_id,title,visibility,publishing_state,is_hidden) VALUES($1,'forged','only_me','draft',true)",[owner]),/Restricted post publishing is disabled|permission denied/);
   for(const sig of ['public.protected_publishing_access(uuid,uuid)','public.protected_media_release_allowed(uuid)','public.retire_verification_post(uuid,uuid)','public.claim_verification_cleanup(uuid,uuid)']) assert.equal((await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') allowed",[sig])).rows[0].allowed,false);
  });
  await t.test('Public posts are unchanged and cannot be converted into verification posts',async()=>{
   const id=await newId();await db.query("INSERT INTO public.posts(id,user_id,title,visibility) VALUES($1,$2,'Existing public','public')",[id,owner]);
   await assert.rejects(create(owner,'followers',imagePlan,id),/Invalid verification draft/);
   const asset=await newId();
   await db.query("INSERT INTO public.post_media_assets(id,post_id,owner_id,cloudinary_asset_id,cloudinary_public_id,resource_type,format,delivery_type,status) VALUES($1,$2,$3,'unmarked','unmarked','image','jpg','authenticated','ready')",[asset,id,owner]);
   assert.equal(await rpc('protected_media_release_allowed',[asset]),false,'verification mode cannot enable unmarked media');
   await assert.rejects(create(owner,'public'),/Invalid verification draft/);
   assert.equal((await as('authenticated',stranger,'SELECT id FROM public.posts WHERE id=$1',[id])).rows.length,1);
  });
  for(const [a,allowed]of [['followers',[owner,follower,mutual]],['friends',[owner,mutual]],['only_me',[owner]]]){
   await t.test(a+' retains owner/follower/mutual authorization for registered media and RLS',async()=>{
    for(const [from,to]of [[follower,owner],[mutual,owner],[owner,mutual]]){
     await db.query("INSERT INTO public.follows VALUES($1,$2,'active') ON CONFLICT DO NOTHING",[from,to]);
     await db.query("INSERT INTO privacy_v2_private.follow_approvals VALUES($1,$2,'public_auto') ON CONFLICT DO NOTHING",[from,to]);
    }
    const id=await create(owner,a);const [asset]=await publish(id);
    assert.equal(await rpc('protected_media_release_allowed',[asset.asset_id]),true);
    for(const viewer of [owner,follower,mutual,stranger,null]) {
     assert.equal(await rpc('authorize_protected_asset',[asset.asset_id,viewer]),allowed.includes(viewer),a+':'+viewer);
     if(viewer)assert.equal((await as('authenticated',viewer,'SELECT id FROM public.posts WHERE id=$1',[id])).rows.length,allowed.includes(viewer)?1:0);
    }
    await assert.rejects(rpc('protected_publish_transition',[other,id,'reserve',{slot:0,public_id:'bad'}]),/release is disabled|origin required/);
   });
  }
  await t.test('video cannot publish without its registered authenticated poster',async()=>{
   const plan=[{slot:0,type:'video',role:'media'},{slot:20,type:'image',role:'thumbnail'}];const id=await create(owner,'only_me',plan);
   await assert.rejects(rpc('protected_publish_transition',[owner,id,'publish',{}]),/Incomplete protected media/);
   const refs=await publish(id,owner,plan);
   const row=(await db.query('SELECT media FROM public.posts WHERE id=$1',[id])).rows[0];
   assert.equal(row.media[0].thumbnail_asset_id,refs[1].asset_id);
  });
  await t.test('expired, revoked or disabled verification cannot deliver, mutate or remain visible even if normal release is later enabled',async()=>{
   const id=await create();const [asset]=await publish(id);
   await db.query("UPDATE privacy_v2_private.verification_posts SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE post_id=$1",[id]);
   await db.exec('UPDATE privacy_v2_private.release_control SET restricted_enabled=true,delivery_verified=true,publishing_verified=true');
   assert.equal(await rpc('protected_media_release_allowed',[asset.asset_id]),false);
   assert.equal((await as('authenticated',owner,'SELECT id FROM public.posts WHERE id=$1',[id])).rows.length,0);
   await assert.rejects(rpc('protected_publish_transition',[owner,id,'publish',{}]),/release is disabled/);
   await db.exec('UPDATE privacy_v2_private.release_control SET restricted_enabled=false,delivery_verified=false,publishing_verified=false');
   const active=await create();const [liveAsset]=await publish(active);
   await db.query('UPDATE privacy_v2_private.protected_publisher_allowlist SET enabled=false WHERE user_id=$1',[owner]);
   assert.equal(await rpc('protected_media_release_allowed',[liveAsset.asset_id]),false);
   await db.query('UPDATE privacy_v2_private.protected_publisher_allowlist SET enabled=true WHERE user_id=$1',[owner]);
   await db.exec('UPDATE privacy_v2_private.verification_control SET enabled=false');
   assert.equal(await rpc('protected_media_release_allowed',[liveAsset.asset_id]),false);
   await assert.rejects(create(),/publisher unavailable/);
   await db.exec('UPDATE privacy_v2_private.verification_control SET enabled=true');
  });
  await t.test('verification automatically expires and limits each publisher to ten unretired posts',async()=>{
   await db.exec("UPDATE privacy_v2_private.verification_control SET started_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'");
   assert.equal((await rpc('protected_publishing_access',[third,null])).mode,'disabled');
   await assert.rejects(create(third),/publisher unavailable/);
   await db.exec("UPDATE privacy_v2_private.verification_control SET started_at=now(),expires_at=now()+interval '7 days'");
   const ids=[];for(let i=0;i<10;i++)ids.push(await create(third));
   await assert.rejects(create(third),/Clean up verification posts/);
   for(const id of ids)await rpc('retire_verification_post',[third,id]);
   await create(third);
  });
  await t.test('owner-scoped cleanup works after expiry/disable, never claims another post, and confirms deletion only after leased success',async()=>{
   const id=await create(other,'only_me');const [asset]=await publish(id,other);
   await db.exec('UPDATE privacy_v2_private.verification_control SET enabled=false');
   await assert.rejects(rpc('retire_verification_post',[owner,id]),/unavailable/);
   await rpc('retire_verification_post',[other,id]);
   assert.equal(await rpc('protected_media_release_allowed',[asset.asset_id]),false);
   assert.equal((await rpc('list_verification_posts',[other])).find(p=>p.id===id).cleanupPending,true);
   await assert.rejects(rpc('claim_verification_cleanup',[owner,id]),/unavailable/);
   assert.equal((await rpc('claim_verification_cleanup',[other,id])).length,0,'live upload signatures defer remote deletion');
   await db.query("UPDATE public.post_upload_intents SET cleanup_after=now()-interval '1 minute' WHERE post_id=$1",[id]);
   const batch=await rpc('claim_verification_cleanup',[other,id]);assert.equal(batch.length,1);
   assert.equal(await rpc('complete_protected_cleanup',[batch[0].id,await newId(),true]),false);
   assert.equal(await rpc('complete_protected_cleanup',[batch[0].id,batch[0].lease,true]),true);
   assert.equal((await rpc('list_verification_posts',[other])).find(p=>p.id===id).cleanupPending,false);
   await rpc('retire_verification_post',[other,id]);
   assert.equal((await rpc('list_verification_posts',[other])).find(p=>p.id===id).cleanupPending,false,'retries do not requeue completed deletion');
   assert.equal((await rpc('list_verification_posts',[excluded])).length,0);
   const legacy=(await db.query('SELECT protected_first_release_status() value')).rows[0].value;
   assert.deepEqual(legacy,{version:1,delivery:false,publishing:false,legacy_conversion:false});
  });
 } finally {await db.close();}
});
