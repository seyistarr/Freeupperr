import test from 'node:test';
import assert from 'node:assert/strict';
import { productionDeliveryContext, requireProductionDeliveryApproval } from '../lib/protected-media/production-delivery-gate.js';

const sha='a'.repeat(40);
const env={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',
 FREEUPPER_MEDIA_TEST_ENV:'approved-protected-first-production',
 FREEUPPER_PROTECTED_MEDIA_DELIVERY:'approved-protected-first-production',
 SUPABASE_URL:'https://jmjtqidirpmnegzvmiaq.supabase.co',
 CLOUDINARY_CLOUD_NAME:'duzyf1kda',
 FREEUPPER_PROTECTED_FIRST_APPROVED_COMMIT:sha,VERCEL_GIT_COMMIT_SHA:sha,
 SUPABASE_SERVICE_ROLE_KEY:'service-test',SUPABASE_ANON_KEY:'anon-test',
 CLOUDINARY_API_KEY:'cloud-test',CLOUDINARY_API_SECRET:'secret-test'};
test('missing configuration is disabled by default',()=>{
 assert.equal(productionDeliveryContext({}),null);
 for(const key of Object.keys(env)) {
   const changed={...env};delete changed[key];
   assert.equal(productionDeliveryContext(changed),null,key);
 }
});
test('only complete pinned production context passes environment gate',()=>{
 assert.deepEqual(productionDeliveryContext(env),{mode:'production',schema:'public'});
 assert.equal(productionDeliveryContext({...env,VERCEL_GIT_COMMIT_SHA:'b'.repeat(40)}),null);
 assert.equal(productionDeliveryContext({...env,VERCEL_ENV:'preview'}),null);
});
test('database release flag is an independent requirement',async()=>{
 const context=productionDeliveryContext(env);
 const rpc= data => ({rpc:async name=>{assert.equal(name,'protected_first_release_status');return {data,error:null};}});
 assert.equal(await requireProductionDeliveryApproval(rpc({version:1,delivery:true,legacy_conversion:false}),context),true);
 for(const data of [{version:1,delivery:false,legacy_conversion:false},
  {version:1,delivery:true,legacy_conversion:true},{version:2,delivery:true,legacy_conversion:false},null]) {
  assert.equal(await requireProductionDeliveryApproval(rpc(data),context),false);
 }
 assert.equal(await requireProductionDeliveryApproval({rpc:async()=>{throw Error('fail');}},context),false);
 assert.equal(await requireProductionDeliveryApproval(rpc({version:1,delivery:true,legacy_conversion:false}),null),false);
});
