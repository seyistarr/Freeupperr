import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStagingAsset } from '../lib/protected-media/verify-staging-asset.js';

const publicId = 'freeupper-privacy-v2-staging/asset_' + 'a'.repeat(32);
const assetId = 'b'.repeat(32);
const valid = { asset_id: assetId, public_id: publicId, resource_type: 'image', type: 'authenticated', bytes: 1024, format: 'jpg' };
const check = (asset, overrides = {}) => verifyStagingAsset({ asset, expectedPublicId: publicId, expectedAssetId: assetId, expectedResourceType: 'image', ...overrides });

test('accepts matching authenticated staging asset metadata', () => assert.equal(check(valid), true));
for (const [label, asset] of [
  ['unsigned public delivery', { ...valid, type: 'upload' }],
  ['wrong asset ID', { ...valid, asset_id: 'c'.repeat(32) }],
  ['wrong public ID', { ...valid, public_id: 'other/asset_' + 'a'.repeat(32) }],
  ['wrong resource type', { ...valid, resource_type: 'video' }],
  ['zero bytes', { ...valid, bytes: 0 }],
  ['oversized asset', { ...valid, bytes: 51 * 1024 * 1024 }],
  ['deleted asset', { ...valid, deleted: true }],
  ['public access mode', { ...valid, access_mode: 'public' }],
  ['invalid format', { ...valid, format: '../jpg' }],
  ['missing metadata', null]
]) test('rejects ' + label, () => assert.equal(check(asset), false));

test('rejects a public ID outside the staging namespace', () => {
  assert.equal(check(valid, { expectedPublicId: 'outside/asset_' + 'a'.repeat(32) }), false);
});
test('rejects unrecognized media type', () => {
  assert.equal(check(valid, { expectedResourceType: 'raw' }), false);
});
