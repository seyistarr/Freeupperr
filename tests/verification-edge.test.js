import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const owner='9341af03-e007-4fc6-9c23-b06073379088',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function edge(slug, options={}) {
 let handler;const calls=[],destroyed=[];
 const rpc=async(name,args)=>{
  calls.push({name,args});
  if(options.rpc)return options.rpc(name,args);
  const values={protected_publisher_beta_allowed:true,protected_publishing_access:{mode:'production',expires_at:'2026-11-03T12:00:00Z'},
   create_protected_draft:{},protected_cleanup_worker_authorized:!!options.workerAllowed,expire_protected_drafts:0,claim_protected_cleanup_batch:[],record_protected_security_audit:null,authorize_protected_asset:true,protected_media_release_allowed:true,
   list_verification_posts:[],retire_verification_post:{retired:true},claim_verification_cleanup:[]};
  return {data:values[name],error:null};
 };
 const row=slug==='protected-media'?{id,post_id:id,owner_id:owner,status:'ready',delivery_type:'authenticated',resource_type:'image',format:'jpg',cloudinary_public_id:'freeupper-protected-v2/'+owner+'/asset_'+'0'.repeat(32)}:{id:owner};
 const query={select(){return this;},eq(){return this;},async limit(){return {data:[row],error:null};},async maybeSingle(){return {data:row,error:null};}};
 const env={SUPABASE_URL:'https://jmjtqidirpmnegzvmiaq.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon',CLOUDINARY_CLOUD_NAME:'duzyf1kda',CLOUDINARY_API_KEY:'fixture-key',CLOUDINARY_API_SECRET:'fixture-secret'};
 const cloudinary={config(){},utils:{private_download_url(publicId,format,opts){return 'https://api.cloudinary.com/v1_1/duzyf1kda/image/download?expires_at='+opts.expires_at+'&signature=fixture';}},uploader:{async destroy(publicId,opts){destroyed.push({publicId,opts});if(options.destroyFails)throw Error('Remote failure');return {result:'ok'};}}};
 const createClient=(url,key)=> key===env.SUPABASE_SERVICE_ROLE_KEY?{rpc,from:()=>query}:{auth:{getUser:async token=>({data:{user:token==='valid-user'?{id:owner}:null},error:token==='valid-user'?null:{message:'Invalid JWT'}})}};
 let source=await readFile('supabase/functions/'+slug+'/index.ts','utf8');
 source=source.replace(/import \{ createClient \} from "npm:[^"]+";/,'').replace(/import \{ v2 as cloudinary \} from "npm:[^"]+";/,'')
  .replaceAll('await import("npm:cloudinary@2.5.1")','({v2:cloudinaryFixture})');
 const context={Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn;}},createClient,cloudinary,cloudinaryFixture:cloudinary,URL,Request,Response,Headers,AbortSignal,TransformStream,Uint8Array,
  crypto:{randomUUID:()=>id},console:{error(){}},fetch:async(url,init)=>{calls.push({url,init});return new Response('private bytes',{headers:{'Content-Type':'image/jpeg'}});}};
 vm.runInNewContext(stripTypeScriptTypes(source),context);
 const request=async(body,token='valid-user',extraHeaders={})=>handler(new Request('https://api.freeupper.com/functions/v1/'+slug+(slug==='protected-media'?'?asset_id='+id:''),{
  method:slug==='protected-media'?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extraHeaders},...(slug==='protected-media'?{}:{body:JSON.stringify(body)})}));
 return {request,calls,destroyed};
}
const create={action:'create',verification:false,visibility:'followers',media_types:['image'],fields:{source:'studio',title:'Test',content:'',tags:[]}};
test('publishing verifies normal JWTs and denies excluded users before privileged creation',async()=>{
 let e=await edge('protected-publishing');assert.equal((await e.request(create,'invalid-user')).status,401);assert.equal(e.calls.length,0);
 e=await edge('protected-publishing',{rpc:async()=>({data:false,error:null})});assert.equal((await e.request(create)).status,403);
});
test('permanent create rejects temporary flags and calls only the production draft RPC',async()=>{
 const e=await edge('protected-publishing');
 assert.equal((await e.request({...create,verification:true})).status,400);
 const r=await e.request(create);assert.equal(r.status,201);assert.equal((await r.json()).verification,false);
 assert.ok(e.calls.some(c=>c.name==='create_protected_draft'));assert.ok(!e.calls.some(c=>c.name==='create_verification_draft'));
});
test('disabled mode and unmarked post contexts cannot sign, register or publish',async()=>{
 const e=await edge('protected-publishing',{rpc:async name=>({data:name==='protected_publisher_beta_allowed'?true:{mode:'disabled'},error:null})});
 for(const action of ['create','sign','register','publish'])assert.equal((await e.request({...create,action,post_id:id})).status,503);
 assert.ok(!e.calls.some(c=>['create_verification_draft','protected_publish_transition'].includes(c.name)));
});
test('media still authenticates and checks audience authorization before fetching private bytes',async()=>{
 const e=await edge('protected-media');let r=await e.request(null);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(r.headers.get('Location'),null);assert.equal(await r.text(),'private bytes');
 assert.deepEqual(e.calls.filter(c=>c.name).map(c=>c.name),['authorize_protected_asset','protected_media_release_allowed']);
 const denied=await edge('protected-media',{rpc:async()=>({data:false,error:null})});assert.equal((await denied.request(null)).status,404);assert.ok(!denied.calls.some(c=>c.url));
 const expired=await edge('protected-media',{rpc:async name=>({data:name==='authorize_protected_asset',error:null})});assert.equal((await expired.request(null)).status,503);assert.ok(!expired.calls.some(c=>c.url));
 assert.equal((await e.request(null,'invalid-user')).status,404);
});
test('cleanup uses the authenticated owner and keeps remote deletion pending on failure',async()=>{
 for(const fail of [true,false]){
  let pending=true;
  const e=await edge('protected-publishing',{destroyFails:fail,rpc:async(name,args)=>{
   assert.equal(args.p_owner===undefined||args.p_owner===owner,true);
   if(name==='retire_verification_post')return {data:{retired:true},error:null};
   if(name==='claim_verification_cleanup')return {data:[{id,public_id:'freeupper-protected-v2/'+owner+'/asset_'+'0'.repeat(32),lease:id}],error:null};
   if(name==='complete_protected_cleanup'){pending=!args.p_success;return {data:true,error:null};}
   if(name==='list_verification_posts')return {data:[{id,cleanupPending:pending}],error:null};
   throw Error('Unexpected RPC '+name);
  }});
  const r=await e.request({action:'verification-cleanup',post_id:id,owner_id:'attacker'});assert.equal(r.status,200);
  assert.equal((await r.json()).cleanupPending,fail);assert.equal(e.destroyed.length,2);
  assert.ok(e.destroyed.every(c=>c.opts.type==='authenticated'&&c.opts.invalidate===true));
 }
});
test('cross-owner cleanup denial performs no Cloudinary operation',async()=>{
 const e=await edge('protected-publishing',{rpc:async()=>({data:null,error:{message:'unavailable'}})});
 assert.equal((await e.request({action:'verification-cleanup',post_id:id})).status,404);assert.equal(e.destroyed.length,0);
});

test('maintenance token authorizes only fixed cleanup/audit actions, never user publishing or media',async()=>{
 for(const workerAllowed of [false,true]){
  const e=await edge('protected-publishing',{workerAllowed});
  const h={'X-FreeUpper-Action':'cleanup','X-FreeUpper-Worker-Secret':'ab'.repeat(32)};
  assert.equal((await e.request({},'fixture-anon',h)).status,workerAllowed?200:403);
  assert.equal((await e.request(create,'fixture-anon',{'X-FreeUpper-Worker-Secret':'ab'.repeat(32)})).status,401);
  assert.equal(e.destroyed.length,0,'empty retirement queue cannot delete an asset');
 }
 const e=await edge('protected-publishing',{workerAllowed:true});
 assert.equal((await e.request({},'valid-user',{'X-FreeUpper-Action':'cleanup','X-FreeUpper-Worker-Secret':'ab'.repeat(32)})).status,403,'normal user JWT is not a maintenance identity');
});
