import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium,webkit} from '@playwright/test';
import {profileFixtureParts as fixture} from './helpers/profile-navigation-fixture.js';
const nav=await readFile(new URL('../bottom-nav.js',import.meta.url),'utf8');
const shell=await readFile(new URL('../profile-shell.js',import.meta.url),'utf8');
const engine=process.env.FREEUPPER_PROFILE_ENGINE || 'chromium';
const pwa=!!process.env.FREEUPPER_PROFILE_PWA;
const sessionSetup=`
if(window===top){window.testSession={user:{id:'viewer'},expires_at:Date.now()/1000+3600};window.pageMarker=crypto.randomUUID();}
window.authListeners=[];window.userListeners=[];
const originalDetailFactory=window.createProfileDetailNavigation;window.createProfileDetailNavigation=options=>{window.testDetailOptions=options;return originalDetailFactory(options);};
window.AuthUser.getCurrentUser=()=>{const id=top.testSession?.user.id;return id?{id,isLoggedIn:true,displayName:id+' name',avatar:people[id]?.avatar_url}:{id:'guest',isLoggedIn:false};};
window.AuthUser.onChange=f=>userListeners.push(f);
window.sb.auth={getSession:async()=>({data:{session:top.testSession}}),onAuthStateChange:f=>{authListeners.push(f);queueMicrotask(()=>f('INITIAL_SESSION',top.testSession));return {data:{subscription:{unsubscribe(){}}}};}};
window.switchActor=(id)=>{top.testSession=id?{user:{id},expires_at:Date.now()/1000+3600}:null;const windows=[top,...Array.from(top.frames)];for(const win of windows)try{win.authListeners?.slice().forEach(f=>f(id?'SIGNED_IN':'SIGNED_OUT',top.testSession));win.userListeners?.slice().forEach(f=>f(win.AuthUser.getCurrentUser()));}catch(_){};};
window.PostsAPI.loadProfilePage=async(id,{offset=0,limit=24}={})=>{
 calls.push({kind:'page',id,offset,limit});
 const response=await fetch('/fixture/primary?id='+encodeURIComponent(id),{headers:{Authorization:'Bearer fixture-session'}});if(!response.ok)throw Error('Offline');
 const {total}=await response.json();
 return {total,posts:Array.from({length:Math.min(limit,total-offset)},(_,i)=>({id:'own-'+id+'-'+(i+offset),user_id:id,title:id+' post '+(i+offset),timestamp:'2026-01-01',quotedPost:i+offset===0?{id:'foreign-original',user_id:'friend0',visibility:'public',content:'Previously public original'}:null,mediaType:'image',mediaUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>'+id+' '+(i+offset)+'</text></svg>')}))};
};
window.applyTheme=theme=>document.documentElement.dataset.theme=theme;
`;
async function mountedHarness({root='home',delay=120,hydrated=true}={}){
 const documents=[];let failPrimary=false;
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://local');
  if(url.pathname==='/bottom-nav.js'){res.setHeader('Content-Type','text/javascript');res.end(nav);return;}
  if(url.pathname==='/profile-shell.js'){res.setHeader('Content-Type','text/javascript');res.end(shell);return;}
  if(url.pathname==='/service-worker.js'){res.setHeader('Content-Type','text/javascript');res.end(fixture.worker);return;}
  if(url.pathname==='/fixture/primary'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');setTimeout(()=>{if(failPrimary){res.writeHead(503);res.end('{}');}else res.end(JSON.stringify({total:40}));},delay);return;}
  if(url.pathname.endsWith('.css')){res.setHeader('Content-Type','text/css');res.end('');return;}
  res.setHeader('Content-Type','text/html');
  if(url.pathname==='/profile.html'){
   documents.push(req.url);
   res.end(fixture.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',`<script>${fixture.cache}</script><script>${fixture.bootstrap}</script><script>${sessionSetup}</script><script>${fixture.main}</script><script src="/bottom-nav.js?v=mounted-profile-v1"></script></body>`));return;
  }
  if(url.pathname.endsWith('.html') || url.pathname==='/')documents.push(req.url);
  res.end(`<!doctype html><html data-theme="dark"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}#home{height:100vh;overflow:auto}bottom-nav{position:fixed;bottom:0;z-index:100}a{display:inline-block;padding:16px;background:white;color:black}</style><main id="home"><h1>Home</h1><div style="height:3000px">Retained home feed</div></main><bottom-nav></bottom-nav><script>${fixture.bootstrap}</script><script>${sessionSetup}</script><script src="/bottom-nav.js?v=mounted-profile-v1"></script><script>window.__fuInitialHydrated=${hydrated};if(window.__fuInitialHydrated)requestAnimationFrame(()=>dispatchEvent(new Event('fu-app-hydrated')));</script></html>`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await (engine==='webkit'?webkit.launch():chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']})).catch(async e=>{await new Promise(r=>server.close(r));throw e;});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);if(process.env.FREEUPPER_DEBUG)console.error(e.message);});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await page.goto(origin+(root==='profile'?'/profile.html':'/index.html'));
 if(pwa){await page.evaluate(async()=>{await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;});await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);}
 await page.waitForFunction(()=>!!window.FreeUpperProfileShell?.getSession(),null,{timeout:10000}).catch(async error=>{console.error(await page.evaluate(()=>({shell:!!window.FreeUpperProfileShell,user:AuthUser.getCurrentUser(),scripts:[...document.scripts].map(s=>s.src)})));await browser.close();await new Promise(r=>server.close(r));throw error;});
 const profile=()=>root==='profile'?page.mainFrame():page.frames().find(f=>f!==page.mainFrame()&&new URL(f.url()).pathname==='/profile.html');
 return {page,context,errors,documents,profile,setPrimaryFailure:value=>{failPrimary=value;},close:async()=>{await browser.close();await new Promise(r=>server.close(r));}};
}
async function ready(h){await h.page.waitForFunction(()=>{const win=document.querySelector('iframe[data-fu-mounted="profile"]')?.contentWindow;return win?.ProfileMounted?.status().ready;},null,{timeout:10000}).catch(async error=>{console.error(await h.page.evaluate(()=>[...document.querySelectorAll('iframe')].map(f=>({src:f.src,status:f.contentWindow.ProfileMounted?.status(),text:f.contentDocument?.body?.textContent.slice(-300)}))));throw error;});return h.profile();}
test(`${engine}${pwa?'/PWA':''}: Home → Profile → Home restores complete first-frame DOM without documents or grid flashes`,{timeout:90000},async t=>{
 const h=await mountedHarness();try{
 const f=await ready(h);await f.waitForFunction(()=>document.querySelectorAll('#panel-posts .grid-card').length===24);
 assert.equal(await f.locator('#statPosts').textContent(),'40');assert.equal(await h.page.locator('iframe[data-fu-mounted=profile]').evaluate(el=>getComputedStyle(el).visibility),'hidden');
 assert.equal(await f.evaluate(()=>calls.filter(c=>c.kind==='page').length),1);assert.equal(await f.evaluate(()=>calls.filter(c=>c.kind==='page')[0].limit),24);
 assert.equal(await f.evaluate(()=>calls.filter(c=>c.kind==='can_view_profile_tab').length),0);
 const marker=await h.page.evaluate(()=>pageMarker);const documentCount=h.documents.length;
 const first=await h.page.evaluate(async()=>{const start=performance.now();document.querySelector('[data-nav-key="profile"]').click();await new Promise(requestAnimationFrame);const win=document.querySelector('iframe[data-fu-mounted=profile]').contentWindow;return {ms:performance.now()-start,name:win.document.getElementById('displayName').textContent,posts:win.document.getElementById('statPosts').textContent,cards:win.document.querySelectorAll('#panel-posts .grid-card').length,skeletons:win.document.querySelectorAll('#panel-posts .skl-block').length};});
 assert.equal(first.name,'viewer name');assert.equal(first.posts,'40');assert.equal(first.cards,24);assert.equal(first.skeletons,0);t.diagnostic(`warm first RAF: ${first.ms.toFixed(1)}ms`);
 await f.evaluate(()=>{window.savedCard=document.querySelector('#panel-posts .grid-card');document.getElementById('mainScroll').style.scrollBehavior='auto';document.getElementById('mainScroll').scrollTop=350;window.savedScroll=document.getElementById('mainScroll').scrollTop;});
 await f.locator('[data-nav-key=home]').click();assert.equal(await h.page.locator('iframe[data-fu-mounted=profile]').evaluate(el=>getComputedStyle(el).visibility),'hidden');
 const sample=await h.page.evaluate(async()=>{const start=performance.now();document.querySelector('[data-nav-key=profile]').click();await new Promise(requestAnimationFrame);const win=document.querySelector('iframe[data-fu-mounted=profile]').contentWindow;return {ms:performance.now()-start,same:win.savedCard===win.document.querySelector('#panel-posts .grid-card'),scroll:win.document.getElementById('mainScroll').scrollTop,expected:win.savedScroll,posts:win.document.getElementById('statPosts').textContent,skeletons:win.document.querySelectorAll('#panel-posts .skl-block').length};});
 assert(sample.same);assert.equal(sample.scroll,sample.expected);assert.equal(sample.posts,'40');assert.equal(sample.skeletons,0);t.diagnostic(`warm return first RAF: ${sample.ms.toFixed(1)}ms`);
 await f.evaluate(()=>{window.historyLength=history.length;document.querySelector('[data-nav-key=profile]').click();document.querySelector('[data-nav-key=profile]').click();document.querySelector('[data-nav-key=profile]').click();});
 assert.equal(await f.evaluate(()=>history.length),await f.evaluate(()=>historyLength));
 await h.page.goBack();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='home');
 await h.page.goForward();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='profile');
 assert(await f.evaluate(()=>savedCard===document.querySelector('#panel-posts .grid-card')));
 assert.equal(await h.page.evaluate(()=>pageMarker),marker);assert.equal(h.documents.length,documentCount);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test(`${engine}: cold Profile paints a coordinated summary and grid before unrelated tab requests`,{timeout:60000},async t=>{
 const h=await mountedHarness({hydrated:false,delay:180});try{
 assert.equal(await h.page.locator('iframe[data-fu-mounted=profile]').count(),0);
 const start=Date.now();await h.page.locator('[data-nav-key=profile]').click();const f=await ready(h);
 const elapsed=Date.now()-start;assert.equal(await f.locator('#statPosts').textContent(),'40');assert.equal(await f.locator('#panel-posts .grid-card').count(),24);t.diagnostic(`cold completion with 180ms API fixture delay: ${elapsed}ms`);
 assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test(`${engine}: standalone Profile stays mounted through Home and retains the selected tab`,{timeout:60000},async()=>{
 const h=await mountedHarness({root:'profile'});try{
 await h.page.waitForFunction(()=>ProfileMounted.status().ready);await h.page.evaluate(()=>{window.savedProfileCard=document.querySelector('#panel-posts .grid-card');window.rootProfileMarker=crypto.randomUUID();});
 await h.page.locator('[data-nav-key=home]').click();const home=h.page.frameLocator('iframe[data-fu-mounted=home]');await home.locator('[data-nav-key=profile]').click();await h.page.waitForFunction(()=>FreeUpperProfileShell.getActive()==='profile');
 assert(await h.page.evaluate(()=>savedProfileCard===document.querySelector('#panel-posts .grid-card')));
 await h.page.evaluate(()=>switchTab(document.querySelector('[data-tab=love]'),'love'));await h.page.locator('[data-nav-key=home]').click();await home.locator('[data-nav-key=profile]').click();assert.equal(await h.page.evaluate(()=>ProfileMounted.status().tab),'love');
 await h.page.evaluate(()=>switchActor('other'));await h.page.waitForFunction(()=>ProfileMounted.status().ownerId==='other'&&ProfileMounted.status().ready);assert.equal(await h.page.locator('#displayName').textContent(),'other name');assert.equal(await h.page.evaluate(()=>ProfileMounted.status().tab),'posts');
 assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test(`${engine}: offline own snapshots are session leased; sign-out and account changes discard mounted data`,{timeout:60000},async()=>{
 const h=await mountedHarness();try{
 const f=await ready(h);await h.page.locator('[data-nav-key=profile]').click();await f.locator('[data-nav-key=home]').click();await h.context.setOffline(true);
 await h.page.locator('[data-nav-key=profile]').click();assert.equal(await f.locator('#statPosts').textContent(),'40');assert.equal(await f.locator('#panel-posts .grid-card').count(),24);assert.equal(await f.evaluate(()=>testDetailOptions.getPost('own-viewer-0').quotedPost.unavailable),true);
 await h.context.setOffline(false);await h.page.evaluate(()=>switchActor(null));await h.page.waitForFunction(()=>!document.querySelector('iframe[data-fu-mounted=profile]'));assert.equal(await h.page.evaluate(()=>FreeUpperProfileShell.getSession()),null);
 await h.page.evaluate(()=>switchActor('other'));const next=await ready(h);assert.equal(await next.locator('#displayName').textContent(),'other name');assert.equal(await next.locator('#profileAvatar').getAttribute('src'),await next.evaluate(()=>people.other.avatar_url));
 assert.equal(await next.locator('#panel-posts .grid-card').count(),24);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test(`${engine}: mounted profile navigation retains existing relationship modal history`,{timeout:60000},async()=>{
 const h=await mountedHarness();try{
 const f=await ready(h);await h.page.locator('[data-nav-key=profile]').click();await f.waitForFunction(()=>document.getElementById('fsTabFrCount').textContent!==undefined);
 await f.evaluate(()=>openFollowModal('friends'));await f.locator('#fsVirtualContent2 .u-info').first().click();await f.waitForFunction(()=>document.getElementById('displayName').textContent!=='viewer name');
 await f.evaluate(()=>history.back());await f.waitForFunction(()=>document.getElementById('followModal').classList.contains('open'));assert.equal(await f.locator('#fsTitle').textContent(),'Friends');assert.equal(await f.locator('#displayName').textContent(),'viewer name');assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test(`${engine}: background refresh failures retain counts and valid thumbnails; offline leases expire closed`,{timeout:60000},async()=>{
 const h=await mountedHarness();try{
 const f=await ready(h);await h.page.locator('[data-nav-key=profile]').click();await f.evaluate(()=>{window.stableCard=document.querySelector('#panel-posts .grid-card');});
 await f.locator('[data-nav-key=home]').click();h.setPrimaryFailure(true);
 await h.page.evaluate(()=>{const now=Date.now()+61000;window.virtualNow=now;Date.now=()=>top.virtualNow;for(const frame of Array.from(frames))frame.Date.now=()=>top.virtualNow;});
 await h.page.locator('[data-nav-key=profile]').click();await f.waitForFunction(()=>calls.filter(c=>c.kind==='page').length>=2);
 assert.equal(await f.locator('#statPosts').textContent(),'40');assert(await f.evaluate(()=>stableCard===document.querySelector('#panel-posts .grid-card')));assert.equal(await f.locator('#panel-posts .skl-block').count(),0);
 await f.locator('[data-nav-key=home]').click();await h.context.setOffline(true);await h.page.evaluate(()=>{virtualNow+=300001;});await h.page.locator('[data-nav-key=profile]').click();
 assert.equal(await f.locator('#panel-posts .grid-card').count(),0);assert((await f.locator('#panel-posts').textContent()).includes('Connect to refresh'));
 assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
