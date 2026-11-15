// Serve actual generated browser assets; mock only external services with synthetic data.
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium,webkit} from '@playwright/test';
import {originalAudioWav} from './original-audio-fixture.js';
export const owner='11111111-1111-4111-8111-111111111111';
export async function builtGalleryHarness({authenticated=false}={}){
 const root=new URL('../../cloudflare/generated/public/',import.meta.url);
 const profile={id:owner,freeupper_id:'FUABCDEF123456',username:'fixture_creator',display_username:'fixture_creator',display_name:'Fixture Creator',bio:'Synthetic creator',avatar_url:'/freeupper.png',cover_url:'/freeupper.png',verified:true,verified_status:'verified',is_private:false,hidden_tabs:[],hide_all_posts:false,created_at:'2026-11-01T00:00:00Z'};
 const soundId='22222222-2222-4222-8222-222222222222';
 let origin;const documents=[],trace=[],errors=[],requests=[];
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://fixture');let path=url.pathname;
  if(['/profile','/@fixture_creator','/u/FUABCDEF123456'].includes(path))path='/profile.html';
  if(path==='/home')path='/index.html';if(path==='/videos')path='/video.html';
  if(path.endsWith('.html')&&['document','iframe'].includes(req.headers['sec-fetch-dest']))documents.push(path);
  if(path==='/original.wav'){res.setHeader('Content-Type','audio/wav');res.end(originalAudioWav());return;}
  const body=await readFile(path==='/fixture.mp4'?new URL('../fixtures/gallery-ui-video.mp4',import.meta.url):new URL('.'+path,root));
  res.setHeader('Content-Type',path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':path.endsWith('.mp4')?'video/mp4':path.endsWith('.webmanifest')?'application/manifest+json':'text/html');
  if(path.endsWith('.mp4')){res.setHeader('Accept-Ranges','bytes');const m=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);if(m){const start=Number(m[1]),end=Math.min(Number(m[2]||body.length-1),body.length-1);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${body.length}`,'Content-Length':end-start+1});res.end(body.subarray(start,end+1));return;}}
  res.end(body);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const posts=Array.from({length:5},(_,i)=>({id:`33333333-3333-4333-8333-${String(i+1).padStart(12,'0')}`,user_id:owner,profiles:profile,title:'Fixture video '+i,content:'Synthetic Gallery caption',source:'studio',media_type:'video',media_url:origin+'/fixture.mp4',media:[{type:'video',url:origin+'/fixture.mp4'}],thumbnail_url:origin+'/freeupper.png',sound_id:soundId,visibility:'public',publishing_state:'published',is_deleted:false,is_hidden:false,created_at:`2026-11-0${5-i}T00:00:00Z`,likes_count:0,comments_count:0}));
 const note={...posts[0],id:'44444444-4444-4444-8444-444444444444',source:'create',title:'Fixture Note',content:'Actual shared Home card',media_type:null,media_url:null,media:[],sound_id:null};
 const all=[note,...posts];
 const authSource=await readFile(new URL('../../auth.js',import.meta.url),'utf8');
 const storageKey=authSource.match(/storageKey: '([^']+)'/)[1];
 const acceptedDocuments=[...authSource.match(/const LEGAL_VERSIONS = \{([\s\S]*?)\}/)[1].matchAll(/(\w+): '([^']+)'/g)].map(([,document_type,document_version])=>({document_type,document_version}));
 const user={id:owner,aud:'authenticated',role:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{provider:'email'}};
 const exp=Math.floor(Date.now()/1000)+3600;
 const jwt=[{alg:'HS256',typ:'JWT'},{sub:owner,role:'authenticated',exp,iat:exp-3600},'synthetic-signature'].map(v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url')).join('.');
 const session={access_token:jwt,refresh_token:'synthetic-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user};
 const wk=process.env.FREEUPPER_PROFILE_ENGINE==='webkit';
 const browser=await(wk?webkit:chromium).launch(wk?{executablePath:process.env.FREEUPPER_WEBKIT_EXECUTABLE||undefined}:{executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await context.exposeBinding('__galleryTrace',({frame},event)=>trace.push({frame:new URL(frame.url()||origin).pathname,...event}));
 await context.addInitScript(({authenticated,storageKey,session,profile})=>{
  if(authenticated&&!localStorage.getItem('__fixture_session_seeded')){localStorage.setItem('__fixture_session_seeded','1');localStorage.setItem(storageKey,JSON.stringify(session));localStorage.setItem('freeupper_user_profile',JSON.stringify({id:profile.id,isLoggedIn:true,displayName:profile.display_name,username:profile.username,avatar:profile.avatar_url}));}
  const emit=event=>window.__galleryTrace(event).catch(()=>{});
  let client;Object.defineProperty(window,'sb',{configurable:true,get:()=>client,set:value=>{client=value;value.auth.onAuthStateChange((event,session)=>{emit({event:'auth-event',authEvent:event,viewer:session?.user?.id||'guest'});});}});
  for(const name of ['pushState','replaceState']){const original=history[name];history[name]=function(state,title,url){emit({event:name,keys:Object.keys(state||{}),url:String(url||location.href)});return original.apply(this,arguments);};}
  addEventListener('storage',e=>emit({event:'storage',key:e.key}));
  for(const name of ['DOMContentLoaded','pagehide','beforeunload'])addEventListener(name,()=>emit({event:name,disposed:window.FreeUpperScreen?.isDisposed?.()}));
  new MutationObserver(records=>{for(const r of records)for(const el of r.removedNodes)if(el.nodeType===1&&(el.matches?.('.gallery-overlay')||el.querySelector?.('.gallery-overlay')))emit({event:'gallery-removed',disposed:window.FreeUpperScreen?.isDisposed?.()});}).observe(document,{subtree:true,childList:true});
  localStorage.setItem('freeupper_seen_signup_prompt','1');
 },{authenticated,storageKey,session,profile});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===origin)return route.continue();
  if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('@supabase/supabase-js'))return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../../node_modules/@supabase/supabase-js/dist/umd/supabase.js',import.meta.url))});
  if(url.hostname==='cdn.tailwindcss.com')return route.fulfill({contentType:'application/javascript',body:'window.tailwind={}; /* Offline optional style CDN. */'});
  if(url.hostname!=='api.freeupper.com')return route.abort();
  requests.push({method:req.method(),path:url.pathname,owner:url.searchParams.get('user_id'),frame:new URL(req.frame().url()||origin).pathname});
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,HEAD,POST,OPTIONS','access-control-expose-headers':'content-range'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const name=url.pathname.split('/').at(-1);let data=[];let count=0;
  if(url.pathname.startsWith('/auth/v1/'))data=name==='token'?session:name==='user'?user:{};
  else if(url.pathname.includes('/rpc/')){
   if(['get_profile_identity_by_id','get_profile_by_freeupper_id','get_public_profile_by_username','get_my_private_profile'].includes(name))data=[profile];
   else if(name==='quote_repost_status')data={enabled:false};
   else if(name==='can_view_profile_tab')data=true;
   else if(name==='privacy_v2_approved_edge')data=false;
   else if(name==='get_sound_stats')data=[];
  }else if(name==='posts'){
   data=all;const eq=url.searchParams.get('id');if(eq?.startsWith('eq.'))data=all.filter(p=>p.id===eq.slice(3));
   const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||all.length);count=data.length;data=data.slice(offset,offset+limit);
  }else if(name==='profiles')data=[profile];
  else if(name==='legal_acceptances')data=acceptedDocuments;
  else if(name==='sounds')data=[{id:soundId,title:'Owned original fixture',artist:'Fixture Creator',created_by:owner,audio_url:origin+'/original.wav',art_url:origin+'/freeupper.png',source_post_id:posts[0].id,is_original:true,is_public:true,is_active:true,profiles:profile}];
  if(req.headers().accept?.includes('vnd.pgrst.object'))data=data[0]||null;
  headers['content-range']=count?`0-${count-1}/${count}`:'*/0';
  return route.fulfill({status:200,contentType:'application/json',headers,body:req.method()==='HEAD'?'':JSON.stringify(data)});
 });
 await context.routeWebSocket('**/*',s=>s.close());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 return {page,context,browser,origin,posts,documents,trace,errors,requests,close:async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
