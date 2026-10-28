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
      window.soundRpcCalls = 0;
      window.fakeSettings = { likes: false, follows: true };
      window.sb = {
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { id: 'alice' } } } }) },
        async rpc(name, args) {
          window.soundRpcCalls++;
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
    await page.evaluate(() => {
      const original = window.FUSound.play;
      window.FUSound.play = (type, options) => {
        window.lastSoundTap = { active: navigator.userActivation.isActive, trusted: options?.event?.isTrusted === true };
        return original(type, options);
      };
    });
    const rpcCalls = await page.evaluate(() => window.soundRpcCalls);
    await page.locator('#notificationTestSound').click();
    await page.waitForFunction(() => document.getElementById('notificationTestResult').textContent.includes('Sound scheduled'));
    assert.deepEqual(await page.evaluate(() => window.lastSoundTap), { active: true, trusted: true });
    assert.equal(await page.evaluate(() => window.soundRpcCalls), rpcCalls, 'tap audio test must not query Supabase');
    assert.equal(await page.evaluate(() => window.FUSound.diagnostics().lastPlay.source), 'test-button');
    const label = page.locator('label.toggle:has(#notificationSoundsToggle)');
    await label.click();
    await page.waitForFunction(() => window.fakeSettings.sound === false && !document.getElementById('notificationSoundsToggle').disabled);
    assert.equal(await page.evaluate(() => window.FUSound.isEnabled()), false);
    await page.locator('#notificationTestSound').click();
    await page.waitForFunction(() => !document.getElementById('notificationTestSound').disabled);
    assert.equal(await page.evaluate(() => window.fakeSettings.sound), false, 'preview does not enable the saved preference');
    assert.equal(await page.evaluate(() => window.FUSound.diagnostics().lastPlay.scheduled), true);
    await label.click();
    await page.waitForFunction(() => window.fakeSettings.sound === true && !document.getElementById('notificationSoundsToggle').disabled);
    assert.equal(await page.evaluate(() => window.fakeSettings.likes), false);
    await page.waitForTimeout(200);
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
    const enginePage = await context.newPage();
    await enginePage.goto(origin + '/settings.html');
    await enginePage.evaluate(() => {
      window.sb = {
        auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { user: { id: 'engine-fixture' } } } }) },
        rpc: async () => ({ data: { notification_settings: { sound: true } } })
      };
      // Render the actual manager's graph to PCM. This proves non-silent samples,
      // without claiming that a physical device speaker produced audible output.
      window.AudioContext = class {
        constructor() { this.offline = new OfflineAudioContext(1, 44100, 44100); window.fixtureAudio = this; }
        get state() { return 'running'; }
        get currentTime() { return this.offline.currentTime; }
        get sampleRate() { return this.offline.sampleRate; }
        get destination() { return this.offline.destination; }
        resume() { return Promise.resolve(); }
        createBuffer(...args) { return this.offline.createBuffer(...args); }
        createBufferSource() { return this.offline.createBufferSource(); }
        createOscillator() { return this.offline.createOscillator(); }
        createGain() { return this.offline.createGain(); }
      };
    });
    await enginePage.addScriptTag({ url: origin + '/ui-sounds.js' });
    await enginePage.addScriptTag({ url: origin + '/settings.js' });
    await enginePage.waitForFunction(() => !document.getElementById('notificationTestSound').disabled);
    await enginePage.locator('#notificationTestSound').click();
    await enginePage.waitForFunction(() => window.FUSound.diagnostics().scheduled > 0);
    const waveform = await enginePage.evaluate(async () => {
      const buffer = await window.fixtureAudio.offline.startRendering();
      const samples = buffer.getChannelData(0);
      return { peak: Math.max(...samples.map(Math.abs)), nonzero: samples.some(value => Math.abs(value) > .001) };
    });
    assert.equal(waveform.nonzero, true);
    assert.ok(waveform.peak > .01 && waveform.peak < .08);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
