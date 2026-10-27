import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const index = await readFile('index.html', 'utf8');
const profile = await readFile('profile.html', 'utf8');
const create = await readFile('create.html', 'utf8');
const studio = await readFile('studio.html', 'utf8');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function extract(source, start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
test('homepage protected video markup references an opaque media ID and its separate poster', () => {
  const code = extract(index, 'function getMediaItems(post)', 'function initMediaScrollRow(el)');
  const context = {}; vm.createContext(context); vm.runInContext(code, context);
  const html = context.buildMediaHTML({ id: 'post', media: [{ type: 'video', protected: true, assetId: id, thumbnailAssetId: id,
    url: 'https://res.cloudinary.com/should-never-render.mp4' }] }, 0);
  assert.match(html, new RegExp('data-protected-asset="' + id + '"'));
  assert.match(html, new RegExp('data-protected-poster="' + id + '"'));
  assert.doesNotMatch(html, /res\.cloudinary|<video[^>]+src=/);
});
test('profile post and saved grids fetch only the registered video poster', () => {
  const code = extract(profile, 'function buildGridPostCard(post, opts)', '// ─── MARKET CARD');
  const context = { isOwner: false, escapeHtml: String, fmtNum: String, window: { FreeUpperProtectedMedia: {} } };
  vm.createContext(context); vm.runInContext(code, context);
  const post = { id: 'post', title: 'Protected video', protectedMedia: true, mediaType: 'video',
    mediaUrl: 'https://public.invalid/video.mp4', media: [{ protected: true, type: 'video', assetId: 'media-id', thumbnailAssetId: id }] };
  for (const html of [context.buildGridPostCard(post), context.buildGridLoveCard(post)]) {
    assert.match(html, new RegExp('data-protected-asset="' + id + '"'));
    assert.doesNotMatch(html, /public\.invalid|data-protected-asset="media-id"/);
  }
});
test('composer beta readiness uses only the authenticated status RPC and excludes unapproved users', async () => {
  const code = extract(create, 'async function refreshProtectedAudienceAvailability()', "window.addEventListener('load', refreshProtectedAudienceAvailability)");
  for (const [approved, mode] of [[false,'production'],[true,'production'],[true,'verification'],[true,'disabled']]) {
    const select = { options: ['public', 'followers', 'friends', 'only_me'].map(value => ({ value })), value: 'public' };
    const context = { document: { getElementById: id => id === 'postAudience' ? select : {} },
      window: { FreeUpperProtectedPublish: { publish() {} }, sb: { rpc: async name => {
        assert.equal(name, 'protected_studio_beta_status'); return { data: { approved, ready: true, mode } };
      } } } };
    vm.createContext(context); vm.runInContext(code, context);
    await context.refreshProtectedAudienceAvailability();
    for (const option of select.options.filter(o => o.value !== 'public')) assert.equal(option.disabled, !approved || mode !== 'production');
  }
});
test('Studio delegates restricted uploads to the shared publisher and refuses unrendered effects', async () => {
  const code = extract(studio, 'async function publishProtectedStudioPost(audience)', 'async function publishPost()');
  const nodes = new Map(); let request, toast;
  const context = { S: { media: { blob: new Blob(['image'], { type: 'image/jpeg' }), type: 'image' },
    mediaFiles: [], tags: [], filter: 'none', beauty: false, textOverlays: [] },
    document: { getElementById: id => {
      if (!nodes.has(id)) nodes.set(id, { style: {}, value: 'Caption', checked: false }); return nodes.get(id);
    } }, window: { FreeUpperProtectedPublish: { publish: async body => { request = body; } } },
    showScreen() {}, setProgress() {}, renderPostThumb() {}, showToast: value => { toast = value; } };
  vm.createContext(context); vm.runInContext(code, context);
  await context.publishProtectedStudioPost('private');
  assert.equal(request.audience, 'only_me'); assert.equal(request.source, 'studio');
  assert.equal(request.media[0].protectedFile, context.S.media.blob);
  request = null; context.S.filter = 'sepia(1)'; await context.publishProtectedStudioPost('followers');
  assert.equal(request, null); assert.match(toast, /remove effects/);
});

test('registry-backed post normalization ignores legacy public URLs while existing Public media is preserved', async () => {
  const posts = await readFile('posts.js', 'utf8');
  const code = extract(posts, 'function normalizeMedia(row)', 'function mapComment(row');
  const context = { safeArray: value => Array.isArray(value) ? value : [], safeNumber: Number, safeDate: value => value,
    CONFIG: { DEFAULT_CATEGORY: '', DEFAULT_SOURCE: 'composer' } };
  vm.createContext(context); vm.runInContext(code, context);
  const row = { id: 'post', media_type: 'video', media_url: 'https://public.invalid/video.mp4',
    thumbnail_url: 'https://public.invalid/poster.jpg', media: [{ type: 'video', asset_id: id, thumbnail_asset_id: id,
      url: 'https://public.invalid/alternate.mp4' }] };
  const protectedPost = context.mapPost(row);
  assert.equal(protectedPost.protectedMedia, true);
  assert.equal(protectedPost.mediaUrl, ''); assert.equal(protectedPost.thumbnailUrl, '');
  assert.equal(protectedPost.media[0].url, '');
  const publicPost = context.mapPost({ ...row, media: [{ type: 'video', url: row.media_url }] });
  assert.equal(publicPost.protectedMedia, false);
  assert.equal(publicPost.mediaUrl, row.media_url); assert.equal(publicPost.thumbnailUrl, row.thumbnail_url);
});

test('Studio focus/readiness rechecks never silently switch a restricted selection to Public', async () => {
  const code = extract(studio, 'async function refreshStudioAudienceAccess()', "window.addEventListener('focus'");
  for (const approved of [true, false]) {
    const select = { value: 'friends', options: ['public', 'followers', 'friends', 'private'].map(value => ({ value })) };
    const context = { document: { getElementById: id => id === 'studioAudience' ? select : {} },
      window: { sb: { auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) },
        rpc: async () => ({ data: { approved, ready: approved, mode: 'production' } }) } } };
    vm.createContext(context); vm.runInContext(code, context);
    await context.refreshStudioAudienceAccess();
    assert.equal(select.value, 'friends');
    assert.equal(select.options.find(option => option.value === 'friends').disabled, !approved);
  }
});
