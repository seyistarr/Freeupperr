import test from 'node:test';
import assert from 'node:assert/strict';
import { publicName, publicHandle, redactEmails } from '../lib/profile-seo-privacy.js';

test('email addresses never become profile names or handles', () => {
  assert.equal(publicName('person@example.com'), 'FreeUpper Member');
  assert.equal(publicHandle('person@example.com'), '');
  assert.equal(redactEmails('Contact person@example.com'), 'Contact [email removed]');
});

test('custom names remain intact', () => {
  assert.equal(publicName('A FreeUpper Creator'), 'A FreeUpper Creator');
  assert.equal(publicHandle('creator_123'), 'creator_123');
});

test('missing profile names get a generic label', () => {
  assert.equal(publicName(null), 'FreeUpper Member');
  assert.equal(publicName('  '), 'FreeUpper Member');
});
