import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStagingRegistration } from '../lib/protected-media/verify-staging-registration.js';

const owner = 'b27b41f5-744a-475b-b538-4699ad4fa1d4';
const stranger = '8022bdf2-1e05-49e6-87e3-99bb2342007d';
const publicId = 'freeupper-privacy-v2-staging/' + owner + '/asset_' + 'a'.repeat(32);
const assetId = 'b'.repeat(32);
const post = { user_id: owner, visibility: 'followers', is_deleted: false, is_hidden: false };
const cloudinaryAsset = { public_id: publicId, asset_id: assetId, type: 'authenticated', resource_type: 'image', bytes: 1234, format: 'jpg' };
const valid = { viewerId: owner, post, cloudinaryAsset, expectedPublicId: publicId, expectedAssetId: assetId, resourceType: 'image' };
test('accepts owned protected media for a restricted post', () => assert.equal(verifyStagingRegistration(valid), true));
for (const [name, changes] of [
  ['stranger', { viewerId: stranger }],
  ['different owner', { post: { ...post, user_id: stranger } }],
  ['public post', { post: { ...post, visibility: 'public' } }],
  ['deleted post', { post: { ...post, is_deleted: true } }],
  ['hidden post', { post: { ...post, is_hidden: true } }],
  ['wrong folder', { expectedPublicId: 'freeupper-privacy-v2-staging/' + stranger + '/asset_' + 'a'.repeat(32) }],
  ['unsigned upload', { cloudinaryAsset: { ...cloudinaryAsset, type: 'upload' } }],
  ['different Cloudinary asset', { cloudinaryAsset: { ...cloudinaryAsset, asset_id: 'c'.repeat(32) } }],
  ['oversized asset', { cloudinaryAsset: { ...cloudinaryAsset, bytes: 51 * 1024 * 1024 } }],
  ['placeholder asset', { cloudinaryAsset: { ...cloudinaryAsset, placeholder: true } }],
  ['public access mode', { cloudinaryAsset: { ...cloudinaryAsset, access_mode: 'public' } }],
  ['deleted asset', { cloudinaryAsset: { ...cloudinaryAsset, deleted: true } }],
  ['raw resource', { resourceType: 'raw' }],
  ['missing post', { post: null }]
]) test('rejects ' + name, () => assert.equal(verifyStagingRegistration({ ...valid, ...changes }), false));
