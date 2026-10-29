import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {postsFixture,id,source} from './helpers/quote-posts-api-fixture.js';
const contracts=JSON.parse(await readFile(new URL('./fixtures/quote-legacy-contracts.json',import.meta.url),'utf8'));
const outer=(n=200)=>({id:id(n),user_id:id(6),title:'Quote',content:'Comment',is_quote:true,quoted_post_id:id(100),visibility:'public',is_hidden:false,publishing_state:'published',repost_count:2,like_count:3,comment_count:4,share_count:5,bookmark_count:6,views:7});
const original={id:id(100),user_id:id(1),title:'Original',content:'Original content',visibility:'public',profiles:{id:id(1),username:'author'},media:[{type:'video',url:'https://example.com/movie.mp4',thumbnailUrl:'https://example.com/poster.jpg'}]};

test('closed client gate blocks publishing even if server is enabled',async()=>{
 const f=postsFixture();assert.equal(await f.api.canPublishQuote(),false);
 await assert.rejects(f.api.createPost({quotedPostId:id(100),quotePostId:id(200)}),/not available/);
 assert(!f.calls.some(c=>c.rpc==='create_quote_post'));
});
test('reviewed client still requires the server publishing gate',async()=>{
 const f=postsFixture({approved:true,publishingEnabled:false});assert.equal(await f.api.canPublishQuote(),false);
 await assert.rejects(f.api.createPost({quotedPostId:id(100),quotePostId:id(200)}),/not available/);
 assert(!f.calls.some(c=>c.rpc==='create_quote_post'));
});
test('pre-migration normal creation and feeds do not reference nonexistent columns or RPCs',async()=>{
 const f=postsFixture({missing:true});const post=await f.api.createPost({title:'Normal',content:'Text',media:[]});assert.equal(post.title,'Normal');
 await f.api.loadAllPosts();assert.equal(f.calls.filter(c=>c.rpc).length,0);
 for(const call of f.calls.filter(c=>c.select))assert(!call.select.includes('quoted_post_id'));
 assert.equal(f.writes,1);
 assert.equal(await f.api.loadQuotablePost(id(100)),null);
});
test('quote feed hydration preserves outer IDs and all independent counters with one-level media normalization',async()=>{
 const f=postsFixture({rows:[outer()],originals:new Map([[id(100),original]])});const [post]=await f.api.loadAllPosts();
 assert.equal(post.id,id(200));assert.equal(post.quotedPost.id,id(100));assert.equal(post.repostCount,2);assert.equal(post.likes,3);assert.equal(post.comments,4);assert.equal(post.shareCount,5);assert.equal(post.bookmarkCount,6);assert.equal(post.views,7);
 assert.equal(post.quotedPost.media[0].thumbnailUrl,'https://example.com/poster.jpg');assert(!('quotedPost' in post.quotedPost));
 assert.equal(f.calls.filter(c=>c.rpc==='load_quote_references').length,1);
});
test('missing, forbidden, protected and hard-deleted originals render unavailable without losing quote posts',async()=>{
 for(const q of [null,{...original,visibility:'followers'},{...original,media:[{type:'image',asset_id:id(8)}]}]){
  const f=postsFixture({rows:[outer()],originals:new Map([[id(100),q]])});const [p]=await f.api.loadAllPosts();assert.equal(p.id,id(200));assert.equal(p.quotedPost.unavailable,true);
 }
 const f=postsFixture({rows:[{...outer(),quoted_post_id:null}]});const [post]=await f.api.loadAllPosts();assert.equal(post.isQuote,true);assert.equal(post.quotedPost.unavailable,true);assert(!f.calls.some(c=>c.rpc==='load_quote_references'));
 const network=postsFixture({rows:[outer()],referenceFailure:true});assert.equal((await network.api.loadAllPosts())[0].quotedPost.unavailable,true);
});
test('quote RPC batches are bounded and retries preserve the request ID',async()=>{
 const f=postsFixture({approved:true,rows:Array.from({length:150},(_,i)=>outer(300+i)),originals:new Map([[id(100),original]])});await f.api.loadAllPosts(0,150);assert.deepEqual(f.calls.filter(c=>c.rpc==='load_quote_references').map(c=>c.args.p_post_ids.length),[100,50]);
 f.retry(1);const p=await f.api.createPost({quotedPostId:id(100),quotePostId:id(800),content:'New quote',media:[]});assert.equal(p.id,id(800));assert.equal(f.writes,1);
 const calls=f.calls.filter(c=>c.rpc==='create_quote_post');assert.equal(calls.length,2);assert.equal(calls[0].args.p_post_id,calls[1].args.p_post_id);assert(!('user_id' in calls[0].args.p_fields));
 await f.api.createPost({quotedPostId:id(100),quotePostId:id(800),content:'New quote'});assert.equal(f.writes,1);
});
test('video and Explore legacy APIs, media normalization, view tracking and source files remain unchanged',async()=>{
 for(const name of ['video.html','explore.js'])assert.equal(createHash('sha256').update(await readFile(new URL('../'+name,import.meta.url))).digest('hex'),contracts[name+'_sha256']);
 for(const name of ['toggleRepostAPI','updateRepostComment','normalizeMedia','mapPost','incrementView'])assert(source.includes(contracts[name]),name+' legacy contract changed');
 const f=postsFixture({enabled:false,rows:[outer()],originals:new Map([[id(100),original]])});const [p]=await f.api.loadAllPosts();assert(!('isQuote' in p));assert(!f.calls.some(c=>c.rpc==='load_quote_references'));
 const result=await f.api.toggleRepostAPI(id(200),'Existing video note');assert.equal(result.reposted,true);assert.equal(result.count,3);const call=f.calls.find(c=>c.rpc==='toggle_repost');assert.equal(call.args.p_post_id,id(200));assert.equal(call.args.p_comment,'Existing video note');
});
