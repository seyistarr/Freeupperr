import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';

// Real page CSS/markup, isolated from authentication and backend availability.
test('shared navigation clearance, video hit areas, keyboard and native history', {timeout:120000}, async t => {
 let baseline=false;
 const server=createServer(async(req,res)=>{
  const requestedPath=new URL(req.url,'http://local').pathname;
  const path=/^\/(?:u\/|@)/.test(requestedPath)?'/profile.html':requestedPath;
  try {
   let body=baseline?execFileSync('git',['show',process.env.FREEUPPER_NAV_BASELINE_REF+':'+path.slice(1)],{encoding:'utf8',stdio:['ignore','pipe','ignore']}):await readFile('.'+path,'utf8');
   if(baseline)body=body.replace(/env\(safe-area-inset-bottom(?:,\s*[^)]+)?\)/g,'34px');
   if(path.endsWith('.html')) body=body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,s=>/src=["']\/?(?:theme|bottom-nav)\.js(?:\?[^"']*)?["']/.test(s)?s:'').replace(/<link\b[^>]*https:[^>]*>/gi,'');
   res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(body);
  } catch {res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext();
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage();const measurements=[];
 try {
  await mkdir('/tmp/freeupper-navigation',{recursive:true});
  if(process.env.FREEUPPER_NAV_BASELINE_REF) {
  baseline=true;await page.setViewportSize({width:390,height:844});
  const before=[];
  for(const name of ['index','search','create','video','profile']) {
   await page.goto(`${origin}/${name}.html`);await page.waitForSelector('.bottom-nav');await page.waitForTimeout(350);
   await page.evaluate(name=>{
    if(name==='video')document.getElementById('feedTrack').innerHTML='<div class="v-card"><div class="v-progress visible"></div><button class="v-mute-btn">Mute</button></div>';
    else {const owner=name==='index'?document.body:document.getElementById('mainScroll');const last=document.createElement('button');last.id='layout-last-control';last.textContent='Last interactive content';last.style.cssText='display:block;height:44px;margin-top:1200px';owner.append(last);if(name==='index')window.scrollTo(0,document.documentElement.scrollHeight);else{owner.style.scrollBehavior='auto';owner.scrollTop=owner.scrollHeight;}}
   },name);
   before.push(await page.evaluate(name=>({page:name,navHeight:document.querySelector('.bottom-nav').getBoundingClientRect().height,gap:document.querySelector('.bottom-nav').getBoundingClientRect().top-document.querySelector(name==='video'?'.v-progress':'#layout-last-control').getBoundingClientRect().bottom}),name));
   await page.screenshot({path:`/tmp/freeupper-navigation/before-${name}.png`});
  }
  await writeFile('/tmp/freeupper-navigation/before.json',JSON.stringify(before,null,2));baseline=false;
  }
  for(const [width,height] of [[375,667],[390,844],[430,932],[360,800],[667,375]]) for(const theme of ['light','dark']) for(const safe of [0,34]) {
   await page.setViewportSize({width,height});
   for(const name of ['index','search','create','video','profile']) {
    await page.goto(`${origin}/${name}.html`);
    await page.waitForSelector('.bottom-nav');
    await page.evaluate(({theme,safe})=>{applyTheme(theme);document.documentElement.style.setProperty('--bottom-safe-area',safe+'px');}, {theme,safe});
    await page.waitForTimeout(350); // Existing theme/padding transitions must settle.
    if(name==='video') await page.evaluate(()=>{
     document.getElementById('feedTrack').innerHTML='<div class="v-card"><div class="v-info"><button>Caption and sound</button></div><div class="v-actions"><button>Share</button></div><div class="v-progress visible" id="prog-0"></div><button class="v-mute-btn">Mute</button></div>';
    });
    else await page.evaluate(()=>{
     const owner=document.querySelector('.bottom-nav-scroll');
     const last=document.createElement('button');last.id='layout-last-control';last.textContent='Last interactive content';last.style.cssText='display:block;height:44px;margin-top:1200px';owner.append(last);
     if(owner===document.body)window.scrollTo(0,document.documentElement.scrollHeight);else {owner.style.scrollBehavior='auto';owner.scrollTop=owner.scrollHeight;}
    });
    const m=await page.evaluate(name=>{
     const nav=document.querySelector('.bottom-nav').getBoundingClientRect();
     const selectors=name==='video'?['.v-progress','.v-mute-btn','.v-info','.v-actions']:['#layout-last-control'];
     const controls=selectors.map(s=>({selector:s,bottom:document.querySelector(s).getBoundingClientRect().bottom}));
     return {height:nav.height,top:nav.top,controls,targets:[...document.querySelector('.bottom-nav').children].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))};
    },name);
    assert.equal(m.height,64+safe);for(const c of m.controls)assert(c.bottom<=m.top-3,`${name} ${width}x${height} safe=${safe}: ${JSON.stringify(m)}`);
    for(const target of m.targets){assert(target.height>=44);assert(target.width>=44);}
    measurements.push({page:name,width,height,theme,safe,...m});
    if(width===390 && theme==='light' && safe===34)await page.screenshot({path:`/tmp/freeupper-navigation/after-${name}.png`});
   }
  }
  await page.setViewportSize({width:390,height:844});
  // Use a VisualViewport test double: this verifies our response, not a physical keyboard.
  for(const name of ['search','create']) {
   await page.goto(`${origin}/${name}.html`);await page.waitForSelector('.bottom-nav');
   await page.evaluate(()=>{const viewport=window.visualViewport;Object.defineProperty(viewport,'height',{configurable:true,get:()=>480});document.querySelector('input,textarea').focus();viewport.dispatchEvent(new Event('resize'));});
   assert.equal(await page.locator('.bottom-nav').evaluate(el=>getComputedStyle(el).visibility),'hidden');
   assert((await page.locator('.layout').boundingBox()).height<=480);
   await page.evaluate(()=>{delete visualViewport.height;document.activeElement.blur();visualViewport.dispatchEvent(new Event('resize'));});
   await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-nav-keyboard'));
  }
  for(const route of [['home','search','home'],['home','create'],['home','video','profile'],['profile','home','profile'],['search','profile','search']]){
   await page.goto(`${origin}/${route[0]==='home'?'index':route[0]}.html`);
   for(const key of route.slice(1)){await page.locator(`[data-nav-key=${key}]`).click();await page.waitForURL(`**/${key==='home'?'index':key}.html`);assert.equal(await page.locator('[aria-current=page]').getAttribute('data-nav-key'),key);assert.equal(await page.locator('.bottom-nav').count(),1);}
   await page.goBack();await page.goForward();
  }
  await page.goto(`${origin}/u/FUfixture`);await page.waitForSelector('.bottom-nav');
  assert.equal(await page.locator('[aria-current=page]').getAttribute('data-nav-key'),'profile');
  await page.locator('[data-nav-key=search]').click();await page.waitForURL('**/search.html');
  await page.goto(`${origin}/index.html`);await page.waitForSelector('.bottom-nav');
  await page.evaluate(()=>{document.querySelector('[data-nav-key=search]').click();document.querySelector('[data-nav-key=video]').click();document.querySelector('[data-nav-key=profile]').click();});
  await page.waitForURL('**/search.html');assert.equal(await page.locator('.bottom-nav').count(),1);
  await page.goto(`${origin}/create.html`);await page.waitForSelector('.bottom-nav');await page.locator('#postContent').fill('Unsent text');
  await page.evaluate(()=>{for(let i=0;i<8;i++)document.querySelector('[data-nav-create]').click();});assert.equal(await page.locator('#postContent').inputValue(),'Unsent text');
  const composer=await readFile('create.html','utf8');
  const guard=composer.slice(composer.indexOf('        let composerPublished = false;'),composer.indexOf('        // 3.  TOAST SYSTEM'));
  await page.evaluate(code=>{window.state={postMedia:[]};(0,eval)(code+'\nwindow.testUnsent=hasUnsentComposer;syncComposerExitGuard();');},guard);
  assert.equal(await page.evaluate(()=>testUnsent()),true);
  assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented;}),true);
  await page.locator('#postContent').fill('');assert.equal(await page.evaluate(()=>testUnsent()),false);
  // Exercise the production scrub handlers with a finite-duration media double.
  await page.goto(`${origin}/video.html`);await page.waitForSelector('.bottom-nav');
  const source=await readFile('video.html','utf8');const scrub=source.slice(source.indexOf('        let _scrubIdx = null;'),source.indexOf('        let _tapTimer = null;'));
  await page.evaluate(code=>{
   document.getElementById('feedTrack').innerHTML='<div class="v-card"><video id="vid-0"></video><div class="v-progress visible" id="prog-0"></div></div>';
   const video=document.getElementById('vid-0');Object.defineProperty(video,'duration',{value:100});
   window.videoPosts=[{isYouTube:false}];window.showProgress=()=>{};window.updateProgress=()=>{};
   (0,eval)(code+'\nwindow.testStartScrub=startScrub;');document.getElementById('prog-0').onpointerdown=e=>testStartScrub(e,0);
  },scrub);
  const box=await page.locator('#prog-0').boundingBox();await page.mouse.move(box.x+box.width*.1,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height/2);await page.mouse.up();
  assert(Math.abs(await page.locator('#vid-0').evaluate(v=>v.currentTime)-80)<2);assert(page.url().endsWith('/video.html'));
  await mkdir('/tmp/freeupper-navigation',{recursive:true});await writeFile('/tmp/freeupper-navigation/geometry.json',JSON.stringify(measurements,null,2));
  t.diagnostic(`${measurements.length} page/viewport/theme/safe-area geometry cases passed; measurements in /tmp/freeupper-navigation/geometry.json`);
 } finally {await browser.close();await new Promise(r=>server.close(r));}
});
