import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers/sound-fixture.js';

const saved = (settings = {}) => new Map([['alice', { user_id: 'alice', notification_settings: settings }]]);

test('default sound preference is ON, including missing/null JSON and missing sound', async () => {
  for (const rows of [new Map(), saved(null), saved({ likes: false })]) {
    const f = await fixture({ rows });
    assert.equal(f.sound.isEnabled(), true);
    assert.equal(f.events.preferenceState().ready, true);
  }
});

test('OFF and ON persist per user and synchronize on another device', async () => {
  const rows = saved({ likes: false, replies: true, future: { enabled: false } });
  const f = await fixture({ rows });
  await f.sound.setEnabled(false);
  assert.equal(f.sound.isEnabled(), false);
  assert.equal(f.storage.get('fu-sound:alice'), 'false');
  const other = await fixture({ rows });
  assert.equal(other.sound.isEnabled(), false);
  await other.sound.setEnabled(true);
  await f.visibility('visible');
  assert.equal(f.sound.isEnabled(), true);
  assert.deepEqual(rows.get('alice').notification_settings, { likes: false, replies: true, future: { enabled: false }, sound: true });
});

test('atomic RPC preserves concurrent notification settings', async () => {
  const f = await fixture({ rows: saved({ likes: true }) });
  f.conflict((rows, id) => rows.set(id, { user_id: id, notification_settings: { likes: false, mentions: false } }));
  await f.sound.setEnabled(false);
  assert.deepEqual(f.rows.get('alice').notification_settings, { likes: false, mentions: false, sound: false });
});

test('atomic RPC handles concurrent creation without replacing keys', async () => {
  const f = await fixture();
  f.conflict((rows, id) => rows.set(id, { user_id: id, theme: 'light', notification_settings: { comments: false } }));
  await f.sound.setEnabled(false);
  assert.deepEqual(f.rows.get('alice'), { user_id: 'alice', theme: 'light', notification_settings: { comments: false, sound: false } });
});

test('failed saves reject and restore both preference and cache', async () => {
  const f = await fixture();
  f.fail();
  await assert.rejects(f.sound.setEnabled(false), /offline/);
  assert.equal(f.sound.isEnabled(), true);
  assert.equal(f.storage.get('fu-sound:alice'), 'true');
});

for (const [type, frequencies] of Object.entries({
  like: [880, 1320], comment: [587, 784], reply: [587, 784], mention: [587, 784],
  repost: [523, 659, 784], follow: [523, 659, 1047], system: [660, 880], verified: [660, 880]
})) {
  test(`incoming ${type} uses its correct synthesized sound`, async () => {
    const f = await fixture(); f.gesture(); f.notification(type); await f.flush();
    assert.deepEqual(f.frequencies, frequencies);
    assert.ok(f.gains.every(v => v <= .035));
  });
}

test('only unread incoming notifications for the current recipient sound; history/updates never hooked', async () => {
  const f = await fixture(); f.gesture();
  f.notification('like', 'n1', { receiver_id: 'bob' });
  f.notification('like', 'n2', { actor_id: 'alice' });
  f.notification('like', 'n3', { read: true });
  f.notification('message', 'n4');
  await f.flush();
  assert.deepEqual(f.frequencies, []);
});

test('eligible incoming messages sound once across chat and global callbacks; own messages are silent', async () => {
  const f = await fixture(); f.gesture();
  const msg = f.db.messages.get('m1');
  await Promise.all([f.events.message(msg, 'alice'), f.events.message(msg, 'alice')]);
  assert.deepEqual(f.frequencies, [740, 988, 1175]);
  f.advance();
  f.db.messages.set('m2', { ...msg, id: 'm2', sender_id: 'alice' });
  await f.events.message(f.db.messages.get('m2'), 'alice');
  assert.equal(f.frequencies.length, 3);
});

test('membership, blocks/RLS denial, mute, hidden, expired and deleted messages remain silent', async () => {
  for (const kind of ['not-member', 'rls', 'muted', 'hidden', 'expired', 'deleted', 'system', 'group-no-member', 'note']) {
    const f = await fixture(); f.gesture();
    const msg = f.db.messages.get('m1'), conv = f.db.conversations.get('c1');
    if (kind === 'not-member') conv.user1_id = 'charlie';
    if (kind === 'rls') f.db.messages.clear();
    if (kind === 'muted') conv.muted_by = ['alice'];
    if (kind === 'hidden') conv.hidden_by = ['alice'];
    if (kind === 'expired') msg.expires_at = '1970-01-01T00:00:00Z';
    if (kind === 'deleted') msg.deleted_for = ['alice'];
    if (kind === 'system') msg.message_type = 'system';
    if (kind === 'group-no-member') conv.is_group = true;
    if (kind === 'note') conv.is_note = true;
    await f.events.message(msg, 'alice');
    assert.deepEqual(f.frequencies, [], kind);
  }
  const f = await fixture(); f.gesture();
  f.db.conversations.get('c1').is_group = true;
  f.db.conversation_members.set('alice', { user_id: 'alice' });
  await f.events.message(f.db.messages.get('m1'), 'alice');
  assert.equal(f.frequencies.length, 3);
});

test('duplicate notification events do not replay, including navigation to another page', async () => {
  const f = await fixture(); f.gesture(); f.notification(); await f.flush(); f.advance(); f.notification(); await f.flush();
  assert.deepEqual(f.frequencies, [880, 1320]);
  const nextPage = await fixture({ storage: f.storage }); nextPage.gesture(); nextPage.notification(); await nextPage.flush();
  assert.deepEqual(nextPage.frequencies, []);
});

test('missing or autoplay-blocked Web Audio never throws or schedules a stale sound', async () => {
  for (const options of [{ unavailable: true }, { blocked: true }]) {
    const f = await fixture(options); f.gesture();
    assert.equal(await f.sound.play('like'), false);
    f.notification(); await f.events.message(f.db.messages.get('m1'), 'alice'); await f.flush();
    assert.deepEqual(f.frequencies, []);
  }
});

test('no audio before interaction, while disabled, hidden, or anonymous', async () => {
  const f = await fixture();
  assert.equal(await f.sound.play(), false);
  f.gesture(); await f.sound.setEnabled(false); assert.equal(await f.sound.play(), false);
  await f.sound.setEnabled(true); await f.visibility('hidden'); assert.equal(await f.sound.play(), false);
  await f.visibility('visible'); assert.equal(await f.sound.play(), true);
  for (const options of [{ uid: null }, { anonymous: true }]) {
    const guest = await fixture(options); guest.gesture(); assert.equal(await guest.sound.play(), false);
    await assert.rejects(guest.sound.setEnabled(false), /sign in/);
  }
});

test('suspended context resumes gracefully after an interaction', async () => {
  const f = await fixture(); f.gesture(); f.audio.state = 'suspended';
  assert.equal(await f.sound.play('like'), true);
  assert.deepEqual(f.frequencies, [880, 1320]);
});

test('logout/account switching and in-flight message checks cannot leak preferences or sounds', async () => {
  const rows = saved({ sound: false }); rows.set('bob', { user_id: 'bob', notification_settings: { sound: true } });
  const f = await fixture({ rows }); assert.equal(f.sound.isEnabled(), false);
  await f.logout(); assert.equal(f.sound.isEnabled(), true); assert.equal(await f.sound.play(), false);
  await f.login('bob'); assert.equal(f.sound.isEnabled(), true);
  await f.login('alice'); assert.equal(f.sound.isEnabled(), false);
  await f.sound.setEnabled(true); f.gesture();
  let release; const gate = new Promise(r => { release = r; });
  f.gate((table) => table === 'messages' ? gate : undefined);
  const pending = f.events.message(f.db.messages.get('m1'), 'alice');
  await f.login('bob'); release(); await pending;
  assert.deepEqual(f.frequencies, []);
});

test('existing homepage Realtime callbacks still refresh notification and message badges with sound OFF', async () => {
  const f = await fixture(); await f.sound.setEnabled(false);
  // Header owns its existing auth listener. Keep the sound manager listener above.
  vm.runInContext(readFileSync('header-badges.js', 'utf8'), f.sandbox);
  await f.flush();
  assert.equal(f.channels.length, 3);
  assert.equal(f.badges.notificationUnreadBadge.textContent, '3');
  assert.equal(f.badges.chatUnreadBadge.textContent, '4');
  const notif = f.channels.find(c => c.name.startsWith('header-notifications'));
  notif.callbacks[0].cb({ eventType: 'INSERT', new: { id: 'n1', type: 'like', receiver_id: 'alice', actor_id: 'bob' } });
  const messages = f.channels.find(c => c.name.startsWith('header-messages'));
  messages.callbacks[0].cb({ new: f.db.messages.get('m1') });
  await new Promise(r => setTimeout(r, 350));
  assert.equal(f.badges.notificationUnreadBadge.style.display, 'flex');
  assert.equal(f.badges.chatUnreadBadge.style.display, 'flex');
  assert.deepEqual(f.frequencies, []);
});

test('a stale local cache is superseded by the authenticated saved preference', async () => {
  const storage = new Map([['fu-sound:alice', 'true'], ['fu-sound:bob', 'false']]);
  const f = await fixture({ storage, rows: saved({ sound: false }) });
  assert.equal(f.sound.isEnabled(), false);
  assert.equal(storage.get('fu-sound:alice'), 'false');
});

test('messages checked across a hidden/visible cycle never play late', async () => {
  const f = await fixture(); f.gesture();
  let release; const gate = new Promise(r => { release = r; });
  f.gate(table => table === 'messages' ? gate : undefined);
  const pending = f.events.message(f.db.messages.get('m1'), 'alice');
  await f.visibility('hidden'); await f.visibility('visible'); release(); await pending;
  assert.deepEqual(f.frequencies, []);
});

test('the existing chat INSERT callback passes incoming and own messages through the shared guard', async () => {
  const f = await fixture(); f.gesture();
  const chat = readFileSync('chat.js', 'utf8');
  const handler = chat.slice(chat.indexOf('    function subscribeToMessages() {'), chat.indexOf('    async function notifyIncomingMessage'));
  Object.assign(f.sandbox, { sb: f.sandbox.window.sb, messageSubscription: null, currentUserId: 'alice',
    selectedConversationId: 'c1', messages: [], renderMessages() {}, scrollToBottom() {}, markVisibleMessagesRead() {},
    loadConversations() {}, notifyIncomingMessage() {} });
  vm.runInContext(handler + '\nsubscribeToMessages();', f.sandbox);
  assert.equal(f.channels.length, 1);
  const insert = f.channels[0].callbacks[0].cb;
  insert({ new: f.db.messages.get('m1') }); await f.flush();
  assert.deepEqual(f.frequencies, [740, 988, 1175]);
  f.advance(); insert({ new: { id: 'own', sender_id: 'alice', conversation_id: 'c1' } }); await f.flush();
  assert.deepEqual(f.frequencies, [740, 988, 1175]);
});

test('homepage hooks only INSERT notifications and uses the existing three subscriptions', async () => {
  const f = await fixture(); f.gesture();
  vm.runInContext(readFileSync('header-badges.js', 'utf8'), f.sandbox); await f.flush();
  assert.equal(f.channels.length, 3);
  const callback = f.channels.find(c => c.name.startsWith('header-notifications')).callbacks[0].cb;
  callback({ eventType: 'UPDATE', new: { id: 'update', receiver_id: 'alice', type: 'like' } }); await f.flush();
  assert.deepEqual(f.frequencies, []);
  callback({ eventType: 'INSERT', new: { id: 'insert', receiver_id: 'alice', actor_id: 'bob', type: 'follow' } }); await f.flush();
  assert.deepEqual(f.frequencies, [523, 659, 1047]);
});

test('a trusted tap before async auth completes unlocks audio for the first eligible event', async () => {
  let release; const sessionGate = new Promise(resolve => { release = resolve; });
  const f = await fixture({ sessionGate });
  f.gesture();
  assert.equal(f.sound.diagnostics().contextState, 'running');
  assert.equal(f.sound.diagnostics().authenticated, false);
  assert.equal(await f.sound.play(), false, 'no anonymous playback');
  release(); await f.flush(); await f.flush();
  assert.equal(f.sound.diagnostics().unlocked, true);
  f.notification(); await f.flush();
  assert.deepEqual(f.frequencies, [880, 1320]);
});

test('rejected resume never reports audio as unlocked', async () => {
  const f = await fixture({ blocked: true }); f.gesture(); await f.flush();
  assert.equal(f.sound.diagnostics().contextState, 'suspended');
  assert.equal(f.sound.diagnostics().unlocked, false);
  assert.equal(f.sound.diagnostics().unlockError, 'resume-rejected');
  assert.equal(await f.sound.play('notify', { preview: true, event: f.tap() }), false);
  assert.equal(f.sound.diagnostics().lastPlay.reason, 'resume-rejected');
});

test('Test sound isolates audio from disabled or failed preference sync without changing the preference', async () => {
  for (const options of [{ rows: saved({ sound: false }) }, { preferenceError: true }]) {
    const f = await fixture(options);
    const enabled = f.sound.isEnabled();
    assert.equal(await f.sound.play('notify', { preview: true, event: f.tap() }), true);
    assert.deepEqual(f.frequencies, [660, 880]);
    assert.equal(f.sound.isEnabled(), enabled);
    assert.equal(f.sound.diagnostics().lastPlay.source, 'test-button');
    f.advance();
    assert.equal(await f.sound.play(), false);
    assert.equal(f.sound.diagnostics().lastPlay.reason, options.preferenceError ? 'preference-sync-error' : 'preference-off');
  }
});

test('Test sound has a bounded result when iOS resume never settles', async () => {
  const f = await fixture({ hangingResume: true });
  assert.equal(await f.sound.play('notify', { preview: true, event: f.tap() }), false);
  assert.equal(f.sound.diagnostics().contextState, 'suspended');
  assert.equal(f.sound.diagnostics().lastPlay.reason, 'context-not-running');
});

test('a blocked audio attempt does not poison cross-page duplicate suppression', async () => {
  const f = await fixture({ blocked: true }); f.gesture(); f.notification(); await f.flush();
  assert.equal(f.storage.has('fu-sound-events:alice'), false);
  const next = await fixture({ storage: f.storage }); next.gesture(); next.notification(); await next.flush();
  assert.deepEqual(next.frequencies, [880, 1320]);
});

test('diagnostics trace callback receipt, actual play invocation and duplicate/filter suppression without private data', async () => {
  const f = await fixture(); f.gesture();
  f.notification(); await f.flush();
  assert.equal(f.sound.diagnostics().lastEvent.reason, 'play-invoked');
  assert.equal(f.sound.diagnostics().playInvocations, 1);
  f.notification(); await f.flush();
  assert.equal(f.sound.diagnostics().lastEvent.reason, 'duplicate-memory');
  assert.equal(f.sound.diagnostics().playInvocations, 1);
  await f.events.message({ id: 'secret-message-id', sender_id: 'alice', text: 'private message' }, 'alice', 'chat-messages');
  assert.equal(f.sound.diagnostics().lastEvent.reason, 'own-message');
  const text = JSON.stringify(f.sound.diagnostics());
  assert.ok(!/alice|secret-message-id|private message|access_token/.test(text));
  const next = await fixture({ sessionStorage: f.sessionStorage });
  assert.equal(next.sound.diagnostics().previousPage.lastEvent.reason, 'own-message');
  await next.login('bob');
  assert.equal(next.sound.diagnostics().previousPage, null);
});

test('sound manager loads before auth/Realtime consumers and auth explicitly binds the existing client', () => {
  for (const file of ['index.html', 'chat.html', 'settings.html', 'notification.html']) {
    const html = readFileSync(file, 'utf8');
    assert.ok(html.indexOf('/ui-sounds.js?v=3') < html.indexOf('src="auth.js'), file);
    assert.match(html, /<script src="\/ui-sounds.js\?v=3" data-fu-sounds><\/script>/);
  }
  assert.match(readFileSync('auth.js', 'utf8'), /window\.FreeUpperSounds\.bindClient\(sb\)/);
});

test('early manager binds at DOM ready with cached legacy auth that only assigns window.sb', async () => {
  const f = await fixture({ lateClient: true });
  f.gesture();
  assert.equal(f.sound.diagnostics().authenticated, false);
  f.domReady(); await f.flush(); await f.flush();
  assert.equal(f.sound.diagnostics().authenticated, true);
  assert.equal(f.sound.diagnostics().preferenceReady, true);
  assert.equal(await f.sound.play('notify', { preview: true, event: f.tap() }), true);
});


test('coupled sound consumers bypass pre-upgrade PWA cache entries', () => {
  for (const [page, files] of Object.entries({
    'index.html': ['auth.js', 'header-badges.js'],
    'chat.html': ['auth.js', 'settings.js', 'chat.js'],
    'settings.html': ['auth.js', 'settings.js'],
    'notification.html': ['auth.js', 'notification.js']
  })) {
    const html = readFileSync(page, 'utf8');
    for (const file of files) assert.ok(html.includes(file + '?v=sounds-v3'), page + ': ' + file);
  }
});
