'use strict';
// Offline structural regression checks for the FreeUpper premium chat review branch.
// Run: node --test tests/chat-premium-review.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'chat.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'chat.js'), 'utf8');
function idCount(id) {
  return (html.match(new RegExp('\\bid="' + id + '"', 'g')) || []).length;
}

test('chat.js parses as classic JavaScript', () => {
  assert.doesNotThrow(() => new Function(js));
});
test('premium tabs and search reuse the existing list', () => {
  for (const id of ['conversationList', 'convSearch', 'clTabs', 'sbSearchBox', 'sbTitle', 'sbSub']) {
    assert.equal(idCount(id), 1, id);
  }
  for (const tab of ['all', 'unread', 'groups', 'requests']) {
    assert.match(html, new RegExp('data-tab="' + tab + '"'));
  }
  assert.match(js, /window\.setChatTab = function/);
});
test('new-message actions survive search results replacement', () => {
  assert.equal(idCount('userSearchResults'), 1);
  assert.equal(idCount('newChatModal'), 1);
  const modal = html.slice(html.indexOf('id="newChatModal"'), html.indexOf('id="createGroupModal"'));
  assert.match(modal, /class="nm-actions"/);
  assert.ok(modal.indexOf('class="nm-actions"') < modal.indexOf('id="userSearchResults"'));
  assert.doesNotMatch(js, /<div class="u-row" onclick="openCreateGroupModal\(\)">/);
});
test('view once never renders the mixed-media gallery directly', () => {
  assert.match(js, /msg\.message_type === 'media' && isViewOnceMsg/);
  assert.match(js, /contentHtml = renderViewOnceChip\(msg\)/);
  assert.match(js, /function shieldViewOnce\(/);
  assert.match(js, /window\.forwardMessage = function/);
});
test('request actions invoke server-side transitions, not direct conversation UPDATE', () => {
  assert.match(js, /sb\.rpc\('chat_respond_to_request'/);
  assert.match(js, /p_action: action/);
  assert.match(js, /Request transition was not confirmed/);
});
test('view-once shields have markup and reduced-motion design exists', () => {
  assert.equal(idCount('lbVoShield'), 1);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /\.fu-lb\.vo-shielded \.fu-lb-vo-shield/);
});

test('private view-once is explicitly disabled by default', () => {
  assert.match(js, /window\.FREEUPPER_PRIVATE_VIEWONCE_ENABLED === true/);
  assert.match(js, /if \(viewOnce && privateViewOnceEnabled\(\)\) return sendPrivateViewOnceItem/);
  assert.doesNotMatch(js, /if \(viewOnce && !privateViewOnceEnabled\(\)\)/);
  assert.match(js, /async function sendPrivateViewOnceItem\(/);
  assert.match(js, /sb\.functions\.invoke\('chat-private-upload'/);
  assert.match(js, /sb\.functions\.invoke\('view-once-open'/);
});
test('private sending uploads first and never creates an early database message', () => {
  const section = js.slice(js.indexOf('async function sendPrivateViewOnceItem('),
    js.indexOf('function pushTemp(', js.indexOf('async function sendPrivateViewOnceItem(')));
  assert.match(section, /items\.length !== 1/);
  assert.match(section, /media_url: null/);
  assert.match(section, /media_urls: null/);
  assert.match(section, /private_asset: true/);
  assert.match(section, /form\.append\('conversation_id', convId\)/);
  assert.match(section, /data\?\.status !== 'published'/);
  assert.doesNotMatch(section, /\.from\('messages'\)\s*\.insert/);
});
test('private opening checks Blob response and revokes on viewer failure', () => {
  assert.match(js, /data instanceof Blob/);
  assert.match(js, /URL\.createObjectURL\(data\)/);
  assert.match(js, /URL\.revokeObjectURL\(localUrl\)/);
});

test('legacy view-once remains available while private rollout is disabled',()=>{
  assert.match(js,/viewOnce\s*\?\s*\(item\.kind === 'video' \? 'viewonce_video' : 'viewonce_image'\)/);
  assert.match(js,/if \(viewOnce && privateViewOnceEnabled\(\)\) return sendPrivateViewOnceItem/);
  assert.match(js,/items\.map\(\(item, index\) =>/);
  assert.match(js,/openViewOnceConfirm\('\$\{msg\.id\}',\$\{index\}\)/);
});

test('legacy multi-item chip renderer keeps individual indexes and opened state', () => {
  const start = js.indexOf('    function renderViewOnceChip(msg) {');
  const end = js.indexOf('    window.openMixedMedia = function', start);
  assert.ok(start > 0 && end > start);
  const build = new Function('msg', 'getConsumedIndicesForMsg',
    'currentUserId', 'privateViewOnceEnabled', 'captionHtml', 'window',
    js.slice(start, end) + '\nreturn renderViewOnceChip(msg);');
  const msg = {
    id: 'review-test', sender_id: 'sender', text: '',
    metadata: { view_once: true, media_items: [
      { type: 'image', url: 'https://example.invalid/one.jpg' },
      { type: 'video', url: 'https://example.invalid/two.mp4' }
    ] }
  };
  const htmlResult = build(msg, () => new Set([0]), 'recipient',
    () => false, () => '', {});
  assert.match(htmlResult, /Opened 1 of 2/);
  assert.match(htmlResult, /Video 2 of 2/);
  assert.match(htmlResult, /openViewOnceConfirm\('review-test',1\)/);
  assert.doesNotMatch(htmlResult, /openViewOnceConfirm\('review-test',0\)/);
  const disabledPrivate = build({
    ...msg, metadata: { ...msg.metadata, private_asset: true }
  }, () => new Set(), 'recipient', () => false, () => '', {});
  assert.doesNotMatch(disabledPrivate, /onclick=/);
});
