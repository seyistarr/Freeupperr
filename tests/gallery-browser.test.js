import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium,webkit} from '@playwright/test';
import {originalAudioWav} from './helpers/original-audio-fixture.js';
const bootstrap=`
window.fuT=s=>s;window.AuthUser={getCurrentUser:()=>({id:'viewer',isLoggedIn:true,username:'viewer'}),requireAuth:f=>f(),onChange(){}};
window.getCurrentUser=AuthUser.getCurrentUser;
window.getAuthorFromProfile=p=>({id:p.id,name:p.display_name,username:p.username,avatar:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E',verified:false});window.getVerifiedBadgeHTML=()=>'';
window.globalFeedCalls=0;
window.posts=Array.from({length:5},(_,i)=>({id:'post-'+i,user_id:'owner',profile:{id:'owner',display_name:'Creator',username:'creator'},title:'Video '+(i+1),content:'FreeUpper post caption',mediaType:'video',mediaUrl:'/tests/fixtures/gallery-ui-video.mp4',media:[{type:'video',url:'/tests/fixtures/gallery-ui-video.mp4'}],thumbnailUrl:'',sound_id:'sound-1',timestamp:'2026-11-01T00:00:00Z'}));
window.PostsAPI={getFeedContext:()=>null,loadFeedWithReposts:async()=>{globalFeedCalls++;return []},incrementView:async()=>({counted:false}),subscribe(){},toggleLike:async(id)=>{window.lastLikeTarget=id;return {liked:true,count:1}},toggleBookmark:async(id)=>{window.lastSaveTarget=id;return {bookmarked:true,count:1}}};
window.GalleryAPI={items:async()=>posts.map((post,i)=>({post})),ensureSound:async()=>({playable:true,reusable:true}),changed(){}};
window.SoundsAPI={loadSound:async()=>({id:'sound-1',title:'Original sound',audioUrl:'/owned-original.wav',artUrl:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E',creator:{username:'creator'},createdAt:'2026-11-01',usageCount:1}),loadSoundVideos:async()=>[],loadSoundStats:async()=>({}),isSoundSaved:async()=>false,canPlay:async()=>true,canReuse:async()=>true};
window.authCallbacks=[];window.sb={auth:{onAuthStateChange(fn){authCallbacks.push(fn)},getSession:async()=>({data:{session:{user:{id:'viewer'}}}})},channel:()=>({on(){return this},subscribe(){}}),from(table){const q=new Proxy({}, {get(_,key){if(key==='then')return resolve=>resolve({data:[]});if(key==='insert')return row=>{if(table==='bookmarks')window.lastSaveTarget=row.post_id;return q;};return ()=>q;}});return q;}};
`;
function fixtureServer(){
 return createServer(async(req,res)=>{try{const url=new URL(req.url,'http://fixture');let path=url.pathname;
 if(path==='/profile-gallery-host.html'){
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/gallery.css"><bottom-nav>Profile navigation</bottom-nav><main id="mainScroll"></main><button id="openGallery" onclick="ProfileContent.open(\'creator\',\'posts\',\'post-2\')">Open Gallery</button><script>'+bootstrap+'</script><script src="/profile-content.js"></script>');return;
 }
 if(path==='/owned-original.wav'){res.setHeader('Content-Type','audio/wav');res.setHeader('Cache-Control','private, no-store');res.end(originalAudioWav());return;}
 if(path==='/gallery-viewer.html'){
  let html=await readFile('.'+path,'utf8');html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*https:[^>]*>/gi,'');
  html=html.replace('</body>','<script>'+bootstrap+'</script><script src="/js/freeupper-time.js"></script><script src="/video-shell.js"></script><script src="/video-render.js"></script><script src="/video-player.js"></script><script src="/gallery-session.js"></script></body>');res.setHeader('Content-Type','text/html');res.end(html);return;
 }
 if(path==='/sound.html'){let html=await readFile('sound.html','utf8');const inline=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(m=>m[1].includes('function loadSoundPage'))?.[1];html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*https:[^>]*>/gi,'');res.setHeader('Content-Type','text/html');res.end(html.replace('</body>','<script>'+bootstrap+'</script><script src="/js/freeupper-time.js"></script><script>'+inline+'</script></body>'));return;}
 const body=await readFile('.'+path);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.mp4')?'video/mp4':'text/html');
 if(path.endsWith('.mp4')){res.setHeader('Accept-Ranges','bytes');const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):body.length-1,body.length-1);if(start>end){res.writeHead(416);res.end();return;}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${body.length}`,'Content-Length':end-start+1});res.end(body.subarray(start,end+1));return;}res.setHeader('Content-Length',body.length);}res.end(body);
 }catch(_){res.writeHead(404);res.end();}});
}
test('Gallery uses existing Video controls, exact post, strict boundaries, sound return and cleanup',{timeout:60000},async()=>{
 const server=fixtureServer();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await (process.env.FREEUPPER_PROFILE_ENGINE==='webkit'?webkit:chromium).launch(process.env.FREEUPPER_PROFILE_ENGINE==='webkit'?{executablePath:process.env.FREEUPPER_WEBKIT_EXECUTABLE||undefined}:{executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PLAYER ERROR',e.message)});page.on('console',m=>{if(m.text().startsWith('[video]'))console.error(m.text())});await page.route(url=>url.origin!==origin,r=>r.abort());
 await page.goto(origin+'/gallery-viewer.html?owner=creator&tab=posts&post=post-2',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#card-2');await page.waitForFunction(()=>currentPostId==='post-2');
 assert.equal(await page.locator('bottom-nav').count(),0);assert.equal(await page.locator('.video-topbar').count(),0);assert(await page.locator('.v-disc').count()>0);assert.equal(await page.locator('#card-2 [data-author-handle]').textContent(),'@creat…');assert.equal(await page.locator('#card-2 [data-author-name]').evaluate(el=>getComputedStyle(el).fontSize),'17px');assert.equal(await page.locator('#card-2 .v-disc').evaluate(el=>getComputedStyle(el).animationName),'spinDisc');
 await page.locator('#likeBtn-2').click();await page.waitForFunction(()=>lastLikeTarget==='post-2');assert.equal(await page.locator('#likeCount-2').textContent(),'1');
 await page.locator('#saveBtn-2').click();await page.waitForFunction(()=>window.lastSaveTarget==='post-2');assert(await page.locator('#saveBtn-2').evaluate(el=>el.classList.contains('saved')));
 await page.evaluate(()=>{document.getElementById('card-4').scrollIntoView();});await page.waitForFunction(()=>currentPostId==='post-4');
 const end=await page.locator('#feedTrack').evaluate(el=>{el.scrollTop=1e9;return el.scrollTop;});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>currentPostId),'post-4');assert.match(await page.locator('#galleryEnd').textContent(),/End/);
 await page.evaluate(()=>document.getElementById('card-0').scrollIntoView());await page.waitForFunction(()=>currentPostId==='post-0');await page.locator('#feedTrack').evaluate(el=>el.scrollTop=-1000);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>currentPostId),'post-0');
 await page.evaluate(()=>document.getElementById('card-2').scrollIntoView());await page.waitForFunction(()=>currentPostId==='post-2');await page.waitForFunction(()=>document.getElementById('vid-2').readyState>0);
 await page.evaluate(()=>{document.getElementById('vid-2').pause();document.getElementById('vid-2').currentTime=.04;});
 await page.evaluate(()=>{const original=FreeUpperVideoPlayer.snapshot;FreeUpperVideoPlayer.snapshot=function(){return window.lastGallerySnapshot=original.call(this);};});
 await page.locator('#card-2 .v-disc-wrap').click();await page.waitForSelector('.gallery-overlay iframe');await page.waitForFunction(()=>document.getElementById('vid-2').paused);
 const sound=page.frameLocator('.gallery-overlay iframe');await sound.locator('#soundArtWrap').click();await sound.locator('#soundAudio').evaluate(a=>a.play());assert(await sound.locator('#soundAudio').evaluate(a=>!a.paused&&a.readyState>=2));assert(await page.locator('#vid-2').evaluate(v=>v.paused),'real original audio never overlaps Gallery video');await page.evaluate(()=>window.lastSoundAudio=document.querySelector('.gallery-overlay iframe').contentDocument.getElementById('soundAudio'));
 await page.goBack();await page.waitForFunction(()=>!document.querySelector('.gallery-overlay'));await page.waitForFunction(()=>currentPostId==='post-2');await page.waitForFunction(()=>lastSoundAudio.paused);
 await page.waitForFunction(()=>Math.abs(document.getElementById('vid-2').currentTime-lastGallerySnapshot.time)<.025,null,{timeout:5000}).catch(async e=>{console.error('SNAPSHOT',await page.evaluate(()=>lastGallerySnapshot));console.error('RESTORE STATE',await page.locator('#vid-2').evaluate(v=>({time:v.currentTime,duration:v.duration,src:v.getAttribute('src'),ready:v.readyState,preload:v.preload})));throw e;});
 const shared=await page.evaluate(()=>{galleryParams.set('tab','star');return getPostUrl(2);});assert(!shared.includes('owner=')&&!shared.includes('tab='),'share must not disclose Saved/profile context');
 assert.equal(await page.evaluate(()=>globalFeedCalls),0);
 assert.equal(await page.locator('.v-card').count(),5);assert(await page.locator('#vid-2').evaluate(v=>v.paused));
 const activeSources=await page.locator('video[src]').evaluateAll(nodes=>nodes.filter(n=>n.getAttribute('src')).length);assert(activeSources<=1);
 await mkdir('/tmp/freeupper-gallery',{recursive:true});await page.screenshot({path:'/tmp/freeupper-gallery/viewer.png'});
 await page.evaluate(()=>{GalleryAPI.items=async()=>[];for(const fn of authCallbacks)fn('SIGNED_OUT');});assert.equal(await page.locator('.v-card').count(),0);
 await page.evaluate(()=>FreeUpperVideoPlayer.dispose());assert.equal(await page.locator('video[src]').count(),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

test('native Sounds Back is tappable inside Profile Gallery and restores video/time', {timeout:45000},async()=>{
 const server=fixtureServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const wk=process.env.FREEUPPER_PROFILE_ENGINE==='webkit';const browser=await(wk?webkit:chromium).launch(wk?{executablePath:process.env.FREEUPPER_WEBKIT_EXECUTABLE||undefined}:{executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(url=>url.origin!==origin,r=>r.abort());
  await page.goto(origin+'/profile-gallery-host.html');await page.locator('#openGallery').click();await page.waitForSelector('.gallery-overlay iframe');
  const outerClose=page.locator('.gallery-close[aria-label="Close Gallery"]');assert(await outerClose.isVisible());
  // A sibling/host message cannot hide the selected viewer's control.
  await page.evaluate(()=>postMessage({type:'fu-gallery-sound',active:true},location.origin));assert(await outerClose.isVisible());
  const viewer=page.frames().find(f=>f.url().includes('/gallery-viewer.html'));await viewer.waitForFunction(()=>currentPostId==='post-2'&&document.getElementById('vid-2').readyState>0);
  if(await viewer.locator('#vid-2').evaluate(v=>v.paused))await viewer.locator('#tap-2').click({position:{x:100,y:200}});
  await viewer.waitForFunction(()=>{const v=document.getElementById('vid-2');return v.currentTime>=1.1&&v.currentTime<1.8;},null,{timeout:8000});
  await viewer.evaluate(()=>{const original=FreeUpperVideoPlayer.snapshot;FreeUpperVideoPlayer.snapshot=function(){return window.expectedSoundSnapshot=original.call(this);};});
  await viewer.locator('#card-2 .v-disc-wrap').click();await viewer.waitForSelector('.gallery-overlay iframe');
  await page.waitForFunction(()=>document.querySelector('.gallery-close[aria-label="Close Gallery"]').hidden);
  assert(await outerClose.evaluate(el=>el.inert&&getComputedStyle(el).display==='none'));
  assert.equal(await viewer.locator('[aria-label="Return to Gallery"]').count(),0,'no duplicate control over sound.html');
  const sound=viewer.childFrames().find(f=>f.url().includes('/sound.html'));await sound.locator('#soundArtWrap').click();await sound.locator('#soundAudio').evaluate(a=>a.play());
  await viewer.evaluate(()=>window.retainedSoundAudio=document.querySelector('.gallery-overlay iframe').contentDocument.getElementById('soundAudio'));
  await mkdir('/tmp/freeupper-gallery',{recursive:true});await page.screenshot({path:'/tmp/freeupper-gallery/sounds-native-back.png'});
  // Actual pointer tap, without force or a programmatic history shortcut.
  await sound.locator('button[onclick="goBack()"]').click();
  await viewer.waitForFunction(()=>!document.querySelector('.gallery-overlay')&&currentPostId==='post-2'&&retainedSoundAudio.paused);
  await viewer.waitForFunction(()=>document.getElementById('vid-2').readyState>0&&Math.abs(document.getElementById('vid-2').currentTime-expectedSoundSnapshot.time)<.15,null,{timeout:5000}).catch(async error=>{console.error('Nested restore',await viewer.evaluate(()=>({snapshot:expectedSoundSnapshot,time:document.getElementById('vid-2').currentTime,ready:document.getElementById('vid-2').readyState})));throw error;});
  assert(await viewer.locator('#vid-2').evaluate(v=>v.loop),'looping is restored after the seek');
  assert(await viewer.evaluate(()=>expectedSoundSnapshot.time>1),'nonzero position was saved');
  assert.equal(await page.locator('.gallery-overlay').count(),1,'Profile Gallery remains open');assert(await outerClose.isVisible());assert.equal(await outerClose.evaluate(el=>el.inert),false);
  assert.equal(await viewer.evaluate(()=>globalFeedCalls),0);assert.deepEqual(errors,[]);
  await outerClose.click();await page.waitForFunction(()=>!document.querySelector('.gallery-overlay'));assert.equal(await page.locator('bottom-nav').evaluate(el=>el.inert),false);
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
