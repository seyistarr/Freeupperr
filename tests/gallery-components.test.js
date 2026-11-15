import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const card=await readFile('post-card.js','utf8');
test('Home and Notes share the full card, original author, quote and formatting dependencies',async()=>{
 const host={escapeHtml:s=>String(s||''),getAuthorFromProfile:p=>({id:p.id,name:p.display_name,avatar:p.avatar_url,verified_status:p.verified_status}),truncateName:s=>s,buildRepostBanner:p=>p.repost?'REPOST':'',getMediaItems:p=>p.media||[],buildMediaHTML:p=>'<media>'+p.id+'</media>',buildFollowButton(){},buildFollowPlusButton:()=>'',getVerifiedBadgeHTML:s=>s==='verified'?'VERIFIED':'',getCurrentUser:()=>({id:'viewer'}),formatRelativeTime:()=> '1m',renderPostTitle:t=>'<title>'+t+'</title>',buildContentBlockHTML:(id,text)=>'<content>'+text+'</content>',buildQuotedPostCard:p=>p.quotedPost?'ORIGINAL QUOTE AUTHOR':'',buildPublishedLinkCard:()=>'',buildActionsRow:()=> 'LOVE COMMENT REPOST SHARE SAVE'};
 const context=vm.createContext({window:host});vm.runInContext(card,context);
 const post={id:'p',user_id:'creator',profile:{id:'creator',display_name:'Original Creator',verified_status:'verified',avatar_url:'avatar'},title:'Title',content:'Text',media:[{type:'image',url:'image'}],quotedPost:{id:'q'}};
 const markup=host.FreeUpperPostCard.render(post,0);for(const text of ['Original Creator','VERIFIED','<title>Title','<content>Text','<media>p','ORIGINAL QUOTE AUTHOR','LOVE COMMENT REPOST SHARE SAVE'])assert(markup.includes(text));
 assert(markup.startsWith('<article'));assert(!markup.includes('grid-card'));assert(markup.includes('data-author-id="creator"'));
 const feed=await readFile('foryou.js','utf8');assert(feed.includes('window.FreeUpperPostCard.render(...args)'));assert(feed.includes('window.renderProfileNotes'));assert(!feed.includes('return `<article'));
});
test('previews select one visible decoder and release it on lifecycle changes',async()=>{
 let observer,visibility;const videos=Array.from({length:3},()=>({dataset:{previewSrc:'clip.mp4'},isConnected:true,plays:0,pauses:0,loads:0,play(){this.plays++;return Promise.resolve()},pause(){this.pauses++},removeAttribute(name){delete this[name]},load(){this.loads++}}));
 const window={};const document={hidden:false,addEventListener(name,f){visibility=f},removeEventListener(){}};
 vm.runInNewContext((await readFile('inline-video.js','utf8'))+';'+(await readFile('gallery-preview.js','utf8')),{window,document,navigator:{connection:{saveData:false}},matchMedia:()=>({matches:false}),IntersectionObserver:class{constructor(callback){this.callback=callback;observer=this}observe(){}disconnect(){this.disconnected=true}}});
 const controller=new window.GalleryPreviews({querySelectorAll:()=>videos});observer.callback(videos.map((target,i)=>({target,isIntersecting:true,intersectionRatio:.7+i*.1})));await Promise.resolve();await Promise.resolve();
 assert.equal(videos.reduce((n,v)=>n+v.plays,0),1);assert.equal(controller.active,videos[2]);assert.equal(videos[2].muted,true);
 observer.callback([{target:videos[2],isIntersecting:false,intersectionRatio:0}]);await Promise.resolve();await Promise.resolve();assert.equal(controller.active,videos[1]);assert.equal(videos[2].src,undefined);
 document.hidden=true;visibility();assert.equal(controller.active,null);controller.dispose();assert(observer.disconnected);
});
test('Gallery uses existing profile APIs, includes ordinary and Studio video, and keeps Saved private',async()=>{
 const posts=[{id:'a',mediaType:'video',source:'composer'},{id:'b',mediaType:'image',source:'studio'},{id:'c',mediaType:'video',source:'studio'}];
 const calls=[];
 const window={AuthUser:{getCurrentUser:()=>({id:'viewer',isLoggedIn:true})},sb:{rpc:async(name)=>{calls.push(name);return {data:name==='get_profile_identity_by_id'?[{freeupper_id:'FU1'}]:[{id:'creator',is_private:false}]};}},PostsAPI:{loadProfilePage:async()=>({posts,total:3})}};
 vm.runInNewContext(await readFile('gallery-api.js','utf8'),{window,addEventListener(){}});
 assert.deepEqual(Array.from(await window.GalleryAPI.items('creator','posts'),r=>r.post.id),['a','c']);
 assert.deepEqual(Array.from(await window.GalleryAPI.notes('creator','posts'),p=>p.id),['a']);
 assert.equal((await window.GalleryAPI.profile('creator','star')).length,0);
 assert(!calls.includes('profile_content_ids'));assert(!calls.includes('sound_access'));
});
test('profile access fails closed and interaction grids preserve canonical membership order',async()=>{
 let privateProfile=true,approved=false,allowed=true,fail=false,queries=0;
 const window={AuthUser:{getCurrentUser:()=>({id:'viewer',isLoggedIn:true})},
 sb:{rpc:async(name)=>({data:name==='get_profile_identity_by_id'?[{freeupper_id:'FU1'}]:name==='get_profile_by_freeupper_id'?[{id:'creator',is_private:privateProfile}]:name==='privacy_v2_approved_edge'?approved:allowed}),
 from(table){queries++;assert.equal(table,'reposts');const query={select(){return this},eq(){return this},order(){return this},range:async()=>({data:[{post_id:'b'},{post_id:'a'}],error:fail?Error('Denied'):null})};return query;}},
 PostsAPI:{loadPostIds:async()=>[{id:'a',mediaType:'video'},{id:'b',mediaType:'video'}]}};
 vm.runInNewContext(await readFile('gallery-api.js','utf8'),{window,addEventListener(){}});
 assert.equal((await window.GalleryAPI.items('creator','share')).length,0);assert.equal(queries,0);
 approved=true;allowed=false;assert.equal((await window.GalleryAPI.items('creator','share')).length,0);assert.equal(queries,0);
 allowed=true;assert.deepEqual(Array.from(await window.GalleryAPI.items('creator','share'),r=>r.post.id),['b','a']);
 fail=true;await assert.rejects(window.GalleryAPI.items('creator','share'),/Denied/);
});
