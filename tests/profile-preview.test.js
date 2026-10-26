import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
const { default: handler } = await import('../api/profile-preview.js');

const profile = {
  freeupper_id: 'FU_TEST',
  is_private: false,
  username: 'person@example.com',
  display_name: 'person@example.com',
  bio: 'Contact person@example.com'
};

async function runPreview(eligibility) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('get_profile_by_freeupper_id')) {
      return { ok: true, json: async () => profile };
    }
    if (String(url).includes('get_public_profile_seo_status')) {
      return eligibility === 'error'
        ? { ok: false, status: 404 }
        : { ok: true, json: async () => eligibility };
    }
    throw new Error('Unexpected fetch');
  };
  const headers = {};
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; }
  };
  try {
    await handler({ headers: { 'user-agent': 'Twitterbot' }, query: { freeupper_id: 'FU_TEST' } }, res);
    return { res, headers, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('unverified profile stays shareable but anonymous and noindex', async () => {
  const { res, headers } = await runPreview(false);
  assert.equal(res.statusCode, 200);
  assert.match(headers['x-robots-tag'], /noindex/);
  assert.match(res.body, /FreeUpper Member/);
  assert.doesNotMatch(res.body, /person@example.com/);
  assert.doesNotMatch(res.body, /api\/profile-og\?/);
});

test('missing eligibility RPC fails closed', async () => {
  const { res, headers } = await runPreview('error');
  assert.equal(res.statusCode, 200);
  assert.match(headers['x-robots-tag'], /noindex/);
  assert.doesNotMatch(res.body, /person@example.com/);
});

test('verified profile remains indexable while emails are redacted', async () => {
  const { res, headers } = await runPreview(true);
  assert.equal(res.statusCode, 200);
  assert.equal(headers['x-robots-tag'], undefined);
  assert.doesNotMatch(res.body, /person@example.com/);
  assert.match(res.body, /api\/profile-og\?/);
});
