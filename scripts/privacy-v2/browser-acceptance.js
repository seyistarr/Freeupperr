import { readerSettled, classifyWorkerUpgrade } from './browser-assertions.js';
import { syntheticImageBase64, syntheticVideoBase64 } from '../../lib/protected-media/synthetic-media-data.js';
// Runs in a real browser against real staging surfaces. No mocked media APIs.
const form = document.querySelector('#accounts'), output = document.querySelector('#results'), frame = document.querySelector('#surface');
const results = [];
const record = (check, detail) => { results.push({check,...detail}); output.textContent = JSON.stringify(results,null,2); };
async function until(predicate, timeout=30000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) { if(await predicate()) return; await new Promise(resolve=>setTimeout(resolve,100)); }
  throw Error('Browser assertion timed out');
}
async function open(page) {
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Frame navigation timeout')),30000);frame.onload=()=>{clearTimeout(timeout);resolve();};frame.onerror=()=>{clearTimeout(timeout);reject(Error('Frame navigation failed'));};frame.src=page;});
  await until(()=>frame.contentWindow.PrivacyStaging); return frame.contentWindow;
}
async function signInUI(w, account, composer=false) {
  const selector=composer?'[data-staging-auth]':'#privacy-staging-reader form[data-login]';
  await until(()=>w.document.querySelector(selector+' [name="email"]'));
  const parent=w.document.querySelector(selector);
  parent.querySelector('[name="email"]').value=account.email;
  parent.querySelector('[name="password"]').value=account.password;
  parent.querySelector('button').click();
  await until(()=>w.PrivacyStaging.enabled);
  if(!composer)await until(()=>readerSettled(w.document.querySelector('#privacy-staging-reader [role="status"]')?.textContent));
  if(composer)await until(()=>!w.document.querySelector('#postAudience,#studioAudience').querySelector('[value="only_me"]').disabled);
}
form.addEventListener('submit',async event=>{
  event.preventDefault(); form.querySelector('button').disabled=true; results.length=0;
  const account = role=>({email:form.elements[role+'-email'].value.trim(),password:form.elements[role+'-password'].value});
  const owner=account('owner'), denied=account('denied');
  form.querySelectorAll('input[type="password"]').forEach(input=>input.value='');
  try {
    const response=await fetch('/api/privacy-v2-publish',{cache:'no-store',redirect:'error'}), config=await response.json();
    if(!response.ok || config.supabaseUrl!=='https://tagkrhvgcbnybiuyvjxt.supabase.co') throw Error('Exact staging configuration required');
    for(const a of [owner,denied]) {
      if(!/^[^@]+@privacy-staging\.invalid$/.test(a.email)) throw Error('Synthetic accounts only');
      const client=window.supabase.createClient(config.supabaseUrl,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data,error}=await client.auth.signInWithPassword(a);
      if(error || data.user?.app_metadata?.privacy_v2_browser_acceptance!==true) throw Error('Authorized browser fixture marker required');
      a.id=data.user.id; await client.auth.signOut({scope:'local'});
    }
    if(owner.id===denied.id) throw Error('Independent accounts required');
    // Capture the actual old worker before Create/Studio can auto-register updates.
    const oldRegistration=await navigator.serviceWorker.getRegistration('/'),oldWorker=oldRegistration?.active;
    let controllerChanged=false;
    const changed=()=>{controllerChanged=true;};navigator.serviceWorker.addEventListener('controllerchange',changed);
    try {
      const registration=await navigator.serviceWorker.register('/service-worker.js',{updateViaCache:'none'});await registration.update();
      await until(async()=>registration.active?.state==='activated'&&(await caches.keys()).includes('freeupper-pwa-v10')&&!(await caches.keys()).some(key=>/^freeupper-pwa-v[1-9]$/.test(key)));
      const keys=await caches.keys();
      const evidence=classifyWorkerUpgrade({hadActiveWorker:!!oldWorker,workerReplaced:!!oldWorker&&oldWorker!==registration.active,controllerChanged,newCachePresent:keys.includes('freeupper-pwa-v10'),obsoleteCachesRemaining:keys.some(key=>/^freeupper-pwa-v[1-9]$/.test(key))});
      const leaked=(await Promise.all(keys.map(async key=>(await (await caches.open(key)).keys()).some(r=>new URL(r.url).pathname.startsWith('/api/'))))).some(Boolean);
      if(leaked)throw Error('API present in CacheStorage');
      record('service worker',{passed:evidence.upgrade_verified,...evidence,note:evidence.upgrade_verified?'Actual active worker replacement observed.':'Upgrade remains unverified: requires a previously active older worker and controller change; old cache names alone are insufficient.'});
    } finally {navigator.serviceWorker.removeEventListener('controllerchange',changed);}
    const fixturePosts=[];
    for(const page of ['create.html','studio.html']) {
      const w=await open(page); await until(()=>w.document.querySelector('[data-staging-auth]'));
      await signInUI(w,owner,true);
      const audience=w.document.querySelector('#postAudience,#studioAudience'); audience.value='only_me'; audience.dispatchEvent(new w.Event('change'));
      const video=page==='studio.html', mime=video?'video/mp4':'image/png';
      const bytes=Uint8Array.from(atob(video?syntheticVideoBase64:syntheticImageBase64),c=>c.charCodeAt(0));
      const files=new w.DataTransfer();files.items.add(new w.File([bytes],video?'synthetic-browser.mp4':'synthetic-browser.png',{type:mime}));
      const input=w.document.querySelector('#postFileInput,#galleryInput'); input.files=files.files;
      if(page==='create.html')await w.handlePostUpload({target:input});
      else await w.handleGalleryFiles({target:input});
      let published=false;
      const original=w.fetch.bind(w);
      w.fetch=async (...args)=>{
        const r=await original(...args);
        if(String(args[0]).includes('/api/privacy-v2-publish') && args[1]?.body) {
          const request=JSON.parse(args[1].body);
          if(request.action==='publish' && r.ok) {const data=await r.clone().json();published=data.status==='published'||data.publishing_state==='published';if(published)fixturePosts.push(data.id);}
        }
        return r;
      };
      if(page==='create.html') {w.document.querySelector('#postTitle').value='Synthetic browser acceptance';await w.submitPost();}
      else {w.document.querySelector('#detCaption').value='Synthetic browser acceptance';await until(()=>w.document.querySelector('#publishBtn'));await w.publishPost();}
      await until(()=>published,120000); w.fetch=original;
      record(page,{passed:true,check_type:'real UI + real publishing API'});
      await w.PrivacyStaging.signOut();
      if(audience.value!=='only_me' || !audience.querySelector('[value="only_me"]').disabled) throw Error('Composer logout failed to disable restricted publishing');
      record(page+' logout',{passed:true});
    }
    for(const page of ['index.html','video.html','profile.html']) {
      const w=await open(page+'?privacy_staging=1'); await signInUI(w,owner);
      await until(()=>w.document.querySelector('#privacy-staging-reader img[src^="blob:"],#privacy-staging-reader video[src^="blob:"]'));
      const targets=fixturePosts.map(id=>'[data-post-id="'+id+'"]');
      const media=[...w.document.querySelectorAll(targets.flatMap(t=>[t+' img',t+' video']).join(','))];
      if(!media.length)throw Error('Published fixture media missing');
      await until(()=>media.every(item=>item.tagName==='IMG'?item.complete&&item.naturalWidth>0:item.readyState>=2));
      const videos=media.filter(item=>item.tagName==='VIDEO');
      if(page==='video.html'&&!videos.length)throw Error('Studio video missing');
      for(const video of videos) {
        if(!video.poster.startsWith('blob:'))throw Error('Protected poster missing');
        const poster=new w.Image();poster.src=video.poster;await until(()=>poster.complete&&poster.naturalWidth>0);
        video.muted=true;await video.play();await until(()=>video.currentTime>0);video.pause();
      }
      const oldUrls=media.flatMap(item=>[item.src,...(item.poster?[item.poster]:[])]);
      // Replacement login uses the same exposed staging session as composer UI.
      await w.PrivacyStaging.signIn(denied.email,denied.password);
      await until(()=>readerSettled(w.document.querySelector('#privacy-staging-reader [role="status"]')?.textContent));
      if(fixturePosts.some(id=>w.document.querySelector('[data-post-id="'+id+'"]')))throw Error('Restricted fixture survived denied account switch');
      for(const url of oldUrls) {let accessible=false;try{accessible=(await w.fetch(url)).ok;}catch{}if(accessible)throw Error('Old object URL survived account switch');}
      record(page+' owner / session switch',{passed:true});
      // Test logout from an owner session containing media, not an already empty denied feed.
      await w.PrivacyStaging.signIn(owner.email,owner.password);
      await until(()=>readerSettled(w.document.querySelector('#privacy-staging-reader [role="status"]')?.textContent));
      const ownerMedia=[...w.document.querySelectorAll(targets.flatMap(t=>[t+' img',t+' video']).join(','))];
      if(!ownerMedia.length)throw Error('Owner media did not reload');
      const logoutUrls=ownerMedia.flatMap(item=>[item.src,...(item.poster?[item.poster]:[])]);
      w.document.querySelector('[data-signout]').click();
      await until(()=>!w.PrivacyStaging.enabled);
      if(w.document.querySelector('#privacy-staging-reader img,#privacy-staging-reader video')) throw Error('Media survived logout');
      for(const url of logoutUrls){let accessible=false;try{accessible=(await w.fetch(url)).ok;}catch{}if(accessible)throw Error('Object URL survived owner logout');}
      record(page+' logout',{passed:true});
    }
  } catch(_){record('exercise',{passed:false,note:'Blocked or failed. Inspect the visible frame; do not treat earlier checks as full acceptance.'});}
  finally {owner.password='';denied.password='';await frame.contentWindow.PrivacyStaging?.signOut().catch(()=>{});form.querySelector('button').disabled=false;}
});
