import test from 'node:test';
import assert from 'node:assert/strict';
import {profileHarness} from './helpers/profile-navigation-fixture.js';
const pwa=!!process.env.FREEUPPER_PROFILE_PWA;
const engine=process.env.FREEUPPER_PROFILE_ENGINE || 'chromium';
test(`${engine}${pwa?'/PWA':''}: relationship tabs hydrate synchronously and Back restores exact source`,{timeout:90000},async t=>{
 const h=await profileHarness({pwa});const {page}=h;
 try{
 const baseline=h.documents();
 for(const [tab,id] of [['followers','follower'],['following','following'],['friends','friend0'],['suggestions','suggestion']])await t.test(tab,async()=>{
  await page.evaluate(tab=>openFollowModal(tab),tab);
  await page.evaluate(id=>{const idx=['followers','following','friends','suggestions'].indexOf(document.querySelector('#fsTitle').textContent.toLowerCase());const input=document.getElementById('fsSearch'+idx);input.value=id;filterUsersPage(idx);},id);
  const result=await page.evaluate(({id,tab})=>{
   hold('identity:'+id);hold('relation:'+id);hold('posts:'+id);
   const row=document.querySelector('#followModal .fs-page.active .u-info') || document.querySelector('#followModal .u-info[data-profile-id="'+id+'"]');
   const start=performance.now();row.click();
   return {latency:performance.now()-start,name:document.getElementById('displayName').textContent,bio:document.getElementById('heroBio').textContent,
    cover:document.getElementById('profileCover').getAttribute('src'),avatar:document.getElementById('profileAvatar').getAttribute('src'),badge:!document.getElementById('verifiedBadge').classList.contains('hidden'),action:document.getElementById('actionRow').textContent};
  },{id,tab});
  assert.equal(result.name,id+' name');assert.equal(result.bio,id+' bio');assert(result.avatar.includes(id));assert(result.cover.includes('cover'));assert(result.latency<200,`warm synchronous hydration ${result.latency}ms`);t.diagnostic(`${tab} synchronous hydration ${result.latency.toFixed(1)}ms`);
  assert(result.action.includes(tab==='friends'?'Friends':tab==='followers'?'Follow Back':tab==='following'?'Following':'Follow'));
  if(id==='friend0')assert(result.badge);
  await page.evaluate(id=>{release('identity:'+id);release('relation:'+id);release('posts:'+id);},id);
  await page.waitForFunction(id=>document.getElementById('panel-posts').textContent.includes(id+' post'),id);
  await page.goBack();await page.waitForSelector('#followModal.open');
  assert.equal(await page.locator('#fsTitle').textContent(),tab[0].toUpperCase()+tab.slice(1));
  const idx=['followers','following','friends','suggestions'].indexOf(tab);assert.equal(await page.locator('#fsSearch'+idx).inputValue(),id);
  await page.evaluate(()=>closeFS('followModal'));
 });
 assert.equal(h.documents(),baseline);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test(`${engine}: nested modal destinations retain virtual-list scroll, rows, query and viewer identity`,{timeout:60000},async()=>{
 const h=await profileHarness({pwa});const {page}=h;try{
 await page.evaluate(()=>openFollowModal('friends'));
 await page.evaluate(()=>{const input=document.getElementById('fsSearch2');input.value='FrIeNd';filterUsersPage(2);document.getElementById('fsList2').scrollTop=720;onFollowScrollPage(2);window.listScroll=document.getElementById('fsList2').scrollTop;window.listCalls=calls.filter(c=>c.kind==='lists'&&c.id==='viewer').length;});
 const id=await page.locator('#fsVirtualContent2 .u-info').evaluateAll(rows=>{const bounds=document.getElementById('fsList2').getBoundingClientRect();return rows.find(row=>{const r=row.getBoundingClientRect();return r.top>=bounds.top&&r.bottom<=bounds.bottom;}).dataset.profileId;});// DOM activation avoids Playwright's scroll-into-view changing the source position before the click.
 await page.locator('#fsVirtualContent2 .u-info[data-profile-id="'+id+'"]').evaluate(row=>row.click());
 await page.waitForFunction(id=>document.getElementById('panel-posts').textContent.includes(id+' post'),id);
 await page.evaluate(()=>openFollowModal('followers'));await page.locator('#fsVirtualContent0 .u-info[data-profile-id="viewer"]').click();
 await page.waitForFunction(()=>document.getElementById('displayName').textContent==='viewer name');
 await page.goBack();await page.waitForSelector('#followModal.open');assert.equal(await page.locator('#displayName').textContent(),id+' name');assert.equal(await page.locator('#fsTitle').textContent(),'Followers');
 // Use the actual in-app Back control for the second leg.
 await page.locator('.header-back').evaluate(el=>el.click());await page.waitForSelector('#followModal.open');
 assert.equal(await page.locator('#fsTitle').textContent(),'Friends');assert.equal(await page.locator('#fsSearch2').inputValue(),'FrIeNd');
 assert.equal(await page.evaluate(()=>history.state.fuProfileNavigation.modal.scroll[2]),await page.evaluate(()=>listScroll));
 assert.equal(await page.locator('#fsList2').evaluate(el=>el.scrollTop),await page.evaluate(()=>listScroll));
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.kind==='lists'&&c.id==='viewer').length),await page.evaluate(()=>listCalls));
 assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test(`${engine}: invalid self-edges are excluded without hiding the viewer in another owner's lists`,{timeout:60000},async()=>{
 const h=await profileHarness();const {page}=h;try{
 const expected=await page.evaluate(()=>({followers:edges.filter(e=>e.following_id==='viewer'&&e.follower_id!=='viewer'&&e.status==='active').length,following:edges.filter(e=>e.follower_id==='viewer'&&e.following_id!=='viewer'&&e.status==='active').length}));
 assert.equal(await page.locator('#statFollowers').textContent(),String(expected.followers));assert.equal(await page.locator('#statFollowing').textContent(),String(expected.following));
 for(const tab of ['followers','following','friends','suggestions']){await page.evaluate(tab=>openFollowModal(tab),tab);assert.equal(await page.locator('#followModal [data-profile-id="viewer"]').count(),0);await page.evaluate(()=>closeFS('followModal'));}
 await page.evaluate(()=>ProfileNavigation.open('friend0'));await page.waitForFunction(()=>document.getElementById('panel-posts').textContent.includes('friend0 post'));
 await page.evaluate(()=>openFollowModal('followers'));assert.equal(await page.locator('#fsVirtualContent0 .u-info[data-profile-id="viewer"]').count(),1);
 assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test(`${engine}: cached statistics never flicker, failed counts never become zero, follow mutations dedupe and roll back`,{timeout:60000},async()=>{
 const h=await profileHarness();const {page}=h;try{
 await page.evaluate(()=>window.originalOwnCard=document.getElementById('panel-posts').firstChild);
 await page.evaluate(()=>ProfileNavigation.open('friend0'));await page.waitForFunction(()=>document.getElementById('followBtn')?.textContent==='Friends'&&document.getElementById('statPosts').textContent==='1');
 await page.evaluate(()=>{hold('mutation:friend0');failMutation=true;window.pendingMutations=[handleFollow(),handleFollow()];});
 assert.equal(await page.locator('#followBtn').textContent(),'Follow Back');assert(await page.locator('#followBtn').isDisabled());
 await page.evaluate(()=>release('mutation:friend0'));await page.waitForFunction(()=>document.getElementById('followBtn')?.textContent==='Friends'&&!document.getElementById('followBtn').disabled);
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.kind==='toggle_follow_with_notification').length),1);
 await page.evaluate(()=>{failMutation=false;return handleFollow();});await page.waitForFunction(()=>document.getElementById('followBtn')?.textContent==='Follow Back');
 assert.equal(await page.locator('#statFollowers').textContent(),'0');
 await page.evaluate(()=>ProfileNavigation.open('friend1'));await page.waitForFunction(()=>document.getElementById('statPosts').textContent==='1');
 const warm=await page.evaluate(()=>{hold('identity:friend0');ProfileNavigation.open('friend0');return {posts:document.getElementById('statPosts').textContent,followers:document.getElementById('statFollowers').textContent,action:document.getElementById('followBtn')?.textContent};});
 assert.deepEqual(warm,{posts:'1',followers:'0',action:'Follow Back'});await page.evaluate(()=>release('identity:friend0'));
 await page.evaluate(()=>{failCounts=true;ProfileNavigation.open('other');});await page.waitForFunction(()=>document.getElementById('panel-posts').textContent.includes('other post'));
 assert.equal(await page.locator('#statFollowers').textContent(),'—');assert.equal(await page.locator('#statFollowing').textContent(),'—');
 await page.evaluate(()=>history.go(-4));await page.waitForFunction(()=>document.getElementById('displayName').textContent==='viewer name');
 assert(await page.evaluate(()=>document.getElementById('panel-posts').firstChild===originalOwnCard));
 assert.equal(await page.locator('#statFollowing').textContent(),'30');
 assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test(`${engine}: private permissions, rapid profiles, anonymous resolver and account switching keep cached rows isolated`,{timeout:60000},async()=>{
 const h=await profileHarness({pwa});const {page}=h;try{
 await page.evaluate(()=>{hold('identity:follower');ProfileNavigation.open('follower');ProfileNavigation.open('private');});
 await page.waitForFunction(()=>document.getElementById('panel-posts').textContent.includes('This account is private'));
 await page.evaluate(()=>release('identity:follower'));assert.equal(await page.locator('#displayName').textContent(),'private name');assert.equal(await page.locator('#panel-posts .grid-card').count(),0);
 await page.evaluate(()=>{viewer={id:'guest',isLoggedIn:false};authChange('SIGNED_OUT',null);ProfileNavigation.open('friend0');});
 await page.waitForFunction(()=>document.getElementById('displayName').textContent==='friend0 name'&&document.getElementById('statPosts').textContent==='1');
 assert((await page.locator('#actionRow').textContent()).includes('Follow'));assert.equal(await page.locator('#followBtn').count(),0);
 await page.goBack();assert.equal(await page.locator('#followModal.open').count(),0);
 assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test(`${engine}: an older permission response cannot restore private posts after a successful unfollow`,{timeout:60000},async()=>{
 const h=await profileHarness();const {page}=h;try{
 await page.evaluate(()=>{people.friend0.is_private=true;granted.add('viewer:friend0');hold('posts:friend0');ProfileNavigation.open('friend0');});
 await page.waitForFunction(()=>document.getElementById('followBtn')?.textContent==='Friends'&&!document.getElementById('followBtn').disabled);
 await page.evaluate(()=>handleFollow());
 await page.evaluate(()=>release('posts:friend0'));
 await page.waitForFunction(()=>document.getElementById('panel-posts').textContent.includes('This account is private'));
 assert.equal(await page.locator('#panel-posts .grid-card').count(),0);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test(`${engine}: visible-entry relationship prefetch is bounded, drains the queue and never invents a pending state`,{timeout:60000},async()=>{
 const h=await profileHarness();const {page}=h;try{
 await page.evaluate(()=>{for(let i=0;i<15;i++){edges.push({follower_id:'friend'+i,following_id:'other',status:'active'});hold('relation:friend'+i);}hold('relation:other');ProfileNavigation.open('other');});
 await page.waitForFunction(()=>document.getElementById('displayName').textContent==='other name'&&!document.querySelector('#actionRow .act-msg')?.disabled);
 assert.equal(await page.locator('#followBtn').count(),0);assert((await page.locator('#actionRow').textContent()).includes('Message'));
 await page.evaluate(()=>release('relation:other'));await page.waitForFunction(()=>!!document.getElementById('followBtn'));
 await page.waitForFunction(()=>document.getElementById('panel-posts').textContent.includes('other post'));
 await page.evaluate(()=>openFollowModal('followers'));
 const queued=await page.evaluate(()=>calls.filter(c=>c.kind==='privacy_v2_approved_edge'&&c.args.p_following.startsWith('friend')).length);assert(queued>0&&queued<=8);
 await page.evaluate(()=>{for(let i=0;i<15;i++)release('relation:friend'+i);});
 await page.waitForFunction(()=>{const bounds=document.getElementById('fsList0').getBoundingClientRect();return [...document.querySelectorAll('#fsVirtualContent0 .u-row')].filter(row=>{const r=row.getBoundingClientRect();return r.bottom>bounds.top&&r.top<bounds.bottom;}).every(row=>!row.querySelector('button[aria-label="Loading relationship"]'));});
 const requests=await page.evaluate(()=>{const n={};calls.filter(c=>c.kind==='privacy_v2_approved_edge'&&c.args.p_following.startsWith('friend')).forEach(c=>n[c.args.p_following]=(n[c.args.p_following]||0)+1);return n;});
 assert(Object.values(requests).every(n=>n===1));assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
