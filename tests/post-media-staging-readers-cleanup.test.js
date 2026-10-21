import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { isolatedStagingEnvironment, stagingPublishingEnabled, requirePublishingSchema } from '../lib/protected-media/staging-publishing-server.js';
import assert from 'node:assert/strict';
import { readStagingPosts } from '../lib/protected-media/staging-reader-server.js';
import { cleanupStagingDraft, sweepStagingDrafts, validCleanupWorker } from '../lib/protected-media/staging-cleanup-server.js';
const owner='10000000-0000-4000-8000-000000000001';
const post='20000000-0000-4000-8000-000000000001';
const intent='30000000-0000-4000-8000-000000000001';
const publicId='freeupper-privacy-v2-staging/'+owner+'/asset_'+'a'.repeat(32);
const env={ VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/post-privacy-v2-integration',
  FREEUPPER_MEDIA_TEST_ENV:'isolated-freeupper-staging',SUPABASE_URL:'https://tagkrhvgcbnybiuyvjxt.supabase.co',
  CLOUDINARY_CLOUD_NAME:'sxdcqs5x',FREEUPPER_PROTECTED_MEDIA_DELIVERY:'enabled-in-isolated-staging',
  FREEUPPER_PROTECTED_PUBLISHING:'enabled-in-isolated-staging',SUPABASE_ANON_KEY:'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY:'private-role',CLOUDINARY_API_KEY:'public-key',CLOUDINARY_API_SECRET:'private-secret' };

test('reader RPC uses the viewer JWT/anon key and bound filters rather than the service role', async()=>{
  let config,params;
  const rows=await readStagingPosts({ token:'viewer-token',query:{author_id:owner,q:"x'),true",source:'studio',offset:'0',limit:'10'},env,
    createClientImpl(url,key,options){assert.equal(url,env.SUPABASE_URL);assert.equal(key,env.SUPABASE_ANON_KEY);config=options;
      return {async rpc(name,args){assert.equal(name,'read_protected_posts');params=args;return {data:[]};}};}});
  assert.deepEqual(rows,[]);assert.equal(config.global.headers.Authorization,'Bearer viewer-token');
  assert.equal(config.db.schema,'privacy_test');assert.equal(params.p_author,owner);assert.equal(params.p_query,"x'),true");
});
test('invalid reader queries and production targets fail before any client is created',async()=>{
  let clients=0;const createClientImpl=()=>{clients++;throw Error('unexpected');};
  for(const query of [{post_id:'invalid'},{source:'arbitrary'},{q:'x'.repeat(201)},{limit:'51'},{offset:'-1'}])
    await assert.rejects(readStagingPosts({token:'viewer',query,env,createClientImpl}));
  await assert.rejects(readStagingPosts({token:'viewer',query:{},env:{...env,VERCEL_ENV:'production'},createClientImpl}));
  assert.equal(clients,0);
});
function context({claim,failDelete=false}={}) {
  const calls=[],deleted=[];
  const db={async rpc(name,args){calls.push({name,args});
    if(name==='claim_protected_cleanup')return {data:claim||{claimed:true,intents:[{id:intent,cloudinary_public_id:publicId}]}};
    if(name==='record_protected_cleanup')return {data:{id:post,status:'failed',cleanupPending:args.p_results.some(r=>!r.ok)}};
    if(name==='protected_cleanup_candidates')return {data:[{id:post,owner_id:owner}]};
    throw Error('unexpected');
  }};
  const cloudinary={uploader:{async destroy(id,options){deleted.push({id,options});if(failDelete)throw Error('retry');return {result:'not found'};}}};
  return {db,cloudinary,calls,deleted};
}
test('cleanup first claims the owned post, removes authenticated orphan resource types, and records a lease result',async()=>{
  const c=context();const result=await cleanupStagingDraft({...c,ownerId:owner,postId:post});
  assert.equal(c.calls[0].name,'claim_protected_cleanup');assert.equal(c.calls[0].args.p_owner,owner);
  assert.equal(c.calls.at(-1).args.p_lease,c.calls[0].args.p_lease);
  assert.deepEqual(c.deleted.map(d=>d.options.resource_type),['image','video','raw']);
  assert.ok(c.deleted.every(d=>d.id===publicId&&d.options.type==='authenticated'&&d.options.invalidate));
  assert.equal(result.status,'failed');
});
test('cleanup never deletes another namespace or a published/busy post and failures remain retryable',async()=>{
  for(const claim of [{claimed:false,status:'published'},{claimed:false,status:'busy'},
    {claimed:true,intents:[{id:intent,cloudinary_public_id:publicId.replace(owner,'other-owner')}]}]){
    const c=context({claim});await cleanupStagingDraft({...c,ownerId:owner,postId:post});assert.equal(c.deleted.length,0);
    if(claim.claimed)assert.equal(c.calls.at(-1).args.p_results[0].ok,false);
  }
  const c=context({failDelete:true});assert.equal((await cleanupStagingDraft({...c,ownerId:owner,postId:post})).cleanupPending,true);
});
test('cleanup worker uses database-supplied owners, requests expired-only claims, and rejects user JWTs',async()=>{
  const secret='s'.repeat(40);assert.equal(validCleanupWorker('Bearer viewer-jwt',secret),false);
  assert.equal(validCleanupWorker('Bearer '+secret,secret),true);assert.equal(validCleanupWorker('Bearer x',''),false);
  const c=context();await sweepStagingDrafts(c);
  const claim=c.calls.find(c=>c.name==='claim_protected_cleanup');assert.equal(claim.args.p_owner,owner);assert.equal(claim.args.p_expired_only,true);
});

test('readiness checks only staging services and returns booleans without secret values',async()=>{
  for(const production of [false,true]) {
    let calls=0;
    const context={process:{env:{...env,VERCEL_ENV:production?'production':'preview'}},console:{error(){}},
      isolatedStagingEnvironment,stagingPublishingEnabled,requirePublishingSchema,
      createClient(url){calls++;assert.equal(url,env.SUPABASE_URL);return {async rpc(name){return {data:name==='protected_publishing_capabilities'?{version:2}:{version:1,new_protected_posts:true,legacy_conversion_required:false}};}};},
      cloudinary:{config(options){assert.equal(options.cloud_name,'sxdcqs5x');},api:{async ping(){calls++;return {status:'ok'};}}}
    };
    const source=readFileSync(new URL('../api/privacy-v2-publish.js',import.meta.url),'utf8')
      .replace(/^import[\s\S]*?from '[^']+';\n/gm,'').replace('export default async function handler','async function handler');
    vm.runInNewContext(source+'\nthis.handler=handler;',context);
    const res={setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await context.handler({method:'GET',query:{readiness:'1'}},res);
    assert.equal(res.statusCode,production?503:200);assert.equal(res.body.ready,!production);
    assert.doesNotMatch(JSON.stringify(res.body),/private-role|private-secret|public-key/);
    assert.equal(calls,production?0:2);
  }
});
