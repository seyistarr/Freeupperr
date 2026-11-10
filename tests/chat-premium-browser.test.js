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
const tabs = requireFragment(/<div class="cl-tabs" id="clTabs"[\s\S]*?<\/div>/, 'chat tabs');
const search = requireFragment(/<div class="search-box" id="sbSearchBox">[\s\S]*?<\/div>/, 'chat search');
const newActions = requireFragment(/<div class="nm-actions">[\s\S]*?<\/div>/, 'New Message actions');
const tabStart = js.indexOf('    const TAB_META = {');
const tabEnd = js.indexOf('    function isIncomingRequest(', tabStart);
const switchStart = js.indexOf('    window.setChatTab = function(tab)');
const switchEnd = js.indexOf('    function updateChatTabCounts()', switchStart);
assert.ok(tabStart >= 0 && tabEnd > tabStart && switchStart >= 0 && switchEnd > switchStart);
const productionHandlers = js.slice(tabStart, tabEnd) + '\n' + js.slice(switchStart, switchEnd);
const markup = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
  '<body><div id="sbTitle">Messages</div><p id="sbSub">Your conversations</p>' +
  tabs + search + '<div id="conversationList"></div>' +
  '<div id="newChatModal"><h2>New Message</h2>' + newActions +
  '<div id="userSearchResults"></div></div></body></html>';
const harness = \`
  const convSearch = document.getElementById('convSearch');
  const convList = document.getElementById('conversationList');
  let chatTab = 'all';
  window.__renders = [];
  function renderConversations(query) { window.__renders.push({tab: chatTab, query}); }
  window.__action = '';
  window.openCreateGroupModal = () => { window.__action = 'group'; };
  window.openOrCreateFreeUpperNote = () => { window.__action = 'note'; };
\` + productionHandlers;

async function withPage(viewport, callback, reducedMotion = 'no-preference') {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport, reducedMotion });
    await page.setContent(markup, { waitUntil: 'load' });
    await page.addScriptTag({ content: harness });
    await callback(page);
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
      await page.locator('[data-tab="unread"]').click();
      assert.equal(await page.locator('#sbSearchBox').isVisible(), false);
      assert.equal(await page.locator('#sbTitle').textContent(), 'Unread Messages');
      await page.locator('[data-tab="groups"]').click();
      assert.equal(await page.locator('#sbSearchBox').isVisible(), true);
      assert.equal(await page.locator('#convSearch').getAttribute('placeholder'), 'Search groups...');
      await page.locator('[data-tab="requests"]').click();
      assert.equal(await page.locator('#sbSearchBox').isVisible(), false);
      assert.equal(await page.locator('#sbTitle').textContent(), 'Message Requests');
      await page.locator('[data-tab="all"]').click();
      assert.equal(await page.locator('#sbSearchBox').isVisible(), true);
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
