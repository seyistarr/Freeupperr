// Operator-only LIVE acceptance. Fixed synthetic fixtures; no arbitrary target IDs,
// URLs, user emails or credentials are accepted or returned by this runner.
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import { LegacyMediaMigration, attestLegacySource } from './legacy-media-migration.js';
import { readCompleteCloudinaryAsset } from './cloudinary-asset-inventory.js';
import { verifyStagingAsset } from './verify-staging-asset.js';
import { verifySource, publicAsset } from './legacy-media-plan.js';
import { syntheticImage, syntheticVideo } from './staging-synthetic-media.js';
export const ACCEPTANCE_RUN='privacy-v2-live-20261020';
const ORIGIN='https://freeupper-git-feature-post-privacy-v-3ab7d2-seyistarrs-projects.vercel.app';
const ROLES=['owner','follower','mutual','unapproved'];
export class AcceptanceFailure extends Error { constructor(check){super('Staging acceptance failed');this.check=check;} }
const expect=(condition,check)=>{if(!condition)throw new AcceptanceFailure(check);};
const sha=v=>createHash('sha256').update(v).digest('hex');
function fixtureId(kind) { const h=sha(ACCEPTANCE_RUN+kind);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32); }
export function acceptanceEnabled(env) {
  return env.FREEUPPER_STAGING_ACCEPTANCE==='synthetic-fixtures-only' && env.VERCEL_ENV==='preview' &&
    env.VERCEL_GIT_COMMIT_REF==='feature/post-privacy-v2-integration' && env.FREEUPPER_MEDIA_TEST_ENV==='isolated-freeupper-staging' &&
    env.SUPABASE_URL==='https://tagkrhvgcbnybiuyvjxt.supabase.co' && env.CLOUDINARY_CLOUD_NAME==='sxdcqs5x';
}
export const PROTECTED_FIRST_RUN='privacy-v2-protected-first-20261021';
export function protectedFirstAcceptanceEnabled(env) {
  return acceptanceEnabled({...env, FREEUPPER_STAGING_ACCEPTANCE:
    env.FREEUPPER_STAGING_ACCEPTANCE === 'protected-first-synthetic-only' ? 'synthetic-fixtures-only' : ''});
}
export async function runStagingAcceptance(options) { return runAcceptance(options, false); }
export async function runProtectedFirstAcceptance(options) { return runAcceptance(options, true); }
async function runAcceptance({phase,env,db,cloudinary},protectedFirst) {
  expect(protectedFirst ? protectedFirstAcceptanceEnabled(env) : acceptanceEnabled(env),'acceptance_disabled');
  // A separate operator mode uses fresh accounts and cannot reach ANY legacy
  // copy/deletion/invalidation/evidence action, even with a valid worker token.
  if(protectedFirst) expect(['seed','publish-followers','publish-friends','publish-only_me',
    'audiences','follow-transitions','recovery','session-revocation','public-control','close'].includes(phase),'protected_first_phase');
  const ACCEPTANCE_RUN=protectedFirst ? PROTECTED_FIRST_RUN : 'privacy-v2-live-20261020';
  const ROLES=protectedFirst ? ['owner','follower','mutual','unapproved','stranger'] : ['owner','follower','mutual','unapproved'];
  const fixtureId=kind=>{const h=sha(ACCEPTANCE_RUN+kind);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
  expect(['close','legacy-evidence','legacy-rollback','legacy-abandon-rollback','diagnostics','seed','publish-followers','publish-friends','publish-only_me','audiences','legacy-image','legacy-video','legacy-copy-image',
    'legacy-copy-video','legacy-revoke-image','legacy-revoke-video','legacy-status',
    ...(protectedFirst ? ['follow-transitions','recovery','session-revocation','public-control'] : [])].includes(phase),'unknown_phase');
  const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:listed,error:listError}=await admin.auth.admin.listUsers({page:1,perPage:100});
  expect(!listError && listed.users.length<100,'fixture_user_inventory');
  const users={};
  for(const role of ROLES) {
    const email=ACCEPTANCE_RUN+'-'+role+'@privacy-staging.invalid';
    let user=listed.users.find(u=>u.email===email);
    if(!user && phase==='seed') {
      const {data,error}=await admin.auth.admin.createUser({email,password:randomBytes(48).toString('base64url'),email_confirm:true,
        app_metadata:{privacy_v2_acceptance:ACCEPTANCE_RUN,fixture_role:role}});
      expect(!error && data.user,'create_synthetic_'+role);user=data.user;
    }
    expect(user?.app_metadata?.privacy_v2_acceptance===ACCEPTANCE_RUN && user.app_metadata.fixture_role===role,'fixture_identity_'+role);
    users[role]=user;
  }
  async function token(role) {
    const {data:link,error}=await admin.auth.admin.generateLink({type:'magiclink',email:users[role].email});
    expect(!error && link.properties?.hashed_token,'fixture_link_'+role);
    const client=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    // generateLink does not send mail. Only synthetic identities are accepted.
    const {data,error:verifyError}=await client.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'email'});
    expect(!verifyError && data.user?.id===users[role].id && data.session?.access_token,'fixture_login_'+role);
    const identity=await client.auth.getUser(data.session.access_token);
    expect(!identity.error && identity.data.user?.id===users[role].id,'verified_jwt_'+role);
    return {jwt:data.session.access_token,client};
  }
  async function row(id) {const r=await db.from('posts').select('*').eq('id',id).maybeSingle();expect(!r.error,'post_lookup');return r.data;}
  async function api(path,jwt,body) {
    const r=await fetch(ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{...(jwt?{Authorization:'Bearer '+jwt}:{}),
      ...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
    const type=r.headers.get('content-type') || '';let data=null;
    if(type.includes('application/json'))data=await r.json();
    else if(protectedFirst && path.startsWith('/api/post-media?') && r.ok) {
      const bytes=Buffer.from(await r.arrayBuffer());
      expect(bytes.length>0 && bytes.length<=50*1024*1024,'media_body_size');
      data={bytes:bytes.length,sha256:sha(bytes),contentType:type};
    } else await r.body?.cancel();
    return {status:r.status,data,noStore:(r.headers.get('cache-control') || '').includes('no-store'),
      variesAuth:(r.headers.get('vary') || '').toLowerCase().includes('authorization')};
  }
  const owner=users.owner.id, controlId=fixtureId('control');
  if(phase==='seed') {
    for(const user of Object.values(users)) {
      const {error}=await db.from('profiles').upsert({id:user.id,is_private:false,suspended:false});expect(!error,'seed_profile');
    }
    for(const edge of [{follower_id:users.follower.id,following_id:owner,status:'active'},
      {follower_id:users.mutual.id,following_id:owner,status:'active'},{follower_id:owner,following_id:users.mutual.id,status:'active'},
      {follower_id:users.unapproved.id,following_id:owner,status:'pending'}]) {
      const {error}=await db.from('follows').upsert(edge);expect(!error,'seed_follow');
    }
    const old=await row(controlId);
    if(!old) {const {error}=await db.from('posts').insert({id:controlId,user_id:owner,visibility:protectedFirst?'public':'only_me',is_hidden:true,is_deleted:false,
      publishing_state:'failed',media:[],publish_payload:{title:ACCEPTANCE_RUN+' control',state:{}}});expect(!error,'seed_control');}
    else expect(old.user_id===owner && old.publish_payload?.title===ACCEPTANCE_RUN+' control','control_identity');
    return {phase,run:ACCEPTANCE_RUN,roles:ROLES,syntheticAccounts:ROLES.length};
  }
  const control=await row(controlId);expect(control?.user_id===owner && control.publish_payload.title===ACCEPTANCE_RUN+' control','control_identity');
  const state=control.publish_payload.state || {};
  async function checkpoint(){const {error}=await db.from('posts').update({publish_payload:{...control.publish_payload,state}}).eq('id',controlId).eq('user_id',owner);expect(!error,'checkpoint');}
  if(phase==='close') {
    for(const [role,user] of Object.entries(users)) {
      if(protectedFirst) {const session=await token(role);const signedOut=await session.client.auth.signOut({scope:'global'});expect(!signedOut.error,'close_sessions');}
      const {error}=await admin.auth.admin.updateUserById(user.id,{app_metadata:{...user.app_metadata,
        privacy_v2_acceptance:ACCEPTANCE_RUN+'-closed',privacy_v2_acceptance_closed_at:new Date().toISOString()}});
      expect(!error,'close_synthetic_runner');
    }
    return {phase,closed:true,accountsRetained:ROLES.length,legacyWaitingUnchanged:true};
  }
  const ownerSession=await token('owner');
  const publication=async(body,jwt=ownerSession.jwt)=>api('/api/privacy-v2-publish',jwt,body);
  if(phase==='diagnostics') {
    const diagnostics=[];
    for(const [audience,entry] of Object.entries(state.publishing || {})) for(const [slot,part] of Object.entries(entry.parts || {})) {
      const a=await cloudinary.api.resource(part.public_id,{type:'authenticated',resource_type:part.resource_type});
      const r=await api('/api/privacy-v2-register-asset',ownerSession.jwt,{post_id:entry.postId,slot:Number(slot),...part});
      diagnostics.push({kind:'registered',audience,slot,response:r.status,responseError:r.data?.error,
        identityMatch:a.asset_id===part.asset_id,publicIdMatch:a.public_id===part.public_id,type:a.type,resourceType:a.resource_type,
        bytes:a.bytes,format:a.format,accessMode:a.access_mode ?? null,placeholder:!!a.placeholder,deleted:!!a.deleted,
        verified:verifyStagingAsset({asset:a,expectedPublicId:part.public_id,expectedAssetId:part.asset_id,expectedResourceType:part.resource_type})});
    }
    for(const type of ['image','video']) {
      const p=await row(fixtureId('legacy-'+type));if(!p)continue;
      const a=await cloudinary.api.resource(p.media[0].public_id,{type:'upload',resource_type:type,context:true});
      let verified=false,urlParsed=false;try {const e=publicAsset(a.secure_url);urlParsed=true;verifySource(a,e,p,true);verified=true;}catch{}
      let inventoryError=null,inventoryCount=null;
      try {const full=await readCompleteCloudinaryAsset({cloudinary,assetId:a.asset_id,publicId:a.public_id,resourceType:type});inventoryCount=full.derived.length;}
      catch(error) {inventoryError=['Incomplete Cloudinary derivative inventory','Source changed during inventory','Source identity mismatch'].includes(error.message)?error.message:'provider_lookup';}
      const page=a.next_cursor?await cloudinary.api.resource(a.public_id,{type:'upload',resource_type:type,max_results:100,derived_next_cursor:a.next_cursor}):null;
      const table=await db.from('legacy_media_provenance').select('cloudinary_asset_id').limit(1);
      diagnostics.push({kind:'legacy',sourceType:type,resourceType:a.resource_type,delivery:a.type,format:a.format,bytes:a.bytes,
        version:a.version,versionType:typeof a.version,assetIdValid:/^[a-f0-9]{32}$/.test(a.asset_id || ''),
        ownerContextMatch:a.context?.custom?.freeupper_owner_id===owner,postContextMatch:a.context?.custom?.freeupper_post_id===p.id,
        secureUrlParsed:urlParsed,verified,hasDerivedCursor:!!a.derived_next_cursor,hasNextCursor:!!a.next_cursor,rootKeys:Object.keys(a),derivedCount:a.derived?.length || 0,inventoryError,inventoryCount,
        repeatedGenericCursor:!!page && page.next_cursor===a.next_cursor,pageHasDerivedCursor:!!page?.derived_next_cursor,provenanceTableError:table.error?.code || null});
    }
    return {phase,diagnostics};
  }
  if(phase.startsWith('publish-')) {
    const visibility=phase.slice(8);state.publishing ||= {};state.publishing[visibility] ||= {};
    const entry=state.publishing[visibility];
    if(entry.complete) return {phase,...entry.result,reused:true};
    if(!entry.postId) {
      const r=await publication({action:'create',visibility,media_types:[visibility==='friends'?'video':'image'],fields:{source:'studio',title:ACCEPTANCE_RUN+' '+visibility,content:'Synthetic staging acceptance'}});
      expect(r.status===201,'draft_creation');entry.postId=r.data.id;await checkpoint();
    }
    const stranger=await token('unapproved');
    const reserveOther=await api('/api/privacy-v2-upload-signature',stranger.jwt,{post_id:entry.postId,slot:0});
    expect(reserveOther.status===409,'nonowner_signature_denied');
    const hidden=await api('/api/privacy-v2-publish?reader=posts&post_id='+entry.postId,ownerSession.jwt);
    expect(hidden.status===200 && hidden.data.posts.length===0,'hidden_draft_metadata');
    const slots=visibility==='friends'?[{slot:0,type:'video',bytes:syntheticVideo},{slot:20,type:'image',bytes:syntheticImage}]:[{slot:0,type:'image',bytes:syntheticImage}];
    entry.parts ||= {};
    for(const part of slots) {
      const key=String(part.slot);
      if(!entry.parts[key]) {
        const signed=await api('/api/privacy-v2-upload-signature',ownerSession.jwt,{post_id:entry.postId,slot:part.slot});
        expect(signed.status===200 && signed.data.type==='authenticated' && signed.data.cloud_name==='sxdcqs5x','authenticated_upload_signature');
        const form=new FormData();form.append('file',new Blob([part.bytes],{type:part.type==='image'?'image/png':'video/mp4'}),'fixture.'+(part.type==='image'?'png':'mp4'));
        for(const field of ['api_key','timestamp','folder','public_id','type','signature','overwrite'])form.append(field,String(signed.data[field]));
        const uploaded=await fetch('https://api.cloudinary.com/v1_1/sxdcqs5x/'+part.type+'/upload',{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(25000)});
        const a=await uploaded.json();expect(uploaded.ok && a.type==='authenticated' && a.public_id===signed.data.folder+'/'+signed.data.public_id,'cloudinary_authenticated_upload');
        entry.parts[key]={public_id:a.public_id,asset_id:a.asset_id,resource_type:part.type};await checkpoint();
      }
      const data={post_id:entry.postId,slot:part.slot,...entry.parts[key]};
      const foreign=await api('/api/privacy-v2-register-asset',stranger.jwt,data);expect(foreign.status===404,'nonowner_registration_denied');
      const registered=await api('/api/privacy-v2-register-asset',ownerSession.jwt,data);
      expect(registered.status===201 && registered.data.status==='ready','asset_registered');
      entry.parts[key].registry_id=registered.data.asset_id;await checkpoint();
      const draftMedia=await api('/api/post-media?asset_id='+registered.data.asset_id,ownerSession.jwt);expect(draftMedia.status===404,'draft_media_denied');
      if(visibility==='friends' && part.slot===0) {
        const premature=await publication({action:'publish',post_id:entry.postId});expect(premature.status===409,'missing_poster_prevents_publish');
      }
    }
    const published=await publication({action:'publish',post_id:entry.postId});expect(published.status===200 && published.data.status==='published','publication_complete');
    const stored=await row(entry.postId);expect(stored.visibility===visibility && stored.publishing_state==='published' && !stored.is_hidden && !JSON.stringify(stored.media).includes('https:'),'atomic_protected_references');
    entry.complete=true;entry.result={postId:entry.postId,audience:visibility,registeredAssets:Object.values(entry.parts).map(p=>p.registry_id),
      ownerPublishing:true,nonownerSignatureDenied:true,nonownerRegistrationDenied:true,draftsHidden:true,atomicReferences:true};await checkpoint();
    return {phase,...entry.result};
  }
  if(phase==='audiences') {
    const results=[];
    for(const role of [...ROLES,'guest']) {
      const session=role==='guest'?null:await token(role);
      for(const audience of ['followers','friends','only_me']) {
        const entry=state.publishing?.[audience];expect(entry?.complete,'published_fixture_required');
        const allowed=role==='owner' || (audience==='followers' && ['follower','mutual'].includes(role)) || (audience==='friends' && role==='mutual');
        const detail=await api('/api/privacy-v2-publish?reader=posts&post_id='+entry.postId,session?.jwt);
        expect(role==='guest'?detail.status===401:detail.status===200 && detail.data.posts.some(p=>p.id===entry.postId)===allowed,'metadata_'+role+'_'+audience);
        if(session) {
          for(const filter of ['author_id='+owner,'q='+encodeURIComponent(ACCEPTANCE_RUN)]) {
            const r=await api('/api/privacy-v2-publish?reader=posts&'+filter,session.jwt);
            expect(r.status===200 && r.data.posts.some(p=>p.id===entry.postId)===allowed,'feed_search_profile_'+role+'_'+audience);
          }
          const direct=await session.client.schema('privacy_test').from('posts').select('id,media').eq('id',entry.postId);
          expect(!direct.error && direct.data.some(p=>p.id===entry.postId)===allowed,'direct_rls_'+role+'_'+audience);
        }
        const media=[];
        for(const part of Object.values(entry.parts)) {
          const r=await api('/api/post-media?asset_id='+part.registry_id,session?.jwt);
          expect(r.status===(allowed?200:404),'media_'+role+'_'+audience);
          if(protectedFirst && allowed) expect(r.data?.sha256===sha(part.resource_type==='video'?syntheticVideo:syntheticImage),'authenticated_media_bytes');
          expect(r.noStore && r.variesAuth,'media_cache_headers');media.push(r.status);
        }
        results.push({role,audience,metadata:detail.status,visible:allowed,media,...(protectedFirst?{deliveredBytesVerified:allowed}: {})});
      }
    }
    for(const path of ['/api/post-preview?code=syntheticAcceptance','/api/post-text-og?code=syntheticAcceptance',
      '/api/post-short-link?id='+state.publishing.followers.postId,'/api/profile-preview?freeupper_id=synthetic','/api/profile-og?freeupper_id=synthetic','/api/sitemap-profiles']) {
      const r=await api(path);expect(r.status===404 && r.noStore,'staging_seo_does_not_query_production');
    }
    return {phase,results,profileSearchDirectRls:true,privateResponsesNoStore:true,stagingSeoBlocked:true,
      reposts:'disabled in isolated reader; no publishing/engagement acceptance claimed',browserCache:'service-worker/browser UI acceptance separate'};
  }
  if(protectedFirst && phase==='follow-transitions') {
    const follower=await token('follower'), pending=await token('unapproved'), mutual=await token('mutual');
    const image=state.publishing?.followers, video=state.publishing?.friends;
    expect(image?.complete && video?.complete,'published_fixture_required');
    async function allowed(session,entry,value,label) {
      const metadata=await api('/api/privacy-v2-publish?reader=posts&post_id='+entry.postId,session.jwt);
      const media=await api('/api/post-media?asset_id='+entry.parts['0'].registry_id,session.jwt);
      const direct=await session.client.schema('privacy_test').from('posts').select('id').eq('id',entry.postId);
      expect(metadata.status===200 && metadata.data.posts.some(p=>p.id===entry.postId)===value &&
        !direct.error && (direct.data.length===1)===value && media.status===(value?200:404),label);
    }
    async function edge(from,to,status) {
      const r=await db.from('follows').update({status}).eq('follower_id',users[from].id).eq('following_id',users[to].id);
      expect(!r.error,'follow_transition');
    }
    try {
      await allowed(pending,image,false,'pending_initial_denied');
      await edge('unapproved','owner','active');await allowed(pending,image,true,'approval_same_token');
      await edge('unapproved','owner','pending');await allowed(pending,image,false,'approval_revoked_same_token');
      await allowed(follower,image,true,'follower_initial_allowed');
      await edge('follower','owner','pending');await allowed(follower,image,false,'follower_revoked_same_token');
      await edge('owner','mutual','pending');await allowed(mutual,video,false,'reciprocity_revoked_same_token');
      await edge('owner','mutual','active');await allowed(mutual,video,true,'reciprocity_restored_same_token');
    } finally {
      await edge('follower','owner','active');await edge('unapproved','owner','pending');await edge('owner','mutual','active');
    }
    return {phase,approval:true,revocation:true,reciprocity:true,sameJwt:true,metadataMediaAndRls:true};
  }
  if(protectedFirst && phase==='recovery') {
    state.recovery ||= {};
    const entry=state.recovery;
    if(!entry.postId) {
      const created=await publication({action:'create',visibility:'only_me',media_types:['image'],fields:{source:'composer',content:'Synthetic incomplete upload'}});
      expect(created.status===201,'recovery_create');entry.postId=created.data.id;await checkpoint();
    }
    const premature=await publication({action:'publish',post_id:entry.postId});expect(premature.status===409,'incomplete_publish_denied');
    const status=await publication({action:'status',post_id:entry.postId});expect(status.status===200 && status.data.status==='draft','lost_create_response_status');
    const signed=await api('/api/privacy-v2-upload-signature',ownerSession.jwt,{post_id:entry.postId,slot:0});
    const retried=await api('/api/privacy-v2-upload-signature',ownerSession.jwt,{post_id:entry.postId,slot:0});
    expect(signed.status===200 && retried.status===200 && signed.data.public_id===retried.data.public_id && signed.data.timestamp===retried.data.timestamp,'lost_signature_response_same_intent');
    async function retryUpload() {
      const form=new FormData();form.append('file',new Blob([syntheticImage],{type:'image/png'}),'lost-response.png');
      for(const field of ['api_key','timestamp','folder','public_id','type','signature','overwrite'])form.append(field,String(retried.data[field]));
      return fetch('https://api.cloudinary.com/v1_1/sxdcqs5x/image/upload',{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(25000)});
    }
    if(!entry.uploadResponseLost) {
      const lost=await retryUpload();expect(lost.ok,'upload_before_response_loss');
      // Deliberately discard the upload response without retaining its asset ID.
      await lost.body?.cancel();entry.uploadResponseLost=true;await checkpoint();
    }
    const repeated=await retryUpload(), asset=await repeated.json();
    expect(repeated.ok && asset.asset_id && asset.public_id===retried.data.folder+'/'+retried.data.public_id &&
      asset.type==='authenticated','upload_response_recovered_without_overwrite');
    const registration={post_id:entry.postId,slot:0,public_id:asset.public_id,asset_id:asset.asset_id,resource_type:'image'};
    const registered=await api('/api/privacy-v2-register-asset',ownerSession.jwt,registration);
    expect(registered.status===201,'registration_before_response_loss');
    const repeatRegistration=await api('/api/privacy-v2-register-asset',ownerSession.jwt,registration);
    expect(repeatRegistration.status===201 && repeatRegistration.data.asset_id===registered.data.asset_id,'registration_response_recovered');
    const assets=await db.from('post_media_assets').select('id').eq('post_id',entry.postId);
    expect(!assets.error && assets.data.length===1,'retry_does_not_duplicate_asset');
    const foreign=await token('stranger');
    const denied=await publication({action:'cancel',post_id:entry.postId},foreign.jwt);expect(denied.status===404,'nonowner_cancel_denied');
    const cancelled=await publication({action:'cancel',post_id:entry.postId});
    expect(cancelled.status===200 && cancelled.data.status==='failed','cancel_incomplete');
    const again=await publication({action:'cancel',post_id:entry.postId});expect(again.status===200 && again.data.status==='failed','cancel_retry');
    const media=await api('/api/post-media?asset_id='+registered.data.asset_id,ownerSession.jwt);expect(media.status===404,'cancelled_asset_denied');
    return {phase,incompletePublishingDenied:true,lostCreateAndSignatureResponseRecovered:true,nonownerCleanupDenied:true,cancellationRetryable:true,
      lostUploadAndRegistrationResponsesRecovered:true,duplicateRegistrationPrevented:true,cancelledMediaDenied:true,
      cleanupPending:again.data.cleanupPending,replayWindow:'original reservation time plus 65 minutes; final cleanup deferred'};
  }
  if(protectedFirst && phase==='session-revocation') {
    const session=await token('follower'), entry=state.publishing.followers;
    expect(entry?.complete,'published_fixture_required');
    const before=await api('/api/post-media?asset_id='+entry.parts['0'].registry_id,session.jwt);expect(before.status===200,'session_before_logout');
    const logout=await session.client.auth.signOut({scope:'global'});expect(!logout.error,'synthetic_logout');
    const media=await api('/api/post-media?asset_id='+entry.parts['0'].registry_id,session.jwt);
    const metadata=await api('/api/privacy-v2-publish?reader=posts&post_id='+entry.postId,session.jwt);
    const revoked=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{Authorization:'Bearer '+session.jwt}}});
    const direct=await revoked.schema('privacy_test').from('posts').select('id').eq('id',entry.postId);
    return {phase,logoutSucceeded:true,oldJwtMediaStatus:media.status,oldJwtMetadataStatus:metadata.status,
      oldJwtDirectRows:direct.data?.length ?? null,oldJwtDirectError:direct.error?.code || null,
      passed:media.status!==200 && metadata.status!==200 && !direct.data?.length,browserLogout:'not run'};
  }
  if(protectedFirst && phase==='public-control') {
    const postId=fixtureId('public-control');let original=await row(postId);
    if(!original) {
      const asset=await cloudinary.uploader.upload('data:image/png;base64,'+syntheticImage.toString('base64'),{
        public_id:'freeupper-privacy-v2-staging/'+owner+'/protected_first_public_control',type:'upload',resource_type:'image',overwrite:false,
        context:{freeupper_owner_id:owner,freeupper_post_id:postId,acceptance_run:ACCEPTANCE_RUN}});
      expect(asset.type==='upload' && asset.resource_type==='image','public_control_upload');
      const r=await db.from('posts').insert({id:postId,user_id:owner,visibility:'public',publishing_state:'published',is_hidden:false,is_deleted:false,
        media:[{type:'image',url:asset.secure_url,public_id:asset.public_id}],publish_payload:{title:ACCEPTANCE_RUN+' public control',source:'composer'}});
      expect(!r.error,'public_control_insert');original=await row(postId);
    }
    const guest=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const direct=await guest.schema('privacy_test').from('posts').select('id,visibility').eq('id',postId);
    expect(!direct.error && direct.data[0]?.visibility==='public','public_guest_rls_unchanged');
    const r=await fetch(original.media[0].url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    expect(r.status===200 && sha(Buffer.from(await r.arrayBuffer()))===sha(syntheticImage),'public_asset_unchanged');
    const transition=await publication({action:'visibility',post_id:postId,visibility:'only_me'});
    expect(transition.status===409,'public_not_silently_converted');
    return {phase,publicUploadAndAnonymousRead:true,publicVisibilityPreserved:true,legacyConversionBlocked:true,
      publicCreateStudioBrowser:'not run; this is a staging API/database control'};
  }
  const kind=phase.endsWith('video')?'video':'image',variant=phase.endsWith('rollback')?'rollback':kind,sourceId=fixtureId('legacy-'+variant);
  if(phase==='legacy-image' || phase==='legacy-video' || phase==='legacy-rollback') {
    let original=await row(sourceId);
    if(!original) {
      const publicId='freeupper-privacy-v2-staging/'+owner+'/legacy_acceptance_'+variant;
      let asset;
      try {asset=await cloudinary.api.resource(publicId,{type:'upload',resource_type:kind,context:true});}
      catch(error) {if((error?.error?.http_code ?? error?.http_code)!==404)throw error;}
      if(!asset)asset=await cloudinary.uploader.upload('data:'+(kind==='image'?'image/png':'video/mp4')+';base64,'+(kind==='image'?syntheticImage:syntheticVideo).toString('base64'),
        {public_id:publicId,type:'upload',resource_type:kind,overwrite:false,context:{freeupper_owner_id:owner,freeupper_post_id:sourceId,acceptance_run:ACCEPTANCE_RUN}});
      expect(asset.context?.custom?.acceptance_run===ACCEPTANCE_RUN && asset.type==='upload','synthetic_source_identity');
      const receipt=sha(JSON.stringify({run:ACCEPTANCE_RUN,asset_id:asset.asset_id,public_id:asset.public_id,version:asset.version,owner,post:sourceId,bytes_sha256:sha(kind==='image'?syntheticImage:syntheticVideo)}));
      const inserted=await db.from('posts').insert({id:sourceId,user_id:owner,visibility:'public',publishing_state:'published',is_hidden:false,is_deleted:false,
        media:[{type:kind,url:asset.secure_url,public_id:asset.public_id}],publish_payload:{title:ACCEPTANCE_RUN+' legacy '+variant,source:'studio',creation_receipt_sha256:receipt}});
      expect(!inserted.error,'legacy_fixture_insert');original=await row(sourceId);
    }
    expect(original.user_id===owner && original.publish_payload.title===ACCEPTANCE_RUN+' legacy '+variant,'legacy_fixture_owned');
    const source=await cloudinary.api.resource(original.media[0].public_id,{type:'upload',resource_type:kind,context:true});
    const evidence={asset_id:source.asset_id,post_id:sourceId,owner_id:owner,public_id:source.public_id,resource_type:kind,version:source.version,
      evidence_sha256:original.publish_payload.creation_receipt_sha256,reviewed_by:'synthetic-live-runner'};
    const migration=new LegacyMediaMigration({db,cloudinary,ownerId:owner,postId:sourceId,
      env:{...env,FREEUPPER_LEGACY_MIGRATION:'enabled-in-isolated-staging'}});
    let missingProofDenied=false;
    try {await migration.plan();}catch {missingProofDenied=true;}
    await attestLegacySource({db,cloudinary,post:original,evidence,dryRun:false});
    const unauth=await token('unapproved');
    const foreign=new LegacyMediaMigration({db,cloudinary,ownerId:users.unapproved.id,postId:sourceId,env:{...env,FREEUPPER_LEGACY_MIGRATION:'enabled-in-isolated-staging'}});
    let foreignDenied=false;try{await foreign.prepare('only_me');}catch{foreignDenied=true;}expect(foreignDenied,'nonowner_migration_denied');
    const browser=await unauth.client.schema('privacy_test').rpc('legacy_media_transition',{p_owner:owner,p_post:sourceId,p_action:'inspect'});
    expect(!!browser.error,'private_migration_rpc_denied');
    const job=await migration.prepare('only_me');
    const visibility=await publication({action:'visibility',post_id:sourceId,visibility:'only_me'});expect(visibility.status===409,'legacy_visibility_blocked');
    return {phase,postId:sourceId,jobId:job.id,sourceAssetId:source.asset_id,sourceType:kind,sourcePublic:true,
      ownerJwtVerified:true,missingProofDenied,syntheticCreationReceipt:true,nonownerMigrationDenied:foreignDenied,privateRpcDenied:true,restrictedVisibilityBlocked:true};
  }
  if(phase==='legacy-evidence') {
    const results=[];
    for(const type of ['image','video']) {
      const postId=fixtureId('legacy-'+type);
      const migration=new LegacyMediaMigration({db,cloudinary,ownerId:owner,postId,env:{...env,FREEUPPER_LEGACY_MIGRATION:'enabled-in-isolated-staging'}});
      const before=await migration.inspect();expect(before.job.state==='revoking','revoking_fixture_required');
      const retried=await migration.revoke();expect(retried.revocation_started_at===before.job.revocation_started_at,'idempotent_wait_clock');
      for(const role of [...ROLES,'guest']) {
        const session=role==='guest'?null:await token(role);
        const metadata=await api('/api/privacy-v2-publish?reader=posts&post_id='+postId,session?.jwt);
        expect(role==='guest'?metadata.status===401:metadata.status===200 && metadata.data.posts.length===0,'quarantine_all_roles');
        for(const copy of Object.values(retried.copies)) {
          const media=await api('/api/post-media?asset_id='+copy.registry_id,session?.jwt);expect(media.status===404,'quarantine_media_all_roles');
        }
      }
      results.push({type,postId,quarantineAllRoles:true,repeatInvalidationAcknowledged:true,originAbsent:true,waitingClockPreserved:true,revocationComplete:false});
    }
    for(const fields of [{source:'studio',sound_id:owner},{source:'studio',textOverlays:[{text:'synthetic'}]}]) {
      const r=await publication({action:'create',visibility:'only_me',media_types:['image'],fields});expect(r.status===400,'unsupported_restricted_type_denied');
    }
    const text=await publication({action:'create',visibility:'only_me',media_types:[],fields:{source:'studio',content:'text only'}});
    expect(text.status===400,'restricted_text_only_denied');
    return {phase,results,unsupportedTextMusicOverlaysDenied:true};
  }
  if(phase==='legacy-status') {
    const jobs=[];
    for(const type of ['image','video']) {
      const r=await db.from('legacy_media_jobs').select('id,post_id,state,revocation_started_at,verified_at,observations,deletions,plan,copies').eq('post_id',fixtureId('legacy-'+type)).maybeSingle();
      expect(!r.error,'legacy_status');if(!r.data)continue;
      const j=r.data;jobs.push({type,id:j.id,postId:j.post_id,state:j.state,deletionCount:Object.keys(j.deletions).length,
        registeredCopies:Object.keys(j.copies).length,probeCount:j.plan.sources.reduce((n,s)=>n+s.probe_urls.length,0),
        waitStartedAt:j.revocation_started_at,earliestObservationAt:j.revocation_started_at?new Date(Date.parse(j.revocation_started_at)+31*86400000).toISOString():null,
        observations:j.observations.length,verifiedAt:j.verified_at});
    }
    return {phase,run:ACCEPTANCE_RUN,jobs};
  }
  const original=await row(sourceId);expect(original?.user_id===owner && original.publish_payload.title===ACCEPTANCE_RUN+' legacy '+variant,'legacy_fixture_owned');
  const migrationEnv={...env,FREEUPPER_LEGACY_MIGRATION:'enabled-in-isolated-staging'};
  if(phase==='legacy-abandon-rollback') {
    const migration=new LegacyMediaMigration({db,cloudinary,ownerId:owner,postId:sourceId,env:migrationEnv});
    const copied=await migration.copy();
    const abandoned=await migration.abandon();expect(abandoned.state==='abandoned','abandon_before_quarantine');
    const after=await row(sourceId);expect(after.visibility==='public' && !after.is_hidden && JSON.stringify(after.media)===JSON.stringify(original.media),'rollback_preserves_public_post');
    const publicResponse=await fetch(original.media[0].url,{redirect:'manual',signal:AbortSignal.timeout(10000)});await publicResponse.body?.cancel();expect(publicResponse.status===200,'rollback_preserves_public_source');
    for(const copy of Object.values(copied.copies)) {
      let removed=false;try {await cloudinary.api.resource_by_asset_id(copy.asset_id);}catch(error){removed=(error?.http_code ?? error?.error?.http_code)===404;}
      expect(removed,'rollback_copy_removed');
    }
    return {phase,postId:sourceId,abandoned:true,protectedCopiesRemoved:Object.keys(copied.copies).length,publicSourceStatus:200,publicReferencesPreserved:true};
  }
  if(phase.startsWith('legacy-copy-')) {
    // Simulate a lost registration response AFTER a real upload, not fake provider evidence.
    let injected=false;const failingDb={...db,rpc:async(name,args)=>{
      if(!injected && name==='legacy_media_transition' && args.p_action==='copy'){injected=true;return {error:{message:'synthetic registration interruption'}};}
      return db.rpc(name,args);
    }};
    const failing=new LegacyMediaMigration({db:failingDb,cloudinary,ownerId:owner,postId:sourceId,env:migrationEnv});
    let interrupted=false;try{await failing.copy();}catch{interrupted=true;}
    expect(injected && interrupted,'real_upload_registration_failure');
    const before=await row(sourceId);expect(before.visibility==='public' && before.media[0].url===original.media[0].url,'failed_copy_preserves_references');
    const migration=new LegacyMediaMigration({db,cloudinary,ownerId:owner,postId:sourceId,env:migrationEnv});
    const copied=await migration.copy();const again=await migration.copy();
    expect(Object.keys(copied.copies).length===copied.plan.entries.length && JSON.stringify(copied.copies)===JSON.stringify(again.copies),'copy_retry_no_duplicates');
    const rawStatuses=[];
    for(const copy of Object.values(copied.copies)) {
      const raw=cloudinary.url(copy.public_id,{secure:true,resource_type:copy.resource_type,type:'upload',format:copy.format});
      const r=await fetch(raw,{redirect:'manual',signal:AbortSignal.timeout(10000)});await r.body?.cancel();
      expect(![200,206].includes(r.status),'protected_copy_public_alias_denied');rawStatuses.push(r.status);
    }
    return {phase,postId:sourceId,registeredCopies:Object.keys(copied.copies).length,copyTypes:Object.values(copied.copies).map(c=>c.resource_type),
      interruptedAfterUpload:true,recovered:true,referencesUnchanged:true,publicAliasStatuses:rawStatuses};
  }
  if(phase.startsWith('legacy-revoke-')) {
    const migration=new LegacyMediaMigration({db,cloudinary,ownerId:owner,postId:sourceId,env:migrationEnv});
    const current=await migration.inspect();
    if(current.job.state==='copying') await migration.quarantine();
    const cancel=await publication({action:'cancel',post_id:sourceId});expect(cancel.status===409,'legacy_cancellation_guard');
    const hidden=await api('/api/privacy-v2-publish?reader=posts&post_id='+sourceId,ownerSession.jwt);
    expect(hidden.status===200 && hidden.data.posts.length===0,'quarantined_metadata_hidden');
    const job=await migration.revoke();
    let observeBlocked=false,finalizeBlocked=false;
    try {await migration.observe('live_primary');}catch{observeBlocked=true;}
    try {await migration.finalize();}catch{finalizeBlocked=true;}
    expect(observeBlocked && finalizeBlocked,'real_31_day_gate_enforced');
    const status=await migration.inspect();expect(status.job.state==='revoking' && !status.job.verified_at && status.post.visibility==='public' && status.post.is_hidden,'revocation_not_falsely_complete');
    return {phase,postId:sourceId,deletedSources:Object.keys(job.deletions).length,waitStartedAt:job.revocation_started_at,
      earliestObservationAt:new Date(Date.parse(job.revocation_started_at)+31*86400000).toISOString(),observeBlocked,finalizeBlocked,
      cancellationBlocked:true,quarantined:true,revocationComplete:false};
  }
}
