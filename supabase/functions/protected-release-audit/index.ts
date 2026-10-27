// Operator-only, one-use live acceptance driver. Never exports login material.
// Test identities below identify the user's authorized test accounts, not gates.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { PHOTO, VIDEO } from "./fixtures.ts";
const BASE="https://jmjtqidirpmnegzvmiaq.supabase.co",API="https://api.freeupper.com",WEB="https://freeupper.com";
const OWNER="9341af03-e007-4fc6-9c23-b06073379088",OUTSIDE="1568563e-592f-4dd4-8efa-ee9429aebacb";
const OPTIONS={auth:{persistSession:false,autoRefreshToken:false}};
Deno.serve(async(request:Request)=>{
 const reply=(status:number,value:unknown)=>Response.json(value,{status,headers:{"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow"}});
 if(request.method!=="POST")return reply(405,{error:"Method not allowed"});
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),anon=Deno.env.get("SUPABASE_ANON_KEY");
 if(Deno.env.get("SUPABASE_URL")!==BASE||!service||!anon)return reply(503,{error:"Configuration unavailable"});
 const db=createClient(BASE,service,OPTIONS),key=request.headers.get("X-FreeUpper-Worker-Secret")||"";
 const {data:allowed,error:keyError}=await db.rpc("protected_cleanup_worker_authorized",{p_token:key});
 if(keyError||allowed!==true)return reply(403,{error:"Operator forbidden"});
 let run:string;
 try{const raw=await request.text();if(raw.length>512)throw Error();run=JSON.parse(raw).run_id;if(!/^[a-f0-9-]{36}$/.test(run))throw Error();}catch{return reply(400,{error:"Invalid run"});}
 const {data:claimed,error:claimError}=await db.rpc("claim_release_workflow_audit",{p_run:run});
 if(claimError||claimed!==true)return reply(409,{error:"Run unavailable"});
 const sessions=new Map<string,string>(),created:Array<{id:string,owner:string}>=[],checks:string[]=[],relationships:any[]=[];
 let passed=false,failure="";
 const check=(condition:unknown,label:string)=>{if(!condition)throw Error(label);checks.push(label);};
 const api=async(path:string,token:string|undefined,body?:unknown)=>fetch(API+path,{method:body===undefined?"GET":"POST",redirect:"manual",headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 const publish=async(owner:string,body:unknown)=>{const response=await api('/functions/v1/protected-publishing',sessions.get(owner),body);const data=await response.json();check(response.ok,"publisher action "+(body as any).action+" status "+response.status);return data;};
 const media=async(asset:string,viewer:string|undefined,expected:number)=>{const r=await fetch(WEB+'/api/post-media?asset_id='+asset,{redirect:"manual",headers:viewer?{Authorization:'Bearer '+sessions.get(viewer)}:{},signal:AbortSignal.timeout(20000)});check(r.status===expected,'media '+expected+' for '+(viewer||'signed-out'));check(/private, no-store/.test(r.headers.get('Cache-Control')||''),'media private cache');check(!r.headers.get('Location'),'media never redirects');if(expected===200)check((await r.arrayBuffer()).byteLength>0,'actual media bytes');else await r.body?.cancel();};
 const rpc=async(name:string,owner:string,args:unknown)=>{const r=await api('/rest/v1/rpc/'+name,sessions.get(owner),args);check(r.ok,'owner RPC '+name);return r;};
 async function create(owner:string,type:string,visibility:string){
  const draft=await publish(owner,{action:'create',visibility,media_types:[type],fields:{source:'studio',title:'Privacy release audit '+run,content:'',tags:[]}});
  created.push({id:draft.id,owner});const registered=[];
  for(const slot of type==='video'?[0,20]:[0]){
   const kind=slot===20?'image':type,signed=await publish(owner,{action:'sign',post_id:draft.id,slot});
   check(signed.type==='authenticated'&&signed.cloud_name==='duzyf1kda','authenticated Cloudinary reservation');
   const form=new FormData();for(const name of ['api_key','timestamp','folder','public_id','type','overwrite','signature'])form.append(name,String(signed[name]));
   const bytes=Uint8Array.from(atob(kind==='video'?VIDEO:PHOTO),c=>c.charCodeAt(0));form.append('file',new Blob([bytes],{type:kind==='video'?'video/mp4':'image/jpeg'}),kind==='video'?'audit.mp4':'audit.jpg');
   const uploaded=await fetch('https://api.cloudinary.com/v1_1/duzyf1kda/'+kind+'/upload',{method:'POST',body:form,signal:AbortSignal.timeout(20000)});
   check(uploaded.ok,'real authenticated '+kind+' upload');const asset=await uploaded.json();check(asset.type==='authenticated','uploaded delivery type');
   const registry=await publish(owner,{action:'register',post_id:draft.id,slot,public_id:asset.public_id,asset_id:asset.asset_id,resource_type:kind});registered.push(registry.asset_id);
   for(const delivery of ['upload','authenticated']){
    const direct=await fetch('https://res.cloudinary.com/duzyf1kda/'+kind+'/'+delivery+'/'+asset.public_id+'.'+asset.format,{redirect:'manual',signal:AbortSignal.timeout(15000)});check([400,401,403,404].includes(direct.status),'unsigned '+delivery+' denied');await direct.body?.cancel();
   }
  }
  await publish(owner,{action:'publish',post_id:draft.id});return {id:draft.id,assets:registered};
 }
 try{
  const rel=await db.rpc('release_audit_relationships');check(!rel.error&&Array.isArray(rel.data)&&rel.data.length===4,'four production test accounts');relationships.push(...rel.data);
  // Admin-generated one-time links are redeemed by Supabase Auth. They are not
  // emailed or exported, and only these newly created test sessions are revoked.
  for(const account of relationships){
   check(account.eligible===true,'existing Auth account eligible '+account.username);
   const user=await db.auth.admin.getUserById(account.id);check(!user.error&&!!user.data.user?.email,'test identity exists');
   const link=await db.auth.admin.generateLink({type:'magiclink',email:user.data.user!.email!});check(!link.error&&!!link.data.properties?.hashed_token,'one-time test authorization');
   const auth=createClient(BASE,anon,OPTIONS),verified=await auth.auth.verifyOtp({token_hash:link.data.properties!.hashed_token,type:'magiclink'});
   check(!verified.error&&verified.data.user?.id===account.id&&!!verified.data.session?.access_token,'genuine Auth session '+account.username);
   sessions.set(account.id,verified.data.session!.access_token);
   const readiness=await api('/rest/v1/rpc/protected_studio_beta_status',verified.data.session!.access_token,{});
   const ready=await readiness.json();check(readiness.ok&&ready.approved===true&&ready.ready===true&&ready.mode==='production','global selector readiness '+account.username);
  }
  const anonymousAttempt=await api('/functions/v1/protected-publishing',undefined,{action:'create'});check(anonymousAttempt.status===401,'anonymous publishing denied');await anonymousAttempt.body?.cancel();
  const publicPosts=await api('/rest/v1/posts?select=id&visibility=eq.public&is_deleted=eq.false&is_hidden=eq.false&limit=1',undefined);check(publicPosts.ok&&(await publicPosts.json()).length===1,'existing Public posts work');
  const photo=await create(OWNER,'image','followers');
  for(const audience of ['followers','friends','only_me']){
   if(audience!=='followers')await publish(OWNER,{action:'visibility',post_id:photo.id,visibility:audience});
   for(const viewer of relationships){const visible=viewer.id===OWNER||(audience==='followers'&&viewer.follows_owner)||(audience==='friends'&&viewer.follows_owner&&viewer.owner_follows);
    const metadata=await api('/rest/v1/posts?select=id,media,visibility&id=eq.'+photo.id,sessions.get(viewer.id));check(metadata.ok,'metadata request');check((await metadata.json()).length===(visible?1:0),'metadata '+audience+' '+viewer.username);await media(photo.assets[0],viewer.id,visible?200:404);}
   await media(photo.assets[0],undefined,401);
  }
  const text=await publish(OUTSIDE,{action:'text',visibility:'only_me',fields:{source:'composer',title:'Privacy release audit '+run,content:'Restricted text audit',tags:[]}});created.push({id:text.id,owner:OUTSIDE});
  for(const viewer of [OUTSIDE,OWNER]){const r=await api('/rest/v1/posts?select=id,content&id=eq.'+text.id,sessions.get(viewer));check(r.ok&&(await r.json()).length===(viewer===OUTSIDE?1:0),'restricted text metadata authorization');}
  const outside=await create(OUTSIDE,'image','only_me');await media(outside.assets[0],OUTSIDE,200);await media(outside.assets[0],OWNER,404);check(true,'previously non-allowlisted account publishes protected post');
  await rpc('delete_post',OUTSIDE,{p_post_id:outside.id});await media(outside.assets[0],OUTSIDE,404);await rpc('restore_post',OUTSIDE,{p_post_id:outside.id});await media(outside.assets[0],OUTSIDE,200);
  await rpc('permanently_delete_post',OUTSIDE,{p_post_id:outside.id});await media(outside.assets[0],OUTSIDE,404);
  const restore=await api('/rest/v1/rpc/restore_post',sessions.get(OUTSIDE),{p_post_id:outside.id});check(!restore.ok,'permanent deletion cannot restore');await restore.body?.cancel();
  const video=await create(OWNER,'video','only_me');for(const asset of video.assets){await media(asset,OWNER,200);await media(asset,OUTSIDE,404);await media(asset,undefined,401);}
  const cancelled=await publish(OWNER,{action:'create',visibility:'only_me',media_types:['image'],fields:{source:'studio',title:'Privacy release audit '+run,content:'',tags:[]}});created.push({id:cancelled.id,owner:OWNER});await publish(OWNER,{action:'sign',post_id:cancelled.id,slot:0});const cancelledResult=await publish(OWNER,{action:'cancel',post_id:cancelled.id});check(cancelledResult.cleanupPending===true,'cancel queues delayed cleanup');
  passed=true;
 }catch(error){failure=error instanceof Error?error.message:'Audit failed';}
 finally{
  // Recover any owned audit draft whose create response was lost.
  try{const recovered=await db.from('posts').select('id,user_id').eq('title','Privacy release audit '+run).in('user_id',[OWNER,OUTSIDE]);
   for(const post of recovered.data||[])if(!created.some(p=>p.id===post.id))created.push({id:post.id,owner:post.user_id});
  }catch{passed=false;failure||='Audit draft recovery failed';}
  for(const post of created)try{const r=await api('/rest/v1/rpc/permanently_delete_post',sessions.get(post.owner),{p_post_id:post.id});if(!r.ok){passed=false;failure||='Audit post retirement failed';}await r.body?.cancel();}catch{passed=false;failure||='Audit post retirement failed';}
  for(const token of sessions.values())try{await db.auth.admin.signOut(token,'local');}catch{passed=false;failure||='Test session revocation failed';}
 }
 const result={checks,relationships,posts:created,failure:failure||null,scope:'server-authorized live test-account sessions; not interactive browser acceptance'};
 const saved=await db.rpc('complete_release_workflow_audit',{p_run:run,p_passed:passed,p_result:result});
 if(saved.error||saved.data!==true)return reply(503,{error:'Audit recording failed'});
 return reply(passed?200:503,{passed,...result});
});
