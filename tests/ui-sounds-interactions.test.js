import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers/sound-fixture.js';

const tap = () => ({ isTrusted: true, eventPhase: 2 });

test('interactions default ON and are independent from notification preferences and RPC errors', async () => {
  for (const options of [{}, { preferenceError: true }]) {
    const f = await fixture(options);
    assert.equal(f.sound.isInteractionsEnabled(), true);
    assert.equal(f.sound.interaction('like', tap()), true);
    await f.sound.setEnabled(false);
    assert.equal(f.sound.interaction('save', tap()), true);
    f.sound.setInteractionsEnabled(false);
    assert.equal(f.sound.interaction('like', tap()), false);
    await f.sound.setEnabled(true);
    assert.equal(f.sound.isInteractionsEnabled(), false);
    f.advance(); f.gesture();
    assert.equal(await f.sound.play('notify'), true);
  }
});

test('interaction preference persists per account and page, without server writes', async () => {
  const f = await fixture();
  f.sound.setInteractionsEnabled(false);
  assert.equal(f.storage.get('fu-interaction-sound:alice'), 'false');
  assert.equal(f.rows.size, 0);
  assert.equal((await fixture({ storage: f.storage })).sound.isInteractionsEnabled(), false);
  await f.login('bob');
  assert.equal(f.sound.isInteractionsEnabled(), true);
  await f.login('alice');
  assert.equal(f.sound.isInteractionsEnabled(), false);
  await f.logout();
  assert.equal(f.sound.interaction('like', tap()), false);
  assert.throws(() => f.sound.setInteractionsEnabled(false), /sign in/);
});

test('cross-tab updates and clearing storage affect only the current account', async () => {
  const f = await fixture();
  f.storage.set('fu-interaction-sound:alice', 'false');
  f.sandbox.window.dispatchEvent({ type: 'storage', key: 'fu-interaction-sound:bob' });
  assert.equal(f.sound.isInteractionsEnabled(), true);
  f.sandbox.window.dispatchEvent({ type: 'storage', key: 'fu-interaction-sound:alice' });
  assert.equal(f.sound.isInteractionsEnabled(), false);
  f.storage.clear();
  f.sandbox.window.dispatchEvent({ type: 'storage', key: null });
  assert.equal(f.sound.isInteractionsEnabled(), true);
});

test('blocked storage leaves the existing interaction preference intact', async () => {
  const f = await fixture();
  f.sandbox.localStorage.setItem = () => { throw Error('quota'); };
  assert.throws(() => f.sound.setInteractionsEnabled(false), /Could not save/);
  assert.equal(f.sound.isInteractionsEnabled(), true);
});

test('every interaction tone is quiet, immediate and deduplicated by activation, without a global cooldown', async () => {
  const f = await fixture();
  for (const type of ['like', 'repost', 'share', 'comment', 'save', 'follow', 'tap']) {
    const event = tap(), before = f.frequencies.length;
    assert.equal(f.sound.interaction(type, event), true);
    assert.ok(f.frequencies.length > before, type);
    assert.equal(f.sound.interaction(type, event), false);
    assert.equal(f.sound.interaction('tap', event), false, 'nested handlers do not play twice');
  }
  assert.ok(f.gains.every(g => g <= .022));
});

test('untrusted, ended, missing, hidden, suspended-screen and anonymous activations are silent', async () => {
  const f = await fixture();
  assert.equal(f.sound.interaction('like'), false);
  assert.equal(f.sound.interaction('like', { isTrusted: false, eventPhase: 2 }), false);
  assert.equal(f.sound.interaction('like', { isTrusted: true, eventPhase: 0 }), false);
  assert.equal(f.sound.interaction('scroll', tap()), false);
  await f.visibility('hidden');
  assert.equal(f.sound.interaction('like', tap()), false);
  await f.visibility('visible');
  f.sandbox.window.FreeUpperScreen = { isActive: () => false };
  assert.equal(f.sound.interaction('like', tap()), false);
  for (const options of [{ anonymous: true }, { uid: null }, { unavailable: true }, { blocked: true }, { hangingResume: true }]) {
    const other = await fixture(options);
    assert.equal(other.sound.interaction('like', tap()), false);
    await other.flush();
    assert.deepEqual(other.frequencies, []);
  }
  assert.deepEqual(f.frequencies, []);
});

test('existing action handler still performs its work exactly once when sound is on, off or unavailable', async () => {
  const source = readFileSync('video.html', 'utf8');
  const body = source.slice(source.indexOf('        async function toggleLike(idx)'), source.indexOf('        async function toggleSave(idx)'));
  for (const enabled of [true, false, null]) {
    const f = await fixture();
    f.sound.setInteractionsEnabled(enabled !== false);
    let calls = 0;
    const post = { id: 'post-1', liked: false, likes: 0 };
    Object.assign(f.sandbox, {
      videoPosts: [post], requireLoggedIn: () => true,
      updateLikeButton() {}, fmtNum: String, haptic() {}, showToast() {},
    });
    f.sandbox.window.PostsAPI = { async toggleLike(id) { assert.equal(id, 'post-1'); calls++; return { liked: true, count: 1 }; } };
    f.sandbox.window.AuthUser = { getCurrentUser: () => ({ id: 'alice', isLoggedIn: true }) };
    if (enabled === null) delete f.sandbox.window.FUSound;
    vm.runInContext(body, f.sandbox);
    await f.activate(() => vm.runInContext('toggleLike(0)', f.sandbox));
    assert.equal(f.frequencies.length, enabled === true ? 2 : 0);
    assert.equal(calls, 1);
    assert.equal(post.liked, true);
  }
});


test('the captured activation expires after dispatch and never replays on async completion or background work', async () => {
  const f = await fixture();
  const count = f.activate(() => f.sound.interaction('like'));
  assert.equal(count, true);
  await f.flush();
  assert.equal(f.sound.interaction('like'), false);
  assert.equal(f.frequencies.length, 2);
  f.activate(() => assert.equal(f.sound.interaction('tap'), true), 'keydown');
  assert.equal(f.frequencies.length, 3);
});

test('new handler calls stay compatible with a cached v3 manager lacking the interaction method', async () => {
  const f = await fixture();
  f.sandbox.window.FUSound = { play() {} };
  const market = readFileSync('market.js', 'utf8');
  const fn = market.slice(market.indexOf('    function selectMarketSubcategory(sub)'), market.indexOf('    function applyMarketFiltersAndRender'));
  let rendered = 0;
  Object.assign(f.sandbox, { activeMarketSubcategory: 'All', renderMarketCategoryBars() {}, applyMarketFiltersAndRender() { rendered++; } });
  vm.runInContext(fn + '\nselectMarketSubcategory("Books");', f.sandbox);
  assert.equal(f.sandbox.activeMarketSubcategory, 'Books');
  assert.equal(rendered, 1);
});


test('all interaction documents load the manager early and precache their new coupled scripts for PWA upgrades', () => {
  for (const page of ['index.html', 'search.html', 'video.html', 'profile.html', 'settings.html', 'chat.html', 'notification.html']) {
    const html = readFileSync(page, 'utf8');
    assert.equal((html.match(/data-fu-sounds/g) || []).length, 1, page);
    const manager = html.indexOf('/ui-sounds.js?v=4');
    assert.ok(manager >= 0 && manager < html.search(/src="\/?auth\.js/), page);
  }
  const worker = readFileSync('service-worker.js', 'utf8');
  for (const path of ['ui-sounds.js?v=4', ...['auth.js', 'settings.js', 'market.js', 'search.js', 'bottom-nav.js', 'side-nav.js'].map(name => name + '?v=interaction-sounds-v4')]) {
    assert.ok(worker.includes("'./" + path + "'"), path);
  }
});
