import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const posts = read('posts.js');

for (const page of ['create.html', 'studio.html']) {
  test(page + ' defaults to public and disables restricted audiences', () => {
    const html = read(page);
    const selectId = page === 'create.html' ? 'postVisibility' : 'studioVisibility';
    const select = html.match(new RegExp('<select[^>]+id="' + selectId + '"[^>]*>([\\s\\S]*?)<\\/select>'));
    assert.ok(select, 'Audience selector exists');
    assert.match(select[1], /<option value="public">Everyone<\/option>/);
    for (const audience of ['followers', 'friends', 'only_me']) {
      assert.match(select[1], new RegExp('<option value="' + audience + '" disabled>'));
    }
  });
}

test('post creation rejects restricted visibility before writing to posts table', () => {
  const createStart = posts.indexOf('async function createPost(');
  assert.ok(createStart >= 0, 'createPost exists');
  const insert = posts.indexOf(".insert(payload)", createStart);
  const gate = posts.indexOf("if (payload.visibility !== 'public')", createStart);
  assert.ok(gate > createStart && gate < insert, 'Fail-closed gate precedes insert');
});

test('legacy visibility changes reject restricted audiences before database update', () => {
  const start = posts.indexOf('async function updatePostVisibility(');
  assert.ok(start >= 0);
  const end = posts.indexOf(".update({ visibility })", start);
  const gate = posts.indexOf("if (visibility !== 'public')", start);
  assert.ok(gate > start && gate < end, 'Fail-closed gate precedes update');
});
