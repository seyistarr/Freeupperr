import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers/sound-fixture.js';

const tap=()=>({isTrusted:true,eventPhase:2});

test('activation cues are short neutral feedback and notification melodies retain their own gain/duration',async()=>{
 const f=await fixture();
 for(const type of ['like','repost','share','comment','save','follow','tap']) {
  const before=f.durations.length;
  assert.equal(f.sound.interaction(type,tap()),true);
  assert.ok(f.durations.slice(before).every(end=>end<=.12),type+' must be a short cue, not a success melody');
 }
 assert.ok(f.gains.every(g=>g<=.022));
 const n=await fixture();n.gesture();n.notification('follow');await n.flush();
 assert.deepEqual(n.frequencies,[523,659,1047]);
 assert.ok(n.gains.every(g=>g===.035));
});

test('running contexts are reused without additional silent buffers, including rapid activations',async()=>{
 const f=await fixture();
 for(let i=0;i<100;i++)f.activate(()=>f.sound.interaction('tap'));
 assert.equal(f.contexts,1);
 assert.equal(f.buffers,0);
 assert.equal(f.frequencies.length,100);
});

test('a blocked or indefinitely suspended context has at most one pending silent buffer and no audible queue',async()=>{
 for(const opts of [{blocked:true},{hangingResume:true}]) {
  const f=await fixture(opts);
  for(let i=0;i<100;i++)f.activate(()=>f.sound.interaction('like'));
  await f.flush();
  assert.equal(f.contexts,1);assert.equal(f.buffers,1);assert.deepEqual(f.frequencies,[]);
 }
});

test('asynchronous resume never replays an expired activation; next trusted activation works with webkitAudioContext',async()=>{
 let release;const resumeGate=new Promise(resolve=>{release=resolve;});
 const f=await fixture({resumeGate,webkitAudio:true});
 f.activate(()=>assert.equal(f.sound.interaction('like'),false));
 release();await f.flush();assert.deepEqual(f.frequencies,[]);
 f.activate(()=>assert.equal(f.sound.interaction('like'),true));
 assert.equal(f.frequencies.length,2);assert.equal(f.contexts,1);
});

test('closed contexts recover with one replacement context and a fresh trusted activation',async()=>{
 const f=await fixture();f.activate(()=>f.sound.interaction('like'));f.audio.state='closed';
 f.activate(()=>assert.equal(f.sound.interaction('tap'),true));assert.equal(f.contexts,2);
});

test('denied private-mode storage reads/writes preserve default and current preference without leaking another account',async()=>{
 const f=await fixture();f.sound.setInteractionsEnabled(false);
 f.sandbox.localStorage.getItem=()=>{throw Error('denied');};
 f.sandbox.localStorage.setItem=()=>{throw Error('denied');};
 assert.throws(()=>f.sound.setInteractionsEnabled(true),/Could not save/);
 assert.equal(f.sound.isInteractionsEnabled(),false);
 await f.login('bob');assert.equal(f.sound.isInteractionsEnabled(),true);
 assert.throws(()=>f.sound.setInteractionsEnabled(false),/Could not save/);
 assert.equal(f.sound.isInteractionsEnabled(),true);
});

test('Home Repost and Undo confirmation handlers play once and preserve the action and failure path',async()=>{
 const html=readFileSync('index.html','utf8');
 for(const failed of [false,true])for(const control of ['homeRepostDo','repostRemoveBtn']) {
  const f=await fixture();let handler,writes=0;
  const marker="            document.getElementById('"+control+"').addEventListener('click',";
  const a=html.indexOf(marker),b=html.indexOf('\n            });',a)+16;
  const snippet=html.slice(a,b);
  f.sandbox.document.getElementById=id=>({addEventListener(_type,callback){handler=callback;},textContent:'Remove',disabled:false});
  Object.assign(f.sandbox,{homeRepostTarget:'p1',repostQuoteTargetId:'p1',pendingHomeReposts:new Set(),allPosts:[{id:'p1'}],closeHomeRepostMenu(){},closeRepostQuoteModal(){},reloadPosts:async()=>{},renderUI(){},showToast(){}});
  f.sandbox.window.fuT=s=>s;
  f.sandbox.window.AuthUser={requireAuth:callback=>callback()};
  f.sandbox.window.PostsAPI={async toggleRepostAPI(id){writes++;assert.equal(id,'p1');if(failed)throw Error('offline');return {count:1,reposted:true};}};
  vm.runInContext(snippet,f.sandbox);
  f.activate(()=>handler());await f.flush();
  assert.equal(writes,1);assert.equal(f.frequencies.length,2);
  await f.flush();assert.equal(f.frequencies.length,2,'no success or retry sound on server completion');
 }
});

test('an ignored pending Home Like neither submits twice nor plays extra feedback',async()=>{
 const f=await fixture();let calls=0;
 const html=readFileSync('index.html','utf8');
 const a=html.indexOf('            async function toggleReaction(postId)'),b=html.indexOf('            function updateReactionsUI',a);
 Object.assign(f.sandbox,{appData:{posts:[{id:'p1'}]},pendingLikes:new Set(['p1'])});
 f.sandbox.window.PostsAPI={toggleLike(){calls++;}};
 vm.runInContext(html.slice(a,b),f.sandbox);
 await f.activate(()=>vm.runInContext('toggleReaction("p1")',f.sandbox));
 assert.equal(calls,0);assert.deepEqual(f.frequencies,[]);
});

test('muting each category stops only that category, while account logout cancels all remaining tones',async()=>{
 const f=await fixture();f.activate(()=>f.sound.interaction('like'));f.gesture();
 assert.equal(await f.sound.play('notify'),true);
 f.sound.setInteractionsEnabled(false);assert.equal(f.cancelled,2);
 await f.sound.setEnabled(false);assert.equal(f.cancelled,4);
 f.sound.setInteractionsEnabled(true);f.activate(()=>f.sound.interaction('like'));
 await f.logout();assert.equal(f.cancelled,6);
});

test('first interaction while auth is pending remains silent, never replays after auth, and the next activation works',async()=>{
 let release;const sessionGate=new Promise(resolve=>{release=resolve;});
 const f=await fixture({sessionGate});
 f.activate(()=>assert.equal(f.sound.interaction('like'),false));
 release();await f.flush();await f.flush();assert.deepEqual(f.frequencies,[]);
 f.activate(()=>assert.equal(f.sound.interaction('like'),true));
 f.audio.state='interrupted';
 f.activate(()=>assert.equal(f.sound.interaction('tap'),true));
 assert.equal(f.contexts,1);
});
