import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium,webkit} from '@playwright/test';
import {profileFixtureParts as profile} from './helpers/profile-navigation-fixture.js';

// Real page markup/CSS, coordinator, component and lifecycle; real Search,
// Profile and Video page code. Backend fixtures deliberately isolate latency,
// authorization boundaries and document navigation from external availability.
const names={home:'index',search:'search',create:'create',video:'video',profile:'profile'};
const sources=Object.fromEntries(await Promise.all(Object.entries(names).map(async([key,name])=>[key,await readFile(name+'.html','utf8')])));
const createGuard=sources.create.slice(sources.create.indexOf('        let composerPublished = false;'),sources.create.indexOf('        // 3.  TOAST SYSTEM'));
const videoMain=[...sources.video.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(m=>m[1].includes('let _curIdx'))[1];
const bootstrap=`
(function(){
if(window===top){window.actor=localStorage.getItem('test-actor') === 'guest' ? null : localStorage.getItem('test-actor') || 'viewer';window.sessionExpiry=Date.now()/1000+3600;}
window.pageMarker=crypto.randomUUID();window.authListeners=[];window.userListeners=[];
window.fuT=s=>s;window.toasts=[];window.showToast=s=>toasts.push(s);
window.getCurrentUser=()=>({id:top.actor,isLoggedIn:!!top.actor,username:top.actor,avatar:''});
window.AuthUser={getCurrentUser,onChange:f=>userListeners.push(f),requireAuth:f=>f()};
window.updateNavAvatar=()=>{};window.updateAuthorUI=()=>{};
window.queryCalls=0;window.channels=[];window.requests=[];
const channel=()=>{const c={on(){return c},subscribe(){channels.push(c);return c}};return c;};
window.sb={auth:{getSession:async()=>({data:{session:top.actor?{user:{id:top.actor},expires_at:top.sessionExpiry}:null}}),onAuthStateChange:f=>{authListeners.push(f);return {data:{subscription:{unsubscribe(){}}}};}},channel,getChannels:()=>channels,removeChannel:async c=>{channels=channels.filter(x=>x!==c);},
 from(table){let filtered=false;const q=new Proxy({}, {get(_,key){if(key==='then')return (resolve)=>{queryCalls++;return Promise.resolve({data:[],count:0}).then(resolve);};return (...args)=>{if(key==='ilike'||key==='or')filtered=true;return q;};}});return q;},rpc:async()=>({data:[]})};
window.getAuthorFromProfile=p=>({name:p?.display_name || 'Creator',avatar:'',verified:false});
window.ListingsAPI={getListings:async()=>({data:[]})};
window.PostsAPI={loadFeedWithReposts:async()=>{requests.push('feed');await new Promise(r=>setTimeout(r,80));return []},subscribe(){window.repostSubscriptions=(window.repostSubscriptions||0)+1;},loadProfilePage:async()=>({posts:[],total:0})};
window.switchActor=id=>{top.actor=id;localStorage.setItem('test-actor',id||'guest');for(const w of [top,...Array.from(top.frames)]){try{w.authListeners.forEach(f=>f(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id},expires_at:top.sessionExpiry}:null));w.userListeners.forEach(f=>f());}catch(_){}}};
})();
`;
async function harness({root='home',pwa=false,delay=100,route=null,guest=false,prefetch=true,holdFirstSearch=false}={}){
 const documents=[];const errors=[];let heldSearch=null;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  try{
   if(url.searchParams.has('fixtureRenderer')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><head><script src="/js/screen-lifecycle.js?v=1"></script></head><body><input id="rendererInput"><main>Owned renderer</main></body>');return;}
   const key=Object.keys(names).find(key=>url.pathname==='/'+names[key]+'.html') || (url.pathname.startsWith('/u/')||url.pathname.startsWith('/@')?'profile':null);
   if(!key){const path=url.pathname==='/'?'/index.html':url.pathname;const body=await readFile('.'+path);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream');res.end(body);return;}
   documents.push({url:req.url,time:Date.now()});
   let html=sources[key].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*https:[^>]*>/gi,'');
   let code=key==='search'?'<script src="/search.js"></script>':key==='create'?'<script>const state={postMedia:[],marketImages:[],postEmbeddings:[]};'+createGuard+'</script>':key==='video'?'<script>'+videoMain+'</script>':key==='profile'?'<script>'+profile.cache+'</script><script>'+profile.bootstrap+'</script><script>window.fixtureSB=window.sb;</script><script>'+bootstrap+'</script><script>sb.from=fixtureSB.from;sb.rpc=fixtureSB.rpc;</script><script>'+profile.main+'</script>':`<script>window.__fuInitialHydrated=${prefetch};addEventListener("DOMContentLoaded",()=>{if(window.__fuInitialHydrated)dispatchEvent(new Event("fu-app-hydrated"));});</script>`;
   // Profile fixture provides identity/relationship RPCs; keep shared auth and
   // realtime semantics from this harness, and its real production page logic.
   html=html.replace('<head>','<head><script>'+bootstrap+'</script><script src="/js/screen-lifecycle.js?v=1"></script><script src="/theme.js?v=2"></script>');
   html=html.replace('</body>',code+'<script src="/router.js"></script><script src="/side-nav.js"></script><script src="/bottom-nav.js?v=five-tabs-v1"></script></body>');
   res.setHeader('Content-Type','text/html');if(holdFirstSearch && key==='search' && url.searchParams.has('fuMounted'))heldSearch=()=>setTimeout(()=>res.end(html),delay);else setTimeout(()=>res.end(html),url.searchParams.has('fuMounted')?delay:0);
  }catch(e){res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const engine=process.env.FREEUPPER_PROFILE_ENGINE==='webkit'?webkit:chromium;
 const browser=await engine.launch(engine===chromium?{executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']}:{}).catch(async error=>{await new Promise(r=>server.close(r));throw error;});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route(url=>url.origin!==origin,r=>r.abort());
 if(guest)await context.addInitScript(()=>localStorage.setItem('test-actor','guest'));
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>{errors.push(e.message);if(process.env.FREEUPPER_DEBUG)console.error(e.message);});
 await page.goto(origin+(route || '/'+names[root]+'.html'));
 if(pwa){await page.evaluate(async()=>{await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;});await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);}
 if(!guest)await page.waitForFunction(()=>!!window.FreeUpperProfileShell?.getSession());
 const screen=key=>key===root?page.mainFrame():page.frames().find(f=>f!==page.mainFrame() && new URL(f.url()).pathname==='/'+names[key]+'.html');
 const select=async key=>{const start=Date.now();await page.locator('bottom-nav [data-nav-key='+key+']').click();await page.waitForFunction(k=>FreeUpperProfileShell.getActive()===k,key).catch(async e=>{console.error(key,errors,await page.evaluate(()=>({status:FreeUpperProfileShell.status(),frames:[...document.querySelectorAll('iframe[data-fu-mounted]')].map(f=>({src:f.src,html:f.contentDocument?.body?.textContent.slice(0,120),ready:f.contentWindow.FreeUpperScreen?.isReady(),controller:!!f.contentWindow.navigator.serviceWorker.controller,scripts:[...f.contentDocument.scripts].map(s=>s.src)}))})));throw e;});return Date.now()-start;};
 const releaseSearch=()=>{holdFirstSearch=false;heldSearch?.();heldSearch=null;};
 return {page,screen,select,errors,documents,origin,releaseSearch,close:async()=>{releaseSearch();await browser.close();await new Promise(r=>server.close(r));}};
}

test('five tabs: cold/warm timing, persistent nav identity, state, geometry, history and bounded retention',{timeout:120000},async t=>{
 const h=await harness({holdFirstSearch:true});const samples=[];let cdp;const memory=[];
 if(process.env.FREEUPPER_PROFILE_ENGINE!=='webkit'){cdp=await h.page.context().newCDPSession(h.page);await cdp.send('Performance.enable');}
 try{
  await h.page.evaluate(()=>{window.originalNav=document.querySelector('bottom-nav');window.originalDocument=document;window.navigationSamples=[];addEventListener('fu-tab-active',e=>navigationSamples.push(e.detail));});
  // Hold a cold destination behind Home. No frame is revealed before ready.
  const cold=await h.page.evaluate(async()=>{const start=performance.now();document.querySelector('[data-nav-key=search]').click();await new Promise(requestAnimationFrame);const frame=document.querySelector('[data-fu-mounted=search]');return {ms:performance.now()-start,selected:document.querySelector('[aria-current=page]').dataset.navKey,hidden:getComputedStyle(frame).visibility,home:getComputedStyle(document.querySelector('#app-container')||document.querySelector('main')||document.body.children[0]).visibility,nav:getComputedStyle(document.querySelector('.bottom-nav')).visibility};});
  assert.equal(cold.selected,'search');assert.equal(cold.hidden,'hidden');assert.equal(cold.home,'visible');assert.equal(cold.nav,'visible');
  h.releaseSearch();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='search');
  const search=h.screen('search');await search.locator('#searchInput').fill('retained query');await search.evaluate(()=>Search.runSearch('retained query'));await search.waitForFunction(()=>document.getElementById('resultsContainer').textContent.includes('retained query'));
  await search.evaluate(()=>{window.savedResults=document.getElementById('resultsContainer').firstElementChild;document.getElementById('resultsContainer').insertAdjacentHTML('beforeend','<div style="height:2000px">Scroll fixture</div>');document.getElementById('mainScroll').scrollTop=240;});
  const count=await search.evaluate(()=>queryCalls);const oldSearchDoc=search;
  samples.push({kind:'create',coldMs:await h.select('create')});const composer=h.screen('create');await composer.locator('#postContent').fill('Unsent work');
  await h.select('home');const before=h.documents.length;
  const warm=await h.page.evaluate(async()=>{const start=performance.now();document.querySelector('[data-nav-key=search]').click();await new Promise(requestAnimationFrame);const win=document.querySelector('[data-fu-mounted=search]').contentWindow;return {ms:performance.now()-start,same:win.savedResults===win.document.getElementById('resultsContainer').firstElementChild,scroll:win.document.getElementById('mainScroll').scrollTop};});
  assert(warm.same);assert.equal(warm.scroll,240);assert.equal(await search.locator('#searchInput').inputValue(),'retained query');assert.equal(await search.evaluate(()=>queryCalls),count);assert.equal(h.documents.length,before);samples.push({kind:'search',warmMs:warm.ms});
  // WebKit/WPE's WAV backend does not seek this silent fixture: its timestamp
  // assertion uses a finite media double; native play/pause is still exercised.
  // Video forces bounded eviction of Search when the draft and Profile are retained.
  samples.push({kind:'video',coldMs:await h.select('video')});
  const video=h.screen('video');
  const wav=Buffer.alloc(44+8000*2*6);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  await video.evaluate(async src=>{for(const tag of ['audio','video']){const media=document.createElement(tag);media.id='native-'+tag;media.src=src;media.muted=true;media.loop=true;document.body.append(media);await media.play();}},'data:audio/wav;base64,'+wav.toString('base64'));
  await video.evaluate(async webkit=>{const v=document.getElementById('native-video');v.pause();v.id='vid-0';const pause=v.pause.bind(v);v.pause=()=>{pause();window.pausedCount=(window.pausedCount||0)+1;};if(!webkit){v.currentTime=4.25;if(v.seeking)await new Promise(r=>v.addEventListener('seeked',r,{once:true}));}if(webkit)Object.defineProperty(v,'currentTime',{configurable:true,writable:true,value:4.25});window.savedTrack=document.getElementById('feedTrack');},process.env.FREEUPPER_PROFILE_ENGINE==='webkit');
  if(process.env.FREEUPPER_DEBUG)t.diagnostic('media before hide '+JSON.stringify(await video.locator('#vid-0').evaluate(v=>({time:v.currentTime,duration:v.duration,ready:v.readyState,src:v.src.slice(0,30)}))));
  await h.select('create');assert.equal(await composer.locator('#postContent').inputValue(),'Unsent work');assert((await video.evaluate(()=>pausedCount))>0);assert(await video.evaluate(()=>document.getElementById('native-audio').paused && document.getElementById('vid-0').paused));
  await video.evaluate(async()=>{await document.getElementById('native-audio').play();await new Promise(requestAnimationFrame);});assert(await video.locator('#native-audio').evaluate(a=>a.paused));
  await h.select('video');if(process.env.FREEUPPER_DEBUG)t.diagnostic('media after show '+JSON.stringify(await video.locator('#vid-0').evaluate(v=>({time:v.currentTime,duration:v.duration,ready:v.readyState}))));assert(Math.abs(await video.locator('#vid-0').evaluate(v=>v.currentTime)-4.25)<0.1);assert.equal(await video.evaluate(()=>repostSubscriptions),1);await video.evaluate(()=>{document.getElementById('feedTrack').innerHTML='<div class="v-card"><div class="v-progress visible" id="geometryScrubber"></div></div>';});
  await h.page.evaluate(()=>{document.documentElement.style.setProperty('--bottom-safe-area','34px');dispatchEvent(new Event('resize'));});
  const bar=await h.page.locator('.bottom-nav').boundingBox(),scrub=await video.locator('#geometryScrubber').boundingBox();assert.equal(bar.height,98);assert(scrub.y+scrub.height<=bar.y-11);
  await h.page.evaluate(()=>{document.documentElement.style.setProperty('--bottom-safe-area','0px');dispatchEvent(new Event('resize'));});
  await h.select('profile');await h.select('home');
  const historyCount=await h.page.evaluate(()=>history.length);
  await h.page.evaluate(()=>{for(let i=0;i<10;i++)document.querySelector('[data-nav-key=home]').click();});assert.equal(await h.page.evaluate(()=>history.length),historyCount);
  await h.select('search');const restored=h.screen('search');assert.equal(await restored.locator('#searchInput').inputValue(),'retained query');assert.equal(await restored.locator('#mainScroll').evaluate(el=>el.scrollTop),240);
  for(let round=0;round<4;round++){for(const key of ['create','video','profile','home','search']){
   await h.select(key);
   const state=await h.page.evaluate(()=>({status:FreeUpperProfileShell.status(),same:originalNav===document.querySelector('bottom-nav'),doc:originalDocument===document,nav:document.querySelector('.bottom-nav').getBoundingClientRect().toJSON(),hit:document.elementFromPoint(30,innerHeight-32)?.closest('bottom-nav')===originalNav,visible:[...document.querySelectorAll('iframe[data-fu-mounted]')].filter(f=>getComputedStyle(f).visibility==='visible').length}));
   assert(state.same);assert(state.doc);assert(state.status.documents<=4,JSON.stringify(state));assert.equal(state.nav.height,64);assert(state.hit);assert(state.visible<=1);
   assert.equal(await h.page.locator('[aria-current=page]').getAttribute('data-nav-key'),key);
   assert.equal(await composer.locator('#postContent').inputValue(),'Unsent work');
   if(key!=='home')assert.equal(await h.screen(key).locator('.bottom-nav').count(),0);
  }
  if(cdp && round>=1){await cdp.send('HeapProfiler.collectGarbage');const counters=await cdp.send('Memory.getDOMCounters');const m=await cdp.send('Performance.getMetrics');memory.push({...counters,heap:m.metrics.find(m=>m.name==='JSHeapUsedSize').value});}
  }
  if(memory.length){assert(memory.at(-1).documents<=memory[0].documents+2,JSON.stringify(memory));assert(memory.at(-1).nodes<memory[0].nodes+500,JSON.stringify(memory));assert(memory.at(-1).heap<memory[0].heap+12*1024*1024,JSON.stringify(memory));t.diagnostic('GC fixture memory: '+JSON.stringify(memory));}
  samples.push(...await h.page.evaluate(()=>navigationSamples));
  await h.page.goBack();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='home');await h.page.goForward();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='search');
  await h.page.locator('[data-nav-key=home]').focus();await h.page.keyboard.press('Enter');await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='home');
  await h.page.locator('[data-nav-key=create]').focus();await h.page.keyboard.press('Space');await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='create');await h.select('search');
  await h.page.evaluate(()=>applyTheme('light'));assert.equal(await h.screen('search').evaluate(()=>document.documentElement.dataset.theme),'light');
  await h.select('create');await composer.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>480});document.getElementById('postContent').focus();visualViewport.dispatchEvent(new Event('resize'));});
  assert.equal(await h.page.locator('.bottom-nav').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  await composer.evaluate(()=>{delete visualViewport.height;document.activeElement.blur();visualViewport.dispatchEvent(new Event('resize'));});await h.page.waitForFunction(()=>!document.documentElement.hasAttribute('data-nav-keyboard'));
  await h.page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>480});});await composer.locator('#postContent').focus();await h.page.evaluate(()=>visualViewport.dispatchEvent(new Event('resize')));assert.equal(await h.page.locator('.bottom-nav').evaluate(el=>getComputedStyle(el).visibility),'hidden');assert((await composer.locator('.layout').boundingBox()).height<=480);
  await composer.locator('#postContent').blur();await h.page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});await h.page.waitForFunction(()=>!document.documentElement.hasAttribute('data-nav-keyboard'));
  await h.page.setViewportSize({width:1024,height:768});await h.screen('create').locator('side-nav [data-side-key=search]').click();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='search');assert(await h.page.evaluate(()=>originalDocument===document));
  await h.page.setViewportSize({width:390,height:844});await h.select('home');
  const rapid=await h.page.evaluate(()=>{const before=history.length;for(const key of ['search','search','create','create','video','video','profile','profile','home','home'])document.querySelector('[data-nav-key='+key+']').click();return {added:history.length-before,kinds:[...document.querySelectorAll('iframe[data-fu-mounted]')].map(f=>f.dataset.fuMounted)};});assert.equal(rapid.added,5);assert.equal(new Set(rapid.kinds).size,rapid.kinds.length);await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='home');
  assert.deepEqual(h.errors,[]);await writeFile('/tmp/freeupper-five-tab-timings.json',JSON.stringify(samples,null,2));t.diagnostic(JSON.stringify(Object.keys(names).map(kind=>({kind,warmMs:samples.filter(s=>s.kind===kind && s.mode==='warm').map(s=>Number(s.ms.toFixed(1))),coldMs:samples.filter(s=>s.kind===kind && s.mode==='cold').map(s=>Number(s.ms.toFixed(1)))}))));
 }finally{await h.close();}
});

test('PWA direct Search: Back/Forward, eviction and offline navigation',{timeout:90000},async()=>{
 const h=await harness({root:'search',pwa:true});try{
  await h.select('video');await h.select('create');await h.screen('create').locator('#postContent').fill('Retained offline draft');await h.select('profile');await h.select('home');
  await h.page.goBack();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='profile');await h.page.goForward();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='home');
  // Chromium also restores an evicted document offline. WebKit/WPE's offline
  // driver blocks new iframe navigations before its service worker can respond.
  await h.page.context().setOffline(true);if(process.env.FREEUPPER_PROFILE_ENGINE!=='webkit')await h.select('video');assert(await h.page.evaluate(()=>FreeUpperProfileShell.status().documents<=FreeUpperProfileShell.status().limit));await h.select('search');assert.equal(await h.screen('search').locator('#searchInput').inputValue(),'');await h.page.context().setOffline(false);
  assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});


async function accountBoundaries(h) {
  await h.select('create');await h.screen('create').locator('#postContent').fill('Private draft');
  await h.select('search');
  const beforeAccount=await h.page.evaluate(()=>pageMarker);await h.page.evaluate(()=>switchActor('other'));await h.page.waitForFunction(marker=>window.pageMarker!==marker && getCurrentUser().id==='other' && !!window.FreeUpperProfileShell?.getSession() && !!document.querySelector('bottom-nav [data-nav-key=create]'),beforeAccount);
  assert.equal(await h.page.locator('iframe[data-fu-mounted=create]').count(),0);assert.equal(await h.page.evaluate(()=>FreeUpperProfileShell.status().snapshots),0);
  await h.select('create');await h.page.evaluate(()=>{localStorage.setItem('old-document-marker',pageMarker);sessionExpiry=Date.now()/1000+0.2;authListeners.forEach(f=>f('TOKEN_REFRESHED',{user:{id:actor},expires_at:sessionExpiry}));});
  await h.page.waitForFunction(()=>window.pageMarker && pageMarker!==localStorage.getItem('old-document-marker') && !!window.FreeUpperProfileShell?.getSession());assert.equal(await h.page.locator('iframe[data-fu-mounted=create]').count(),0);
  await h.page.evaluate(()=>switchActor(null));await h.page.waitForFunction(()=>!!window.AuthUser && !AuthUser.getCurrentUser().isLoggedIn && !window.FreeUpperProfileShell?.getSession());
  assert.equal(await h.page.locator('iframe[data-fu-mounted]').count(),0);
}
test('account changes, expiration and logout dispose drafts and retained data',{timeout:60000},async()=>{
 const h=await harness({root:'search'});try{await accountBoundaries(h);assert.deepEqual(h.errors,[]);}finally{await h.close();}
});
test('PWA account boundaries clear the launch document and child screens',{timeout:60000},async()=>{
 const h=await harness({root:'search',pwa:true});try{await accountBoundaries(h);assert.deepEqual(h.errors,[]);}finally{await h.close();}
});

test('direct query links and guest tab navigation keep native URL behavior',{timeout:45000},async()=>{
 const direct=await harness({root:'search',route:'/search.html?q=deep-link'});
 try{await direct.page.waitForFunction(()=>document.getElementById('resultsContainer').textContent.includes('deep-link'));await direct.select('create');await direct.select('search');assert.equal(await direct.page.locator('#searchInput').inputValue(),'deep-link');assert.deepEqual(direct.errors,[]);}finally{await direct.close();}
 const guest=await harness({guest:true});
 try{for(const key of ['search','create','video','profile','home']){await guest.page.locator('[data-nav-key='+key+']').click();await guest.page.waitForURL('**/'+names[key]+'.html');assert.equal(await guest.page.locator('[aria-current=page]').getAttribute('data-nav-key'),key);assert.equal(await guest.page.locator('.bottom-nav').count(),1);}assert.deepEqual(guest.errors,[]);}finally{await guest.close();}
});

test('cold Home and Profile handoffs retain the outer document and navigation',{timeout:45000},async t=>{
 for(const [root,destination] of [['profile','home'],['home','profile']]){
  const h=await harness({root,delay:350,prefetch:root!=='home'});try{
   if(root==='profile')await h.page.waitForFunction(()=>ProfileMounted.status().ready);
   await h.page.evaluate(()=>{window.launchNav=document.querySelector('bottom-nav');window.launchDoc=document;window.coldSample=null;addEventListener('fu-tab-active',e=>coldSample=e.detail);});
   const elapsed=await h.select(destination);
   const result=await h.page.evaluate(()=>({same:launchNav===document.querySelector('bottom-nav') && launchDoc===document,sample:coldSample,visible:getComputedStyle(document.querySelector('.bottom-nav')).visibility}));
   assert(result.same);assert.equal(result.visible,'visible');assert.equal(result.sample.mode,'cold');assert.deepEqual(h.errors,[]);t.diagnostic(`${destination}: ${result.sample.ms.toFixed(1)}ms commit, ${elapsed}ms tap-to-ready (350ms document fixture)`);
  }finally{await h.close();}
 }
});


test('owned renderers inherit suspension; native post links leave the managed tab frame',{timeout:45000},async()=>{
 const h=await harness();try{
  await h.select('profile');const profile=h.screen('profile');
  await profile.evaluate(async()=>{const frame=document.createElement('iframe');frame.id='ownedRenderer';frame.style.cssText='position:fixed;top:20px;left:20px;width:200px;height:200px';frame.src='/index.html?profileShell=1&fixtureRenderer=1';document.body.append(frame);await new Promise(r=>frame.onload=r);});
  assert(await profile.evaluate(()=>document.getElementById('ownedRenderer').contentWindow.FreeUpperScreen.isActive()));
  await h.select('home');assert.equal(await profile.evaluate(()=>document.getElementById('ownedRenderer').contentWindow.FreeUpperScreen.isActive()),false);
  await h.select('profile');assert(await profile.evaluate(()=>document.getElementById('ownedRenderer').contentWindow.FreeUpperScreen.isActive()));
  await h.select('search');const marker=await h.page.evaluate(()=>pageMarker);
  await h.screen('search').evaluate(()=>Router.openVideo('fixture-post'));
  await h.page.waitForURL('**/video.html?post=fixture-post');await h.page.waitForFunction(value=>window.pageMarker && pageMarker!==value,marker);
  assert.equal(await h.page.locator('[aria-current=page]').getAttribute('data-nav-key'),'video');assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});


test('Video launch keeps a dirty composer and both primary feeds within the draft retention bound',{timeout:45000},async()=>{
 const h=await harness({root:'video'});try{
  const marker=await h.page.evaluate(()=>pageMarker);
  await h.select('home');await h.select('profile');await h.select('create');const create=h.screen('create');await create.locator('#postContent').fill('Unsent from Video launch');
  await h.select('search');const status=await h.page.evaluate(()=>FreeUpperProfileShell.status());assert(status.documents<=5);assert.equal(status.limit,5);
  await h.select('profile');assert((await h.page.evaluate(()=>FreeUpperProfileShell.status())).documents<=4);assert.equal(await create.locator('#postContent').inputValue(),'Unsent from Video launch');assert.equal(await h.page.evaluate(()=>pageMarker),marker);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
