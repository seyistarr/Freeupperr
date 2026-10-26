import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const renderSource = html.match(/function buildReactionButton\(postId\) \{[\s\S]*?\n            \}/)?.[0];
assert.ok(renderSource, 'reaction renderer must be present');
function render(post) {
  const context = { appData: { posts: [post] }, formatCount: String, svgHeart: () => '<svg></svg>' };
  vm.createContext(context);
  vm.runInContext(renderSource + '\nthis.renderButton = buildReactionButton;', context);
  return context.renderButton(post.id);
}
test('a shared post without reaction enrichment renders zero likes', () => {
  assert.match(render({ id: 'shared' }), /reaction-count">0</);
});
test('enriched shared post keeps its real count and liked state', () => {
  const result = render({ id: 'shared', reactions: { like: 3 }, likedByMe: true });
  assert.match(result, /reaction-count">3</);
  assert.match(result, /reaction-btn reacted/);
});
const loaded = html.match(/onloadeddata="([^"]*video-loading-overlay[^\"]*)"/)?.[1];
assert.ok(loaded, 'video loading handler must be present');
const onLoaded = new Function(loaded);
test('video load callback tolerates absent wrapper', () => {
  assert.doesNotThrow(() => onLoaded.call({ closest: () => null }));
});
test('video load callback still hides a present loading overlay', () => {
  let hidden = false;
  onLoaded.call({ closest: () => ({ querySelector: () => ({ classList: { add(value) { hidden = value === 'hide'; } } }) }) });
  assert.equal(hidden, true);
});
