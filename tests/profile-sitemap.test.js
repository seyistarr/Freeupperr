import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
const { default: handler } = await import('../api/sitemap-profiles.js');

async function renderSitemap(response) {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return response;
  };
  const headers = {};
  const res = {
    setHeader(k,v) { headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; }
  };
  try {
    await handler({ method: 'GET' }, res);
    return { res, headers, requestedUrl };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('sitemap requests only completed public unsuspended profiles', async () => {
  const { res, requestedUrl } = await renderSitemap({
    ok: true,
    json: async () => [{ freeupper_id: 'FU_GOOD' }]
  });
  const params = new URL(requestedUrl).searchParams;
  assert.equal(params.get('profile_setup_completed_at'), 'not.is.null');
  assert.equal(params.get('is_private'), 'eq.false');
  assert.equal(params.get('suspended'), 'eq.false');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /https:\/\/www\.freeupper\.com\/u\/FU_GOOD/);
});

test('invalid identifiers cannot enter the sitemap', async () => {
  const { res } = await renderSitemap({
    ok: true,
    json: async () => [{ freeupper_id: '<script>' }, { freeupper_id: 'FU_OK' }]
  });
  assert.doesNotMatch(res.body, /script/);
  assert.match(res.body, /FU_OK/);
});

test('database lookup failure returns 503, not an empty successful sitemap', async () => {
  const { res, headers } = await renderSitemap({ ok: false, status: 400 });
  assert.equal(res.statusCode, 503);
  assert.equal(headers['cache-control'], 'no-store');
});
