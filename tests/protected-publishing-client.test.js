import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile('privacy-v2-composer.js', 'utf8');
const owner = '9341af03-e007-4fc6-9c23-b06073379088';
const draft = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function setup(options = {}) {
  const calls = [], uploads = [], revoked = [];
  const signed = slot => ({ cloud_name: 'duzyf1kda', api_key: 'test-key', type: 'authenticated',
    overwrite: false, timestamp: 1234567890, folder: 'freeupper-protected-v2/' + owner,
    public_id: 'asset_' + String(slot).padStart(32, '0'), signature: 'test-signature', ...options.signed });
  let uploadIndex = 0;
  const context = { Blob, File, FormData, setTimeout, clearTimeout,
    URL: { createObjectURL: () => 'blob:poster', revokeObjectURL: u => revoked.push(u) },
    document: { createElement(type) {
      if (type === 'video') return { videoWidth: 1920, videoHeight: 1080,
        set src(v) { queueMicrotask(() => this.onloadeddata?.()); }, removeAttribute() {}, load() {} };
      if (type === 'canvas') return { getContext: () => ({ drawImage() {} }),
        toBlob(callback) { callback(new Blob(['poster'], { type: 'image/jpeg' })); } };
      throw Error(type);
    } },
    window: { sb: { auth: { getSession: async () => ({ data: { session: options.guest ? null : { access_token: 'user-token' } } }) },
      rpc: async name => { assert.equal(name, 'protected_studio_beta_status'); return { data: { approved: !options.excluded, ready: true, mode: options.verification ? 'verification' : 'production' } }; } } },
    fetch: async (url, init) => {
      assert.equal(init.cache, 'no-store');
      if (url.startsWith('https://api.cloudinary.com/')) {
        const fields = Object.fromEntries(init.body.entries()); uploads.push({ url, fields });
        assert.equal(fields.type, 'authenticated'); assert.equal(fields.overwrite, 'false');
        return Response.json({ asset_id: String(++uploadIndex).padStart(32, '0'),
          public_id: fields.folder + '/' + fields.public_id,
          resource_type: url.includes('/video/') ? 'video' : 'image', type: 'authenticated', ...options.upload });
      }
      assert.equal(url, 'https://api.freeupper.com/functions/v1/protected-publishing');
      assert.equal(init.headers.Authorization, 'Bearer user-token');
      const body = JSON.parse(init.body); calls.push(body);
      if (body.action === 'text') return Response.json({id:draft,status:'published',media:[]});
      if (body.action === 'create') return Response.json({ id: draft, status: 'draft', verification: !!options.verification });
      if (body.action === 'sign') return Response.json(signed(body.slot));
      if (body.action === 'register') return Response.json({ status: 'ready', asset_id: 'registry-' + body.slot, ...options.registration });
      if (body.action === 'publish') {
        if (options.lostResponse) throw Error('Network lost');
        return Response.json({ status: 'published', id: draft });
      }
      if (body.action === 'status') {
        if (options.lostStatus) throw Error('Network lost');
        return Response.json({ status: options.lostResponse ? 'published' : 'draft', id: draft });
      }
      if (body.action === 'cancel') return Response.json({ status: 'failed' });
      throw Error(body.action);
    }
  };
  vm.runInNewContext(source, context);
  const publish = extra => context.window.FreeUpperProtectedPublish.publish({ audience: 'followers', title: 'Photo', content: '', tags: [],
    media: [{ type: 'image', protectedFile: new File(['image'], 'photo.jpg', { type: 'image/jpeg' }) }], ...extra });
  return { calls, uploads, revoked, publish };
}
test('approved Studio photo uploads authenticated media, registers, and confirms publish', async () => {
  const s = setup();
  assert.equal((await s.publish({ source: 'studio' })).status, 'published');
  assert.deepEqual(s.calls.map(c => c.action), ['create', 'sign', 'register', 'publish']);
  assert.equal(s.calls[0].fields.source, 'studio');
  assert.equal(s.calls[0].visibility, 'followers');
  assert.equal(s.uploads.length, 1);
});
test('video produces a separately signed authenticated poster in slot 20', async () => {
  const s = setup();
  await s.publish({ audience: 'friends', media: [{ type: 'video', protectedFile: new File(['video'], 'video.mp4', { type: 'video/mp4' }) }] });
  assert.deepEqual(s.calls.filter(c => c.action === 'sign').map(c => c.slot), [0, 20]);
  assert.deepEqual(s.calls.filter(c => c.action === 'register').map(c => [c.slot, c.resource_type]), [[0, 'video'], [20, 'image']]);
  assert.equal(s.uploads[1].fields.file.type, 'image/jpeg');
  assert.deepEqual(s.revoked, ['blob:poster']);
});
test('excluded and unauthenticated accounts cannot create drafts or upload', async () => {
  for (const options of [{ excluded: true }, { guest: true }]) {
    const s = setup(options); await assert.rejects(s.publish());
    assert.equal(s.calls.length, 0); assert.equal(s.uploads.length, 0);
  }
});
test('invalid audience, mixed media, empty files, and oversize media fail before draft creation', async () => {
  const s = setup();
  const large = new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' });
  for (const extra of [{ audience: 'public' }, { media: [], title:'', content:'' }, { media: [{ type: 'image', protectedFile: large }] },
    { media: [{ type: 'image', protectedFile: new File([], 'empty.jpg', { type: 'image/jpeg' }) }] }]) await assert.rejects(s.publish(extra));
  assert.equal(s.calls.length, 0); assert.equal(s.uploads.length, 0);
});
test('untrusted signing parameters and public or mismatched uploads never register or publish', async () => {
  for (const options of [{ signed: { type: 'upload' } }, { signed: { cloud_name: 'attacker' } },
    { signed: { overwrite: true } }, { upload: { type: 'upload' } }, { upload: { public_id: 'unreserved' } }]) {
    const s = setup(options); await assert.rejects(s.publish());
    assert.ok(!s.calls.some(c => ['register', 'publish'].includes(c.action)));
    assert.ok(s.calls.some(c => c.action === 'cancel'));
  }
});
test('registration failure stops publish; lost publish responses recover without cancelling committed posts', async () => {
  const failed = setup({ registration: { status: 'pending' } }); await assert.rejects(failed.publish());
  assert.ok(!failed.calls.some(c => c.action === 'publish'));
  const recovered = setup({ lostResponse: true }); assert.equal((await recovered.publish()).status, 'published');
  assert.ok(!recovered.calls.some(c => c.action === 'cancel'));
  const unknown = setup({ lostResponse: true, lostStatus: true }); await assert.rejects(unknown.publish());
  assert.ok(!unknown.calls.some(c => c.action === 'cancel'), 'unknown commit state must not be cancelled');
});

test('stale temporary readiness cannot publish or fall back to public upload', async () => {
  const s = setup({ verification: true });
  await assert.rejects(s.publish({ audience: 'only_me' }), /unavailable/);
  assert.equal(s.calls.length, 0);
});

test('restricted text publishes atomically without Cloudinary or public-upload fallbacks',async()=>{
 const s=setup();const result=await s.publish({media:[],content:'Private text',audience:'only_me'});
 assert.equal(result.status,'published');assert.equal(s.calls.length,1);assert.equal(s.calls[0].action,'text');assert.equal(s.calls[0].visibility,'only_me');assert.equal(s.uploads.length,0);
});
