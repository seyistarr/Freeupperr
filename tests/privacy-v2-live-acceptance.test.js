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
