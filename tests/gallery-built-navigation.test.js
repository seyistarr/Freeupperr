import test from 'node:test';
import assert from 'node:assert/strict';
import {builtGalleryHarness,owner} from './helpers/gallery-built-fixture.js';
const engine=process.env.FREEUPPER_PROFILE_ENGINE||'chromium';
const galleryFrame=async page=>(await page.locator('iframe[title="Gallery viewer"]').elementHandle()).contentFrame();
async function openProfile(h,notes=false){
 await h.page.goto(h.origin+'/@fixture_creator?tab=posts&content='+(notes?'notes':'gallery'),{waitUntil:'domcontentloaded'});
 await h.page.waitForSelector('.profile-content-tabs');
}
async function openVideo(h,index=2){
 await h.page.locator('[data-gallery-index]').nth(index).click();
 await h.page.waitForSelector('iframe[title="Gallery viewer"]');
 const frame=await galleryFrame(h.page);assert(frame,'Gallery has its own frame');
 await frame.waitForFunction(id=>window.FreeUpperVideoPlayer?.snapshot()?.post===id,h.posts[index].id);
 return frame;
}
test(`${engine}: built Profile keeps its document/player through Gallery, boundaries, Sounds and history`,{timeout:90000},async()=>{
 const h=await builtGalleryHarness();const {page}=h;
 try{
 await openProfile(h,true);
 await page.waitForFunction(()=>document.querySelector('iframe[title="Profile Notes"]')?.contentDocument?.querySelector('.feed-post'));
 assert.equal(await page.frameLocator('iframe[title="Profile Notes"]').locator('.feed-post').count(),1);
 await page.evaluate(()=>{window.originalDocument=document;window.originalHeader=document.getElementById('displayName');});
 await page.getByRole('tab',{name:'Gallery',exact:true}).click();await page.waitForSelector('[data-gallery-index]');
 assert.equal(await page.locator('[data-gallery-index]').count(),5);
 await page.locator('[data-gallery-index]').nth(2).scrollIntoViewIfNeeded();
 const scroll=await page.locator('#mainScroll').evaluate(el=>el.scrollTop);
 const frame=await openVideo(h);const selected=h.posts[2].id;
 await frame.evaluate(()=>localStorage.setItem('freeupper_user_profile',JSON.stringify({...AuthUser.getCurrentUser(),id:'GUEST-REFRESH'})));
 await frame.waitForFunction(()=>document.getElementById('vid-2').readyState>0);
 assert.equal(h.documents.filter(p=>p==='/profile.html').length,1,'no profile document reload');
 assert.equal(h.documents.filter(p=>p==='/gallery-viewer.html').length,1,'one viewer initialization');
 assert.equal(await frame.locator('.video-topbar,bottom-nav').count(),0);
 assert.equal(await frame.locator('.v-disc').count(),5);
 assert.equal(await frame.locator('#card-2 [data-author-name]').evaluate(el=>getComputedStyle(el).fontSize),'17px');
 assert(await page.locator('bottom-nav').evaluate(el=>el.hidden&&el.inert));
 await frame.locator('#feedTrack').evaluate(el=>el.scrollTop=1e9);
 await frame.waitForFunction(id=>FreeUpperVideoPlayer.snapshot().post===id,h.posts[4].id);
 await frame.locator('#feedTrack').evaluate(el=>el.scrollTop+=1e9);
 assert.equal(await frame.evaluate(()=>FreeUpperVideoPlayer.snapshot().post),h.posts[4].id);
 await frame.locator('#feedTrack').evaluate(el=>el.scrollTop=-1000);
 await frame.waitForFunction(id=>FreeUpperVideoPlayer.snapshot().post===id,h.posts[0].id);
 assert.equal(await frame.locator('.v-card').count(),5);
 const scopedReads=h.requests.filter(r=>r.frame==='/gallery-viewer.html'&&r.path.endsWith('/posts'));
 assert(scopedReads.length>0);assert(scopedReads.every(r=>r.owner==='eq.'+owner),'Gallery queries only this profile');
 await frame.locator('#card-2').evaluate(el=>el.scrollIntoView());
 await frame.waitForFunction(id=>FreeUpperVideoPlayer.snapshot().post===id,selected);
 if(await frame.locator('#vid-2').evaluate(v=>v.paused))await frame.locator('#tap-2').click({position:{x:100,y:180}});
 await frame.waitForFunction(()=>document.getElementById('vid-2').currentTime>.7);
 await frame.evaluate(()=>{const original=FreeUpperVideoPlayer.snapshot;FreeUpperVideoPlayer.snapshot=()=>{const state=original();window.soundPosition ||= state;return state;};});
 await frame.locator('#card-2 .v-disc-wrap').click();await frame.waitForSelector('iframe[title="Sound details"]');
 const sound=await(await frame.locator('iframe[title="Sound details"]').elementHandle()).contentFrame();assert(sound);
 await sound.waitForFunction(()=>typeof soundData!=='undefined'&&soundData?.audioUrl);
 await sound.locator('#soundArtWrap').click();await sound.waitForFunction(()=>!document.getElementById('soundAudio').paused&&document.getElementById('soundAudio').readyState>0);
 await frame.evaluate(()=>window.retainedOriginalAudio=document.querySelector('iframe[title="Sound details"]').contentDocument.getElementById('soundAudio'));
 assert(await frame.evaluate(()=>soundPosition.time>.7));
 assert(await page.locator('.gallery-close').evaluate(el=>el.hidden&&el.inert));
 assert(await frame.locator('#vid-2').evaluate(v=>v.paused));
 await sound.locator('button[onclick="goBack()"]').click();
 await frame.waitForFunction(id=>!document.querySelector('iframe[title="Sound details"]')&&currentPostId===id,selected);
 await frame.waitForFunction(()=>retainedOriginalAudio.paused&&Math.abs(document.getElementById('vid-2').currentTime-soundPosition.time)<.25);
 assert(await page.evaluate(()=>originalDocument===document&&originalHeader===document.getElementById('displayName')));
 assert.equal(h.documents.filter(p=>p==='/profile.html').length,1,'Sounds must not reinitialize Profile');
 assert.equal(h.documents.filter(p=>p==='/gallery-viewer.html').length,1,'Sounds retains player frame');
 await page.locator('.gallery-close').click();await page.waitForFunction(()=>!document.querySelector('iframe[title="Gallery viewer"]'));
 assert(await page.locator('bottom-nav').evaluate(el=>!el.hidden&&!el.inert));
 await page.waitForFunction(scroll=>document.getElementById('mainScroll').scrollTop===scroll,scroll);
 await page.goForward();await page.waitForSelector('iframe[title="Gallery viewer"]');
 const restored=await galleryFrame(page);await restored.waitForFunction(id=>window.FreeUpperVideoPlayer?.snapshot()?.post===id,selected);
 assert.equal(h.documents.filter(p=>p==='/profile.html').length,1,'Forward restores overlay without root reload');
 assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test(`${engine}: built authenticated Gallery still clears its launch heap and media on sign-out`,{timeout:60000},async()=>{
 const h=await builtGalleryHarness({authenticated:true});const {page}=h;
 try{
 await openProfile(h);
 await page.waitForFunction(id=>AuthUser.getCurrentUser().id===id&&FreeUpperProfileShell.getSession()?.viewer===id,owner);
 await page.waitForFunction(()=>document.body.classList.contains('is-owner')&&ProfileMounted.status().ready);
 await page.getByRole('tab',{name:'Gallery',exact:true}).click();await page.waitForSelector('[data-gallery-index]');
 const viewer=await openVideo(h);
 await viewer.waitForFunction(()=>document.getElementById('vid-2').readyState>0);
 await viewer.evaluate(()=>FreeUpperScreen.register({dispose(){__galleryTrace({event:'viewer-disposed',paused:[...document.querySelectorAll('video,audio')].every(v=>v.paused)}).catch(()=>{});}}));
 await page.evaluate(()=>window.privateHeapMarker={fixture:true});
 const before=h.documents.filter(p=>p==='/profile.html').length;
 await page.evaluate(()=>{void sb.auth.signOut();});
 await page.waitForFunction(()=>window.AuthUser&&!window.privateHeapMarker&&!AuthUser.getCurrentUser().isLoggedIn);
 assert(h.documents.filter(p=>p==='/profile.html').length>before,'real authenticated boundary resets launch heap');
 assert.equal(await page.evaluate(()=>document.body.classList.contains('is-owner')),false);
 assert(h.trace.some(e=>e.event==='viewer-disposed'&&e.paused),'media is paused on authenticated disposal');
 }catch(error){console.error('Built auth-boundary state',await page.evaluate(()=>({profile:ProfileMounted.status(),viewer:{id:AuthUser.getCurrentUser().id,loggedIn:AuthUser.getCurrentUser().isLoggedIn},tabs:[...document.querySelectorAll('.profile-content-tabs button')].map(b=>({name:b.textContent,selected:b.getAttribute('aria-selected')})),panel:document.getElementById('panel-posts').textContent.slice(0,200)})));console.error('Browser errors',h.errors);console.error('Lifecycle trace',h.trace.filter(e=>e.event==='auth-event'||e.event==='gallery-removed').slice(-16));throw error;}finally{await h.close();}
});
