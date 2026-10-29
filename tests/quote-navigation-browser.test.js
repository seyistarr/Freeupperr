import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const slice=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const navigation=slice('            // Quote navigation stays in this document:', '            // ─── ACTIONS ROW');
const builder=slice('            function buildQuotedPostCard(', '            // Quote navigation stays in this document:');
const renderer=slice('            function buildSinglePostHTML(', '            function applyCommentBarLockState(');
const open=slice('            async function openExplorePost(', '            // ─── closeExploreFullscreen');
const close=slice('            function closeExploreFullscreen(', '            // ─── setupExploreEventDelegation');
const lock=slice('            function lockBodyScroll()', '            // ─── ICONS');
test('quote links retain the document, original identity, themes and return history', {timeout:60000},async t=>{
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html data-theme="dark"><style>body{margin:0;background:var(--bg);color:var(--text)}html{--bg:#000;--text:#fff}html[data-theme=light]{--bg:#fff;--text:#000}#feed{height:2400px}#explore-fullscreen{display:none;position:fixed;inset:0;overflow:auto;background:var(--bg)}#explore-fullscreen.open{display:block}</style><body><div id="feed"><div id="quote"></div></div><div id="explore-fullscreen"><button id="back" onclick="closeExploreFullscreen()">Back</button><div id="explore-fullscreen-content"></div></div></body></html>`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 async function setup(theme,image,detail=false){
  await page.goto(origin+'/index.html'+(detail?'?post=B':''));
  await page.evaluate(({theme,image})=>{
   document.documentElement.dataset.theme=theme;window.documentToken=crypto.randomUUID();window.toasts=[];window.views=[];window.fetches=[];
   window.A={id:'A',user_id:'authorA',title:'Original title',content:'Original content',visibility:'public',commentsHidden:true,comments:0,likes:7,shareCount:3,bookmarkCount:4,views:8,profile:{id:'authorA',display_name:'Original author'},media:[]};
   window.B={id:'B',user_id:'authorB',title:'Quote title',content:'Quote text',commentsHidden:true,profile:{id:'authorB',display_name:'Quote author'},isQuote:true,quotedPostId:'A',quotedPost:{...A,media:image?[{type:'image',url:location.origin+'/image.png'}]:[]},media:image?[{type:'image',url:location.origin+'/own.png'}]:[]};
   window.PostsAPI={loadPostById:id=>{fetches.push(id);return new Promise((resolve,reject)=>{window.resolveLoad=()=>resolve(id==='A'?A:B);window.denyLoad=()=>resolve(null);});}};
   window.fuT=s=>s;window.showToast=s=>toasts.push(s);window.getAuthorFromProfile=p=>({id:p.id,name:p.display_name,avatar:''});
   window.getCurrentUser=()=>({id:'actor'});window.escapeHtml=s=>String(s||'').replaceAll('<','&lt;');window.truncateName=s=>s;window.getMediaItems=p=>p.media||[];
   for(const n of ['buildMediaHTML','buildFollowButton','buildPublishedLinkCard','svgClock','svgComment','svgCommentOff','svgShare','svgEye','buildCommentsOffIllustration','commentSkeletons'])window[n]=()=>'';
   for(const n of ['pauseAllVideos','setupExploreEventDelegation','setupCommentListDelegation','initPlayers','setCommentBarVisible','applyCommentBarLockState','updateExploreReplyContextUI','refreshTabStates','setupVideoAutoplay','renderUI'])window[n]=()=>{};
   window.getVisibleComments=()=>[];window.isBookmarked=()=>false;window.formatRelativeTime=()=>'';window.getCommentSort=()=> 'top';window.svgChevronDown=()=>'';window.formatCount=n=>String(n);
   window.renderPostTitle=s=>s;window.buildContentBlockHTML=(id,s)=>s;
   window.buildReactionButton=id=>`<button data-like="${id}">Like</button>`;window.repostCountBadge=p=>`<button data-repost="${p.id}">Repost</button>`;window.bookmarkIcon=()=>'';window.registerPostView=id=>views.push(id);
  },{theme,image});
  await page.addScriptTag({content:`const profileDetailEmbedded=false;let allPosts=[B],appData={posts:[B]},uiPage='home',currentPostId=null,_lockedScrollY=0,tabScrollPositions={home:0},videoObserver=null,exploreReplyTarget=null,expandedThreads=new Map(),bottomNavHidden=false;\n${lock}\n${builder}\n${renderer}\n${open}\n${close}\n${navigation}\ndocument.getElementById('quote').innerHTML=buildQuotedPostCard(B);`});
  if(detail)await page.evaluate(()=>{allPosts.push(A);openExplorePost('B','home');});
 }
 for(const theme of ['light','dark'])for(const image of [false,true])await t.test(`${theme}, ${image?'image':'text-only'} quote: pending, detail, back and forward`,async()=>{
  await setup(theme,image);const token=await page.evaluate(()=>documentToken);
  await page.locator('#quote [data-fu-quote]').tap();await page.locator('#quote [data-fu-quote]').tap();
  assert.equal(await page.evaluate(()=>fetches.length),1);assert.equal(await page.locator('#quote [data-fu-quote]').getAttribute('aria-busy'),'true');
  assert(await page.locator('#quote').isVisible());assert.equal(await page.evaluate(()=>getComputedStyle(document.body).visibility),'visible');assert(!page.url().includes('?post='));
  await page.evaluate(()=>resolveLoad());await page.waitForURL('**/index.html?post=A');
  await page.waitForFunction(()=>document.querySelector('.single-post-container')?.dataset.postId==='A');
  assert.equal(await page.evaluate(()=>documentToken),token);assert.equal(await page.locator('[data-author-name]').innerText(),'Original author');assert((await page.locator('.single-post-container').innerText()).includes('Original content'));
  assert.equal(await page.locator('.post-actions-row').getAttribute('data-post-reactions'),'A');assert.equal(await page.locator('[data-like]').getAttribute('data-like'),'A');assert.equal(await page.locator('[data-repost]').getAttribute('data-repost'),'A');assert.deepEqual(await page.evaluate(()=>views),['A']);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('explore-fullscreen')).backgroundColor),theme==='dark'?'rgb(0, 0, 0)':'rgb(255, 255, 255)');
  await page.locator('#back').tap();await page.waitForFunction(()=>!document.getElementById('explore-fullscreen').classList.contains('open'));assert(!page.url().includes('?post='));
  await page.goForward();await page.waitForFunction(()=>fetches.length===2);await page.evaluate(()=>resolveLoad());await page.waitForFunction(()=>document.getElementById('explore-fullscreen').classList.contains('open'));assert.equal(await page.evaluate(()=>documentToken),token);
 });
 await t.test('unavailable original leaves quote visible and history untouched',async()=>{
  await setup('dark',false);await page.locator('[data-fu-quote]').tap();await page.evaluate(()=>denyLoad());await page.waitForFunction(()=>toasts.length===1);assert(!page.url().includes('?post='));assert(await page.locator('#quote').isVisible());assert.equal(await page.locator('[data-fu-quote]').getAttribute('aria-busy'),null);
 });
 await t.test('detail-to-original returns to authored quote on browser Back',async()=>{
  await setup('dark',true,true);await page.locator('#explore-fullscreen [data-fu-quote]').tap();await page.evaluate(()=>resolveLoad());await page.waitForFunction(()=>document.querySelector('.single-post-container')?.dataset.postId==='A');
  await page.goBack();await page.waitForFunction(()=>fetches.length===2);await page.evaluate(()=>resolveLoad());await page.waitForFunction(()=>document.querySelector('.single-post-container')?.dataset.postId==='B');assert(page.url().endsWith('?post=B'));
 });
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
