import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium,webkit} from '@playwright/test';
const html=await readFile(new URL('../../profile.html',import.meta.url),'utf8');
const cache=await readFile(new URL('../../profile-cache.js',import.meta.url),'utf8');
const worker=await readFile(new URL('../../service-worker.js',import.meta.url),'utf8');
const main=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('var targetUserId'))[1];
const bootstrap=`
window.fuT=s=>s;window.showToast=s=>(window.toasts ||= []).push(s);window.updateNavAvatar=()=>{};
window.viewer={id:'viewer',isLoggedIn:true};window.AuthUser={getCurrentUser:()=>viewer,onChange:f=>window.viewerChange=f,requireAuth:f=>viewer.isLoggedIn?f():null};
window.createProfileDetailNavigation=()=>({resetViewer(){},invalidate(){},setProfile(){},warm(){},restore(){},popstate(){return false;}});
window.calls=[];window.pending={};window.failCounts=false;window.failMutation=false;window.granted=new Set();window.allowTabs=true;
window.hold=key=>{let resolve;const promise=new Promise(r=>resolve=r);pending[key]={promise,resolve};};window.release=key=>{pending[key]?.resolve();delete pending[key];};
window.waitFor=async key=>{if(pending[key])await pending[key].promise;};
const image=id=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>'+id+'</text></svg>');
window.people=Object.fromEntries(['viewer','follower','following','suggestion','private','other',...Array.from({length:30},(_,i)=>'friend'+i)].map(id=>[id,{id,username:id,display_name:id+' name',avatar_url:image(id),bio:id+' bio',cover_url:image('cover '+id),verified:id==='friend0',hidden_tabs:[],is_private:id==='private'}]));
window.edges=[{follower_id:'viewer',following_id:'viewer',status:'active'},{follower_id:'other',following_id:'other',status:'active'},
 {follower_id:'follower',following_id:'viewer',status:'active'},{follower_id:'viewer',following_id:'following',status:'active'},
 ...Array.from({length:30},(_,i)=>[{follower_id:'viewer',following_id:'friend'+i,status:'active'},{follower_id:'friend'+i,following_id:'viewer',status:'active'}]).flat(),
 {follower_id:'viewer',following_id:'private',status:'pending'},{follower_id:'private',following_id:'viewer',status:'active'}];
window.approved=(actor,id)=>{const edge=edges.find(e=>e.follower_id===actor&&e.following_id===id&&e.status==='active');return !!edge&&(!people[id]?.is_private||granted.has(actor+':'+id));};
window.sb={auth:{onAuthStateChange:f=>window.authChange=f},channel:()=>({on(){return this},subscribe(){}}),
 rpc:async(name,args)=>{
 calls.push({kind:name,args});
 if(name==='privacy_v2_approved_edge'){await waitFor('relation:'+args.p_following);return {data:approved(args.p_follower,args.p_following)};}
 if(name==='can_view_profile_tab')return {data:allowTabs};
 if(name==='get_suggestions')return {data:[people.viewer,people.suggestion]};
 if(name==='get_profile_identity_by_id')return {data:people[args.p_user_id]};
 if(name==='get_public_profile_by_username')return {data:people[args.p_username]};
 if(name==='toggle_follow_with_notification'){
  await waitFor('mutation:'+args.p_target_id);if(failMutation)return {error:{message:'Mutation failed'}};
  const i=edges.findIndex(e=>e.follower_id===viewer.id&&e.following_id===args.p_target_id);
  if(i>=0){edges.splice(i,1);return {data:false};}
  edges.push({follower_id:viewer.id,following_id:args.p_target_id,status:people[args.p_target_id]?.is_private?'pending':'active'});return {data:true};
 }
 return {data:null};
 },from(table){let equal={},not={},fields='',head=false,single=false;
 const q={select(f,o){fields=f;head=!!o?.head;return q;},eq(k,v){equal[k]=v;return q;},neq(k,v){not[k]=v;return q;},maybeSingle(){single=true;return q;},then(resolve,reject){return (async()=>{
  if(table==='profiles'){calls.push({kind:'identity',id:equal.id});await waitFor('identity:'+equal.id);return viewer.isLoggedIn?{data:people[equal.id]||null}:{error:{message:'Direct profile SELECT denied'}};}
  if(table==='blocks')return {data:null};
  if(table==='follows'){
   const owner=head?(equal.following_id||equal.follower_id):null;
   if(head){calls.push({kind:'counts',id:owner});await waitFor('counts:'+owner);if(failCounts)return {error:{message:'Stats unavailable'}};}
   if(single){calls.push({kind:'relation-row',id:equal.following_id});await waitFor('relation:'+((equal.follower_id===viewer.id)?equal.following_id:equal.follower_id));}
   if(fields.includes('profiles:')){calls.push({kind:'lists',id:equal.following_id||equal.follower_id});await waitFor('lists:'+(equal.following_id||equal.follower_id));}
   let rows=edges.filter(e=>Object.entries(equal).every(([k,v])=>e[k]===v)&&Object.entries(not).every(([k,v])=>e[k]!==v));
   if(head)return {count:rows.length};
   if(fields.includes('profiles:'))rows=rows.map(e=>({...e,profiles:people[fields.includes('profiles:follower_id')?e.follower_id:e.following_id]}));
   return {data:single?(rows[0]||null):rows};
  }
  return {data:[]};
 })().then(resolve,reject);}};return q;}};
window.PostsAPI={loadPostsByUserId:async id=>{calls.push({kind:'posts',id});await waitFor('posts:'+id);return [{id:'post-'+id,title:id+' post',user_id:id,timestamp:'2026-01-01',mediaType:'text'}];}};
`;
export async function profileHarness({guest=false,pwa=false}={}){
 let documents=0;
 const server=createServer((req,res)=>{if(req.url==='/service-worker.js'){res.setHeader('Content-Type','text/javascript');res.end(worker);return;}
 res.setHeader('Content-Type','text/html');if(req.url.startsWith('/profile.html'))documents++;
 res.end(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',`<script>${cache}</script><script>${bootstrap}${guest?"viewer={id:'guest',isLoggedIn:false};":''}</script><script>${main}</script></body>`));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await (process.env.FREEUPPER_PROFILE_ENGINE==='webkit'?webkit.launch():chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']})).catch(async e=>{await new Promise(r=>server.close(r));throw e;});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin+'/profile.html?uid=viewer');
 if(pwa){await page.evaluate(async()=>{await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;});await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);}
 await page.waitForFunction(()=>document.getElementById('statPosts').textContent==='1');
 return {page,errors,documents:()=>documents,close:async()=>{await browser.close();await new Promise(r=>server.close(r));}};
}

export const profileFixtureParts={html,cache,bootstrap,main,worker};
