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
