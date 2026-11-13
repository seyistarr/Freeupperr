// Execute current production chat functions with a disposable in-memory query
// adapter. No Auth calls, network requests or production writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync('chat.js', 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Production chat function boundary missing: ' + start);
  return source.slice(a, b);
}
const functions = [
  section('    function getDisplayName(', '    function mediaLabel('),
  section('    async function loadConversations()', '    // Review-branch tab navigation:'),
  section('    window.selectConversation =', '    function renderPartnerStatus('),
  section('    async function deleteConversationForMe(', "    convList.addEventListener('touchstart'"),
  section('    window.startConversationWith =', '    // ═══════════════════════════════════════════════════════════════════'),
  section('    function userRowHtml(', '    window.onUserSearchInput =')
].join('\n');

function fixture() {
  const profiles = [
    { id: 'b', username: 'fu111111111111', display_name: 'FreeUpper User' },
    { id: 'c', username: 'custom_handle', display_name: 'Custom Public Name' }
  ];
  const rows = [
    { id: 'default-dm', user1_id: 'a', user2_id: 'b', messages: [], hidden_by: [] },
    { id: 'custom-dm', user1_id: 'a', user2_id: 'c', messages: [], hidden_by: [] },
    { id: 'hidden-dm', user1_id: 'a', user2_id: 'd', messages: [], hidden_by: ['a'] }
  ];
  const tables = { profiles, conversations: rows, conversation_members: [] };
  const calls = [], events = [], nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { innerHTML: '', textContent: '', value: '', dataset: {}, disabled: false,
        classList: {
          add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
          toggle(x, force) { const on = force ?? !classes.has(x); on ? classes.add(x) : classes.delete(x); }
        }, focus() {} });
    }
    return nodes.get(id);
  }
  const sb = { from(table) {
    let mode = 'select', payload, filters = [];
    const query = {
      select() { return this; }, order() { return this; }, or() { return this; },
      eq(k, v) { filters.push(row => row[k] === v); return this; },
      in(k, values) { filters.push(row => values.includes(row[k])); return this; },
      insert(value) { mode = 'insert'; payload = value; return this; },
      update(value) { mode = 'update'; payload = value; return this; },
      async result(single = false) {
        calls.push({ table, mode, payload });
        let data = (tables[table] || []).filter(row => filters.every(f => f(row)));
        if (mode === 'insert') {
          data = [{ ...payload, id: 'new-dm', messages: [], hidden_by: [] }];
          tables[table].push(data[0]);
        } else if (mode === 'update') {
          data.forEach(row => Object.assign(row, payload));
        }
        return { data: single ? data[0] ?? null : data, error: null };
      },
      single() { return this.result(true); }, maybeSingle() { return this.result(true); },
      then(resolve, reject) { return this.result().then(resolve, reject); }
    };
    return query;
  } };
  const ctx = {
    currentUserId: 'a', conversations: [], selectedConversationId: null, selectedPartnerId: null,
    chatSearch: { open: false }, isBlockedConversation: false, canSendMessages: true,
    currentUserProfile: profiles[0], DEFAULT_AVATAR: 'avatar', DEFAULT_GROUP_AVATAR: 'group-avatar',
    sb, console, innerWidth: 390, fuT: x => x,
    document: { getElementById: node, createElement() {
      let value = '';
      return { set textContent(text) { value = String(text); },
        get innerHTML() { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } };
    } },
    getAvatar: p => p.avatar_url || 'avatar', getVerifiedBadge: () => '', avatarErrAttr: () => '',
    isUserOnline: () => false,
    escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    setChatHeaderName: (name) => { node('chatPartnerName').innerHTML = '<span class="cpn-text">' + name + '</span>'; },
    renderConversations: () => events.push('render'),
    loadGroupMemberCounts: async () => {},
    getBlockStatus: async () => ({ blocked: false }),
    canSendInConversation: async () => true,
    loadMessages: async id => events.push('messages:' + id),
    setupTypingChannel: async id => events.push('typing:' + id),
    applyChatBackground() {}, applyBubbleColor() {}, getMyBubbleColor() {}, renderTypingIndicator() {},
    emptyChatIllustration: () => '', renderPinnedBar() {}, renderPartnerStatus() {},
    populateGroupHeaderSubtitle() {}, closeChatSearch() {},
    closeNewChatModal: () => events.push('close-new'),
    closeChatView: () => { ctx.selectedConversationId = null; events.push('close-chat'); },
    showToast: message => events.push('toast:' + message)
  };
  for (const name of ['chatPartnerName', 'chatPartnerAvatar', 'chatPartnerStatus', 'messagesArea',
    'messageInputArea', 'messageInput', 'sendBtn', 'convSearch']) ctx[name] = node(name);
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(functions, ctx);
  return { ctx, tables, calls, events, node };
}

test('chat list reload keeps UUID relationships and both default/custom names; hidden chats stay hidden', async () => {
  const f = fixture();
  await f.ctx.loadConversations();
  assert.equal(f.ctx.conversations.length, 2);
  assert.equal(f.ctx.conversations[0].otherUser.id, 'b');
  assert.equal(f.ctx.conversations[0].otherUser.display_name, 'FreeUpper User');
  assert.equal(f.ctx.conversations[1].otherUser.username, 'custom_handle');
  assert.equal(f.ctx.conversations[1].otherUser.display_name, 'Custom Public Name');
  assert.ok(f.calls.every(c => c.mode === 'select'));
});

test('individual conversation restoration uses the same UUID and current profile display name', async () => {
  const f = fixture();
  await f.ctx.loadConversations();
  await f.ctx.selectConversation('default-dm');
  assert.equal(f.ctx.selectedPartnerId, 'b');
  assert.equal(f.node('chatPartnerName').innerHTML, '<span class="cpn-text">FreeUpper User</span>');
  await f.ctx.selectConversation('custom-dm');
  assert.equal(f.ctx.selectedConversationId, 'custom-dm');
  assert.equal(f.node('chatPartnerName').innerHTML, '<span class="cpn-text">Custom Public Name</span>');
  assert.ok(f.events.includes('messages:custom-dm'));
  assert.ok(f.events.includes('typing:custom-dm'));
  assert.ok(f.calls.every(c => c.mode === 'select'));
});

test('New Message reopens an existing conversation without another conversation/profile insert', async () => {
  const f = fixture();
  await f.ctx.loadConversations();
  await f.ctx.startConversationWith('b');
  assert.equal(f.ctx.selectedConversationId, 'default-dm');
  assert.ok(f.events.includes('close-new'));
  assert.equal(f.tables.conversations.length, 3);
  assert.ok(f.calls.every(c => c.mode === 'select'));
});

test('starting a new DM creates only UUID-based conversation data and leaves profile names intact', async () => {
  const f = fixture();
  await f.ctx.loadConversations();
  const names = JSON.stringify(f.tables.profiles);
  await f.ctx.startConversationWith('e');
  const write = f.calls.find(c => c.mode === 'insert');
  assert.equal(write.table, 'conversations');
  assert.equal(write.payload.user1_id, 'a');
  assert.equal(write.payload.user2_id, 'e');
  assert.equal(f.ctx.selectedConversationId, 'new-dm');
  assert.equal(JSON.stringify(f.tables.profiles), names);
  assert.ok(!f.calls.some(c => c.table === 'profiles' && c.mode !== 'select'));
});

test('deleting the selected chat hides it for this owner and preserves the conversation row and identities', async () => {
  const f = fixture();
  await f.ctx.loadConversations();
  f.ctx.selectedConversationId = 'custom-dm';
  const names = JSON.stringify(f.tables.profiles);
  await f.ctx.deleteConversationForMe('custom-dm');
  assert.equal(f.ctx.selectedConversationId, null);
  assert.equal(f.tables.conversations.length, 3);
  assert.ok(f.tables.conversations.find(c => c.id === 'custom-dm').hidden_by.includes('a'));
  await f.ctx.loadConversations();
  assert.ok(!f.ctx.conversations.some(c => c.id === 'custom-dm'));
  assert.equal(JSON.stringify(f.tables.profiles), names);
  assert.ok(f.calls.filter(c => c.mode !== 'select').every(c => c.table === 'conversations' && c.mode === 'update'));
});

test('chat search result rows render current names/handles and navigate by UUID', () => {
  const f = fixture();
  const initial = f.ctx.userRowHtml(f.tables.profiles[0], true);
  const custom = f.ctx.userRowHtml(f.tables.profiles[1], false);
  assert.match(initial, /FreeUpper User/);
  assert.match(initial, /@fu111111111111/);
  assert.match(initial, /startConversationWith\('b'\)/);
  assert.match(custom, /Custom Public Name/);
  assert.match(custom, /@custom_handle/);
  assert.match(custom, /startConversationWith\('c'\)/);
  assert.doesNotMatch(initial + custom, /@[^< ]+@/);
});
