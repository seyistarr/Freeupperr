// Browser-only acceptance smoke against actual FreeUpper chat markup and handlers.
// No authentication, network, database writes, or production deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const [html, js] = await Promise.all([
  readFile('chat.html', 'utf8'), readFile('chat.js', 'utf8')
]);
function requireFragment(pattern, label) {
  const m = html.match(pattern);
  assert.ok(m, 'Missing production HTML fragment: ' + label);
  return m[0];
}
// Use the real page's inline styles, rather than a replacement UI stylesheet.
const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  .map(m => m[1]).join('\n');
const tabs = requireFragment(/<div class="cl-tabs" id="clTabs"[\s\S]*?<\/div>/, 'chat tabs');
const search = requireFragment(/<div class="search-box" id="sbSearchBox">[\s\S]*?<\/div>/, 'chat search');
const newActions = requireFragment(/<div class="nm-actions">[\s\S]*?<\/div>/, 'New Message actions');
const header = requireFragment(/<header class="chat-header">[\s\S]*?<\/header>/, 'chat header');
const sidebarTop = requireFragment(/<div class="sidebar-top">[\s\S]*?<button[\s\S]*?<\/button><\/div>/, 'sidebar title and New button');
const tabStart = js.indexOf('    const TAB_META = {');
const tabEnd = js.indexOf('    function isIncomingRequest(', tabStart);
const switchStart = js.indexOf('    window.setChatTab = function(tab)');
const switchEnd = js.indexOf('    function updateChatTabCounts()', switchStart);
assert.ok(tabStart >= 0 && tabEnd > tabStart && switchStart >= 0 && switchEnd > switchStart);
const productionHandlers = js.slice(tabStart, tabEnd) + '\n' + js.slice(switchStart, switchEnd);
const markup = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
  '<style>' + inlineStyles + '</style><body>' + header + '<div class="conversations-sidebar">' + sidebarTop +
  tabs + search + '<div id="conversationList"></div>' +
  '<div id="newChatModal" class="mfs" style="position:static;visibility:visible;opacity:1;transform:none;z-index:auto"><h2>New Message</h2>' + newActions +
  '<div id="userSearchResults" class="fs-list"></div></div></div></body></html>';
const harness = `
  const convSearch = document.getElementById('convSearch');
  const convList = document.getElementById('conversationList');
  let chatTab = 'all';
  window.__renders = [];
  function renderConversations(query) { window.__renders.push({tab: chatTab, query}); }
  window.__action = '';
  window.openCreateGroupModal = () => { window.__action = 'group'; };
  window.openOrCreateFreeUpperNote = () => { window.__action = 'note'; };
` + productionHandlers;

async function withPage(viewport, callback, reducedMotion = 'no-preference') {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.FREEUPPER_CHROMIUM || undefined, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport, reducedMotion });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(markup, { waitUntil: 'load' });
    await page.addScriptTag({ content: harness });
    await callback(page);
    assert.deepEqual(errors, [], 'Production handlers must not throw browser errors');
  } finally {
    await browser.close();
  }
}

for (const [label, viewport] of [
  ['iPhone-sized', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 800 }]
]) {
  test('premium chat tabs and search visibility: ' + label, async () => {
    await withPage(viewport, async page => {
      assert.equal(await page.locator('#sbSearchBox').isVisible(), true);
      assert.equal(await page.locator('#hdrSearch').isVisible(), true);
      assert.equal(await page.locator('#hdrBack').isVisible(), false);
      await page.locator('[data-tab="unread"]').click();
      assert.equal(await page.locator('#hdrSearch').isVisible(), false);
      assert.equal(await page.locator('#newBtn').isVisible(), false);
      assert.equal(await page.locator('#hdrBack').isVisible(), true);
      assert.equal(await page.locator('#sbSearchBox').isVisible(), false);
      assert.equal(await page.locator('#sbTitle').textContent(), 'Unread Messages');
      await page.locator('[data-tab="groups"]').click();
      assert.equal(await page.locator('#sbSearchBox').isVisible(), true);
      assert.equal(await page.locator('#newBtn').isVisible(), false);
      assert.equal(await page.locator('#convSearch').getAttribute('placeholder'), 'Search groups...');
      await page.locator('[data-tab="requests"]').click();
      assert.equal(await page.locator('#sbSearchBox').isVisible(), false);
      assert.equal(await page.locator('#sbTitle').textContent(), 'Message Requests');
      await page.locator('[data-tab="all"]').click();
      assert.equal(await page.locator('#sbSearchBox').isVisible(), true);
      assert.equal(await page.locator('#newBtn').isVisible(), true);
      const details = await page.evaluate(() => ({
        selected: [...document.querySelectorAll('#clTabs [aria-selected="true"]')].map(x => x.dataset.tab),
        renders: window.__renders
      }));
      assert.deepEqual(details.selected, ['all']);
      assert.deepEqual(details.renders.map(x => x.tab), ['unread','groups','requests','all']);
    });
  });

  test('new-message actions persist through search replacement: ' + label, async () => {
    await withPage(viewport, async page => {
      assert.equal(await page.locator('#newChatModal .nm-card').count(), 2);
      await page.evaluate(() => {
        document.querySelector('#userSearchResults').innerHTML =
          '<div class="u-row">Search result A</div><div class="u-row">Search result B</div>';
      });
      assert.equal(await page.locator('#newChatModal .nm-card').count(), 2);
      assert.equal(await page.getByText('New Group', { exact: true }).count(), 1);
      assert.equal(await page.getByText('My Note', { exact: true }).count(), 1);
      await page.getByText('New Group', { exact: true }).click();
      assert.equal(await page.evaluate(() => window.__action), 'group');
      await page.getByText('My Note', { exact: true }).click();
      assert.equal(await page.evaluate(() => window.__action), 'note');
    });
  });
}
test('reduced-motion browser can activate tabs without errors', async () => {
  await withPage({ width: 390, height: 844 }, async page => {
    await page.locator('[data-tab="unread"]').click();
    await page.locator('[data-tab="requests"]').click();
    assert.equal(await page.locator('#sbSearchBox').isVisible(), false);
  }, 'reduce');
});

test('3D chat cards stay in reading order without overlap on mobile', async () => {
  await withPage({ width: 390, height: 844 }, async page => {
    await page.evaluate(() => {
      const host = document.querySelector('#conversationList');
      host.style.height = '450px';
      host.style.overflowY = 'auto';
      host.innerHTML = Array.from({length: 6}, (_,i) =>
        '<div class="conv-swipe-wrap" style="--rx:2deg;--tz:0px;--sc:1">' +
        '<div class="conv-item"><strong>Chat ' + (i+1) + '</strong></div></div>'
      ).join('');
    });
    const geometry = await page.locator('.conv-swipe-wrap').evaluateAll(elements =>
      elements.map(e => {
        const r = e.getBoundingClientRect();
        return { top:r.top, bottom:r.bottom, height:r.height };
      })
    );
    assert.equal(geometry.length, 6);
    for(let i = 1; i < geometry.length; i++) {
      assert.ok(geometry[i].top >= geometry[i-1].bottom - 1,
        'Conversation cards must remain ordered and non-overlapping');
    }
  });
});


test('current production header retains contextual back/search controls and signed-in avatar', () => {
  assert.match(header, /id="hdrBack"[^>]+onclick="setChatTab\('all'\)"/);
  assert.match(header, /id="hdrSearch"[^>]+onclick="focusSidebarSearch\(\)"/);
  assert.match(header, /id="myHeaderAvatar"[^>]+alt="My profile photo"/);
  assert.match(js, /headerAvatar\.src = currentUserProfile\.avatar_url/);
  assert.match(js, /user\.user_metadata\?\.avatar_url/);
  assert.match(html, /id="sbSearchBox"/);
});
test('New Message renders one pair of shortcut actions and no duplicate search rows', () => {
  const modal = html.slice(html.indexOf('<div class="mfs" id="newChatModal">'),
    html.indexOf('<div class="fu-screen" id="createGroupModal">'));
  assert.equal((modal.match(/class="nm-card"/g) || []).length, 2);
  assert.equal((modal.match(/>New Group<\/b>/g) || []).length, 1);
  assert.equal((modal.match(/>My Note<\/b>/g) || []).length, 1);
  const render = js.slice(js.indexOf('    function renderUserSearchDefault()'),
    js.indexOf('    function userRowHtml(', js.indexOf('    function renderUserSearchDefault()')));
  assert.doesNotMatch(render, /openCreateGroupModal\(|openOrCreateFreeUpperNote\(/);
  assert.match(html, /chat\.js\?v=chat-ui-scroll-v2/);
});
test('Archive reuses themed, ordered, independent 3D conversation cards', async () => {
  assert.match(html, /#fuArchivedModal \.conv-swipe-wrap\{/);
  assert.match(html, /#fuArchivedModal \.conv-item\{/);
  assert.match(html, /#fuArchivedModal\{background:linear-gradient/);
  assert.match(js, /const updateArchived3D = \(\) => \{/);
  await withPage({width:390,height:844}, async page => {
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = 'fuArchivedModal';
      el.innerHTML = '<div class="fu-body">' + Array.from({length:4}, (_,i) =>
        '<div class="conv-swipe-wrap"><div class="conv-item">Archived ' + i +
        '</div></div>').join('') + '</div>';
      document.body.appendChild(el);
    });
    const positions = await page.locator('#fuArchivedModal .conv-item').evaluateAll(nodes =>
      nodes.map(el => {const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom};})
    );
    assert.equal(positions.length,4);
    for(let i=1;i<positions.length;i++)
      assert.ok(positions[i].top >= positions[i-1].bottom - 1,
        'Archived cards must remain individually ordered and non-overlapping');
  });
});


test('unread count is beside the caret rather than the display name', () => {
  assert.match(js, /<div class="conv-name">\$\{pinIcon\}<span class="conv-display-name">/);
  assert.match(js, /<div class="conv-actions-inline">\s*\$\{unreadDot\}\s*<button class="conv-more-btn"/);
  assert.match(html, /\.conv-item \.conv-actions-inline/);
});
test('New Message results use scrollable individual 3D cards', async () => {
  assert.match(js, /function updateNewMessage3D\(\)/);
  assert.match(js, /newMessageList\?\.addEventListener\('scroll', scheduleNewMessage3D/);
  await withPage({width:390,height:844}, async page => {
    await page.evaluate(() => {
      const list=document.getElementById('userSearchResults');
      list.style.height='350px';list.style.flex='none';
      list.innerHTML=Array.from({length:12},(_,i)=>'<div class="u-row"><span>Friend '+i+'</span></div>').join('');
    });
    const result=await page.locator('#userSearchResults').evaluate(list=>{
      const rows=[...list.querySelectorAll('.u-row')];
      return {overflow:getComputedStyle(list).overflowY,scrollHeight:list.scrollHeight,height:list.clientHeight,
        bounds:rows.map(e=>{let r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom};})};
    });
    assert.equal(result.overflow,'auto');
    assert.ok(result.scrollHeight>result.height);
    for(let i=1;i<result.bounds.length;i++)assert.ok(result.bounds[i].top>=result.bounds[i-1].bottom-1);
    await page.locator('#userSearchResults').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.ok(await page.locator('#userSearchResults').evaluate(el=>el.scrollTop)>0);
  });
});
