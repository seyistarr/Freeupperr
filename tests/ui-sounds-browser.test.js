import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

test('Settings sounds toggle saves live, rolls back failures, and uses purple theme in light/dark modes', { timeout: 60000 }, async () => {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://local').pathname;
      let body = await readFile('.' + path, 'utf8');
      if (path.endsWith('.html')) {
        body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, script => /src=["']\/?theme\.js/.test(script) ? script : '');
        body = body.replace(/<link\b[^>]*https:[^>]*>/gi, '');
      }
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.FREEUPPER_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'] });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/settings.html');
    await page.evaluate(() => {
      window.fuT = key => key;
      window.AuthUser = { getCurrentUser: () => ({ id: 'alice', isLoggedIn: true }) };
      window.fakeSettings = { likes: false, follows: true };
      window.sb = {
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { id: 'alice' } } } }) },
        async rpc(name, args) {
          if (name === 'get_user_settings') return { data: { notification_settings: { ...window.fakeSettings } } };
          if (window.failSoundSave) { window.failSoundSave = false; return { error: Error('offline') }; }
          window.fakeSettings.sound = args.p_value === 'true';
          return { data: true };
        }
      };
    });
    await page.addScriptTag({ url: origin + '/ui-sounds.js' });
    await page.addScriptTag({ url: origin + '/settings.js' });
    await page.waitForFunction(() => !document.getElementById('notificationSoundsToggle').disabled);
    assert.equal(await page.locator('#notificationSoundsToggle').isChecked(), true);
    assert.equal(await page.evaluate(() => window.FUSound.play('like')), false, 'no audio before gesture');
    const label = page.locator('label.toggle:has(#notificationSoundsToggle)');
    await label.click();
    await page.waitForFunction(() => window.fakeSettings.sound === false && !document.getElementById('notificationSoundsToggle').disabled);
    assert.equal(await page.evaluate(() => window.FUSound.isEnabled()), false);
    await label.click();
    await page.waitForFunction(() => window.fakeSettings.sound === true && !document.getElementById('notificationSoundsToggle').disabled);
    assert.equal(await page.evaluate(() => window.fakeSettings.likes), false);
    assert.equal(await page.evaluate(() => window.FUSound.play('message')), true, 'real Web Audio runs after gesture');
    for (const theme of ['light', 'dark']) {
      const colors = await page.evaluate(theme => {
        window.applyTheme(theme);
        const track = document.querySelector('#notificationSoundsToggle + .track');
        const probe = document.createElement('span'); probe.style.color = 'var(--p)'; document.body.append(probe);
        const row = track.closest('.row');
        const result = { track: getComputedStyle(track).backgroundColor, purple: getComputedStyle(probe).color,
          title: getComputedStyle(row.querySelector('.r-title')).color, body: getComputedStyle(document.body).backgroundColor };
        probe.remove(); return result;
      }, theme);
      // Toggle background has an animation; let it settle before inspecting.
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#notificationSoundsToggle + .track').evaluate(el => getComputedStyle(el).backgroundColor), colors.purple);
      assert.notEqual(colors.title, colors.body);
    }
    await page.evaluate(() => { window.failSoundSave = true; });
    await label.click();
    await page.waitForFunction(() => document.getElementById('notificationSoundsError').textContent.includes('Could not save'));
    assert.equal(await page.locator('#notificationSoundsToggle').isChecked(), true);
    assert.equal(await page.evaluate(() => window.fakeSettings.sound), true);
    assert.equal(await page.locator('#notificationSoundsToggle').isDisabled(), false);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
