import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
const profile=await readFile(new URL('../profile.html',import.meta.url),'utf8');
const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
const module=await readFile(new URL('../profile-detail.js',import.meta.url),'utf8');
const moduleURL=profile.match(/src="([^"]*profile-detail\.js[^"]*)"/)[1];
const adapter=profile.slice(profile.indexOf('            var profileDetailNavigation ='),profile.indexOf('            function restoreProfileReturnState()'));
const bridge=index.slice(index.indexOf('            // Profile retains its own document;'),index.indexOf('            // ─── EXPOSE GLOBALLY'));
const close=index.slice(index.indexOf('            function closeExploreFullscreen()'),index.indexOf('            // ─── setupExploreEventDelegation'));
const tabs=['posts','love','share','star','market'];
test('retained Profile detail navigation across tabs, media, profiles and history', {timeout:120000},async t=>{
 const requests=[];
 const pending=new Map(),waiters=new Map();
 const navigationRequests=()=>requests.filter(url=>/^\/(?:profile\.html|index\.html|profile-detail\.js)/.test(url)).length;
 const server=createServer((req,res)=>{
  requests.push(req.url);res.setHeader('Content-Type','text/html');
  if(req.url.startsWith('/detail-ready?')){
   const id=new URL(req.url,'http://test').searchParams.get('id');pending.set(id,res);waiters.get(id)?.();waiters.delete(id);return;
  }
  if(req.url===moduleURL){res.setHeader('Content-Type','text/javascript');res.end(module);return;}
  if(req.url.startsWith('/index.html')){
   const params=new URL(req.url,'http://test').searchParams;const id=params.get('post')||params.get('product');
   res.end(`<!doctype html><html><body><button id="childBack" onclick="closeExploreFullscreen()">Back</button><div id="productModal"><button id="marketBack" onclick="closeProductModal()">Back</button></div><div data-post-id="${id}"><span data-author-id="author">Author</span><span data-engagement-id="${id}">Engagements</span>${id.split('-')[0]==='video'?'<video style="width:100%;aspect-ratio:9/16" muted playsinline></video>':id.split('-')[0]==='image'?'<img alt="Image">':id.split('-')[0]==='quote'?'<a data-fu-quote href="index.html?post=original">Original</a>':'Text'}</div><script>
   let allPosts=[{id:${JSON.stringify(id)},views:12,reactions:{like:4},comments:2,shareCount:3,bookmarkCount:5,repostCount:6,likedByMe:true,myRepost:false}];
   let quoteNavigationActive=false,restoringQuoteNavigation=false;window.pauses=0;window.fuT=s=>s;window.closeProductModal=()=>{};window.pauseAllVideos=()=>pauses++;window.IndexInteractions={on(){}};
   ${bridge}\n${close}
   if(/^(image|video|text|quote)-(A|B|C|failure)$/.test(${JSON.stringify(id)})) {
    fetch('/detail-ready?id='+encodeURIComponent(${JSON.stringify(id)})).then(r=>{if(!r.ok)throw Error('Failed request');return r.json();})
     .then(()=>profileDetailMessage('fu-profile-detail-ready',{available:true}))
     .catch(()=>profileDetailMessage('fu-profile-detail-ready',{available:false}));
   } else setTimeout(()=>profileDetailMessage('fu-profile-detail-ready',{available:${id!=='unavailable'}}),${id==='slow'?500:10});
   </script></body></html>`);return;
  }
  res.end(`<!doctype html><html data-theme="dark"><head><style>html{--bg:#000;--text:#fff;--bg3:#111;--brd:#333}html[data-theme=light]{--bg:#fff;--text:#000;--bg3:#eee;--brd:#ddd}body{margin:0}#mainScroll{height:100vh;overflow:auto;background:var(--bg);color:var(--text)}.panel{display:none;height:4000px}.panel.active{display:block}.grid-card{height:160px}</style><script src="${moduleURL}"></script></head><body><main id="mainScroll"><h1 id="identity">Viewed profile</h1><nav>${tabs.map(tab=>`<button data-tab="${tab}" onclick="switchTab('${tab}')">${tab}</button>`).join('')}</nav>${tabs.map(tab=>`<section class="panel${tab==='posts'?' active':''}" id="panel-${tab}" data-profile-rendered="owner" data-page="4"><div class="grid-3"><div class="grid-card" data-profile-post="image" onclick="openPostFromGrid('image')"><span class="grid-stat"><span>1</span></span></div><span class="loaded">Previously loaded cards</span></div></section>`).join('')}</main></body></html>`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function setup(owner,theme,tab){
  await page.goto(origin+'/profile.html?uid='+owner);
  await page.evaluate(({owner,theme,tab})=>{
   document.documentElement.dataset.theme=theme;document.getElementById('identity').textContent=owner;
   window.token=crypto.randomUUID();window.allPosts=[{id:'image',views:1}],window._profileUserPosts=[{id:'image',views:1}];window._collectionPostCache=new Map();
   window.isOwner=owner==='self';window.likedPostIds=['image'];window.repostedPostIds=['image'];window.bookmarkedPostIds=['image'];window.fmtNum=String;window.targetUserId=owner;window.refreshes=0;
   window.renderActionRow=()=>refreshes++;window.loadAndRenderSecondaryData=()=>refreshes++;window.buildGridPostCard=p=>'<div data-profile-post="'+p.id+'"></div>';
   window.switchTab=key=>{window.activeTab=key;document.querySelectorAll('.panel').forEach(el=>el.classList.toggle('active',el.id==='panel-'+key));};switchTab(tab);
   document.getElementById('mainScroll').scrollTop=623;
   window.savedNode=document.querySelector('#panel-'+tab+' .loaded');
  },{owner,theme,tab});
  await page.addScriptTag({content:adapter+"window.addEventListener('popstate',e=>{if(!profileDetailNavigation.popstate(e))refreshes++});"});
 }
 async function open(kind,id){await page.evaluate(({kind,id})=>kind==='product'?openMarketFromGrid(id):openPostFromGrid(id),{kind,id});}
 async function ready(){await page.waitForFunction(()=>document.querySelector('#profileDetail iframe')?.style.visibility==='visible');}
 async function restored(tab,owner,token){
  await page.waitForFunction(()=>document.getElementById('profileDetail').hidden);
  assert.equal(await page.evaluate(()=>window.token),token);assert.equal(await page.evaluate(()=>activeTab),tab);assert.equal(await page.locator('#identity').innerText(),owner);
  assert.equal(await page.evaluate(()=>document.getElementById('mainScroll').scrollTop),623);assert(await page.evaluate(()=>savedNode===document.querySelector('.panel.active .loaded')));
  assert.equal(await page.locator('.panel.active').getAttribute('data-page'),'4');assert.equal(await page.evaluate(()=>refreshes),0);
 }
 for(const owner of ['self','other'])for(const theme of ['light','dark'])for(const tab of tabs)for(const id of (tab==='market'?['listing']:['image','text','quote','video']))await t.test(`${owner}/${theme}/${tab}/${id}`,async()=>{
  await setup(owner,theme,tab);const token=await page.evaluate(()=>window.token);const before=requests.length;
  await open(tab==='market'?'product':'post',id);await ready();
  assert(page.url().includes('uid='+owner));assert.equal(await page.locator('#profileDetail iframe').count(),1);
  assert.equal(await page.frameLocator('#profileDetail iframe').locator('[data-engagement-id]').getAttribute('data-engagement-id'),id);
  const loaded=requests.slice(before).filter(url=>url.startsWith('/index.html')).length;assert.equal(loaded,1);
  // Browser Back exercises the same popstate path used by iOS swipe-back.
  await page.goBack();await restored(tab,owner,token);
  const count=navigationRequests();await page.goForward();await ready();assert.equal(navigationRequests(),count);
  await page.frameLocator('#profileDetail iframe').locator(tab==='market'?'#marketBack':'#childBack').click();await restored(tab,owner,token);
  await open(tab==='market'?'product':'post',id);await ready();assert.equal(navigationRequests(),count);
  await page.goBack();await restored(tab,owner,token);
 });
 await t.test('slow/error details retain Profile and themed loading; Back cancels visibility',async()=>{
  await setup('other','dark','star');const token=await page.evaluate(()=>window.token);
  await page.evaluate(()=>{openPostFromGrid('slow');openPostFromGrid('slow');});assert.equal(await page.locator('#profileDetail iframe').count(),1);assert.equal(await page.locator('#profileDetail').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');assert.equal(await page.locator('#profileDetail iframe').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  await page.locator('.profile-detail-status button').click();await restored('star','other',token);
  await page.waitForTimeout(550);assert(await page.locator('#profileDetail').isHidden());
  await open('post','unavailable');await page.waitForFunction(()=>document.querySelector('.profile-detail-status p').textContent.includes('unavailable'));assert.equal(await page.locator('#profileDetail iframe').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  await page.locator('.profile-detail-status button').click();await restored('star','other',token);assert.equal(await page.locator('iframe').count(),1);
  const count=navigationRequests();await open('post','unavailable');await page.waitForFunction(()=>document.querySelector('.profile-detail-status p').textContent.includes('unavailable'));assert.equal(navigationRequests(),count+1);await page.goBack();await restored('star','other',token);
 });
 for(const theme of ['light','dark'])for(const kind of ['image','video','text','quote'])await t.test(`${theme}/${kind}: uncached A, cached A, uncached B/C and failed retry`,async()=>{
  await setup('other',theme,'posts');const token=await page.evaluate(()=>window.token);
  await page.evaluate(()=>{
   document.querySelector('.panel.active .grid-3').style.paddingTop='650px';
   document.querySelector('.panel.active .grid-card').textContent='Profile tile stays visible';
  });
  const original=await page.screenshot({clip:{x:0,y:0,width:390,height:400}});
  const count=id=>requests.filter(url=>url==='/detail-ready?id='+id).length;
  async function cold(id,fail=false){
   const previous=count(id);const received=new Promise(resolve=>waiters.set(id,resolve));
   await open('post',id);await open('post',id);await received;
   assert.equal(count(id),previous+1);assert.equal(await page.locator('iframe').count(),1);
   assert.equal(await page.locator('#profileDetail').getAttribute('data-state'),'loading');
   assert.equal(await page.locator('#profileDetail').getAttribute('aria-busy'),'true');
   assert.equal(await page.locator('#profileDetail').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
   assert.equal(await page.locator('.profile-detail-status').evaluate(el=>getComputedStyle(el).backgroundColor),theme==='dark'?'rgb(17, 17, 17)':'rgb(238, 238, 238)');
   assert((await page.locator('.profile-detail-status').boundingBox()).height<200);
   assert.equal(await page.locator('iframe').evaluate(el=>getComputedStyle(el).visibility),'hidden');
   assert.deepEqual(await page.screenshot({clip:{x:0,y:0,width:390,height:400}}),original,'Profile pixels must remain visible during the cold request');
   const response=pending.get(id);pending.delete(id);response.writeHead(fail?503:200,{'Content-Type':'application/json'});response.end('{}');
   if(fail){
    await page.waitForFunction(()=>document.getElementById('profileDetail').dataset.state==='error');
    assert.equal(await page.locator('#profileDetail').getAttribute('aria-busy'),'false');
    assert.equal(await page.locator('iframe').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    assert.deepEqual(await page.screenshot({clip:{x:0,y:0,width:390,height:400}}),original);
   }else{
    await ready();assert.equal(await page.locator('#profileDetail').getAttribute('data-state'),'ready');
    assert.equal(await page.frameLocator('iframe').locator('[data-engagement-id]').getAttribute('data-engagement-id'),id);
   }
  }
  const aRequests=count(kind+'-A');await cold(kind+'-A');await page.goBack();await restored('posts','other',token);
  const loaded=navigationRequests();await open('post',kind+'-A');await ready();
  assert.equal(navigationRequests(),loaded);assert.equal(count(kind+'-A'),aRequests+1);assert(await page.locator('.profile-detail-status').isHidden());
  await page.goBack();await restored('posts','other',token);
  for(const suffix of ['B','C']){await cold(kind+'-'+suffix);await page.goBack();await restored('posts','other',token);}
  await cold(kind+'-failure',true);await page.locator('.profile-detail-status button').click();await restored('posts','other',token);
  await cold(kind+'-failure');await page.goBack();await restored('posts','other',token);
 });
 await t.test('snapshot updates and forged messages cannot replace retained Profile',async()=>{
  await setup('self','light','posts');await open('post','image');await ready();
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:location.origin,data:{type:'fu-profile-detail-back'},source:window})));
  assert(await page.locator('#profileDetail').isVisible());await page.goBack();await page.waitForFunction(()=>allPosts[0].views===12);
  assert.equal(await page.locator('#panel-posts .grid-stat span').innerText(),'12');
 });
 await t.test('collection edits patch cards and media pauses while retained',async()=>{
  await setup('self','dark','star');await open('post','image');await ready();
  await page.frameLocator('#profileDetail iframe').locator('body').evaluate(()=>profileDetailMessage('fu-profile-detail-state',{posts:allPosts,interaction:{postId:'image',type:'unbookmark'}}));
  await page.waitForFunction(()=>bookmarkedPostIds.length===0);assert.equal(await page.locator('#panel-star [data-profile-post="image"]').count(),0);
  await page.goBack();await page.waitForFunction(()=>document.getElementById('profileDetail').hidden);
  assert((await page.frameLocator('#profileDetail iframe').locator('body').evaluate(()=>pauses))>0);
  assert.equal(await page.evaluate(()=>refreshes),0);
 });
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
