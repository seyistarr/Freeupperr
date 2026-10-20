import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stagingPublishingEnabled, requirePublishingSchema } from '../lib/protected-media/staging-publishing-server.js';
import { verifyStagingRegistration } from '../lib/protected-media/verify-staging-registration.js';
const owner = 'b27b41f5-744a-475b-b538-4699ad4fa1d4';
const other = '8022bdf2-1e05-49e6-87e3-99bb2342007d';
const postId = '20000000-0000-4000-8000-000000000002';
const publicId = 'freeupper-privacy-v2-staging/' + owner + '/asset_' + 'a'.repeat(32);
const assetId = 'b'.repeat(32);
const staging = {
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/post-privacy-v2-integration',
  FREEUPPER_MEDIA_TEST_ENV: 'isolated-freeupper-staging',
  SUPABASE_URL: 'https://tagkrhvgcbnybiuyvjxt.supabase.co', CLOUDINARY_CLOUD_NAME: 'sxdcqs5x',
  SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'server-only',
  CLOUDINARY_API_KEY: 'api-key', CLOUDINARY_API_SECRET: 'server-secret'
};
async function call(endpoint, options = {}) {
  const calls = [], inserted = [], signed = [];
  const post = { id: postId, user_id: owner, visibility: 'followers', is_deleted: false, is_hidden: false, ...options.post };
  const asset = { public_id: publicId, asset_id: assetId, type: 'authenticated', resource_type: 'image', bytes: 1234, format: 'jpg', ...options.asset };
  const db = { async rpc(name, args) {
    calls.push(['rpc', name, args]);
    if (options.rpcError && name === 'protected_publish_transition') return { error: { code: 'draft-unavailable' } };
    return { data: name === 'protected_publishing_capabilities' ? { version: 2 } :
      args.p_action === 'register' ? { asset_id: postId, status: 'ready' } : { status: 'reserved' } };
  }, from(table) {
    calls.push(['table', table]);
    return {
      select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: post }),
      limit: async () => ({ data: options.existing || [], error: options.lookupError }),
      insert: async value => { inserted.push(value); return { error: options.insertError }; }
    };
  } };
  const context = {
    process: { env: { ...staging, ...options.env } },
    console: { error() {} }, verifyStagingRegistration, stagingPublishingEnabled, requirePublishingSchema,
    stagingPublishingDb(env) { if (!stagingPublishingEnabled(env)) throw Error('disabled'); return db; },
    randomUUID: () => '30000000-0000-4000-8000-000000000003',
    createClient(url, key, config) {
      calls.push(['client', url, key, config]);
      return key === 'server-only' ? db : { auth: { getUser: async token => {
        calls.push(['getUser', token]);
        return options.authError ? { error: Error('invalid') } : { data: { user: { id: owner } } };
      } } };
    },
    cloudinary: {
      config(config) { calls.push(['cloudinaryConfig', config]); },
      utils: { api_sign_request(params, secret) { signed.push({ params, secret }); return 'signed'; } },
      api: { resource: async (id, config) => { calls.push(['resource', id, config]); return asset; } }
    }
  };
  const source = readFileSync(new URL('../api/' + endpoint + '.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default async function handler', 'async function handler');
  vm.runInNewContext(source + '\nthis.handler = handler;', context);
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await context.handler({ method: options.method || 'POST',
    headers: options.guest ? {} : { authorization: 'Bearer viewer-token' },
    body: { ...(endpoint === 'privacy-v2-register-asset' ? { post_id: postId, public_id: publicId, asset_id: assetId, resource_type: 'image' } : {}), ...options.body }
  }, res);
  return { res, calls, inserted, signed };
}

for (const endpoint of ['privacy-v2-upload-signature', 'privacy-v2-register-asset']) {
  test(endpoint + ' rejects guests, invalid tokens, and production before privileged work', async () => {
    for (const [options, expected] of [[{ guest: true }, 401], [{ authError: true }, 401],
      [{ env: { VERCEL_ENV: 'production' } }, 503],
      [{ env: { VERCEL_GIT_COMMIT_REF: 'main' } }, 503],
      [{ env: { SUPABASE_URL: 'https://production.example' } }, 503],
      [{ env: { CLOUDINARY_CLOUD_NAME: 'production' } }, 503],
      [{ env: { FREEUPPER_MEDIA_TEST_ENV: '' } }, 503]]) {
      const r = await call(endpoint, options);
      assert.equal(r.res.statusCode, expected); assert.equal(r.inserted.length, 0); assert.equal(r.signed.length, 0);
      assert.equal(r.calls.some(([name]) => name === 'resource' || name === 'table'), false);
    }
  });
}

test('signature ignores supplied ownership and delivery overrides and signs immutable authenticated parameters', async () => {
  const r = await call('privacy-v2-upload-signature', { body: { user_id: other, folder: 'public', type: 'upload', overwrite: true } });
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.signed[0].params.folder, 'freeupper-privacy-v2-staging/' + owner);
  assert.equal(r.signed[0].params.type, 'authenticated'); assert.equal(r.signed[0].params.overwrite, false);
  assert.equal(r.res.body.signature, 'signed');
  assert.doesNotMatch(JSON.stringify(r.res.body), /server-only|server-secret|secure_url/);
});

test('registration writes only verified server metadata to isolated schema and returns only registry reference', async () => {
  const r = await call('privacy-v2-register-asset', { body: { owner_id: other, delivery_type: 'upload', format: 'html', status: 'revoked' } });
  assert.equal(r.res.statusCode, 201);
  assert.equal(r.inserted[0].owner_id, owner); assert.equal(r.inserted[0].post_id, postId);
  assert.equal(r.inserted[0].delivery_type, 'authenticated'); assert.equal(r.inserted[0].format, 'jpg');
  assert.equal(r.inserted[0].status, 'ready');
  const dbClient = r.calls.find(([name, , key]) => name === 'client' && key === 'server-only');
  assert.equal(dbClient[3].db.schema, 'privacy_test');
  const resource = r.calls.find(([name]) => name === 'resource');
  assert.equal(resource[1], publicId); assert.equal(resource[2].type, 'authenticated');
  assert.deepEqual(Object.keys(r.res.body).sort(), ['asset_id', 'status']);
});

test('registration rejects foreign posts, foreign namespaces, and unavailable posts before querying Cloudinary', async () => {
  for (const options of [{ post: { user_id: other } }, { body: { public_id: publicId.replace(owner, other) } },
    { post: { visibility: 'public' } }, { post: { is_hidden: true } }, { post: { is_deleted: true } }]) {
    const r = await call('privacy-v2-register-asset', options);
    assert.equal(r.res.statusCode, 404); assert.equal(r.inserted.length, 0);
    assert.equal(r.calls.some(([name]) => name === 'resource'), false);
  }
});

test('registration rejects duplicate claims, lookup errors, and unique conflicts from racing inserts', async () => {
  for (const existing of [[{ id: 'existing', post_id: postId, owner_id: owner }], [{ id: 'existing', post_id: 'other', owner_id: other }]]) {
    const r = await call('privacy-v2-register-asset', { existing });
    assert.equal(r.res.statusCode, 409); assert.equal(r.inserted.length, 0);
  }
  const failed = await call('privacy-v2-register-asset', { lookupError: { code: 'unavailable' } });
  assert.equal(failed.res.statusCode, 409); assert.equal(failed.inserted.length, 0);
  const race = await call('privacy-v2-register-asset', { insertError: { code: '23505' } });
  assert.equal(race.res.statusCode, 409); assert.equal(race.res.body.asset_id, undefined);
});

test('registration refuses public, placeholder, mismatched, and oversized Cloudinary assets', async () => {
  for (const asset of [{ type: 'upload' }, { access_control: [{ access_type: 'anonymous' }] }, { placeholder: true },
    { deleted: true }, { asset_id: 'c'.repeat(32) }, { public_id: 'other' },
    { resource_type: 'raw' }, { bytes: 51 * 1024 * 1024 }]) {
    const r = await call('privacy-v2-register-asset', { asset });
    assert.equal(r.res.statusCode, 404); assert.equal(r.inserted.length, 0);
  }
});

const publishing = { SUPABASE_ANON_KEY: 'sb_publishable_test', FREEUPPER_PROTECTED_PUBLISHING: 'enabled-in-isolated-staging',
  FREEUPPER_PROTECTED_MEDIA_DELIVERY: 'enabled-in-isolated-staging' };
test('draft upload records its owner/post intent before signing and fails closed on reservation failure', async () => {
  for (const rpcError of [false, true]) {
    const r = await call('privacy-v2-upload-signature', { env: publishing, body: { post_id: postId, slot: 0 }, rpcError });
    assert.equal(r.res.statusCode, rpcError ? 409 : 200);
    assert.equal(r.signed.length, rpcError ? 0 : 1);
    if (!rpcError) {
      const reserve = r.calls.find(([name, , args]) => name === 'rpc' && args?.p_action === 'reserve');
      assert.equal(reserve[2].p_owner, owner); assert.equal(reserve[2].p_post, postId);
      assert.ok(reserve[2].p_data.public_id.startsWith('freeupper-privacy-v2-staging/' + owner + '/'));
    }
  }
});
test('draft registration uses the locked transition and never the legacy direct insert', async () => {
  const r = await call('privacy-v2-register-asset', { env: publishing,
    post: { publishing_state: 'draft', is_hidden: true }, body: { slot: 0 } });
  assert.equal(r.res.statusCode, 201); assert.equal(r.inserted.length, 0);
  const register = r.calls.find(([name, , args]) => name === 'rpc' && args?.p_action === 'register');
  assert.equal(register[2].p_owner, owner); assert.equal(register[2].p_post, postId);
  assert.equal(register[2].p_data.cloudinary_asset_id, assetId);
});
