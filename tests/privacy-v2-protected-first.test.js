import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { publishingContext, requireRuntimeSchema } from '../lib/protected-media/publishing-runtime.js';
import { authorizeProtectedMedia } from '../lib/protected-media/post-media-access.js';
import { mediaDigest, verifyReplacementDelivery } from '../lib/protected-media/legacy-replacement-verification.js';
import { LegacyMediaMigration } from '../lib/protected-media/legacy-media-migration.js';
import { REVOCATION_WAIT_MS } from '../lib/protected-media/legacy-media-plan.js';
import { verifyStagingAsset } from '../lib/protected-media/verify-staging-asset.js';
import { validateProtectedStagingFiles } from '../lib/protected-media/staging-upload-client.js';
import { createExpiringDownloadUrl } from '../lib/protected-media/post-media-download-url.js';
import { proxyProtectedMedia } from '../lib/protected-media/post-media-proxy.js';
const approved={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),
 FREEUPPER_PROTECTED_FIRST_APPROVED_COMMIT:'a'.repeat(40),FREEUPPER_MEDIA_TEST_ENV:'approved-protected-first-production',
 SUPABASE_URL:'https://jmjtqidirpmnegzvmiaq.supabase.co',CLOUDINARY_CLOUD_NAME:'duzyf1kda',
 FREEUPPER_PROTECTED_MEDIA_DELIVERY:'approved-protected-first-production',FREEUPPER_PROTECTED_PUBLISHING:'approved-protected-first-production',
 SUPABASE_ANON_KEY:'sb_publishable_synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',CLOUDINARY_API_KEY:'synthetic-key',CLOUDINARY_API_SECRET:'synthetic-secret'};
test('production publishing requires explicit pinned approval, isolated targets and independent DB gates',async()=>{
 const runtime=publishingContext(approved);assert.equal(runtime.schema,'public');
 for(const patch of [{FREEUPPER_PROTECTED_FIRST_APPROVED_COMMIT:''},{VERCEL_GIT_COMMIT_SHA:'b'.repeat(40)},
  {VERCEL_GIT_COMMIT_REF:'feature/post-privacy-v2-integration'},{CLOUDINARY_CLOUD_NAME:'sxdcqs5x'},
  {SUPABASE_URL:'https://tagkrhvgcbnybiuyvjxt.supabase.co'},{FREEUPPER_PROTECTED_PUBLISHING:''},
  {FREEUPPER_MEDIA_TEST_ENV:'isolated-freeupper-staging'},{SUPABASE_ANON_KEY:approved.SUPABASE_SERVICE_ROLE_KEY}])assert.equal(publishingContext({...approved,...patch}),null);
 const capability=name=>name==='protected_publishing_capabilities'?{version:2}:{version:1,new_protected_posts:true,legacy_conversion_required:false};
 let calls=[];const db=flags=>({async rpc(name){calls.push(name);return {data:name==='protected_first_release_status'?flags:capability(name)};}});
 await assert.rejects(requireRuntimeSchema(db({version:1,publishing:false,delivery:false,legacy_conversion:false}),runtime));
 assert.deepEqual(calls,['protected_first_release_status']);calls=[];
 await requireRuntimeSchema(db({version:1,publishing:true,delivery:true,legacy_conversion:false}),runtime);
 assert.equal(calls.length,3);
 await assert.rejects(requireRuntimeSchema(db({version:1,publishing:true,delivery:true,legacy_conversion:true}),runtime));
 // Stop writes while retaining authorized reads for posts already published.
 const delivery=publishingContext({...approved,FREEUPPER_PROTECTED_PUBLISHING:''},{deliveryOnly:true});
 await requireRuntimeSchema(db({version:1,publishing:false,delivery:true,legacy_conversion:false}),delivery,{deliveryOnly:true});
});
test('production media authorization uses the approved database predicate and fails closed',async()=>{
 const asset={id:'synthetic-registry',post_id:'synthetic-post',status:'ready',delivery_type:'authenticated'};
 for(const result of [{data:true},{data:false},{error:{message:'unavailable'}},{data:'true'}]){
  const db={async rpc(name,args){assert.equal(name,'authorize_protected_asset');assert.deepEqual(args,{p_asset:asset.id,p_viewer:'verified-viewer'});return result;},from(){throw Error('Bare follow lookup must not authorize production');}};
  assert.equal(await authorizeProtectedMedia({db,asset,viewerId:'verified-viewer',production:true}),result.data===true&&!result.error);
 }
});
test('replacement proof compares delivered bytes and retains originals on any mismatch or delivery failure',async()=>{
 const body=new Uint8Array([1,2,3,4]),entry={url:'https://res.cloudinary.com/sxdcqs5x/image/upload/v123/owned/photo.png',type:'image'};
 const asset={version:456,bytes:4,status:'ready',type:'authenticated',resource_type:'image',public_id:'owned/protected',format:'png'};
 const cloudinary={utils:{private_download_url(_id,_fmt,o){return 'https://api.cloudinary.com/v1_1/sxdcqs5x/image/download?expires_at='+o.expires_at+'&signature=synthetic';}}};
 const response=bytes=>new Response(bytes,{headers:{'content-type':'image/png'}});
 const fetchImpl=async(_url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');return response(body);};
 const proof=await verifyReplacementDelivery({entry,asset,cloudinary,fetchImpl});assert.equal(proof.bytes,4);
 await verifyReplacementDelivery({entry,asset,cloudinary,fetchImpl,expected:proof});
 await assert.rejects(verifyReplacementDelivery({entry,asset,cloudinary,fetchImpl,expected:{bytes:4,sha256:'0'.repeat(64)}}),/differs/);
 await assert.rejects(verifyReplacementDelivery({entry,asset:{...asset,bytes:5},cloudinary,fetchImpl}),/length differs/);
 await assert.rejects(mediaDigest(entry.url,'image',async()=>new Response(null,{status:302})),/unavailable/);
 await assert.rejects(mediaDigest(entry.url,'image',async()=>new Response('',{headers:{'content-type':'text/html'}})),/unavailable/);
 assert.equal(REVOCATION_WAIT_MS,31*86400000);
});
test('quarantine consent alone cannot invoke a single Cloudinary deletion',async()=>{
 const migration=Object.create(LegacyMediaMigration.prototype);let touched=false;
 migration.bulkInvalidationEvidence='a'.repeat(64);migration.locked=operation=>operation({state:'quarantined',id:'synthetic-job'});
 migration.db={async rpc(name){assert.equal(name,'legacy_deletion_authorized');return {data:false};}};
 migration.readyCopies=async()=>{touched=true;};migration.cloudinary={api:{delete_resources_by_asset_ids(){touched=true;}}};
 await assert.rejects(migration.revoke(),/Explicit owner deletion/);assert.equal(touched,false);
});
test('approved production composer reuses the main session without logging it out on navigation',async()=>{
 const listeners={},authListeners=[],owner='10000000-0000-4000-8000-000000000001';let logouts=0;
 const session={user:{id:owner},access_token:'synthetic-token'};
 const browser={supabase:{},sb:{supabaseUrl:approved.SUPABASE_URL,auth:{onAuthStateChange(fn){authListeners.push(fn);},async getSession(){return {data:{session}};},async signOut(){logouts++;}}},
  dispatchEvent(){},addEventListener(name,fn){listeners[name]=fn;}};
 const context={window:browser,fetch:async()=>({ok:true,json:async()=>({enabled:true,mode:'production',cloudName:'duzyf1kda',supabaseUrl:approved.SUPABASE_URL,anonKey:'sb_publishable_synthetic'})}),CustomEvent:class{constructor(type){this.type=type;}}};
 const source=readFileSync(new URL('../lib/protected-media/staging-session.js',import.meta.url),'utf8').replace('export const stagingSession','const stagingSession');
 vm.runInNewContext(source,context);const client=browser.PrivacyStaging;
 await client.configure();assert.equal(client.enabled,true);assert.equal(await client.accessToken(),'synthetic-token');
 await assert.rejects(client.signIn('synthetic@example.invalid','unused'),/main|FreeUpper account/);
 await listeners.pagehide();assert.equal(logouts,0);assert.equal(client.enabled,false);
 await listeners.pageshow();assert.equal(client.enabled,true);
 authListeners[0]('SIGNED_OUT',null);assert.equal(client.enabled,false);assert.equal(client.userId,null);
});
test('account switching aborts an in-flight protected publisher and removes its listener',async()=>{
 let listener,signal,removed=false;
 const source=readFileSync(new URL('../posts.js',import.meta.url),'utf8');
 const start=source.indexOf('  async function createProtectedStagingPost('),end=source.indexOf('\n  async function createPost(',start);
 const wrapper=source.slice(start,end).replace("await import('./lib/protected-media/staging-publishing-client.js')",'await loadPublisher()');
 const browser={PrivacyStaging:{userId:'synthetic-owner'},ProtectedPublishing:{enabled:true,cloudName:'sxdcqs5x',async accessToken(){return 'synthetic-token';}},
  addEventListener(_name,fn){listener=fn;},removeEventListener(_name,fn){assert.equal(listener,fn);removed=true;}};
 const context={window:browser,AbortController,loadPublisher:async()=>({async publishProtectedStagingPost(options){signal=options.signal;browser.PrivacyStaging.userId='another-owner';listener();assert.equal(signal.aborted,true);throw Error('synthetic cancelled request');}})};
 vm.runInNewContext(wrapper+'\nthis.publish=createProtectedStagingPost;',context);
 await assert.rejects(context.publish({fields:{},files:[]}),/cancelled/);assert.equal(removed,true);
});
test('active image documents cannot enter protected publishing or same-origin blob delivery',async()=>{
 for(const type of ['image/svg+xml','image/pdf','text/html'])assert.throws(()=>validateProtectedStagingFiles([{type,size:100}]));
 for(const namespace of ['freeupper-privacy-v2-staging','freeupper-protected-v2']){
  const expectedPublicId=namespace+'/10000000-0000-4000-8000-000000000001/asset_'+'a'.repeat(32),expectedAssetId='b'.repeat(32);
  const asset={public_id:expectedPublicId,asset_id:expectedAssetId,type:'authenticated',resource_type:'image',format:'png',bytes:100};
  assert.equal(verifyStagingAsset({asset,namespace,expectedPublicId,expectedAssetId,expectedResourceType:'image'}),true);
  for(const format of ['svg','pdf','html']){
   assert.equal(verifyStagingAsset({asset:{...asset,format},namespace,expectedPublicId,expectedAssetId,expectedResourceType:'image'}),false);
   let signatures=0;
   assert.throws(()=>createExpiringDownloadUrl({asset:{...asset,format,status:'ready',delivery_type:'authenticated',cloudinary_public_id:expectedPublicId},
    expectedCloudName:'sxdcqs5x',cloudinaryUtils:{private_download_url(){signatures++;return 'invalid';}}}));
   assert.equal(signatures,0);
  }
 }
 let cancelled=false;const res={setHeader(){},status(n){this.code=n;return this;},end(){}};
 await proxyProtectedMedia({req:{headers:{}},res,upstreamUrl:'https://api.cloudinary.com/v1_1/sxdcqs5x/image/download',
  fetchImpl:async()=>({status:200,headers:new Headers({'content-type':'image/svg+xml'}),body:{async cancel(){cancelled=true;}}})});
 assert.equal(res.code,503);assert.equal(cancelled,true);
});
