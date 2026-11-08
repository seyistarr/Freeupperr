import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium,webkit} from '@playwright/test';
import {profileFixtureParts as profile} from './helpers/profile-navigation-fixture.js';

// Real page markup/CSS, coordinator, component and lifecycle; real Search,
// Profile and Video page code. Backend fixtures deliberately isolate latency,
// authorization boundaries and document navigation from external availability.
const routes={home:'/home',search:'/search',create:'/create',video:'/videos',profile:'/profile'};
const names={home:'index',search:'search',create:'create',video:'video',profile:'profile'};
const fixtureIcon='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>').toString('base64');
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
window.PostsAPI={loadFeedWithReposts:async()=>{requests.push('feed');await new Promise(r=>setTimeout(r,80));requests.push('feed-complete');return []},subscribe(){window.repostSubscriptions=(window.repostSubscriptions||0)+1;},loadProfilePage:async()=>({posts:[],total:0})};
window.switchActor=id=>{top.actor=id;localStorage.setItem('test-actor',id||'guest');for(const w of [top,...Array.from(top.frames)]){try{w.authListeners.forEach(f=>f(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id},expires_at:top.sessionExpiry}:null));w.userListeners.forEach(f=>f());}catch(_){}}};
})();
`;
async function harness({root='home',pwa=false,delay=100,route=null,guest=false,prefetch=true,holdFirstSearch=false,holdFirstCreate=false,holdFirstProfile=false,dataDelay=80,legacyWorker=false,coordinatorDelay=0,waitShell=true}={}){
 const documents=[];const errors=[];const offlineRequests=[];let transportOffline=false;let heldSearch=null,heldCreate=null;const heldProfiles=[];let profileRequestedResolve;const profileRequested=new Promise(resolve=>{profileRequestedResolve=resolve;});let workerUpdated=false;
 const server=createServer(async(req,res)=>{
  if(transportOffline){offlineRequests.push(req.url);res.destroy();return;}
  const url=new URL(req.url,'http://fixture');
  try{
   if(url.pathname==='/service-worker.js' && legacyWorker){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-cache');res.end(await readFile(workerUpdated?'service-worker.js':'tests/fixtures/service-worker-v26.js'));return;}
   if(url.searchParams.has('fixtureRenderer')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><head><script src="/js/freeupper-routes.js?v=clean-urls-v1"></script><script src="/js/screen-lifecycle.js?v=sidebar-v1"></script></head><body><input id="rendererInput"><main>Owned renderer</main></body>');return;}
   const key=Object.keys(names).find(key=>url.pathname==='/'+names[key]+'.html' || url.pathname===routes[key]) || (url.pathname.startsWith('/u/')||url.pathname.startsWith('/@')?'profile':null);
   if(!key){if(url.pathname==='/profile-shell.js' && coordinatorDelay)await new Promise(r=>setTimeout(r,coordinatorDelay));const path=url.pathname==='/'?'/index.html':url.pathname;const body=await readFile('.'+path);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream');res.end(body);return;}
   documents.push({url:req.url,time:Date.now()});
   let html=sources[key].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*https:[^>]*>/gi,'');
   // Keep decorative share icons local, like the fixture's mocked backend
   // and stripped external scripts/styles. WebKit reports aborted third-party
   // image requests as page errors when the PWA is switched offline.
   html=html.replace(/(<img\b[^>]*\bsrc=["'])https:\/\/cdn-icons-png\.flaticon\.com\/[^"']+(["'])/gi,(_match,before,after)=>before+fixtureIcon+after);
   let code=key==='search'?'<script src="/search.js?v=interaction-sounds-v4"></script>':key==='create'?'<script>const state={postMedia:[],marketImages:[],postEmbeddings:[]};'+createGuard+';window.handlePostUpload=event=>{window.handedFiles=Array.from(event.target.files);};</script>':key==='video'?'<script>'+videoMain+'</script>':key==='profile'?'<script>'+profile.cache+'</script><script>'+profile.bootstrap+'</script><script>window.fixtureSB=window.sb;</script><script>'+bootstrap.replace('setTimeout(r,80)','setTimeout(r,'+dataDelay+')')+'</script><script>sb.from=fixtureSB.from;sb.rpc=fixtureSB.rpc;</script><script>'+profile.main+'</script>':`<script>window.__fuInitialHydrated=${prefetch};addEventListener("DOMContentLoaded",()=>{if(window.__fuInitialHydrated)dispatchEvent(new Event("fu-app-hydrated"));});</script>`;
   // Profile fixture provides identity/relationship RPCs; keep shared auth and
   // realtime semantics from this harness, and its real production page logic.
   html=html.replace('<head>','<head><script src="/js/freeupper-routes.js?v=clean-urls-v1"></script><script>'+bootstrap.replace('setTimeout(r,80)','setTimeout(r,'+dataDelay+')')+'</script><script src="/js/screen-lifecycle.js?v=sidebar-v1"></script><script src="/theme.js?v=2"></script>');
   html=html.replace('</body>',code+'<script src="/router.js?v=clean-urls-v1"></script><script src="/side-nav.js?v=sidebar-v1"></script><script src="/bottom-nav.js?v=sidebar-v1"></script></body>');
   res.setHeader('Content-Type','text/html');if(holdFirstProfile && key==='profile' && url.searchParams.has('fuMounted')){heldProfiles.push(()=>res.end(html));profileRequestedResolve();}else if(holdFirstCreate && key==='create' && url.searchParams.has('fuMounted'))heldCreate=()=>res.end(html);else if(holdFirstSearch && key==='search' && url.searchParams.has('fuMounted'))heldSearch=()=>setTimeout(()=>res.end(html),delay);else setTimeout(()=>res.end(html),url.searchParams.has('fuMounted')?delay:0);
  }catch(e){res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const engine=process.env.FREEUPPER_PROFILE_ENGINE==='webkit'?webkit:chromium;
 const browser=await engine.launch(engine===chromium?{executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']}:{}).catch(async error=>{await new Promise(r=>server.close(r));throw error;});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route(url=>url.origin!==origin,r=>r.abort());
 if(guest)await context.addInitScript(()=>localStorage.setItem('test-actor','guest'));
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>{errors.push(e.message);if(process.env.FREEUPPER_DEBUG)console.error(e.message);});
 await page.goto(origin+(route || routes[root]),{waitUntil:waitShell?'load':'domcontentloaded'});
 if(pwa){await page.evaluate(async()=>{await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;});await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);}
 if(!guest && waitShell)await page.waitForFunction(()=>!!window.FreeUpperProfileShell?.getSession());
 const screen=key=>key===root?page.mainFrame():page.frames().find(f=>f!==page.mainFrame() && f.url() && new URL(f.url()).pathname==='/'+names[key]+'.html');
 const select=async key=>{const start=Date.now();await page.locator('bottom-nav [data-nav-key='+key+']').click();await page.waitForFunction(k=>FreeUpperProfileShell.getActive()===k,key).catch(async e=>{console.error(key,errors,await page.evaluate(()=>({status:FreeUpperProfileShell.status(),frames:[...document.querySelectorAll('iframe[data-fu-mounted]')].map(f=>({src:f.src,html:f.contentDocument?.body?.textContent.slice(0,120),ready:f.contentWindow.FreeUpperScreen?.isReady(),controller:!!f.contentWindow.navigator.serviceWorker.controller,scripts:[...f.contentDocument.scripts].map(s=>s.src)}))})));throw e;});if(key!==root)await page.waitForFunction(k=>document.querySelector('iframe[data-fu-mounted='+k+']')?.dataset.loaded==='true',key);return Date.now()-start;};
 const releaseSearch=()=>{holdFirstSearch=false;heldSearch?.();heldSearch=null;};
 const waitForProfileRequest=async()=>{let timeout;try{await Promise.race([profileRequested,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Profile prefetch did not request its document')),12000);})]);}finally{clearTimeout(timeout);}};
 const releaseProfile=()=>{holdFirstProfile=false;heldProfiles.splice(0).forEach(release=>release());};
 return {page,screen,select,errors,documents,offlineRequests,origin,disconnectTransport:()=>{transportOffline=true;},releaseSearch,waitForProfileRequest,releaseProfile,releaseCreate:()=>{holdFirstCreate=false;heldCreate?.();},updateWorker:()=>{workerUpdated=true;},close:async()=>{releaseSearch();releaseProfile();holdFirstCreate=false;heldCreate?.();await browser.close();await new Promise(r=>server.close(r));}};
}

test('five tabs: cold/warm timing, persistent nav identity, state, geometry, history and bounded retention',{timeout:120000},async t=>{
 const h=await harness({holdFirstSearch:true});const samples=[];let cdp;const memory=[];
 if(process.env.FREEUPPER_PROFILE_ENGINE!=='webkit'){cdp=await h.page.context().newCDPSession(h.page);await cdp.send('Performance.enable');}
 try{
  await h.page.evaluate(()=>{window.originalNav=document.querySelector('bottom-nav');window.originalDocument=document;window.navigationSamples=[];addEventListener('fu-tab-active',e=>{const sample={...e.detail};navigationSamples.push(sample);const received=performance.now();requestAnimationFrame(()=>{sample.firstFrameMs=sample.ms+performance.now()-received;});});});
  // A blocked cold document shows its usable shell in the tap task.
  const cold=await h.page.evaluate(async()=>{const start=performance.now();document.querySelector('[data-nav-key=search]').click();await new Promise(requestAnimationFrame);const frame=document.querySelector('[data-fu-mounted=search]');return {ms:performance.now()-start,selected:document.querySelector('bottom-nav [aria-current=page]').dataset.navKey,hidden:frame?getComputedStyle(frame).visibility:'hidden',home:getComputedStyle(document.querySelector('.top-header')).visibility,nav:getComputedStyle(document.querySelector('.bottom-nav')).visibility,shell:document.querySelector('[data-fu-mounted=shell]').hidden,shellTitle:document.querySelector('[data-fu-mounted=shell] h1').textContent};});
  assert.equal(cold.selected,'search');assert.equal(cold.hidden,'hidden');assert.equal(cold.home,'hidden');assert.equal(cold.shell,false);assert.equal(cold.shellTitle,'Search');assert.equal(cold.nav,'visible');
  await h.page.locator('[data-fu-mounted=shell] input').fill('cold query');
  h.releaseSearch();await h.page.waitForFunction(()=>document.querySelector('iframe[data-fu-mounted=search]')?.dataset.loaded==='true');
  assert.equal(await h.screen('search').locator('#searchInput').inputValue(),'cold query');
  const search=h.screen('search');await search.locator('#searchInput').fill('retained query');await search.evaluate(()=>Search.runSearch('retained query'));await search.waitForFunction(()=>document.getElementById('resultsContainer').textContent.includes('retained query'));
  await search.evaluate(()=>{window.savedResults=document.getElementById('resultsContainer').firstElementChild;document.getElementById('resultsContainer').insertAdjacentHTML('beforeend','<div style="height:2000px">Scroll fixture</div>');document.getElementById('mainScroll').scrollTop=240;});
  const count=await search.evaluate(()=>queryCalls);const oldSearchDoc=search;
  samples.push({kind:'create',coldMs:await h.select('create')});const composer=h.screen('create');await composer.locator('#postContent').fill('Unsent work');
  await h.select('home');const before=h.documents.length;
  const warm=await h.page.evaluate(async()=>{const start=performance.now();document.querySelector('[data-nav-key=search]').click();await new Promise(requestAnimationFrame);const win=document.querySelector('[data-fu-mounted=search]').contentWindow;return {ms:performance.now()-start,same:win.savedResults===win.document.getElementById('resultsContainer').firstElementChild,scroll:win.document.getElementById('mainScroll').scrollTop};});
  assert(warm.same);assert.equal(warm.scroll,240);assert.equal(await search.locator('#searchInput').inputValue(),'retained query');assert.equal(await search.evaluate(()=>queryCalls),count);assert.equal(h.documents.length,before);samples.push({kind:'search',warmMs:warm.ms});
  // WebKit/WPE's WAV backend does not seek this silent fixture: its timestamp
  // assertion uses a finite media double; native play/pause is still exercised.
  // Video keeps the initialized Search document and the composer draft alive.
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
  await h.select('search');const restored=h.screen('search');assert.equal(await restored.locator('#searchInput').inputValue(),'retained query');assert.equal(await restored.locator('#mainScroll').evaluate(el=>el.scrollTop),240);assert.equal(restored,oldSearchDoc);
  for(let round=0;round<4;round++){for(const key of ['create','video','profile','home','search']){
   await h.select(key);
   const state=await h.page.evaluate(()=>({status:FreeUpperProfileShell.status(),same:originalNav===document.querySelector('bottom-nav'),doc:originalDocument===document,nav:document.querySelector('.bottom-nav').getBoundingClientRect().toJSON(),hit:document.elementFromPoint(30,innerHeight-32)?.closest('bottom-nav')===originalNav,visible:[...document.querySelectorAll('iframe[data-fu-mounted]')].filter(f=>getComputedStyle(f).visibility==='visible').length}));
   assert(state.same);assert(state.doc);assert(state.status.documents<=5,JSON.stringify(state));assert.equal(state.nav.height,64);assert(state.hit);assert(state.visible<=1);
   assert.equal(await h.page.locator('bottom-nav [aria-current=page]').getAttribute('data-nav-key'),key);
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
  await h.page.setViewportSize({width:1024,height:768});await h.page.locator('side-nav [data-side-key=search]').click();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='search');assert(await h.page.evaluate(()=>originalDocument===document));
  await h.page.setViewportSize({width:390,height:844});await h.select('home');
  const rapid=await h.page.evaluate(()=>{const before=history.length;for(const key of ['search','search','create','create','video','video','profile','profile','home','home'])document.querySelector('[data-nav-key='+key+']').click();return {added:history.length-before,kinds:[...document.querySelectorAll('iframe[data-fu-mounted]')].map(f=>f.dataset.fuMounted)};});assert.equal(rapid.added,5);assert.equal(new Set(rapid.kinds).size,rapid.kinds.length);await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='home');
  assert.deepEqual(h.errors,[]);await writeFile('/tmp/freeupper-five-tab-'+(process.env.FREEUPPER_PROFILE_ENGINE || 'chromium')+'-timings.json',JSON.stringify(samples,null,2));t.diagnostic(JSON.stringify(Object.keys(names).map(kind=>({kind,warmMs:samples.filter(s=>s.kind===kind && s.mode==='warm').map(s=>Number(s.ms.toFixed(1))),coldMs:samples.filter(s=>s.kind===kind && s.mode==='cold').map(s=>Number(s.ms.toFixed(1)))}))));
 }finally{await h.close();}
});

test('PWA direct Search: Back/Forward, retention and offline navigation',{timeout:90000},async()=>{
 const h=await harness({root:'search',pwa:true});try{
  await h.select('video');await h.select('create');await h.screen('create').locator('#postContent').fill('Retained offline draft');await h.select('profile');await h.select('home');
  await h.page.goBack();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='profile');await h.page.goForward();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='home');
  // All initialized documents restore offline in both engines.
  await h.page.context().setOffline(true);await h.select('video');assert(await h.page.evaluate(()=>FreeUpperProfileShell.status().documents<=FreeUpperProfileShell.status().limit));await h.select('search');assert.equal(await h.screen('search').locator('#searchInput').inputValue(),'');await h.page.context().setOffline(false);
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
 try{await direct.page.waitForFunction(()=>document.getElementById('resultsContainer').textContent.includes('deep-link'));await direct.select('create');await direct.select('search');assert.equal(new URL(direct.page.url()).pathname,'/search');assert.equal(new URL(direct.page.url()).search,'?q=deep-link');assert.equal(await direct.page.locator('#searchInput').inputValue(),'deep-link');assert.deepEqual(direct.errors,[]);}finally{await direct.close();}
 const guest=await harness({guest:true});
 try{for(const key of ['search','create','video','profile','home']){await guest.page.locator('[data-nav-key='+key+']').click();await guest.page.waitForURL('**'+routes[key]);assert.equal(await guest.page.locator('bottom-nav [aria-current=page]').getAttribute('data-nav-key'),key);assert.equal(await guest.page.locator('.bottom-nav').count(),1);}assert.deepEqual(guest.errors,[]);}finally{await guest.close();}
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
  await h.page.waitForURL('**/videos?post=fixture-post');await h.page.waitForFunction(value=>window.pageMarker && pageMarker!==value,marker);
  assert.equal(await h.page.locator('bottom-nav [aria-current=page]').getAttribute('data-nav-key'),'video');assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});


test('Video launch keeps a dirty composer and both primary feeds within the draft retention bound',{timeout:45000},async()=>{
 const h=await harness({root:'video'});try{
  const marker=await h.page.evaluate(()=>pageMarker);
  await h.select('home');await h.select('profile');await h.select('create');const create=h.screen('create');await create.locator('#postContent').fill('Unsent from Video launch');
  await h.select('search');const status=await h.page.evaluate(()=>FreeUpperProfileShell.status());assert(status.documents<=5);assert.equal(status.limit,5);
  await h.select('profile');assert((await h.page.evaluate(()=>FreeUpperProfileShell.status())).documents<=5);assert.equal(await create.locator('#postContent').inputValue(),'Unsent from Video launch');assert.equal(await h.page.evaluate(()=>pageMarker),marker);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('full-screen overlays keep their original stacking while the single navigation node stays mounted',{timeout:45000},async()=>{
 const h=await harness();try{
  await h.page.evaluate(()=>{const toast=document.createElement('div');toast.id='stackingToast';toast.setAttribute('role','status');toast.style.cssText='position:fixed;bottom:0;left:0;width:100%;height:40px;z-index:9999';document.body.append(toast);});await h.page.evaluate(()=>new Promise(requestAnimationFrame));assert.equal(await h.page.locator('.bottom-nav').evaluate(el=>getComputedStyle(el).visibility),'visible');await h.page.evaluate(()=>document.getElementById('stackingToast').remove());
  await h.page.evaluate(()=>{window.overlayNav=document.querySelector('bottom-nav');const modal=document.createElement('section');modal.id='stackingModal';modal.setAttribute('role','dialog');modal.style.cssText='position:fixed;inset:0;z-index:120;background:var(--bg)';modal.innerHTML='<button style="position:absolute;bottom:0;height:60px;width:100%">Modal control</button>';document.body.append(modal);});
  await h.page.waitForFunction(()=>getComputedStyle(document.querySelector('.bottom-nav')).visibility==='hidden');assert(await h.page.evaluate(()=>overlayNav===document.querySelector('bottom-nav')));
  await h.page.evaluate(()=>document.getElementById('stackingModal').remove());await h.page.waitForFunction(()=>getComputedStyle(document.querySelector('.bottom-nav')).visibility==='visible');
  await h.select('search');const search=h.screen('search');await search.evaluate(()=>{const modal=document.createElement('section');modal.id='stackingModal';modal.setAttribute('role','dialog');modal.style.cssText='position:fixed;inset:0;z-index:120;background:var(--bg)';modal.innerHTML='<button id="modalBottomControl" style="position:absolute;bottom:0;height:60px;width:100%" onclick="window.modalTapped=true">Modal control</button>';document.body.append(modal);});
  await h.page.waitForFunction(()=>getComputedStyle(document.querySelector('.bottom-nav')).visibility==='hidden');await search.locator('#modalBottomControl').click();assert(await search.evaluate(()=>modalTapped));
  await search.evaluate(()=>document.getElementById('stackingModal').remove());await h.page.waitForFunction(()=>getComputedStyle(document.querySelector('.bottom-nav')).visibility==='visible');
  await h.select('home');assert(await h.page.evaluate(()=>overlayNav===document.querySelector('bottom-nav')));assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});


test('v26 PWA controller and waiting update retain clean navigation and an unsent draft',{timeout:60000},async()=>{
 const h=await harness({pwa:true,legacyWorker:true});try{
  await h.select('search');await h.select('video');await h.select('create');
  await h.screen('create').locator('#postContent').fill('Draft across a waiting worker update');
  const marker=await h.page.evaluate(()=>pageMarker);
  h.updateWorker();
  await h.page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Update did not wait')),10000);const check=()=>{if(registration.waiting){clearTimeout(timer);resolve();}};check();registration.installing?.addEventListener('statechange',check);registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',check));});});
  assert.equal(await h.page.evaluate(()=>pageMarker),marker);
  assert.equal(await h.screen('create').locator('#postContent').inputValue(),'Draft across a waiting worker update');
  assert.equal(await h.page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting),true);
  await h.page.context().setOffline(true);
  await h.select('home');await h.select('create');
  assert(new URL(h.page.url()).pathname==='/create');
  assert.equal(await h.screen('create').locator('#postContent').inputValue(),'Draft across a waiting worker update');
  await h.page.context().setOffline(false);
  assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});


test('cold Create accepts text and files before HTML arrives and preserves them across tab switches',{timeout:45000},async t=>{
 const h=await harness({holdFirstCreate:true});try{
  const sample=await h.page.evaluate(async()=>{
   const start=performance.now();document.querySelector('[data-nav-key=create]').click();await new Promise(requestAnimationFrame);
   return {ms:performance.now()-start,title:document.querySelector('[data-fu-mounted=shell] h1').textContent,active:FreeUpperProfileShell.getActive()};
  });
  assert.equal(sample.active,'create');assert.equal(sample.title,'Create');
  await h.page.screenshot({path:'/tmp/freeupper-cold-create-'+(process.env.FREEUPPER_PROFILE_ENGINE || 'chromium')+'.png'});
  const shell=h.page.locator('[data-fu-mounted=shell]');
  await shell.locator('textarea').fill('Draft typed before the document loads');
  await shell.locator('input[type=file]').setInputFiles({name:'draft.txt',mimeType:'image/png',buffer:Buffer.from('attachment fixture')});
  await h.select('home');await h.page.locator('[data-nav-key=create]').click();
  assert.equal(await shell.locator('textarea').inputValue(),'Draft typed before the document loads');
  assert.match(await shell.textContent(),/1 attachment/);
  h.releaseCreate();await h.page.waitForFunction(()=>document.querySelector('iframe[data-fu-mounted=create]')?.dataset.loaded==='true');
  const create=h.screen('create');assert.equal(await create.locator('#postContent').inputValue(),'Draft typed before the document loads');
  assert.equal(await create.evaluate(async()=>handedFiles[0].text()),'attachment fixture');
  assert.equal(await h.page.locator('.fu-navigation-status').textContent(),'');assert.deepEqual(h.errors,[]);
  t.diagnostic('Cold Create first animation frame: '+sample.ms.toFixed(1)+'ms; HTML held until after typing and switching');
 }finally{await h.close();}
});

test('ten-second feed hydration does not gate Video visibility or warm returns',{timeout:45000},async t=>{
 // Isolate Home/Video document retention; the concurrent prefetch case below
 // separately exercises Profile creation during the same warm handoff.
 const h=await harness({dataDelay:10000,prefetch:false});try{
  const coldElapsed=await h.select('video');const video=h.screen('video');
  t.diagnostic('Cold Video tap-to-document-visible with 10s feed request: '+coldElapsed+'ms');
  assert.equal(await video.evaluate(()=>requests.includes('feed')),true);
  assert.equal(await video.evaluate(()=>FreeUpperScreen.isReady()),true);
  assert.equal(await video.evaluate(()=>requests.includes('feed-complete')),false);
  assert.equal(h.documents.length,2);
  const before=h.documents.length;await h.select('home');
  const sample=await h.page.evaluate(async()=>{const start=performance.now();document.querySelector('[data-nav-key=video]').click();await new Promise(requestAnimationFrame);return {ms:performance.now()-start,visible:getComputedStyle(document.querySelector('iframe[data-fu-mounted=video]')).visibility};});
  assert.equal(sample.visible,'visible');assert.equal(h.documents.length,before,JSON.stringify(h.documents));
  assert.equal(await video.evaluate(()=>requests.includes('feed-complete')),false);assert.deepEqual(h.errors,[]);
  t.diagnostic('Warm Video first animation frame during 10s feed request: '+sample.ms.toFixed(1)+'ms');
 }finally{await h.close();}
});

test('ten-second feed: Profile prefetch overlaps warm navigation without reloading retained screens',{timeout:45000},async()=>{
 const h=await harness({dataDelay:10000,prefetch:false,holdFirstProfile:true});try{
  await h.select('video');const video=h.screen('video');
  const visitedURLs=['/home','/video.html?fuMounted=1'];
  assert.deepEqual(h.documents.map(d=>d.url),visitedURLs);
  await h.page.evaluate(()=>{
   window.retainedHomeDocument=document;
   const win=document.querySelector('iframe[data-fu-mounted=video]').contentWindow;
   window.retainedVideoDocument=win.document;window.retainedFeedTrack=win.document.getElementById('feedTrack');
  });
  await h.select('home');assert.equal(await video.evaluate(()=>FreeUpperScreen.isActive()),false);
  // Finish Home hydration only after recording the two visited documents.
  // Use the real coordinator's 250ms prefetch; hold its HTML response to force
  // Profile initialization to overlap the warm Video return deterministically.
  await h.page.evaluate(()=>{window.__fuInitialHydrated=true;dispatchEvent(new Event('fu-app-hydrated'));});
  await h.waitForProfileRequest();
  const profileURL='/profile.html?fuMounted=1';
  assert.deepEqual(h.documents.slice(visitedURLs.length).map(d=>d.url),[profileURL]);
  const during=await h.page.evaluate(async()=>{
   document.querySelector('[data-nav-key=video]').click();await new Promise(requestAnimationFrame);
   const frame=document.querySelector('iframe[data-fu-mounted=video]'),profile=document.querySelector('iframe[data-fu-mounted=profile]');
   return {active:FreeUpperProfileShell.getActive(),videoVisible:getComputedStyle(frame).visibility,videoActive:frame.contentWindow.FreeUpperScreen.isActive(),
    sameHome:document===retainedHomeDocument,sameVideo:frame.contentDocument===retainedVideoDocument,
    sameTrack:frame.contentDocument.getElementById('feedTrack')===retainedFeedTrack,
    profileHidden:getComputedStyle(profile).visibility==='hidden' && profile.inert,
    profileState:FreeUpperProfileShell.status().screens.profile,feedPending:!frame.contentWindow.requests.includes('feed-complete')};
  });
  assert.deepEqual(during,{active:'video',videoVisible:'visible',videoActive:true,sameHome:true,sameVideo:true,sameTrack:true,profileHidden:true,profileState:'Initializing',feedPending:true});
  // Account for precisely the one expected background request, rejecting any
  // repeated visited tab, unexpected tab or duplicate Profile document.
  assert.deepEqual(h.documents.filter(d=>d.url!==profileURL).map(d=>d.url),visitedURLs);
  assert.deepEqual(h.documents.filter(d=>d.url===profileURL).map(d=>d.url),[profileURL]);
  h.releaseProfile();await h.page.waitForFunction(()=>document.querySelector('iframe[data-fu-mounted=profile]')?.dataset.loaded==='true');
  assert.equal(await h.screen('profile').evaluate(()=>FreeUpperScreen.isActive()),false);
  assert.equal(await h.page.evaluate(()=>FreeUpperProfileShell.status().screens.profile),'Suspended');
  assert.equal(await h.page.evaluate(()=>FreeUpperProfileShell.getActive()),'video');
  const before=h.documents.length;
  await h.select('home');await h.select('video');
  assert.equal(h.documents.length,before,JSON.stringify(h.documents));
  assert(await h.page.evaluate(()=>document===retainedHomeDocument && document.querySelector('iframe[data-fu-mounted=video]').contentDocument===retainedVideoDocument));
  assert.equal(await video.evaluate(()=>requests.includes('feed-complete')),false);
  assert.deepEqual(h.errors,[]);
 }finally{await h.close();assert.equal(h.page.isClosed(),true);assert.equal(h.page.context().pages().length,0);}
});

test('installed PWA serves managed HTML shells without a network navigation round trip',{timeout:45000},async()=>{
 const h=await harness({pwa:true,holdFirstSearch:true});try{
  const before=h.documents.filter(x=>x.url.includes('fuMounted')).length;
  await h.select('search');
  assert.equal(h.documents.filter(x=>x.url.includes('fuMounted')).length,before);
  assert.equal(await h.screen('search').evaluate(()=>FreeUpperScreen.isReady()),true);
  assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});


// Exercise the shared rail at desktop/iPad width in both Chromium and mobile
// WebKit; the very same root component becomes the bottom bar at phone width.
async function sidebarSelect(h,key){
 await h.page.locator('side-nav .side-btn[data-side-key='+key+']').click();
 await h.page.waitForFunction(k=>FreeUpperProfileShell.getActive()===k,key).catch(async error=>{console.error('sidebar destination',key,h.errors,await h.page.evaluate(()=>({status:FreeUpperProfileShell.status(),frames:[...document.querySelectorAll('iframe[data-fu-mounted]')].map(f=>({kind:f.dataset.fuMounted,url:f.contentWindow.location.href,ready:f.contentWindow.FreeUpperScreen?.isReady()}))})));throw error;});
 if(key!=='home')await h.page.waitForFunction(k=>document.querySelector('iframe[data-fu-mounted='+k+']')?.dataset.loaded==='true',key).catch(async error=>{console.error('sidebar content',key,h.errors,await h.page.evaluate(()=>({status:FreeUpperProfileShell.status(),frames:[...document.querySelectorAll('iframe[data-fu-mounted]')].map(f=>({kind:f.dataset.fuMounted,url:f.contentWindow.location.href,ready:f.contentWindow.FreeUpperScreen?.isReady(),html:f.contentDocument?.body?.innerText.slice(0,100),scripts:[...f.contentDocument.scripts].map(s=>s.src)}))})));throw error;});
 assert.equal(await h.page.locator('side-nav .side-btn[aria-current=page]').getAttribute('data-side-key'),key);
 assert.equal(await h.page.locator('bottom-nav [aria-current=page]').getAttribute('data-nav-key'),key);
}

test('sidebar: blocked cold shell, all five destinations, warm state, logo, history and bounded rapid switching',{timeout:90000},async t=>{
 const h=await harness({prefetch:false,holdFirstSearch:true});
 try{
  await h.page.setViewportSize({width:1024,height:768});
  await h.page.evaluate(()=>{window.retainedRail=document.querySelector('side-nav');window.retainedLaunch=document;window.sidebarSamples=[];addEventListener('fu-tab-active',e=>sidebarSamples.push(e.detail));});
  const cold=await h.page.evaluate(async()=>{
   const start=performance.now();document.querySelector('side-nav [data-side-key=search]').click();await new Promise(requestAnimationFrame);
   const shell=document.querySelector('[data-fu-mounted=shell]'),rail=document.querySelector('side-nav .side-nav');
   return {ms:performance.now()-start,visible:!shell.hidden && getComputedStyle(shell).visibility==='visible',title:shell.querySelector('h1').textContent,interactive:!document.querySelector('side-nav').inert,hit:document.elementFromPoint(30,180)?.closest('side-nav')===retainedRail,clear:shell.getBoundingClientRect().left>=rail.getBoundingClientRect().right,opening:document.body.innerText.includes('Opening')};
  });
  assert(cold.visible);assert(cold.interactive);assert(cold.hit);assert(cold.clear);assert.equal(cold.title,'Search');assert.equal(cold.opening,false);
  await h.page.locator('[data-fu-mounted=shell] input').fill('cold sidebar query');
  // Escape a blocked cold screen using the same rail, then return to its shell.
  await sidebarSelect(h,'home');await h.page.locator('side-nav [data-side-key=search]').click();
  assert.equal(await h.page.locator('[data-fu-mounted=shell] input').inputValue(),'cold sidebar query');
  h.releaseSearch();await sidebarSelect(h,'search');const search=h.screen('search');
  await search.locator('#searchInput').fill('retained sidebar query');await search.evaluate(()=>Search.runSearch('retained sidebar query'));await search.waitForFunction(()=>document.getElementById('resultsContainer').textContent.includes('retained sidebar query'));
  await search.evaluate(()=>{window.savedDocument=document;document.getElementById('resultsContainer').innerHTML='<div style="height:2000px">Retained results</div>';document.getElementById('mainScroll').scrollTop=250;});
  await sidebarSelect(h,'create');const create=h.screen('create');await create.locator('#postContent').fill('Unsent sidebar draft');
  await create.locator('#postFileInput').setInputFiles({name:'draft.txt',mimeType:'text/plain',buffer:Buffer.from('draft attachment')});
  await sidebarSelect(h,'video');const video=h.screen('video');await video.evaluate(()=>{window.retainedTrack=document.getElementById('feedTrack');});
  await sidebarSelect(h,'profile');await sidebarSelect(h,'home');
  const before=h.documents.length;
  await h.page.context().setOffline(true);
  for(let round=0;round<3;round++)for(const key of ['search','create','video','profile','home'])await sidebarSelect(h,key);
  assert.equal(h.documents.length,before);assert.equal(before,5);
  assert.equal(await search.locator('#mainScroll').evaluate(el=>el.scrollTop),250);
  assert.equal(await create.locator('#postContent').inputValue(),'Unsent sidebar draft');
  assert.equal(await create.locator('#postFileInput').evaluate(el=>el.files[0].name),'draft.txt');
  assert(await search.evaluate(()=>document===savedDocument));assert(await video.evaluate(()=>retainedTrack===document.getElementById('feedTrack')));
  const warm=await h.page.evaluate(async()=>{
   const start=performance.now();document.querySelector('side-nav [data-side-key=search]').click();await new Promise(requestAnimationFrame);
   return {ms:performance.now()-start,visible:getComputedStyle(document.querySelector('iframe[data-fu-mounted=search]')).visibility,rail:retainedRail===document.querySelector('side-nav'),launch:retainedLaunch===document};
  });
  assert.equal(warm.visible,'visible');assert(warm.rail);assert(warm.launch);
  await h.page.locator('.side-logo a').click();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='home');assert.equal(h.documents.length,before);
  await h.page.goBack();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='search');await h.page.goForward();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='home');
  await h.page.evaluate(()=>{for(let n=0;n<15;n++)for(const key of ['video','create','profile','search','home'])document.querySelector('side-nav [data-side-key='+key+']').click();});
  assert.equal(await h.page.evaluate(()=>FreeUpperProfileShell.status().documents),5);assert.equal(h.documents.length,before);
  for(const key of ['search','create','video','profile'])assert.equal(await h.screen(key).locator('side-nav').count(),0);
  await h.page.setViewportSize({width:390,height:844});assert.equal(await h.page.locator('.side-nav').isVisible(),false);assert(await h.page.locator('.bottom-nav').isVisible());await h.select('create');
  await h.page.setViewportSize({width:1024,height:768});assert(await h.page.locator('.side-nav').isVisible());assert.equal(await h.page.locator('side-nav .side-btn[aria-current=page]').getAttribute('data-side-key'),'create');
  assert.equal(await create.locator('#postContent').inputValue(),'Unsent sidebar draft');assert.equal(h.documents.length,before);
  assert.deepEqual(h.errors,[]);t.diagnostic('Sidebar tap → first frame '+JSON.stringify({coldMs:cold.ms,warmMs:warm.ms,samples:await h.page.evaluate(()=>sidebarSamples.slice(0,8))}));
 }finally{await h.close();}
});

test('sidebar: shared bootstrap race retains latest intent without native reload',{timeout:30000},async()=>{
 const h=await harness({prefetch:false,coordinatorDelay:1200,waitShell:false});try{
  await h.page.setViewportSize({width:1024,height:768});
  assert.equal(await h.page.evaluate(()=>!!window.FreeUpperProfileShell),false);
  await h.page.evaluate(()=>{window.initialDoc=document;document.querySelector('side-nav [data-side-key=search]').click();document.querySelector('bottom-nav [data-nav-key=create]').click();document.querySelector('side-nav [data-side-key=video]').click();});
  await h.page.waitForFunction(()=>window.FreeUpperProfileShell?.getActive()==='video');
  await h.page.waitForFunction(()=>document.querySelector('iframe[data-fu-mounted=video]')?.dataset.loaded==='true');
  assert(await h.page.evaluate(()=>document===initialDoc));assert.deepEqual(h.documents.map(d=>d.url),['/home','/video.html?fuMounted=1']);
  assert.equal(await h.page.locator('side-nav .side-btn[aria-current=page]').getAttribute('data-side-key'),'video');assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('sidebar: native Chat exits the managed document at the top level',{timeout:30000},async()=>{
 const h=await harness({prefetch:false});try{
  await h.page.setViewportSize({width:1024,height:768});await sidebarSelect(h,'search');
  await h.page.context().route('**/messages',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Messages native route</title><main>Chat</main>'}));
  await h.page.locator('side-nav [data-side-key=chat]').click();await h.page.waitForURL(h.origin+'/messages');
  assert.equal(await h.page.title(),'Messages native route');assert.equal(h.page.frames().length,1);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('sidebar: desktop modal ownership, themes, accessible keyboard and account cleanup',{timeout:45000},async()=>{
 const h=await harness({prefetch:false});try{
  await h.page.setViewportSize({width:1024,height:768});await sidebarSelect(h,'search');const search=h.screen('search');
  await search.locator('#searchInput').fill('retained sidebar query');await search.evaluate(()=>Search.runSearch('retained sidebar query'));await search.waitForFunction(()=>document.getElementById('resultsContainer').textContent.includes('retained sidebar query'));
  await search.evaluate(()=>{const modal=document.createElement('div');modal.id='sidebarModal';modal.setAttribute('role','dialog');modal.style.cssText='position:fixed;inset:0;z-index:1000;background:var(--bg)';document.body.append(modal);});
  await h.page.waitForFunction(()=>document.querySelector('side-nav').inert);
  assert.equal(await h.page.locator('.side-nav').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  await search.locator('#sidebarModal').evaluate(el=>el.remove());await h.page.waitForFunction(()=>!document.querySelector('side-nav').inert);
  await h.page.evaluate(()=>applyTheme('light'));assert.equal(await search.evaluate(()=>document.documentElement.dataset.theme),'light');
  await h.page.locator('side-nav [data-side-key=create]').focus();await h.page.keyboard.press('Enter');await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='create');await sidebarSelect(h,'create');
  await h.screen('create').locator('#postContent').fill('Private account A draft');
  await h.page.evaluate(()=>switchActor('other-viewer'));await h.page.waitForFunction(()=>document.querySelectorAll('iframe[data-fu-mounted]').length===0);
  assert.equal(await h.page.evaluate(()=>[...document.querySelectorAll('textarea')].some(el=>el.value==='Private account A draft')),false);
  await h.page.waitForFunction(()=>window.actor==='other-viewer' && !!window.FreeUpperProfileShell?.getSession());
  await sidebarSelect(h,'create');assert.equal(await h.screen('create').locator('#postContent').inputValue(),'');assert.equal(await h.page.evaluate(()=>FreeUpperProfileShell.getSession().viewer),'other-viewer');assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('sidebar: installed PWA cold switches offline without another document fetch',{timeout:45000},async()=>{
 const h=await harness({prefetch:false,pwa:true});try{
  await h.page.setViewportSize({width:1024,height:768});// WebKit's emulated offline mode prevents even a cached new iframe from
  // committing. Disconnect the actual fixture transport instead, retaining
  // real SW/cache handling and offline privacy signals in every document.
  h.disconnectTransport();await h.page.context().addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));await h.page.evaluate(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));
  const before=h.documents.filter(d=>d.url.includes('fuMounted')).length;
  for(const key of ['search','create','video','profile','home'])await sidebarSelect(h,key);
  assert.equal(h.documents.filter(d=>d.url.includes('fuMounted')).length,before);
  assert.deepEqual(h.offlineRequests.filter(url=>url.includes('fuMounted')),[]);
  assert.equal(await h.page.evaluate(()=>FreeUpperProfileShell.status().documents),5);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('sidebar: guest navigation stays native and modified links retain browser behavior',{timeout:30000},async()=>{
 const h=await harness({guest:true,prefetch:false});try{
  await h.page.setViewportSize({width:1024,height:768});const before=h.documents.length;
  await h.page.locator('side-nav [data-side-key=search]').click();await h.page.waitForURL(h.origin+'/search');
  assert.equal(h.documents.length,before+1);assert.equal(await h.page.locator('iframe[data-fu-mounted]').count(),0);
  assert.equal(await h.page.locator('side-nav .side-btn[aria-current=page]').getAttribute('data-side-key'),'search');
  const untouched=await h.page.evaluate(()=>{const link=document.querySelector('side-nav [data-side-key=create]');const event=new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true});let handled;window.addEventListener('click',e=>{handled=e.defaultPrevented;e.preventDefault();},{once:true});link.dispatchEvent(event);return handled===false && link.target==='_top';});
  assert(untouched);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('sidebar: Video suspends native media and retains feed position on return',{timeout:30000},async()=>{
 const h=await harness({prefetch:false});try{
  await h.page.setViewportSize({width:1024,height:768});await sidebarSelect(h,'video');const video=h.screen('video');
  const wav=Buffer.alloc(44+8000*2*6);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  await video.evaluate(async src=>{const media=document.createElement('video');media.id='vid-0';media.src=src;media.muted=true;media.loop=true;document.body.append(media);await media.play();window.savedFeed=document.getElementById('feedTrack');},'data:audio/wav;base64,'+wav.toString('base64'));
  await sidebarSelect(h,'search');assert(await video.locator('#vid-0').evaluate(v=>v.paused));
  const position=await video.locator('#vid-0').evaluate(v=>v.currentTime);
  const count=h.documents.length;await sidebarSelect(h,'video');
  assert.equal(h.documents.length,count);assert(await video.evaluate(()=>savedFeed===document.getElementById('feedTrack')));
  assert(Math.abs(await video.locator('#vid-0').evaluate(v=>v.currentTime)-position)<0.25);assert.equal(await video.evaluate(()=>FreeUpperScreen.isActive()),true);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('sidebar: sustained history bursts keep the latest URL and Back cancels a pending write',{timeout:30000},async()=>{
 const h=await harness({prefetch:false});try{
  await h.page.setViewportSize({width:1024,height:768});for(const key of ['search','create','home'])await sidebarSelect(h,key);
  await h.page.evaluate(()=>{for(let n=0;n<30;n++)for(const key of ['search','create','home'])document.querySelector('side-nav [data-side-key='+key+']').click();document.querySelector('side-nav [data-side-key=search]').click();});
  assert.equal(await h.page.evaluate(()=>FreeUpperProfileShell.getActive()),'search');await h.page.waitForURL(h.origin+'/search');
  await h.page.evaluate(()=>document.querySelector('side-nav [data-side-key=create]').click());assert.equal(await h.page.evaluate(()=>FreeUpperProfileShell.getActive()),'create');
  await h.page.goBack();const back=h.page.url();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()===FreeUpperRoutes.screen(location.pathname));const expectedBack=await h.page.evaluate(()=>FreeUpperRoutes.screen(location.pathname));
  // Let the 300ms history batch become due; it must not undo Back.
  await h.page.waitForTimeout(350);assert.equal(h.page.url(),back);assert.equal(await h.page.evaluate(()=>FreeUpperProfileShell.getActive()),expectedBack);
  assert.equal(h.documents.length,3);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('sidebar: a native History SecurityError cannot block screen activation',{timeout:30000},async()=>{
 const h=await harness({prefetch:false});try{
  await h.page.setViewportSize({width:1024,height:768});await sidebarSelect(h,'create');await sidebarSelect(h,'home');
  const immediate=await h.page.evaluate(()=>{
   const push=history.pushState;history.pushState=function(...args){history.pushState=push;throw new DOMException('Native history quota exhausted','SecurityError');};
   document.querySelector('side-nav [data-side-key=search]').click();
   return {active:FreeUpperProfileShell.getActive(),shell:!document.querySelector('[data-fu-mounted=shell]').hidden};
  });
  assert.deepEqual(immediate,{active:'search',shell:true});await sidebarSelect(h,'search');
  await h.page.goBack();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='create');assert.equal(new URL(h.page.url()).pathname,'/create');assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
