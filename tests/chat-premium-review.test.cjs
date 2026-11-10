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
