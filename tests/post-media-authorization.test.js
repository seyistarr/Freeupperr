import test from 'node:test';
import assert from 'node:assert/strict';
import { canViewProtectedMedia } from '../api/post-media-authorization.js';

const base = { viewerId: 'stranger', authorId: 'author', visibility: 'public', authorPrivate: false, authorSuspended: false, isDeleted: false, isHidden: false, followsAuthor: false, authorFollowsViewer: false };
const cases = [
  ['public stranger', {}, true],
  ['public anonymous', { viewerId: null }, true],
  ['private account stranger', { authorPrivate: true }, false],
  ['private account follower', { authorPrivate: true, followsAuthor: true }, true],
  ['followers stranger', { visibility: 'followers' }, false],
  ['followers accepted', { visibility: 'followers', followsAuthor: true }, true],
  ['mutuals one-way', { visibility: 'friends', followsAuthor: true }, false],
  ['mutuals both ways', { visibility: 'friends', followsAuthor: true, authorFollowsViewer: true }, true],
  ['only me stranger', { visibility: 'only_me', followsAuthor: true }, false],
  ['only me owner', { visibility: 'only_me', viewerId: 'author' }, true],
  ['deleted owner', { viewerId: 'author', isDeleted: true }, false],
  ['hidden owner', { viewerId: 'author', isHidden: true }, false],
  ['suspended author', { authorSuspended: true }, false],
  ['missing privacy state', { authorPrivate: undefined }, false],
  ['unknown audience', { visibility: 'invalid' }, false],
];
for (const [name, overrides, expected] of cases) {
  test(name, () => assert.equal(canViewProtectedMedia({ ...base, ...overrides }), expected));
}
