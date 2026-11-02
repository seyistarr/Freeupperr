import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

test('local Worker navigation scripts support legacy pages without the new head dependency', {
  skip: !process.env.FREEUPPER_TEST_ORIGIN, timeout: 30000
}, async () => {
  const origin = process.env.FREEUPPER_TEST_ORIGIN;
  const browser = await chromium.launch({ executablePath: process.env.FREEUPPER_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Simulate an already-open legacy HTML document. Scripts still come from
    // the actual workerd asset binding, using pre-migration version queries.
    await page.route(origin + '/index.html', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><html><head></head><body><bottom-nav></bottom-nav></body></html>'
    }));
    await page.goto(origin + '/index.html');
    await page.addScriptTag({ url: origin + '/profile-shell.js?v=five-tabs-v2' });
    assert.equal(await page.evaluate(() => FreeUpperProfileShell.getActive()), 'home');
    await page.addScriptTag({ url: origin + '/router.js?v=five-tabs-v1' });
    await page.addScriptTag({ url: origin + '/bottom-nav.js?v=five-tabs-v2' });
    assert.equal(await page.evaluate(() => Router.getCurrentPage()), 'index.html');
    assert.equal(await page.locator('[data-nav-key=video]').getAttribute('href'), '/videos');
    assert.equal(await page.locator('[aria-current=page]').getAttribute('data-nav-key'), 'home');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
