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
  frame.src=page; await new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject;});
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
          if(request.action==='publish' && r.ok) {const data=await r.clone().json();published=data.status==='published'||data.publishing_state==='published';}
        }
        return r;
      };
      if(page==='create.html') {w.document.querySelector('#postTitle').value='Synthetic browser acceptance';await w.submitPost();}
      else {w.document.querySelector('#detCaption').value='Synthetic browser acceptance';await until(()=>w.document.querySelector('#publishBtn'));await w.publishPost();}
      await until(()=>published,120000); w.fetch=original;
      record(page,{passed:true,check_type:'real UI + real publishing API'});
      await w.PrivacyStaging.signOut();
      if(audience.value!=='public' || !audience.querySelector('[value="only_me"]').disabled) throw Error('Composer logout failed to disable restricted publishing');
      record(page+' logout',{passed:true});
    }
    for(const page of ['index.html','video.html','profile.html']) {
      const w=await open(page+'?privacy_staging=1'); await signInUI(w,owner);
      await until(()=>w.document.querySelector('#privacy-staging-reader img[src^="blob:"],#privacy-staging-reader video[src^="blob:"]'));
      const media=[...w.document.querySelectorAll('#privacy-staging-reader img,#privacy-staging-reader video')];
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
      await until(()=>!w.document.querySelector('#privacy-staging-reader img,#privacy-staging-reader video'));
      for(const url of oldUrls) {let accessible=false;try{accessible=(await w.fetch(url)).ok;}catch{}if(accessible)throw Error('Old object URL survived account switch');}
      record(page+' owner / session switch',{passed:true});
      w.document.querySelector('[data-signout]').click();
      await until(()=>!w.PrivacyStaging.enabled);
      if(w.document.querySelector('#privacy-staging-reader img,#privacy-staging-reader video')) throw Error('Media survived logout');
      record(page+' logout',{passed:true});
    }
    const before=await caches.keys();
    const registration=await navigator.serviceWorker.register('/service-worker.js',{updateViaCache:'none'});await registration.update();
    await until(async()=>{const keys=await caches.keys();return registration.active?.state==='activated'&&keys.includes('freeupper-pwa-v9')&&!keys.some(key=>/^freeupper-pwa-v[1-8]$/.test(key));});
    const leaked=(await caches.keys()).length && (await Promise.all((await caches.keys()).map(async key=>(await (await caches.open(key)).keys()).some(r=>new URL(r.url).pathname.startsWith('/api/'))))).some(Boolean);
    if(leaked)throw Error('API present in CacheStorage');
    record('service worker',{passed:true,upgrade_verified:before.some(key=>/^freeupper-pwa-v[1-8]$/.test(key)),note:'An upgrade is verified only when an older cache existed before activation.'});
  } catch(_){record('exercise',{passed:false,note:'Blocked or failed. Inspect the visible frame; do not treat earlier checks as full acceptance.'});}
  finally {owner.password='';denied.password='';await frame.contentWindow.PrivacyStaging?.signOut().catch(()=>{});form.querySelector('button').disabled=false;}
});
