import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { planLegacyPost, publicAsset, verifySource, probeUrls, REVOCATION_WAIT_MS } from '../lib/protected-media/legacy-media-plan.js';
import { LegacyMediaMigration, buildLegacyPlan, requireLegacyEnvironment, attestLegacySource } from '../lib/protected-media/legacy-media-migration.js';
import { protectedDraftFields } from '../lib/protected-media/staging-publishing-server.js';
const owner='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
const url='https://res.cloudinary.com/sxdcqs5x/image/upload/v123/legacy/photo.jpg';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/post-privacy-v2-integration',
  FREEUPPER_MEDIA_TEST_ENV:'isolated-freeupper-staging',SUPABASE_URL:'https://tagkrhvgcbnybiuyvjxt.supabase.co',
  CLOUDINARY_CLOUD_NAME:'sxdcqs5x',FREEUPPER_PROTECTED_MEDIA_DELIVERY:'enabled-in-isolated-staging',
  FREEUPPER_PROTECTED_PUBLISHING:'enabled-in-isolated-staging',SUPABASE_ANON_KEY:'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY:'secret',CLOUDINARY_API_KEY:'key',CLOUDINARY_API_SECRET:'secret',
  FREEUPPER_LEGACY_MIGRATION:'enabled-in-isolated-staging'};
const post=()=>({id,user_id:owner,visibility:'public',publishing_state:'published',is_hidden:false,is_deleted:false,
  media:[{url,type:'image',thumbnailUrl:url,public_id:'legacy/photo'}],media_url:url,thumbnail_url:url,publish_payload:{title:'caption',source:'composer'}});
const source=()=>({asset_id:'a'.repeat(32),public_id:'legacy/photo',version:123,resource_type:'image',type:'upload',bytes:1000,format:'jpg',secure_url:url,
  context:{custom:{freeupper_owner_id:owner,freeupper_post_id:id}},derived:[]});
test('inventory includes top-level aliases, media URLs, video posters and every cached rendition',()=>{
  const p=planLegacyPost(post());assert.equal(p.entries.length,1);assert.equal(p.refs[0].thumbnail_slot,0);
  const video='https://res.cloudinary.com/sxdcqs5x/video/upload/v123/legacy/clip.mp4';
  const poster=video.replace('/upload/','/upload/so_auto,w_800,h_800,c_fill/').replace('.mp4','.jpg');
  const v=planLegacyPost({...post(),media:[{url:video,type:'video',thumbnailUrl:poster}],media_url:video,thumbnail_url:poster});
  const oldVideo=planLegacyPost({...post(),media:[{url:video,type:'video'}],media_url:video,thumbnail_url:null});
  assert.ok(oldVideo.entries[oldVideo.refs[0].thumbnail_slot].url.includes('/so_0/'));
  assert.equal(v.entries.length,2);assert.equal(v.refs[0].type,'video');assert.equal(v.entries[1].type,'image');
  const a=source();a.derived=[{secure_url:url.replace('/v123/','/w_300/v123/')}];
  const probes=probeUrls(a,p.entries);assert.equal(probes.length,4);assert.ok(probes.some(u=>u.includes('/upload/legacy/photo')));
});
test('unknown alias fields, external/signed URLs, music, layers, ambiguous versions and unsupported media fail closed',()=>{
  for(const patch of [{sound_id:id},{text_template_id:id},{audio_url:'//cdn.example/audio.mp3'},{publish_payload:{poster:url}},
    {media:[{url,type:'image',originalUrl:url}]},{media:[]},{media:[{url,type:'text'}]},
    {media:[{url:url.replace('/v123/','/l_audio:shared/v123/'),type:'image'}]}]) assert.throws(()=>planLegacyPost({...post(),...patch}));
  for(const unsafe of [url.replace('sxdcqs5x','production'),url.replace('https:','http:'),url+'?token=x',url.replace('/v123/','/'),
    url.replace('/v123/','/s--signature--/v123/'),'https://127.0.0.1/file.jpg'])assert.throws(()=>publicAsset(unsafe));
});
test('source URL possession does not establish ownership, version or immutable asset identity',()=>{
  const entry=planLegacyPost(post()).entries[0];assert.throws(()=>verifySource(source(),entry,post()));assert.equal(verifySource(source(),entry,post(),true).asset_id,'a'.repeat(32));
  for(const change of [{context:{custom:{freeupper_owner_id:id}}},{version:124},{asset_id:'bad'},{type:'authenticated'},{bytes:0},{derived_next_cursor:'more'}])
    assert.throws(()=>verifySource({...source(),...change},entry,post(),true));
});
test('dry-run plans only read metadata/dependencies; source sharing blocks preparation',async()=>{
  let writes=0;
  const cloudinary={api:{async resource(){return source();}},uploader:{async upload(){writes++;}}};
  const db={async rpc(name){return {data:name==='verified_legacy_source'?true:0};}};
  const p=await buildLegacyPlan({post:post(),cloudinary,db});assert.equal(p.sources.length,1);assert.equal(writes,0);
  await assert.rejects(buildLegacyPlan({post:post(),cloudinary,db:{async rpc(name){return {data:name==='verified_legacy_source'?true:1};}}}),/Shared/);
  for(const overrides of [{VERCEL_ENV:'production'},{CLOUDINARY_CLOUD_NAME:'production'},{FREEUPPER_LEGACY_MIGRATION:''}])assert.throws(()=>requireLegacyEnvironment({...env,...overrides}));
});
async function fixture() {
  const plan=await buildLegacyPlan({post:post(),cloudinary:{api:{async resource(){return source();}}},db:{async rpc(name){return {data:name==='verified_legacy_source'?true:0};}}});
  const job={id:'30000000-0000-4000-8000-000000000001',state:'copying',original_row:post(),plan,copies:{},deletions:{}};
  const calls=[],uploads=[],deletes=[];let remoteCopy=null,publicPresent=true;
  const db={async rpc(name,args){if(name==='verified_legacy_source')return {data:true};calls.push(args);assert.equal(name,'legacy_media_transition');
    if(args.p_action==='copy')job.copies[String(args.p_data.slot)]={...args.p_data.copy,registry_id:id};
    if(args.p_action==='revoking')job.state='revoking';
    return {data:structuredClone(job)};}};
  const cloudinary={api:{
    async resource(pid){if(pid==='legacy/photo'){if(!publicPresent)throw {http_code:404};return source();}if(remoteCopy)return remoteCopy;throw {http_code:404};},
    async resource_by_asset_id(asset){if(asset==='a'.repeat(32)){if(!publicPresent)throw {http_code:404};return source();}if(remoteCopy?.asset_id===asset)return remoteCopy;throw {http_code:404};},
    async delete_resources_by_asset_ids(ids,options){deletes.push({ids,options});publicPresent=false;return {deleted:{[ids[0]]:'deleted'}};}
  },uploader:{async upload(u,options){uploads.push({u,options});remoteCopy={asset_id:'b'.repeat(32),public_id:options.public_id,resource_type:'image',type:'authenticated',format:'jpg',bytes:1000,context:{custom:options.context}};return remoteCopy;}}};
  const migration=new LegacyMediaMigration({db,cloudinary,ownerId:owner,postId:id,env});
  return {job,calls,uploads,deletes,migration,setCopy(value){remoteCopy=value;}};
}
test('retry recovers a lost registration without reuploading, with authenticated ownership-bound copies',async()=>{
  const f=await fixture();await f.migration.copy();await f.migration.copy();
  assert.equal(f.uploads.length,1);assert.equal(f.uploads[0].options.overwrite,false);assert.equal(f.uploads[0].options.type,'authenticated');
  assert.equal(f.uploads[0].options.context.freeupper_owner_id,owner);assert.ok(f.calls.some(a=>a.p_action==='release'));
});
test('revocation refuses pre-quarantine, then deletes by immutable source ID with invalidation',async()=>{
  const f=await fixture();await f.migration.copy();await assert.rejects(f.migration.revoke());assert.equal(f.deletes.length,0);
  f.job.state='quarantined';await f.migration.revoke();assert.deepEqual(f.deletes[0].ids,['a'.repeat(32)]);
  assert.equal(f.deletes[0].options.invalidate,true);assert.equal(f.deletes[0].options.keep_original,false);
  assert.ok(f.calls.some(a=>a.p_action==='deleted'));
});
test('old URL 200/redirects/network errors never count as verified, and waiting period cannot be skipped',async()=>{
  const f=await fixture();f.job.state='revoking';f.job.revocation_started_at=new Date().toISOString();
  let requests=0;f.migration.fetchImpl=async()=>{requests++;return {status:404};};
  await assert.rejects(f.migration.observe('region_a'));assert.equal(requests,0);
  f.job.revocation_started_at=new Date(Date.now()-REVOCATION_WAIT_MS-1000).toISOString();
  // Sources are still present, so verification must fail even if HTTP probes would return 404.
  await assert.rejects(f.migration.observe('region_a'));assert.equal(requests,0);
  await f.migration.copy().catch(()=>{}); // Copy phase itself is frozen.
  f.job.state='copying';await f.migration.copy();f.job.state='quarantined';await f.migration.revoke();
  f.job.revocation_started_at=new Date(Date.now()-REVOCATION_WAIT_MS-1000).toISOString();
  for(const status of [200,206,301,403,500]) { f.migration.fetchImpl=async()=>({status});await assert.rejects(f.migration.observe('region_a')); }
  f.migration.fetchImpl=async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.headers,undefined);return {status:404};};
  await f.migration.observe('region_a');assert.ok(f.calls.some(a=>a.p_action==='observe'));
});
test('unsupported protected text/music/overlays or public media links are rejected on the server',()=>{
  for(const patch of [{audio_url:url},{textOverlays:[{text:'overlay'}]},{sound_id:id},{media:[{url}]},{content:url}])
    assert.throws(()=>protectedDraftFields({source:'studio',...patch}));
});


test('reviewed provenance attestation is read-only by default and binds immutable identity to actual owner/post',async()=>{
  let writes=0;
  const evidence={asset_id:'a'.repeat(32),post_id:id,owner_id:owner,public_id:'legacy/photo',resource_type:'image',version:123,
    evidence_sha256:'c'.repeat(64),reviewed_by:'staging-reviewer'};
  const cloudinary={api:{async resource_by_asset_id(){return {...source(),context:{}};}}};
  const db={from(name){assert.equal(name,'legacy_media_provenance');return {
    select(){return this;},eq(){return this;},async maybeSingle(){return {data:null};},async insert(row){writes++;assert.equal(row.owner_id,owner);assert.equal(row.post_id,id);return {};}
  };}};
  assert.equal((await attestLegacySource({db,cloudinary,post:post(),evidence})).dryRun,true);assert.equal(writes,0);
  await assert.rejects(attestLegacySource({db,cloudinary,post:post(),evidence:{...evidence,owner_id:id},dryRun:false}));assert.equal(writes,0);
  await attestLegacySource({db,cloudinary,post:post(),evidence,dryRun:false});assert.equal(writes,1);
});
test('staging visibility endpoint binds to verified JWT owner and never downgrades or bypasses database refusal',async()=>{
  for(const visibility of ['friends','public','unknown']) {
    let calls=0;
    const context={process:{env},console:{error(){}},stagingPublishingEnabled:()=>true,requirePublishingSchema:async()=>{},
      stagingPublishingDb:()=>({async rpc(name,args){calls++;assert.equal(name,'set_protected_visibility');assert.equal(args.p_owner,owner);
        assert.equal(args.p_post,id);assert.equal(args.p_visibility,'friends');return {error:{message:'private upstream detail'}};}}),
      createClient:()=>({auth:{async getUser(token){assert.equal(token,'owner-token');return {data:{user:{id:owner}}};}}})};
    const code=readFileSync(new URL('../api/privacy-v2-publish.js',import.meta.url),'utf8')
      .replace(/^import[\s\S]*?from '[^']+';\n/gm,'').replace('export default async function handler','async function handler');
    vm.runInNewContext(code+'\nthis.handler=handler;',context);
    const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
    await context.handler({method:'POST',headers:{authorization:'Bearer owner-token'},body:{action:'visibility',post_id:id,owner_id:id,visibility}},res);
    assert.equal(res.code,visibility==='friends'?409:400);assert.equal(calls,visibility==='friends'?1:0);
    assert.doesNotMatch(JSON.stringify(res.body),/private upstream/);
  }
});
test('abandon cleans authenticated orphan copies only before quarantine; public source deletion is never used for rollback',async()=>{
  const f=await fixture();f.job.state='quarantined';await assert.rejects(f.migration.abandon());assert.equal(f.deletes.length,0);
});


test('retrying an absent immutable source records an empty deletion map conservatively without restarting the wait',async()=>{
  const f=await fixture();await f.migration.copy();f.job.state='quarantined';await f.migration.revoke();
  f.migration.cloudinary.api.delete_resources_by_asset_ids=async()=>({deleted:{}});
  await f.migration.revoke();
  const evidence=f.calls.filter(c=>c.p_action==='deleted').at(-1).p_data;
  assert.equal(evidence.provider_acknowledgement,'already_absent');assert.equal(evidence.invalidation_requested,true);
  assert.equal(evidence.origin_absent,true);assert.equal(evidence.reset_wait,false);
});
