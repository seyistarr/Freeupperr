import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acceptanceEnabled, runStagingAcceptance } from '../lib/protected-media/staging-live-acceptance.js';
import { blockIsolatedStagingSeo } from '../lib/profile-seo-privacy.js';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/post-privacy-v2-integration',FREEUPPER_STAGING_ACCEPTANCE:'synthetic-fixtures-only',
  SUPABASE_URL:'https://tagkrhvgcbnybiuyvjxt.supabase.co',CLOUDINARY_CLOUD_NAME:'sxdcqs5x',FREEUPPER_MEDIA_TEST_ENV:'isolated-freeupper-staging'};
test('live runner is disabled by default and refuses every non-isolated target',async()=>{
  assert.equal(acceptanceEnabled(env),true);
  for(const change of [{FREEUPPER_STAGING_ACCEPTANCE:''},{VERCEL_ENV:'production'},{SUPABASE_URL:'production'},{CLOUDINARY_CLOUD_NAME:'production'}]) {
    assert.equal(acceptanceEnabled({...env,...change}),false);
    await assert.rejects(runStagingAcceptance({phase:'seed',env:{...env,...change}}));
  }
  await assert.rejects(runStagingAcceptance({phase:'arbitrary-operation',env}));
});
test('isolated preview SEO denies before legacy production queries while production behavior remains unchanged',()=>{
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},end(){this.ended=true;}};
  assert.equal(blockIsolatedStagingSeo(res,env),true);assert.equal(res.code,404);assert.equal(res.headers['Cache-Control'],'private, no-store');
  assert.equal(blockIsolatedStagingSeo({}, {...env,VERCEL_ENV:'production'}),false);
  for(const file of ['post-preview','post-text-og','post-short-link','profile-preview','profile-og','sitemap-profiles']) {
    const code=readFileSync(new URL('../api/'+file+'.js',import.meta.url),'utf8');
    const start=code.indexOf('export default async function handler');
    assert.ok(code.slice(start).indexOf('blockIsolatedStagingSeo(res)')<code.slice(start).indexOf('await fetch(')|| !code.slice(start).includes('await fetch('));
  }
});


test('Cloudinary inventory follows every derived cursor and fails on loops or identity changes',async()=>{
  const {readCompleteCloudinaryAsset}=await import('../lib/protected-media/cloudinary-asset-inventory.js');
  const first={asset_id:'a'.repeat(32),public_id:'fixture',type:'upload',resource_type:'image',version:1,derived:Array.from({length:100},(_,i)=>({id:'one-'+i})),next_cursor:'page2'};
  let calls=0;
  const cloudinary={config:()=>({cloud_name:'sxdcqs5x',api_key:'fake-key',api_secret:'fake-secret'}),api:{async resource(id,options){calls++;if(!options.derived_next_cursor)return first;
    assert.equal(options.derived_next_cursor,'page2');return {...first,derived:[{id:'two'}],next_cursor:null};},
    async resource_by_asset_id(){return first;}}};
  const fetchImpl=async(url,options)=>{calls++;assert.equal(url.searchParams.get('next_cursor'),'page2');
    assert.ok(options.headers.Authorization.startsWith('Basic '));return {ok:true,async json(){return {...first,derived:[{id:'two'}],next_cursor:null};}};};
  const result=await readCompleteCloudinaryAsset({cloudinary,publicId:'fixture',resourceType:'image',fetchImpl});
  assert.equal(result.derived.length,101);assert.equal(result.next_cursor,undefined);assert.equal(calls,2);
  cloudinary.api.resource=async()=>first;
  await assert.rejects(readCompleteCloudinaryAsset({cloudinary,publicId:'fixture',resourceType:'image',fetchImpl:async()=>({ok:true,json:async()=>first})}),/Incomplete/);
  cloudinary.api.resource=async(id,options)=>options.derived_next_cursor?{...first,version:2}:first;
  await assert.rejects(readCompleteCloudinaryAsset({cloudinary,publicId:'fixture',resourceType:'image',fetchImpl:async()=>({ok:true,json:async()=>({...first,version:2})})}),/changed/);
});
test('authenticated type tolerates obsolete access_mode but anonymous grants and public delivery still fail',async()=>{
  const {verifyStagingAsset}=await import('../lib/protected-media/verify-staging-asset.js');
  const publicId='freeupper-privacy-v2-staging/10000000-0000-4000-8000-000000000001/asset_'+'a'.repeat(32);
  const asset={public_id:publicId,asset_id:'b'.repeat(32),type:'authenticated',resource_type:'image',access_mode:'public',bytes:69,format:'png'};
  const args={asset,expectedPublicId:publicId,expectedAssetId:asset.asset_id,expectedResourceType:'image'};
  assert.equal(verifyStagingAsset(args),true);
  assert.equal(verifyStagingAsset({...args,asset:{...asset,type:'upload'}}),false);
  assert.equal(verifyStagingAsset({...args,asset:{...asset,access_control:[{access_type:'anonymous'}]}}),false);
});


test('an explicit short derivative page is complete despite an unrelated generic metadata cursor',async()=>{
  const {readCompleteCloudinaryAsset}=await import('../lib/protected-media/cloudinary-asset-inventory.js');
  const asset={asset_id:'a'.repeat(32),public_id:'fixture',type:'upload',resource_type:'image',version:1,derived:[],next_cursor:'unrelated'};
  const cloudinary={api:{async resource(){return asset;}}};
  const result=await readCompleteCloudinaryAsset({cloudinary,publicId:'fixture',resourceType:'image',fetchImpl:()=>{throw Error('not a derivative page');}});
  assert.equal(result.derived_inventory_complete,true);assert.equal(result.derived.length,0);assert.equal(result.next_cursor,undefined);
});
