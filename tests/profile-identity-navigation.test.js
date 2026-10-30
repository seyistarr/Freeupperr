import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createServer} from 'node:http';
import {chromium, webkit} from '@playwright/test';
const engine=process.env.FREEUPPER_PROFILE_ENGINE || 'chromium';
const html=await readFile(new URL('../profile.html',import.meta.url),'utf8');
const cache=await readFile(new URL('../profile-cache.js',import.meta.url),'utf8');
const auth=await readFile(new URL('../auth.js',import.meta.url),'utf8');
const serviceWorker=await readFile(new URL('../service-worker.js',import.meta.url),'utf8');
const main=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('var targetUserId'))[1];
const avatar=auth.slice(auth.indexOf('  function updateAvatarEls('),auth.indexOf('  // ─── CACHED USER'));
test('bounded ID cache keeps viewer partitions, aliases and pending requests isolated',async()=>{
 const c={};vm.createContext(c);vm.runInContext(cache,c);const store=c.createProfileCache({limit:2});store.scope('archangel');
 store.put({id:'a',username:'Aliyaanae',avatar_url:'aliya'},true);store.put({id:'a',avatar_url:'stale'},false);
 assert.equal(store.resolve({type:'username',value:'ALIYAANAE'}).profile.avatar_url,'aliya');
 store.put({id:'b'},true);store.put({id:'c'},true);assert.equal(store.get('a'),undefined);
 let done,calls=0;const one=store.request('c',()=>{calls++;return new Promise(r=>done=r);});const two=store.request('c',()=>{throw Error('duplicate');});
 assert.equal(one,two);await Promise.resolve();assert.equal(calls,1);store.scope('other');done({id:'c',private:'secret'});assert.equal(await one,null);assert.equal(store.get('c'),undefined);
});
test('full Profile: avatar ownership, modal seeds, Back DOM/scroll, races and permission refresh',{timeout:60000},async()=>{
 const bootstrap=`
 window.fuT=s=>s;window.showToast=(s)=>{(window.toasts ||= []).push(s)};window.updateNavAvatar=()=>updateAvatarEls('https://example.com/archangel.png');
 window.viewer={id:'archangel',isLoggedIn:true};window.AuthUser={getCurrentUser:()=>viewer,onChange:fn=>window.viewerChange=fn};
 window.createProfileDetailNavigation=()=>({resetViewer(){},invalidate(){},setProfile(){},warm(){},restore(){},popstate(){return false;}});
 window.calls=[];window.delays={};window.approved=true;window.allowTabs=true;
 window.people=Object.fromEntries(['archangel','aliya','third'].map(id=>[id,{id,username:id,display_name:id,avatar_url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>'+id+'</text></svg>'),cover_url:'',bio:id+' bio',hidden_tabs:[],is_private:false}]));
 window.sb={auth:{onAuthStateChange:fn=>window.authChange=fn},channel:()=>({on(){return this},subscribe(){}}),rpc:async(name,args)=>{
 if(name==='privacy_v2_approved_edge')return {data:approved};if(name==='can_view_profile_tab')return {data:allowTabs};if(name==='get_suggestions')return {data:[]};return {data:null};},from(table){
 let eqs={},fields='',head=false;const q={select(f,o){fields=f;head=!!o?.head;return q},eq(k,v){eqs[k]=v;return q},maybeSingle(){return q},then(resolve,reject){return (async()=>{
 if(table==='profiles'){calls.push('identity:'+eqs.id);if(delays[eqs.id])await new Promise(r=>delays[eqs.id].push(r));return {data:{...people[eqs.id]}};}
 if(table==='blocks')return {data:null};if(head)return {count:1};
 if(table==='follows'&&fields.includes('profiles:'))return {data:[{profiles:people.aliya}]};
 return {data:[]};})().then(resolve,reject);}};return q;}};
 window.PostsAPI={loadPostsByUserId:async id=>{calls.push('posts:'+id);if(delays['posts:'+id])await new Promise(r=>delays['posts:'+id].push(r));return [{id:'post-'+id,title:id+' post',user_id:id,mediaType:'text',timestamp:'2026-01-01'}];}};
 `;
 let documents=0;
 const server=createServer((req,res)=>{if(req.url==='/service-worker.js'){res.setHeader('Content-Type','text/javascript');res.end(serviceWorker);return;}res.setHeader('Content-Type','text/html');if(req.url.startsWith('/profile.html'))documents++;res.end(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',`<script>${cache}</script><script>${avatar}</script><script>${bootstrap}</script><script>${main}</script></body>`));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await (engine==='webkit' ? webkit.launch() : chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']})).catch(async error=>{await new Promise(r=>server.close(r));throw error;});
 try{const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await page.goto(origin+'/profile.html?uid=archangel');
 if(process.env.FREEUPPER_PROFILE_PWA){
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;});
  await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 }
 const initialDocuments=documents;
 await page.waitForFunction(()=>document.querySelector('#statPosts').textContent==='1');
 await page.evaluate(()=>{const panel=document.getElementById('panel-posts');document.getElementById('mainScroll').style.scrollBehavior='auto';window.savedCard=panel.firstChild;panel.appendChild(Object.assign(document.createElement('div'),{style:'height:3000px'}));document.getElementById('mainScroll').scrollTop=400;window.savedScroll=document.getElementById('mainScroll').scrollTop;});
 await page.evaluate(()=>openFollowModal('followers'));await page.waitForSelector('#followModal.open .u-info');
 // Delay the selected identity: modal data must paint before it resolves.
 await page.evaluate(()=>delays.aliya=[]);await page.locator('#followModal.open .u-info').first().click();
 assert.equal(await page.locator('#displayName').textContent(),'aliya');assert((await page.locator('#profileAvatar').getAttribute('src')).includes('aliya'));
 await page.evaluate(()=>{updateAvatarEls('https://example.com/archangel.png');delays.aliya.splice(0).forEach(r=>r());delete delays.aliya;});
 await page.waitForFunction(()=>document.querySelector('#statPosts').textContent==='1');
 assert((await page.locator('#profileAvatar').getAttribute('src')).includes('aliya'));assert((await page.locator('#qrAvatar').getAttribute('src')).includes('aliya'));
 await page.goBack();await page.waitForFunction(()=>document.querySelector('#displayName').textContent==='archangel');
 assert(await page.evaluate(()=>document.getElementById('panel-posts').firstChild===savedCard));assert.equal(await page.evaluate(()=>document.getElementById('mainScroll').scrollTop),await page.evaluate(()=>savedScroll));
 assert.equal(await page.evaluate(()=>calls.filter(c=>c==='identity:archangel').length),1);assert.equal(await page.evaluate(()=>calls.filter(c=>c==='posts:archangel').length),1);
 // Rapid profile switches must ignore an older identity response.
 await page.evaluate(()=>{delays.aliya=[];ProfileNavigation.open('aliya');});await page.waitForFunction(()=>delays.aliya.length>0);
 await page.evaluate(()=>ProfileNavigation.open('third'));await page.waitForFunction(()=>document.querySelector('#displayName').textContent==='third'&&document.querySelector('#statPosts').textContent==='1');
 await page.evaluate(()=>{delays.aliya.splice(0).forEach(r=>r());delete delays.aliya;});await page.waitForTimeout(30);
 assert.equal(await page.locator('#displayName').textContent(),'third');assert((await page.locator('#profileAvatar').getAttribute('src')).includes('third'));
 // Late secondary data cannot replace the next profile's posts or counts.
 await page.evaluate(()=>{delays['posts:aliya']=[];ProfileNavigation.open('aliya');});
 await page.waitForFunction(()=>delays['posts:aliya'].length>0);
 await page.evaluate(()=>ProfileNavigation.open('third'));
 await page.waitForFunction(()=>document.querySelector('#panel-posts').textContent.includes('third post'));
 await page.evaluate(()=>{delays['posts:aliya'].splice(0).forEach(r=>r());delete delays['posts:aliya'];});
 await page.waitForTimeout(20);assert((await page.locator('#panel-posts').textContent()).includes('third post'));
 for(const id of ['aliya','archangel','aliya','archangel']){
  await page.evaluate(id=>ProfileNavigation.open(id),id);
  await page.waitForFunction(id=>document.querySelector('#displayName').textContent===id&&document.querySelector('#panel-posts').textContent.includes(id+' post'),id);
  assert((await page.locator('#profileAvatar').getAttribute('src')).includes(id));
  assert.equal(await page.locator('.mfs.open,.mco.open').count(),0);
 }
 // Missing avatars use a generic fallback after a viewer refresh.
 await page.evaluate(()=>{people.third.avatar_url=null;ProfileNavigation.open('third');});
 await page.waitForFunction(()=>document.querySelector('#displayName').textContent==='third'&&document.querySelector('#profileAvatar').getAttribute('src').startsWith('data:'));
 await page.evaluate(()=>updateAvatarEls('viewer-avatar'));assert(!(await page.locator('#profileAvatar').getAttribute('src')).includes('archangel'));

 // Previously allowed private content is not restored after permission revocation.
 await page.evaluate(()=>{people.aliya.is_private=true;approved=false;allowTabs=false;ProfileNavigation.open('aliya');});
 await page.waitForFunction(()=>document.querySelector('#panel-posts').textContent.includes('This account is private'));
 assert.equal(await page.locator('#panel-posts .grid-card').count(),0);
 // Viewer switch clears retained content and pending work.
 await page.evaluate(()=>{viewer={id:'new-viewer',isLoggedIn:true};authChange('SIGNED_IN',{user:{id:'new-viewer'}});});
 await page.waitForFunction(()=>document.querySelector('#panel-posts').textContent.includes('This account is private'));
 assert.equal(await page.locator('#panel-posts .grid-card').count(),0);
 await page.evaluate(()=>{viewer={isLoggedIn:false};authChange('SIGNED_OUT',null);});
 await page.waitForFunction(()=>document.querySelector('#panel-posts .grid-card')===null);
 assert.equal(await page.locator('#panel-posts .grid-card').count(),0);
 assert.equal(documents,initialDocuments);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
