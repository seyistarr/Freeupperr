// Local, synthetic screenshot comparison. No cloud access or mutations.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const target='docs/gallery/final-visual-review';await mkdir(target,{recursive:true});
const mainFile=path=>execFileSync('git',['show','origin/main:'+path],{encoding:'utf8',maxBuffer:8e6});
const notesTest=await readFile('tests/notes-browser.test.js','utf8');
let notesBootstrap=notesTest.split('const bootstrap=`')[1].split('`;')[0];
const globalSource=await readFile('global.js','utf8');
notesBootstrap+='\n'+globalSource.slice(globalSource.indexOf('  window.getVerifiedBadgeHTML ='),globalSource.indexOf('\n  // ─── UPDATE ALL VERIFIED'));
notesBootstrap+=`\nwindow.getAuthorFromProfile=p=>({id:p.id,name:p.display_name,username:p.username,avatar:p.avatar_url,verified_status:p.verified_status});`;
const galleryTest=await readFile('tests/gallery-browser.test.js','utf8');
let videoBootstrap=galleryTest.split('const bootstrap=`')[1].split('\n`;')[0];
videoBootstrap+=`\nwindow.getAuthorFromProfile=p=>({id:p.id,name:'FreeUpper Creator',username:'creatorname',avatar:'/freeupper.png',verified_status:'verified'});window.PostsAPI.loadFeedWithReposts=async()=>posts.map(post=>({post}));`;
videoBootstrap+='\n'+globalSource.slice(globalSource.indexOf('  window.getVerifiedBadgeHTML ='),globalSource.indexOf('\n  // ─── UPDATE ALL VERIFIED'));
const strip=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*https:[^>]*>/gi,'');
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://fixture').pathname;
 if(path==='/tailwind.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile('/tmp/freeupper-review-tailwind.js'));return;}
 if(path==='/notes-wrapper'){res.setHeader('Content-Type','text/html');res.end('<style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/notes-feature?from=profile-overlay&profileShell=1&profileNotes=1"></iframe>');return;}
 if(path==='/notes-main'||path==='/notes-feature'){
  const latest=path==='/notes-main';const html=latest?mainFile('index.html'):await readFile('index.html','utf8');
  const start=html.indexOf('<!-- Main application');const inline=html.slice(html.indexOf('        (function()',start),html.indexOf('</script>',start));
  let feed=latest?mainFile('foryou.js'):await readFile('foryou.js','utf8');
  if(latest)feed=feed.replace('    function loadInitialFeed()', '    window.LatestMainCard=buildPostHTML;\n    function loadInitialFeed()');
  let body=strip(html).replace('</head>','<script src="/tailwind.js"></script></head>');
  body=body.replace('</body>',`<script src="/js/freeupper-time.js"></script><script>${notesBootstrap}</script><script type="module">${inline}</script><script src="/inline-video.js"></script><script src="/post-card.js"></script><script>${feed}</script></body>`);
  res.setHeader('Content-Type','text/html');res.end(body);return;
 }
 if(path==='/video.html'||path==='/gallery-viewer.html'){
  const latest=path==='/video.html';const html=latest?mainFile('video.html'):await readFile('gallery-viewer.html','utf8');
  const player=latest?[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(m=>m[1].includes('let _curIdx'))[1]:await readFile('video-player.js','utf8');
  let body=strip(html);body=body.replace('</body>',`<script>${videoBootstrap}</script><script src="/js/freeupper-time.js"></script>${latest?'':'<script src="/video-shell.js"></script>'}<script src="/video-render.js"></script><script>${player}</script>${latest?'<script src="/bottom-nav.js"></script>':'<script src="/gallery-session.js"></script>'}</body>`);
  res.setHeader('Content-Type','text/html');res.end(body);return;
 }
 const file='.'+path;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.mp4')?'video/mp4':'image/png');res.end(await readFile(file));
}catch(e){res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});const findings={};findings.main=execFileSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).trim();
try{
 for(const width of [390,430]){
  const page=await browser.newPage({viewport:{width,height:844}});await page.route(url=>url.origin!==origin,r=>r.abort());
  for(const source of ['main','feature']){
   await page.goto(origin+(source==='main'?'/notes-main?from=profile-overlay&profileShell=1&profileNotes=1':'/notes-wrapper'));
   const scope=source==='main'?page:page.frames().find(f=>f.url().includes('/notes-feature'));
   await scope.waitForFunction(latest=>latest?!!window.LatestMainCard:!!window.ProfileNotesRenderer&&!!window.renderProfileNotes,source==='main');
   await scope.evaluate(async latest=>{
    const post={id:'note-review',user_id:'creator',profile:{id:'creator',display_name:'FreeUpper Creator',username:'creatorname',avatar_url:'/freeupper.png',verified_status:'verified'},title:'A day worth sharing',content:'The same FreeUpper post, with its original author, media, caption and actions.',media:[{type:'image',url:'/freeupper.png'}],mediaType:'image',mediaUrl:'/freeupper.png',timestamp:new Date(Date.now()-60000).toISOString(),reactions:{like:7},likes:7,comments:3,reposts:2,bookmarks:1};
    if(latest){const posts=getAllPosts();posts.splice(0,posts.length,post);document.getElementById('feed-container').innerHTML=LatestMainCard(post,0);}else await ProfileNotesRenderer.show([post],'guest');
   },source==='main');
   await page.waitForTimeout(800);await scope.locator('.feed-post').first().screenshot({path:`${target}/notes-${source}-${width}.png`});
   findings[`notes-metrics-${source}-${width}`]=await scope.locator('.feed-post').evaluate(el=>{const rect=el.getBoundingClientRect();const css=getComputedStyle(el);return {width:rect.width,height:rect.height,y:rect.y,border:css.borderBottomWidth,images:[...el.querySelectorAll('img')].map(i=>({width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height}))}});
   findings[`notes-${source}-${width}`]=await scope.locator('.feed-post').evaluate(el=>({name:el.querySelector('[data-author-name]').textContent,handle:el.querySelector('[data-author-handle]')?.textContent||null,font:getComputedStyle(el.querySelector('[data-author-name]')).fontSize,images:el.querySelectorAll('img').length,actions:el.querySelector('.post-actions-row').textContent.trim()}));
  }
  for(const source of ['main','feature']){
   await page.goto(origin+(source==='main'?'/video.html?post=post-2':'/gallery-viewer.html?owner=creator&tab=posts&post=post-2'));
   await page.waitForSelector('#card-2');await page.evaluate(()=>document.getElementById('card-2').scrollIntoView());await page.waitForTimeout(700);
   await page.screenshot({path:`${target}/video-${source}-${width}.png`});
   findings[`video-${source}-${width}`]=await page.locator('#card-2').evaluate(el=>({name:el.querySelector('[data-author-name]').textContent.trim(),handle:el.querySelector('[data-author-handle]')?.textContent||null,font:getComputedStyle(el.querySelector('[data-author-name]')).fontSize,disc:!!el.querySelector('.v-disc')}));
  }
  await page.close();
 }
 for(const width of [390,430]){const {y:mainY,...mainMetrics}=findings['notes-metrics-main-'+width];const {y:notesY,...notesMetrics}=findings['notes-metrics-feature-'+width];assert.deepEqual(mainMetrics,notesMetrics);assert.deepEqual(findings['notes-main-'+width],findings['notes-feature-'+width]);assert.deepEqual(findings['video-main-'+width],findings['video-feature-'+width]);}
 await writeFile(target+'/comparison.json',JSON.stringify(findings,null,2));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
