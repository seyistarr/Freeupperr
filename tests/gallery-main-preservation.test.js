import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import vm from 'node:vm';
// Immutable approved-main fingerprints work with Actions' shallow checkout.
const approved=JSON.parse(await readFile(new URL('./fixtures/gallery-main-baseline.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
test('approved authentication, identity, Chat, publishing and backend fingerprints remain intact',async()=>{
 // Only the explicitly reviewed chat assets and Chat UI workflow may supersede Gallery's original pins.
 assert.deepEqual(Object.keys(approved.chatUpgrade.files).sort(),['.github/workflows/chat-ui-release-checks.yml','chat.html','chat.js']);
 for(const [file,expected] of Object.entries(approved.files))assert.equal(sha(await readFile(file)),approved.chatUpgrade.files[file] || expected,file);
});
test('shared Home renderer is extracted exactly from current main',async()=>{
 const actual={};vm.runInNewContext(await readFile('post-card.js','utf8'),{window:actual});
 assert.equal(sha(actual.FreeUpperPostCard.render.toString()),approved.homeRendererSha256);
});
test('shared Video uses latest main CSS and DOM; Gallery changes are a separate context',async()=>{
 assert.equal(sha((await readFile('video-player.css','utf8')).trim()),approved.videoCssSha256);
 let markup;vm.runInNewContext(await readFile('video-shell.js','utf8'),{document:{body:{insertAdjacentHTML:(at,s)=>markup=s,hasAttribute:()=>false}}});assert.equal(sha(markup),approved.videoDomSha256);
 const player=await readFile('video-player.js','utf8');assert(player.includes('shortDisplayName'));assert(player.includes('shortUsername'));assert(player.includes("if (!galleryMode) await authorizeVideoMedia(videoEntries)"));
});
test('cache manifest preserves unrelated main pins and uses the reviewed chat cache upgrade',async()=>{
 const source=await readFile('service-worker.js','utf8');
 const urls=s=>Array.from(s.matchAll(/  '(\.\/[^']+)'/g),m=>m[1]);for(const url of approved.cacheUrls)assert(urls(source).includes(approved.chatUpgrade.cacheReplacements[url] || url),url);
 assert(!urls(source).includes('./chat.js?v=clean-urls-v1'));
 assert((await readFile('chat.html','utf8')).includes('chat.js?v=chat-security-v4'));
 assert(source.includes(approved.chatUpgrade.cacheName));
 for(const file of ['posts.js?v=notes-gallery-v1','foryou.js?v=author-header-v3-notes-gallery','post-card.js','inline-video.js','video-player.js','video-player.css','gallery-viewer.html'])assert(source.includes(file));
});
