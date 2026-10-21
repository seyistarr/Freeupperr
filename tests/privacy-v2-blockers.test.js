import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfiguration,runnerTemplate} from '../scripts/privacy-v2/infra/configure-runners.mjs';
import {probeUrls} from '../lib/protected-media/legacy-media-plan.js';
import {LegacyMediaMigration} from '../lib/protected-media/legacy-media-migration.js';
const config={repository:'seyistarr/Freeupperr',reviewers:[123],first:{account:'111111111111',bucket:'freeupper-staging-revocation-first-example',region:'us-east-2'},second:{account:'222222222222',bucket:'freeupper-staging-revocation-second-example',region:'eu-west-1'}};
test('infrastructure generator isolates roles, accounts, trust and immutable retention',()=>{
 assert.throws(()=>validateConfiguration({...config,second:config.first}));
 for(const runner of ['first','second']){
  const t=runnerTemplate(config,runner),r=t.Resources;
  assert.equal(r.Evidence.Properties.ObjectLockConfiguration.Rule.DefaultRetention.Mode,'COMPLIANCE');
  assert.equal(r.Evidence.DeletionPolicy,'Retain');
  assert.ok(Object.values(r).every(resource=>resource.Condition==='IsolatedAccountAndRegion'));
  assert.equal(t.Conditions.IsolatedAccountAndRegion['Fn::And'][0]['Fn::Equals'][1],config[runner].account);
  assert.equal(r.RunnerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:sub'],`repo:seyistarr/Freeupperr:environment:privacy-v2-revocation-${runner}`);
  const statements=r.RunnerRole.Properties.Policies[0].PolicyDocument.Statement;
  assert.ok(!JSON.stringify(statements).includes('PutObjectRetention'));assert.ok(!JSON.stringify(statements).includes('DeleteObject'));
  for(const statement of statements.filter(s=>s.Action.includes('s3:PutObject')))assert.ok(statement.Resource.every(a=>a.includes(config[runner].bucket)));
 }
});
test('legacy probes preserve real-version, unversioned, SDK v1 and transformation keys',()=>{
 const url='https://res.cloudinary.com/sxdcqs5x/video/upload/so_1,w_800/v123/owned/movie.jpg';
 const urls=probeUrls({public_id:'owned/movie',version:123,resource_type:'video',secure_url:'https://res.cloudinary.com/sxdcqs5x/video/upload/v123/owned/movie.mp4',derived:[{secure_url:url}]},[]);
 assert.equal(urls.length,6);assert.ok(urls.includes(url.replace('/v123/','/v1/')));assert.ok(urls.includes(url.replace('/v123/','/')));
});
test('legacy deletion fails before any Cloudinary request without reviewed account invalidation evidence',async()=>{
 const migration=Object.create(LegacyMediaMigration.prototype);let touched=false;
 migration.locked=operation=>operation({state:'quarantined'});
 migration.readyCopies=async()=>{touched=true;};
 await assert.rejects(migration.revoke(),/Migration incomplete|bulk invalidation/);assert.equal(touched,false);
});
test('browser evidence never mistakes cache names or an empty loading frame for acceptance',async()=>{
 const {readerSettled,classifyWorkerUpgrade}=await import('../scripts/privacy-v2/browser-assertions.js');
 assert.equal(readerSettled('Loading authorized posts…'),false);assert.equal(readerSettled('Staging reader unavailable.'),false);assert.equal(readerSettled('No accessible posts.'),true);
 const base={hadActiveWorker:true,workerReplaced:true,controllerChanged:true,newCachePresent:true,obsoleteCachesRemaining:false};
 assert.equal(classifyWorkerUpgrade(base).upgrade_verified,true);
 for(const patch of [{hadActiveWorker:false},{workerReplaced:false},{controllerChanged:false},{obsoleteCachesRemaining:true}])assert.equal(classifyWorkerUpgrade({...base,...patch}).upgrade_verified,false);
});
test('synthetic alert requires an authorized receiver and an authenticated acknowledgement',async()=>{
 const {deliverSyntheticAlert,syntheticAlert}=await import('../scripts/privacy-v2/alert-exercise.mjs');
 const {createHmac}=await import('node:crypto');
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/post-privacy-v2-integration',FREEUPPER_MEDIA_TEST_ENV:'isolated-freeupper-staging',SUPABASE_URL:'https://tagkrhvgcbnybiuyvjxt.supabase.co',CLOUDINARY_CLOUD_NAME:'sxdcqs5x',FREEUPPER_PROTECTED_MEDIA_DELIVERY:'enabled-in-isolated-staging',FREEUPPER_PROTECTED_PUBLISHING:'enabled-in-isolated-staging',SUPABASE_ANON_KEY:'sb_publishable_test',SUPABASE_SERVICE_ROLE_KEY:'synthetic',CLOUDINARY_API_KEY:'synthetic',CLOUDINARY_API_SECRET:'synthetic',FREEUPPER_LEGACY_MIGRATION:'enabled-in-isolated-staging',FREEUPPER_STAGING_ALERT_EXERCISE:'authorized-synthetic-receiver',FREEUPPER_STAGING_ALERT_URL:'https://staging-alert.example/receive',FREEUPPER_STAGING_ALERT_ORIGIN:'https://staging-alert.example',FREEUPPER_STAGING_ALERT_HMAC_KEY:'synthetic-only-key'.repeat(3)};
 let requests=0;const payload=syntheticAlert();
 const fetchImpl=async(url,options)=>{requests++;assert.equal(options.redirect,'manual');assert.equal(JSON.parse(options.body).synthetic,true);const receipt={exercise_id:payload.exercise_id,received_at:new Date().toISOString(),receipt_id:'synthetic-receipt'};receipt.signature=createHmac('sha256',env.FREEUPPER_STAGING_ALERT_HMAC_KEY).update(receipt.exercise_id+'\n'+receipt.received_at+'\n'+receipt.receipt_id).digest('hex');return {ok:true,json:async()=>receipt};};
 await assert.rejects(deliverSyntheticAlert({env:{...env,VERCEL_ENV:'production'},payload,fetchImpl}));assert.equal(requests,0);
 const result=await deliverSyntheticAlert({env,payload,fetchImpl});assert.equal(result.receiver_acknowledged,true);assert.equal(result.downstream_alert_delivery_verified,false);
 await assert.rejects(deliverSyntheticAlert({env,payload,fetchImpl:async()=>({ok:true,json:async()=>({})})}),/acknowledgement/);
});
test('composer logout preserves requested restricted audience instead of downgrading to Public',async()=>{
 const {disableRestrictedAudiences}=await import('../lib/protected-media/staging-audience-state.js');
 for(const audience of ['public','followers','friends','only_me']){
  const selector={value:audience,options:['public','followers','friends','only_me'].map(value=>({value,disabled:false}))};
  disableRestrictedAudiences(selector);assert.equal(selector.value,audience);
  assert.ok(selector.options.filter(o=>o.value!=='public').every(o=>o.disabled));assert.equal(selector.options[0].disabled,false);
 }
});
