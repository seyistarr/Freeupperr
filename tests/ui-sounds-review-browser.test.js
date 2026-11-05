import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

// Actual coordinator, lifecycle, navigation components and audio engine; all
// authentication/settings/data are isolated local fixtures, never production.
async function shellFixture(viewport = { width: 390, height: 844 }) {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://fixture').pathname;
      if (/^\/(?:home|index\.html|search|search\.html|create|create\.html|videos|video\.html|profile|profile\.html)$/.test(path)) {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><head>
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <link rel="stylesheet" href="/bottom-nav.css"><link rel="stylesheet" href="/side-nav.css">
          <style>:root{--bottom-nav-height:64px;--navbg:#fff;--p:#7c3aed;--muted:#777;}body{margin:0;}main{padding:30px;}</style>
          <script>
            window.fuT = s=>s; window.__fuInitialHydrated = true;
            window.getCurrentUser = ()=>({id:'review-alice',isLoggedIn:true});
            window.AuthUser = {getCurrentUser,onChange(){}};
            window.sb = {auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'review-alice'},expires_at:Date.now()/1000+3600}}})},rpc:async()=>({data:{notification_settings:{sound:false}}})};
            window.audioStats={contexts:0,starts:0,ended:0,cancelled:0,buffers:0};
            const NativeAudio=window.AudioContext;
            window.AudioContext=class extends NativeAudio {
              constructor(){super();audioStats.contexts++;window.fixtureAudio=this;}
              createBufferSource(){audioStats.buffers++;return super.createBufferSource();}
              createOscillator(){const node=super.createOscillator();node.addEventListener('ended',()=>audioStats.ended++);const start=node.start.bind(node),stop=node.stop.bind(node);
                node.start=(...args)=>{audioStats.starts++;return start(...args)};
                node.stop=(...args)=>{if(!args.length)audioStats.cancelled++;return stop(...args)};
                return node;}
            };
          </script>
          <script src="/js/freeupper-routes.js"></script><script src="/js/screen-lifecycle.js"></script>
          <script src="/ui-sounds.js"></script><script src="/profile-shell.js"></script>
          </head><body><main><button id="contentAction" onclick="FUSound.interaction('like')">Like fixture</button></main>
          <bottom-nav></bottom-nav><side-nav></side-nav>
          <script src="/bottom-nav.js"></script><script src="/side-nav.js"></script>
          <script>document.addEventListener('DOMContentLoaded',()=>FreeUpperScreen.ready());</script></body></html>`);
        return;
      }
      const body = await readFile('.' + path);
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream');
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.FREEUPPER_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'] });
  const context = await browser.newContext({ viewport, hasTouch: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route(url => url.origin !== origin, route => route.abort());
  const page = await context.newPage(); const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/home');
  await page.waitForFunction(() => !!FreeUpperProfileShell.getSession() && !!FreeUpperSounds.preferenceState().authenticated);
  return { page, context, errors, close: async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));} };
}

for (const desktop of [false, true]) {
  test(`persistent ${desktop ? 'sidebar' : 'bottom navigation'} sounds survive screen suspension across all five tabs`, {timeout:30000}, async()=>{
    const h=await shellFixture(desktop ? {width:1280,height:900} : undefined);
    try {
      const selector=desktop?'side-nav .side-btn[data-side-key=':'bottom-nav [data-nav-key=';
      const samples=[];
      for(const kind of ['search','create','video','profile','home']) {
        const before=await h.page.evaluate(()=>({...audioStats}));
        await h.page.locator(selector+kind+']').click();
        await h.page.waitForFunction(k=>FreeUpperProfileShell.getActive()===k,kind);
        if(kind!=='home')await h.page.waitForFunction(k=>document.querySelector('iframe[data-fu-mounted="'+k+'"]')?.dataset.loaded==='true',kind);
        const after=await h.page.evaluate(()=>({...audioStats,hostActive:FreeUpperScreen.isActive()}));
        samples.push({kind,starts:after.starts-before.starts,cancelled:after.cancelled-before.cancelled});
      }
      assert.ok(samples.every(s=>s.starts===1 && s.cancelled===0),JSON.stringify(samples));
      const contexts=await h.page.evaluate(()=>audioStats.contexts);
      assert.equal(contexts,1,'navigation reuses its original AudioContext');
      assert.deepEqual(h.errors,[]);
    } finally {await h.close();}
  });
}

test('Video failure, interruption recovery, offline activation, rapid taps and oscillator cleanup preserve immediate UI behavior', {timeout:30000}, async t=>{
 const h=await shellFixture();
 try {
  const video=await readFile('video.html','utf8');
  const handler=video.slice(video.indexOf('        async function toggleLike(idx)'),video.indexOf('        async function toggleSave(idx)'));
  await h.page.evaluate(source=>{
   window.videoPosts=[{id:'fixture-video',liked:false,likes:0}];window.fmtNum=String;
   window.messages=[];window.showToast=message=>messages.push(message);window.writes=0;window.timings=[];
   const original=FUSound.interaction;
   FUSound.interaction=(...args)=>{const start=performance.now();const value=original(...args);timings.push(performance.now()-start);return value;};
   window.PostsAPI={toggleLike(){writes++;return new Promise((resolve,reject)=>{window.rpcResolve=resolve;window.rpcReject=reject;});}};
   (0,eval)(source);
   document.querySelector('main').insertAdjacentHTML('afterbegin','<button id="likeBtn-0" onclick="toggleLike(0)">Like actual video</button><span id="likeCount-0"></span>');
  },handler);
  const button=h.page.locator('#likeBtn-0');
  await button.click();
  const pending=await h.page.evaluate(()=>({liked:videoPosts[0].liked,writes,starts:audioStats.starts,pending:typeof rpcReject==='function'}));
  assert.deepEqual(pending,{liked:true,writes:1,starts:2,pending:true},'UI and one short sound occur while the server promise remains unresolved');
  await h.page.evaluate(()=>rpcReject(Error('fixture request failed')));
  await h.page.waitForFunction(()=>videoPosts[0].liked===false && messages.includes('fixture request failed'));
  assert.equal(await h.page.evaluate(()=>audioStats.starts),2,'failure does not add a success/retry sound');
  await h.page.evaluate(()=>{
   PostsAPI.toggleLike=async()=>{writes++;if(!navigator.onLine)throw Error('offline');return {liked:videoPosts[0].liked,count:videoPosts[0].liked?1:0};};
  });
  await h.page.evaluate(()=>fixtureAudio.suspend());
  assert.equal(await h.page.evaluate(()=>fixtureAudio.state),'suspended');
  await button.click();
  await h.page.waitForFunction(()=>fixtureAudio.state==='running',null,{timeout:3000}).catch(async error=>{t.diagnostic(JSON.stringify(await h.page.evaluate(()=>({diagnostics:FUSound.diagnostics(),stats:audioStats,active:FreeUpperScreen.isActive()}))));throw error;});
  const recovered=await h.page.evaluate(()=>audioStats.starts);
  assert.ok(recovered===2 || recovered===4,'an interrupted context may drop the resume activation, never queue it');
  if(recovered===2){await button.click();assert.equal(await h.page.evaluate(()=>audioStats.starts),4);}

  for(let i=0;i<20;i++)await button.click();
  assert.equal(await h.page.evaluate(()=>audioStats.starts),44);
  await h.context.setOffline(true);
  await button.click();
  await h.page.waitForFunction(()=>messages.includes('offline'));
  assert.equal(await h.page.evaluate(()=>audioStats.starts),46,'offline request has activation feedback only');
  await h.context.setOffline(false);
  await button.click();
  await h.page.waitForFunction(()=>audioStats.ended===audioStats.starts);
  assert.equal(await h.page.evaluate(()=>audioStats.contexts),1);
  const metrics=await h.page.evaluate(()=>{
   const sorted=[...timings].sort((a,b)=>a-b);
   return {engine:navigator.userAgent,samples:sorted.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),contexts:audioStats.contexts,started:audioStats.starts,ended:audioStats.ended,silentBuffers:audioStats.buffers};
  });
  t.diagnostic(JSON.stringify(metrics));
  await writeFile('/tmp/freeupper-review-performance.json',JSON.stringify(metrics,null,2));
  assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('actual Settings restores the account-local toggle on reload, isolates account switches, and reports denied storage accessibly', {timeout:30000}, async()=>{
 const settings=(await readFile('settings.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*https:[^>]*>/gi,'');
 const setup=`<script>
  window.fuT=s=>s;window.reviewAccount=localStorage.getItem('review-account') || 'alice';window.reviewCallbacks=[];window.rpcCalls=0;
  window.reviewNotification={sound:false};
  window.sb={auth:{onAuthStateChange:f=>reviewCallbacks.push(f),getSession:async()=>({data:{session:reviewAccount?{user:{id:reviewAccount}}:null}})},rpc:async(name,args)=>{rpcCalls++;if(name==='get_user_settings')return {data:{notification_settings:reviewNotification}};reviewNotification.sound=args.p_value==='true';return {data:true};}};
  window.switchReviewUser=id=>{reviewAccount=id;localStorage.setItem('review-account',id || '');reviewCallbacks.forEach(f=>f(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null));};
 </script><script src="/ui-sounds.js"></script><script src="/settings.js" defer></script>`;
 const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://fixture').pathname;
  res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
  res.end(path==='/settings.html'?settings.replace('<head>','<head>'+setup):await readFile('.'+path));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext();const page=await context.newPage();const origin=`http://127.0.0.1:${server.address().port}`;
  await context.route(url=>url.origin!==origin,route=>route.abort());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/settings.html');
  const interaction=page.getByRole('checkbox',{name:'Interaction sounds',exact:true});
  const notification=page.getByRole('checkbox',{name:'Notification sounds',exact:true});
  await page.waitForFunction(()=>!document.getElementById('interactionSoundsToggle').disabled);
  assert.equal(await interaction.isChecked(),true);assert.equal(await notification.isChecked(),false);
  const calls=await page.evaluate(()=>rpcCalls);
  await interaction.focus();await interaction.press('Space');
  assert.equal(await interaction.isChecked(),false);assert.equal(await page.evaluate(()=>rpcCalls),calls);
  await page.reload();await page.waitForFunction(()=>!document.getElementById('interactionSoundsToggle').disabled);
  assert.equal(await interaction.isChecked(),false,'manager and actual checkbox restore after reload');
  await page.evaluate(()=>switchReviewUser('bob'));
  assert.equal(await interaction.isChecked(),true,'a different account gets its own default');
  await interaction.focus();await interaction.press('Space');
  await page.evaluate(()=>switchReviewUser('alice'));
  assert.equal(await interaction.isChecked(),false);
  await interaction.focus();await interaction.press('Space');
  await page.evaluate(()=>switchReviewUser('bob'));assert.equal(await interaction.isChecked(),false);
  await page.evaluate(()=>switchReviewUser(null));assert.equal(await interaction.isDisabled(),true);
  await page.evaluate(()=>switchReviewUser('alice'));assert.equal(await interaction.isChecked(),true);
  await page.evaluate(()=>{window.restoreStorage=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new DOMException('Denied','SecurityError');};});
  await interaction.focus();await interaction.press('Space');
  assert.equal(await interaction.isChecked(),true,'failed save rolls checkbox back');
  assert.match(await page.locator('#interactionSoundsError').textContent(),/Could not save/);
  assert.equal(await page.locator('#interactionSoundsError').getAttribute('aria-live'),'polite');
  assert.match(await page.locator('#interactionSoundsDescription').textContent(),/this browser/);
  await page.evaluate(()=>{Storage.prototype.setItem=restoreStorage;});
  const privateContext=await browser.newContext();const fresh=await privateContext.newPage();
  await privateContext.route(url=>url.origin!==origin,route=>route.abort());await fresh.goto(origin+'/settings.html');
  await fresh.waitForFunction(()=>!document.getElementById('interactionSoundsToggle').disabled);
  assert.equal(await fresh.getByRole('checkbox',{name:'Interaction sounds',exact:true}).isChecked(),true,'new isolated browser context has no cross-device/account-store synchronization');
  assert.deepEqual(errors,[]);await privateContext.close();await context.close();
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});

test('every interaction palette renders short, quiet, non-silent PCM including the Share frequency sweep', {timeout:30000}, async()=>{
 const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const source=await readFile('ui-sounds.js','utf8');
  for(const type of ['like','repost','share','comment','save','follow','tap']){
   const page=await browser.newPage();
   await page.setContent('<button onclick="FUSound.interaction(window.tone)">Render tone</button>');
   await page.evaluate(type=>{
    window.tone=type;
    window.sb={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'pcm-fixture'}}}})},rpc:async()=>({data:{notification_settings:{sound:false}}})};
    window.AudioContext=class {
     constructor(){this.offline=new OfflineAudioContext(1,11025,44100);window.renderingContext=this.offline;}
     get state(){return 'running';}get currentTime(){return this.offline.currentTime;}get destination(){return this.offline.destination;}
     createOscillator(){return this.offline.createOscillator();}createGain(){return this.offline.createGain();}
    };
   },type);
   await page.addScriptTag({content:source});
   await page.waitForFunction(()=>FreeUpperSounds.preferenceState().authenticated);
   await page.getByRole('button',{name:'Render tone'}).click();
   const pcm=await page.evaluate(async()=>{
    const buffer=await renderingContext.startRendering(),data=buffer.getChannelData(0);
    return {peak:Math.max(...data.map(Math.abs)),latePeak:Math.max(...data.slice(Math.floor(.14*44100)).map(Math.abs))};
   });
   assert.ok(pcm.peak>.001 && pcm.peak<.05,JSON.stringify({type,...pcm}));
   assert.equal(pcm.latePeak,0,type+' must finish promptly');
   await page.close();
  }
 }finally{await browser.close();}
});
