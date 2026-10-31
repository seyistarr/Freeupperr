import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {chromium} from '@playwright/test';import vm from 'node:vm';import {postsFixture,id as postId} from './helpers/quote-posts-api-fixture.js';
const module=await readFile(new URL('../profile-detail.js',import.meta.url),'utf8');
const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
const profile=await readFile(new URL('../profile.html',import.meta.url),'utf8');
const api=index.slice(index.indexOf('            // The retained Profile supplies'),index.indexOf("            if (profileDetailEmbedded) document.getElementById('productModal')"));
test('warm renderer uses authorized Profile posts immediately and reconciles without replacing media', {timeout:60000},async t=>{
 let documents=0;const server=createServer((req,res)=>{
 res.setHeader('Content-Type','text/html');
 if(req.url.startsWith('/index.html')){documents++;res.end(`<div id="explore-fullscreen-content"></div><script>
 const profileDetailShell=true;let revision=0,allPosts=[],appData={posts:[]},bookmarksSet=new Set(),currentPostId=null,quoteNavigationActive=false,quoteNavigationVersion=0;
 window.draws=0;window.getCurrentUser=()=>({id:parent.actor,isLoggedIn:true});window.pauseAllVideos=()=>{};window.updateReactionsUI=()=>{};window.updateCommentCount=()=>{};window.formatCount=String;
 window.openExplorePost=async id=>{currentPostId=id;draws++;document.getElementById('explore-fullscreen-content').innerHTML='<article class="single-post-container" data-post-id="'+id+'"><video data-media="'+id+'"></video><span class="share-count"></span></article>';};
 ${api}
 parent.postMessage({type:'fu-profile-detail-boot'},location.origin);
 </script>`);return;}
 res.end('<html data-theme="dark"><style>html{--bg:#000;--text:#fff;--bg3:#111;--brd:#333}html[data-theme=light]{--bg:#fff;--text:#000;--bg3:#eee}#mainScroll{height:800px;overflow:auto}#grid{height:3000px}</style><main id="mainScroll"><h1>Profile</h1><b id="stats">42 posts / 12 followers</b><div id="grid">Loaded cards</div></main></html>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function setup(theme){await page.goto(origin+'/profile.html?uid=other');await page.addScriptTag({content:module});await page.evaluate(theme=>{
 document.documentElement.dataset.theme=theme;window.actor='viewer';window.fetches=[];window.resolvers={};window.profileInitializations=1;window.savedGrid=document.getElementById('grid');document.getElementById('mainScroll').scrollTop=500;
 window.posts=new Map(['A','B','C'].map(id=>[id,{id,user_id:'owner',profile:{display_name:'Author'},title:id,content:'Text',media:[{type:'image',url:'https://example.com/image'}],likes:3,comments:2}]));
 window.nav=createProfileDetailNavigation({getViewer:()=>actor,getPost:id=>posts.get(id),loadPost:id=>{fetches.push(id);return new Promise((resolve,reject)=>{resolvers[id]={resolve,reject};});},revoke:id=>posts.delete(id)});
 window.addEventListener('popstate',e=>nav.popstate(e));nav.warm();
 },theme);await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow.ProfilePostRenderer);}
 for(const theme of ['light','dark'])await t.test(theme+' A/cache A/B/C: no fetch dependency, one document, stable DOM',async()=>{
 await setup(theme);const before=documents;
 for(const id of ['A','A','B','C']){
 await page.evaluate(id=>{nav.open('post',id);nav.open('post',id);},id);
 assert.equal(await page.locator('#profileDetail').getAttribute('data-state'),'ready');
 assert.equal(await page.frameLocator('iframe').locator('article').getAttribute('data-post-id'),id);
 await page.evaluate(()=>{window.mediaNode=document.querySelector('iframe').contentDocument.querySelector('video');});
 await page.waitForFunction(id=>resolvers[id],id);
 await page.evaluate(id=>resolvers[id].resolve({...posts.get(id),likes:5,shareCount:7}),id);
 await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('.share-count').textContent==='7');
 assert(await page.evaluate(()=>mediaNode===document.querySelector('iframe').contentDocument.querySelector('video')));
 await page.goBack();assert(await page.locator('#profileDetail').isHidden());
 assert.equal(await page.locator('#stats').innerText(),'42 posts / 12 followers');assert(await page.evaluate(()=>savedGrid===document.getElementById('grid')));assert.equal(await page.evaluate(()=>document.getElementById('mainScroll').scrollTop),500);
 }
 assert.equal(documents,before);assert.deepEqual(await page.evaluate(()=>fetches),['A','A','B','C']);assert.equal(await page.evaluate(()=>profileInitializations),1);
 await page.goForward();assert.equal(await page.frameLocator('iframe').locator('article').getAttribute('data-post-id'),'C');
 });
 for(const owner of ['self','other'])for(const theme of ['light','dark'])for(const tab of ['posts','love','share','star'])for(const kind of ['image','video','text','quote'])await t.test(`${owner}/${theme}/${tab}/${kind}: cached grid seed has no display-time fetch dependency`,async()=>{
 await setup(theme);await page.evaluate(({owner,tab,kind})=>{
  window.activeTab=tab;document.getElementById('grid').dataset.page='4';document.getElementById('grid').dataset.owner=owner;
  const p=posts.get('A');p.mediaType=kind;p.media=kind==='image'||kind==='video'?[{type:kind,url:'https://example.com/media'}]:[];
  if(kind==='quote'){p.isQuote=true;p.quotedPostId='original';p.quotedPost={id:'original',visibility:'public',profile:{display_name:'Original'},content:'Embedded original'};}
 },{owner,tab,kind});
 const before=documents;await page.evaluate(()=>nav.open('post','A'));assert.equal(await page.locator('#profileDetail').getAttribute('data-state'),'ready');
 const seeded=await page.frameLocator('iframe').locator('body').evaluate(()=>allPosts[0]);assert.equal(seeded.mediaType,kind);if(kind==='quote')assert.equal(seeded.quotedPostId,'original');
 await page.evaluate(()=>resolvers.A.resolve(posts.get('A')));await page.goBack();assert(await page.locator('#profileDetail').isHidden());
 assert.equal(await page.evaluate(()=>activeTab),tab);assert.equal(await page.locator('#grid').getAttribute('data-owner'),owner);assert.equal(await page.locator('#grid').getAttribute('data-page'),'4');assert.equal(await page.evaluate(()=>document.getElementById('mainScroll').scrollTop),500);assert.equal(documents,before);assert.equal(await page.evaluate(()=>profileInitializations),1);
 });
 await t.test('permission revocation clears rendered data; account change discards pending results',async()=>{
 await setup('dark');await page.evaluate(()=>nav.open('post','A'));await page.waitForFunction(()=>resolvers.A);await page.evaluate(()=>resolvers.A.resolve(null));
 await page.waitForFunction(()=>document.getElementById('profileDetail').dataset.state==='error');assert.equal(await page.frameLocator('iframe').locator('article').count(),0);assert.equal(await page.evaluate(()=>posts.has('A')),false);
 await page.goBack();await page.evaluate(()=>nav.open('post','B'));await page.waitForFunction(()=>resolvers.B);
 await page.evaluate(()=>{actor='different';nav.resetViewer();resolvers.B.resolve(posts.get('B'));});await page.waitForTimeout(30);assert.equal(await page.locator('iframe').count(),0);assert(await page.locator('#profileDetail').isHidden());
 });
 await t.test('permission invalidation discards an older authorized response',async()=>{
 await setup('dark');await page.evaluate(()=>nav.open('post','A'));await page.waitForFunction(()=>resolvers.A);
 await page.evaluate(()=>{window.oldResponse=resolvers.A;nav.invalidate('A');});await page.waitForFunction(()=>fetches.length===2);
 await page.evaluate(()=>oldResponse.resolve(posts.get('A')));assert.equal(await page.frameLocator('iframe').locator('article').count(),0);
 await page.evaluate(()=>resolvers.A.resolve(null));await page.waitForFunction(()=>document.getElementById('profileDetail').dataset.state==='error');assert.equal(await page.frameLocator('iframe').locator('article').count(),0);
 });
 await t.test('failed authorization refresh fails closed and rapid A/B results do not replace B',async()=>{
 await setup('light');await page.evaluate(()=>{nav.open('post','A');nav.open('post','B');});await page.waitForFunction(()=>resolvers.A&&resolvers.B);
 await page.evaluate(()=>resolvers.A.resolve({...posts.get('A'),title:'Old result'}));assert.equal(await page.frameLocator('iframe').locator('article').getAttribute('data-post-id'),'B');
 await page.evaluate(()=>resolvers.B.reject(Error('Network failure')));await page.waitForFunction(()=>document.getElementById('profileDetail').dataset.state==='error');assert.equal(await page.frameLocator('iframe').locator('article').count(),0);
 });assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
test('same-viewer hydration does not initialize Profile; scope changes clear caches before reload',()=>{
 const start=profile.indexOf('            function profileViewerUpdated()');const end=profile.indexOf('\n            var _fwPageIdx',start);let fn=profile.slice(start,end);
 const c={profileCache:{scope(){}},_profileRestore:null,followModalData:null,targetUser:null,targetUserId:null,getAvatar:()=>'',scope:'one',profileViewerScope:()=>c.scope,profileLocalViewerScope:()=>c.localScope || c.scope,_profileViewer:'one',_profileScopeVersion:0,_profileRefreshQueued:false,profileDetailNavigation:{resetViewer(){c.clears++;}},allPosts:[1],_profileUserPosts:[1],_collectionPostCache:new Map([['old',1]]),_collectionPostRequests:new Map(),viewerIsBlockedByPrivacy:false,_secondaryDataLoaded:true,document:{getElementById:()=>({src:''}),querySelectorAll:selector=>selector.startsWith('#statPosts')?[c.headerStats]:[]},headerStats:{textContent:'42'},window:{__freeupperProfileLoading:false},renderProfile(){c.loads++;},clears:0,loads:0};vm.createContext(c);vm.runInContext(fn,c);
 c.profileViewerUpdated();c.profileViewerUpdated();assert.equal(c.loads,0);assert.equal(c._secondaryDataLoaded,true);assert.equal(c.headerStats.textContent,'42');
 c.scope='two';c.profileViewerUpdated();assert.equal(c.loads,1);assert.equal(c.clears,1);assert.equal(c.allPosts.length,0);assert.equal(c._collectionPostCache.size,0);assert.equal(c.headerStats.textContent,'—');
 c.localScope='two';c.scope='three';c.profileViewerUpdated();assert.equal(c.loads,1);assert.equal(c.clears,2);
 c.localScope='three';c.profileViewerUpdated();assert.equal(c.loads,2);c.profileViewerUpdated();assert.equal(c.loads,2);
});

test('Profile live refresh excludes deleted, hidden and draft rows while legacy lookup stays unchanged',async()=>{
 for(const flags of [{is_deleted:true},{is_hidden:true},{publishing_state:'draft'}]){
  const row={id:postId(90),user_id:postId(1),is_hidden:false,is_deleted:false,publishing_state:'published',...flags};
  const f=postsFixture({enabled:false,rows:[row]});
  assert.equal(await f.api.loadPostById(row.id,{requireLive:true}),null);
  assert.equal((await f.api.loadPostById(row.id)).id,row.id);
 }
});

test('Profile refresh preserves network errors for retry instead of treating them as deletions',async()=>{
 const f=postsFixture({enabled:false,readError:{code:'NETWORK',message:'Offline'}});
 await assert.rejects(f.api.loadPostById(postId(90),{requireLive:true}),e=>e.code==='NETWORK');
 assert.equal(await f.api.loadPostById(postId(90)),null);
 const denied=postsFixture({enabled:false,readError:{code:'PGRST116',message:'No visible row'}});
 assert.equal(await denied.api.loadPostById(postId(90),{requireLive:true}),null);
});
