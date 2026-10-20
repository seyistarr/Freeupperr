import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { uploadProtectedStagingMediaSet, validateProtectedStagingMediaSet } from '../lib/protected-media/staging-upload-client.js';
import { publishProtectedStagingPost } from '../lib/protected-media/staging-publishing-client.js';
import { protectedMediaPlan, protectedDraftFields, stagingPublishingEnabled } from '../lib/protected-media/staging-publishing-server.js';
const postId = '20000000-0000-4000-8000-000000000002';
const registryId = '30000000-0000-4000-8000-000000000003';
const file = () => new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
const fields = { visibility: 'friends', source: 'composer', title: 'Private', content: 'Text' };
const valid = () => ({ files: [file()], postId, accessToken: 'viewer' });

test('invalid batches, including an invalid later file, reject before the first request', async () => {
  const original = globalThis.fetch;
  let requests = 0; globalThis.fetch = async () => { requests++; throw Error('unexpected request'); };
  try {
    for (const changes of [
      { files: [] }, { files: Array.from({ length: 21 }, file) },
      { files: [file(), { type: 'text/plain', size: 1 }] },
      { files: [file(), { type: 'image/', size: 1 }] },
      ...[0, -1, NaN, Infinity, 1.5, 50 * 1024 * 1024 + 1].map(size => ({ files: [file(), { type: 'image/jpeg', size }] })),
      { files: [file(), { type: 'video/mp4', size: 5 }] },
      { files: [{ type: 'video/mp4', size: 5 }, { type: 'video/mp4', size: 5 }] },
      { files: [file(), , file()] }, { postId: 'not-a-uuid' }, { postId: null },
      { accessToken: '' }, { accessToken: '   ' }, { accessToken: null }
    ]) await assert.rejects(uploadProtectedStagingMediaSet({ ...valid(), ...changes }));
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

function transport({ failedRegistration = 0, losePublishResponse = false } = {}) {
  const calls = []; let registrations = 0; let signatures = 0;
  const mock = async (url, options = {}) => {
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : null;
    calls.push({ url, options, body });
    let value;
    if (url === '/api/privacy-v2-publish') {
      if (body.action === 'create') value = { id: postId, status: 'draft' };
      if (body.action === 'publish' || body.action === 'status') value = { id: postId, status: 'published', visibility: 'friends' };
      if (body.action === 'publish' && losePublishResponse) throw Error('lost response');
      if (body.action === 'cancel') value = { id: postId, status: 'failed', cleanupPending: true };
    } else if (url === '/api/privacy-v2-upload-signature') {
      signatures++;
      value = { cloud_name: 'sxdcqs5x', api_key: 'public-key', signature: 'signed', timestamp: 1234,
        folder: 'freeupper-privacy-v2-staging/owner', public_id: 'asset_' + String(signatures).padStart(32, '0'),
        type: 'authenticated', overwrite: false };
    } else if (url.startsWith('https://api.cloudinary.com/')) {
      assert.equal(options.body.get('type'), 'authenticated'); assert.equal(options.body.get('overwrite'), 'false');
      value = { public_id: options.body.get('folder') + '/' + options.body.get('public_id'),
        type: 'authenticated', resource_type: url.includes('/video/') ? 'video' : 'image', asset_id: 'a'.repeat(32) };
    } else if (url === '/api/privacy-v2-register-asset') {
      registrations++;
      if (registrations === failedRegistration) return { ok: false, status: 503 };
      value = { asset_id: registryId, status: 'ready' };
    } else throw Error('unexpected destination');
    return { ok: true, json: async () => value };
  };
  return { calls, mock };
}

test('complete protected image batch registers each slot before publication', async () => {
  const t = transport(); const original = globalThis.fetch; globalThis.fetch = t.mock;
  try {
    const result = await publishProtectedStagingPost({ fields, files: [file(), file()], accessToken: 'viewer' });
    assert.equal(result.status, 'published');
    assert.deepEqual(t.calls.filter(c => c.url.endsWith('upload-signature')).map(c => c.body.slot), [0, 1]);
    const actions = t.calls.filter(c => c.url === '/api/privacy-v2-publish').map(c => c.body.action);
    assert.deepEqual(actions, ['create', 'publish']);
    assert.equal(t.calls.at(-2).url, '/api/privacy-v2-register-asset');
    assert.equal(t.calls.at(-1).body.action, 'publish');
    assert.doesNotMatch(JSON.stringify(t.calls[0].body), /mediaUrl|secure_url|cloudinary/);
  } finally { globalThis.fetch = original; }
});

test('protected video requires its separately registered poster before publication', async () => {
  const t = transport(); const original = globalThis.fetch; globalThis.fetch = t.mock;
  try {
    await publishProtectedStagingPost({ fields, files: [new File(['video'], 'video.mp4', { type: 'video/mp4' })],
      thumbnailFile: file(), accessToken: 'viewer' });
    assert.deepEqual(t.calls.filter(c => c.url.endsWith('upload-signature')).map(c => c.body.slot), [0, 20]);
    assert.equal(t.calls.at(-1).body.action, 'publish');
  } finally { globalThis.fetch = original; }
});

test('partial registration failure cancels the hidden draft without attempting publication', async () => {
  const t = transport({ failedRegistration: 2 }); const original = globalThis.fetch; globalThis.fetch = t.mock;
  try {
    await assert.rejects(publishProtectedStagingPost({ fields, files: [file(), file()], accessToken: 'viewer' }),
      error => error.postId === postId && error.cleanupPending === true);
    assert.equal(t.calls.some(c => c.body?.action === 'publish'), false);
    assert.equal(t.calls.at(-1).body.action, 'cancel');
    assert.equal(t.calls.at(-1).options.signal, undefined, 'cleanup not tied to a cancelled upload signal');
  } finally { globalThis.fetch = original; }
});

test('a lost publication response is reconciled before any cancellation', async () => {
  const t = transport({ losePublishResponse: true }); const original = globalThis.fetch; globalThis.fetch = t.mock;
  try {
    const result = await publishProtectedStagingPost({ fields, files: [file()], accessToken: 'viewer' });
    assert.equal(result.status, 'published'); assert.equal(t.calls.at(-1).body.action, 'status');
    assert.equal(t.calls.some(c => c.body?.action === 'cancel'), false);
  } finally { globalThis.fetch = original; }
});

test('server plans require all media and a poster, and reject legacy public URLs', () => {
  assert.equal(protectedMediaPlan(Array(20).fill('image')).length, 20);
  assert.deepEqual(protectedMediaPlan(['video']), [{ slot: 0, type: 'video', role: 'media' }, { slot: 20, type: 'image', role: 'thumbnail' }]);
  assert.throws(() => protectedMediaPlan(['image', 'video']));
  assert.throws(() => protectedDraftFields({ ...fields, mediaUrl: 'https://public.example/photo.jpg' }));
  assert.throws(() => protectedDraftFields({ ...fields, sound_id: 'public-sound' }));
  assert.equal(stagingPublishingEnabled({ VERCEL_ENV: 'production' }), false);
});

test('batch boundaries accept twenty images or exactly one 50 MiB video', () => {
  assert.doesNotThrow(() => validateProtectedStagingMediaSet({ ...valid(), files: Array.from({length:20},file) }));
  assert.doesNotThrow(() => validateProtectedStagingMediaSet({ ...valid(), files: [{ type: 'video/webm;codecs=vp9,opus', size: 50*1024*1024 }] }));
});

async function endpoint(action, { production = false, schemaMissing = false } = {}) {
  const inserts = [], transitions = [], deletions = [];
  const env = { VERCEL_ENV: production ? 'production' : 'preview',
    VERCEL_GIT_COMMIT_REF: 'feature/post-privacy-v2-integration',
    FREEUPPER_MEDIA_TEST_ENV: 'isolated-freeupper-staging',
    SUPABASE_URL: 'https://tagkrhvgcbnybiuyvjxt.supabase.co', CLOUDINARY_CLOUD_NAME: 'sxdcqs5x',
    FREEUPPER_PROTECTED_MEDIA_DELIVERY: 'enabled-in-isolated-staging',
    FREEUPPER_PROTECTED_PUBLISHING: 'enabled-in-isolated-staging',
    SUPABASE_ANON_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'secret-role',
    CLOUDINARY_API_KEY: 'public-key', CLOUDINARY_API_SECRET: 'secret-cloud' };
  const db = {
    from(table) {
      return { select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: { id: postId } }),
        insert: async data => { inserts.push({ table, data }); return {}; },
        then(resolve) { resolve({ data: [{ id: registryId, cloudinary_public_id: 'trusted-intent', resource_type: 'image', created_at: new Date().toISOString() }] }); }
      };
    },
    async rpc(name, args) { transitions.push(args); return { data: { status: args.p_action === 'publish' ? 'published' : 'failed', id: postId } }; }
  };
  const context = { process: { env }, console: { error() {} },
    stagingPublishingEnabled, protectedMediaPlan, protectedDraftFields,
    stagingPublishingDb() { return db; },
    async requirePublishingSchema() { if (schemaMissing) throw Error('migration missing'); },
    randomUUID: () => postId,
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) } }),
    cloudinary: { config() {}, uploader: { async destroy(id, params) { deletions.push({ id, params }); return { result: 'ok' }; } } }
  };
  const source = readFileSync(new URL('../api/privacy-v2-publish.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from '[^']+';\n/gm, '').replace('export default async function handler', 'async function handler');
  vm.runInNewContext(source + '\nthis.handler = handler;', context);
  const res = { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; },
    status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; return this; } };
  await context.handler({ method: action === 'capabilities' ? 'GET' : 'POST', headers: { authorization: 'Bearer owner-token' },
    body: { action, post_id: postId, fields, visibility: 'friends', media_types: ['image'] } }, res);
  return { res, inserts, transitions, deletions };
}

test('publishing endpoint creates hidden owned drafts and does not enable missing schema or production', async () => {
  const created = await endpoint('create');
  assert.equal(created.res.statusCode, 201);
  assert.equal(created.inserts[0].table, 'posts');
  assert.equal(created.inserts[0].data.is_hidden, true);
  assert.equal(created.inserts[0].data.publishing_state, 'draft');
  assert.equal(created.inserts[0].data.visibility, 'friends');
  assert.equal(created.inserts[0].data.user_id, 'owner');
  assert.equal(created.inserts[0].data.media.length, 0);
  for (const options of [{ production: true }, { schemaMissing: true }]) {
    const blocked = await endpoint('capabilities', options);
    assert.equal(blocked.res.statusCode, 503); assert.equal(blocked.res.body.enabled, undefined);
    assert.equal(blocked.inserts.length, 0);
  }
});

test('cancellation fails the draft before deleting authenticated assets and retains replay-window cleanup', async () => {
  const cancelled = await endpoint('cancel');
  assert.equal(cancelled.transitions[0].p_action, 'cancel');
  assert.equal(cancelled.res.body.status, 'failed');
  assert.equal(cancelled.res.body.cleanupPending, true);
  assert.equal(cancelled.deletions[0].id, 'trusted-intent');
  assert.equal(cancelled.deletions[0].params.type, 'authenticated');
  assert.equal(cancelled.deletions[0].params.invalidate, true);
});
