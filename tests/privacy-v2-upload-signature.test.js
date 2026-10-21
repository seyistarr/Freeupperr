import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/privacy-v2-upload-signature.js';

const staging = {
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'feature/post-privacy-v2-integration',
  FREEUPPER_MEDIA_TEST_ENV: 'isolated-freeupper-staging',
  SUPABASE_URL: 'https://tagkrhvgcbnybiuyvjxt.supabase.co',
  CLOUDINARY_CLOUD_NAME: 'sxdcqs5x',
  FREEUPPER_PROTECTED_PUBLISHING: 'enabled-in-isolated-staging',
  FREEUPPER_PROTECTED_MEDIA_DELIVERY: 'enabled-in-isolated-staging',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role',
  SUPABASE_ANON_KEY: 'sb_publishable_test',
  CLOUDINARY_API_KEY: 'test-api-key',
  CLOUDINARY_API_SECRET: 'test-secret'
};
function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(v) { this.statusCode = v; return this; },
    json(v) { this.body = v; return this; }
  };
}
async function call(method, overrides = {}, headers = {}, body) {
  const keys = Object.keys(staging);
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const key of keys) {
      const value = Object.hasOwn(overrides, key) ? overrides[key] : staging[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const res = response();
    await handler({ method, headers, body }, res);
    return res;
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}
test('only POST is supported', async () => {
  const res = await call('GET');
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
  assert.match(res.headers['cache-control'], /no-store/);
});
for (const [key, value] of [
  ['VERCEL_ENV', 'production'],
  ['VERCEL_GIT_COMMIT_REF', 'main'],
  ['FREEUPPER_MEDIA_TEST_ENV', 'production'],
  ['SUPABASE_URL', 'https://wrong.supabase.co'],
  ['CLOUDINARY_CLOUD_NAME', 'wrong'],
  ['SUPABASE_ANON_KEY', undefined],
  ['CLOUDINARY_API_KEY', undefined],
  ['CLOUDINARY_API_SECRET', undefined]
]) {
  test(`rejects invalid staging config: ${key}`, async () => {
    const res = await call('POST', { [key]: value });
    assert.equal(res.statusCode, 503);
  });
}
test('requires a bearer token before signing', async () => {
  const res = await call('POST');
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Authentication required');
  assert.equal(res.headers.vary, 'Authorization');
});


test('a signature retry uses only the persisted owned ID and original signing time', async()=>{
  const originalFetch=globalThis.fetch, owner='10000000-0000-4000-8000-000000000001';
  const durable='asset_'+'a'.repeat(32), timestamp=Math.floor(Date.now()/1000)-120;
  let reservation={status:'reserved',public_id:'freeupper-privacy-v2-staging/'+owner+'/'+durable,timestamp};
  try {
    globalThis.fetch=async(input)=>{
      const url=String(input.url || input);
      let result;
      if(url.includes('/auth/v1/user')) result={id:owner,role:'authenticated',email:'synthetic@privacy-staging.invalid'};
      else if(url.endsWith('/rpc/protected_publishing_capabilities'))result={version:2};
      else if(url.endsWith('/rpc/protected_first_capabilities'))result={version:1,new_protected_posts:true,legacy_conversion_required:false};
      else if(url.endsWith('/rpc/protected_publish_transition'))result=reservation;
      else throw Error('Unexpected synthetic request');
      return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
    };
    const body={post_id:'20000000-0000-4000-8000-000000000002',slot:0};
    const first=await call('POST',{}, {authorization:'Bearer synthetic'},body);
    const retry=await call('POST',{}, {authorization:'Bearer synthetic'},body);
    assert.equal(first.statusCode,200);assert.equal(first.body.public_id,durable);assert.equal(first.body.timestamp,timestamp);
    assert.deepEqual(first.body,retry.body);assert.equal(first.body.overwrite,false);assert.equal(first.body.type,'authenticated');
    for(const change of [{public_id:'another-owner/'+durable},{timestamp:timestamp+7200},{timestamp:timestamp-7200},{timestamp:null}]) {
      reservation={...reservation,...change};
      const denied=await call('POST',{}, {authorization:'Bearer synthetic'},body);assert.equal(denied.statusCode,409);
      reservation={status:'reserved',public_id:'freeupper-privacy-v2-staging/'+owner+'/'+durable,timestamp};
    }
  } finally {globalThis.fetch=originalFetch;}
});
