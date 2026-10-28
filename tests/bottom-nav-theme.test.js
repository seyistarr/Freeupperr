import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

// Use real page styles and the shared components, isolating backend/account work.
test('bottom navigation follows persisted themes, live switches and page navigation', { timeout: 120000 }, async () => {
  const pages = [];
  for (const name of await readdir('.')) {
    if (name.endsWith('.html') && (await readFile(name, 'utf8')).includes('bottom-nav.css')) pages.push(name);
  }
  for (const required of ['index.html', 'profile.html', 'search.html', 'video.html']) assert.ok(pages.includes(required));
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://local').pathname;
    try {
      let body = await readFile('.' + path, 'utf8');
      if (path.endsWith('.html')) {
        body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, script =>
          /src=["']\/?(?:theme|bottom-nav)\.js(?:\?[^"']*)?["']/.test(script) ? script : '');
        body = body.replace(/<link\b[^>]*https:[^>]*>/gi, '');
      }
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ ...(process.env.FREEUPPER_CHROMIUM ? { executablePath: process.env.FREEUPPER_CHROMIUM } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    async function check(theme) {
      await page.waitForFunction(() => !!document.querySelector('.bottom-nav .nav-item'));
      const result = await page.evaluate(() => {
        const nav = document.querySelector('.bottom-nav');
        const probe = document.createElement('div');
        nav.append(probe);
        const token = (name, property = 'color') => { probe.style[property] = `var(${name})`; return getComputedStyle(probe)[property]; };
        const style = getComputedStyle(nav);
        const active = nav.querySelector('.nav-item.active');
        const inactive = nav.querySelector('.nav-item:not(.active)');
        const result = {
          theme: document.documentElement.dataset.theme,
          background: style.backgroundColor, expectedBackground: token('--navbg', 'backgroundColor'),
          label: getComputedStyle(inactive.querySelector('span')).color, muted: token('--muted'),
          icon: getComputedStyle(inactive.querySelector('svg')).stroke,
          activeLabel: active && getComputedStyle(active.querySelector('span')).color,
          activeIcon: active?.querySelector('svg') && getComputedStyle(active.querySelector('svg')).stroke,
          purple: token('--p'), height: nav.getBoundingClientRect().height,
          extension: getComputedStyle(nav, '::after').backgroundColor,
        };
        probe.remove(); return result;
      });
      assert.equal(result.theme, theme);
      assert.equal(result.background, result.expectedBackground, page.url());
      assert.equal(result.extension, result.expectedBackground);
      assert.equal(result.label, result.muted);
      assert.equal(result.icon, result.muted);
      if (result.activeLabel) assert.equal(result.activeLabel, result.purple);
      if (result.activeIcon) assert.equal(result.activeIcon, result.purple);
      assert.equal(result.height, 64);
    }
    for (const theme of ['dark', 'light']) {
      await context.addInitScript(value => localStorage.setItem('freeupper_theme', value), theme);
      for (const path of pages) {
        await page.goto(`${origin}/${path}`);
        await check(theme);
        await page.waitForFunction(() => !document.documentElement.classList.contains('theme-initializing'));
        await page.evaluate(() => window.navigationMarker = true);
        await page.evaluate(() => toggleTheme());
        await page.waitForTimeout(350);
        await check(theme === 'dark' ? 'light' : 'dark');
        assert.equal(await page.evaluate(() => window.navigationMarker), true);
        await page.evaluate(() => toggleTheme());
        await page.waitForTimeout(350);
        await check(theme);
      }
    }
    // Real anchor navigation retains storage preference and selects the new tab.
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await fresh.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const linked = await fresh.newPage();
    for (const theme of ['light', 'dark']) {
      await linked.goto(`${origin}/index.html`);
      await linked.evaluate(value => applyTheme(value), theme);
      for (const key of ['search', 'video', 'profile', 'home']) {
        await linked.locator(`[data-nav-key="${key}"]`).click();
        await linked.waitForFunction(value => document.documentElement.dataset.theme === value && !!document.querySelector('.nav-item.active'), theme);
        assert.equal(await linked.locator('.nav-item.active').getAttribute('data-nav-key'), key);
        assert.equal(await linked.locator('.bottom-nav').evaluate(el => getComputedStyle(el).backgroundColor), await linked.locator('.bottom-nav').evaluate(el => { const probe = document.createElement('div'); el.append(probe); probe.style.backgroundColor = 'var(--navbg)'; const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; }));
      }
    }
    // Cross-tab updates and bfcache-style restores use the shared controller.
    const other = await fresh.newPage();
    await other.goto(`${origin}/search.html`);
    await linked.evaluate(() => applyTheme('light'));
    await other.waitForFunction(() => getCurrentTheme() === 'light');
    await other.waitForTimeout(350);
    assert.equal(await other.locator('.bottom-nav').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(242, 242, 247, 0.97)');
    await other.evaluate(() => { localStorage.setItem('freeupper_theme', 'dark'); window.dispatchEvent(new Event('pageshow')); });
    await other.waitForTimeout(350);
    assert.equal(await other.locator('.bottom-nav').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0.97)');
    await other.reload();
    assert.equal(await other.evaluate(() => getCurrentTheme()), 'dark');
    await other.setViewportSize({ width: 1024, height: 768 });
    assert.equal(await other.locator('.bottom-nav').evaluate(el => getComputedStyle(el).display), 'none');
    await fresh.close();
    await context.close();
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
