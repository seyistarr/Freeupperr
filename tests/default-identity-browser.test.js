import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

test('auth UI: email registration/login and Google redirect retain normal authentication without email identity writes', {timeout:45000},async()=>{
 const source=await readFile('auth.js','utf8');
 const server=createServer((req,res)=>{
  if(req.url==='/auth.js'){res.setHeader('content-type','application/javascript');return res.end(source);}
  if(req.url!=='/'){res.statusCode=404;return res.end();}
  res.setHeader('content-type','text/html');res.end(`<html><head></head><body><script>
  window.calls=[];
  window.fixtureProfile={id:'00000000-0000-0000-0000-000000000001',username:'my_custom_name',display_name:'Custom Display',avatar_url:''};
  window.fixtureUser={id:fixtureProfile.id,email:'private@example.test',user_metadata:{display_name:'private@example.test'}};
  const session={user:fixtureUser};
  window.supabase={createClient:()=>({auth:{
   getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:fixtureUser}}),onAuthStateChange:()=>({}),
   signUp:async args=>{calls.push(['signup',args]);return {data:{session}}},
   signInWithPassword:async args=>{calls.push(['login',args]);return {data:{session}}},
   signInWithOAuth:async args=>{calls.push(['oauth',args]);return {}},
  },rpc:async()=>({data:[{}]}),functions:{invoke:async()=>({})},
  from:table=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:fixtureProfile}),
   insert:()=>{throw Error('Existing login must not insert')},upsert:()=>{throw Error('Existing login must not upsert')}};return q;}
  })};
  </script><script src='/auth.js'></script></body></html>`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;try{
 browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(()=>AuthUser.openModal('signup'));await page.locator('#fu-email').fill('private@example.test');await page.locator('#fu-password').fill('Test-Only-Password123!');
 await page.locator('#fu-submit-btn').click();await page.waitForFunction(()=>calls.some(c=>c[0]==='signup'));
 assert.deepEqual(await page.evaluate(()=>calls.find(c=>c[0]==='signup')[1]),{email:'private@example.test',password:'Test-Only-Password123!'});
 await page.waitForFunction(()=>AuthUser.getCurrentUser().displayName==='Custom Display');
 assert.equal(await page.evaluate(()=>AuthUser.getCurrentUser().username),'my_custom_name');
 await page.evaluate(()=>AuthUser.openModal('signin'));await page.locator('#fu-email').fill('private@example.test');await page.locator('#fu-password').fill('Test-Only-Password123!');await page.locator('#fu-submit-btn').click();
 await page.waitForFunction(()=>calls.some(c=>c[0]==='login'));
 await page.evaluate(()=>AuthUser.openModal('signup'));
 await page.locator('#fu-google-btn').click();await page.waitForFunction(()=>calls.some(c=>c[0]==='oauth'));
 assert.equal(await page.evaluate(()=>calls.find(c=>c[0]==='oauth')[1].provider),'google');
 await page.evaluate(()=>AuthUser.getAuthenticatedUser());assert.equal(await page.evaluate(()=>AuthUser.getCurrentUser().displayName),'Custom Display');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});

test('email handle routes are rejected while permanent UUID and FreeUpper-ID links remain stable',async()=>{
 const {runInNewContext}=await import('node:vm');
 const html=await readFile('profile.html','utf8');
 const fn=html.slice(html.indexOf('            function getTargetUserFromUrl()'),html.indexOf('            // ─── SKELETON'));
 for(const [pathname,search,expected] of [
  ['/@fu8a3c91d42b67','',{type:'username',value:'fu8a3c91d42b67'}],
  ['/u/FU8A3C91D42B67','',{type:'freeupper_id',value:'FU8A3C91D42B67'}],
  ['/profile','?uid=stable-uuid',{type:'uuid',value:'stable-uuid'}],
 ]){
  const got=runInNewContext(fn+';getTargetUserFromUrl()', {URLSearchParams,window:{location:{pathname,search}}});
  assert.deepEqual(JSON.parse(JSON.stringify(got)),expected);
 }
 assert.throws(()=>runInNewContext(fn+';getTargetUserFromUrl()', {URLSearchParams,window:{location:{pathname:'/@old%40example.test',search:''}}}),/Profile not found/);
});

test('preview rejects email handles without querying or redirecting to an account',async()=>{
 const previousKey=process.env.SUPABASE_ANON_KEY;process.env.SUPABASE_ANON_KEY='test-anon-key';
 const {default:handler}=await import('../api/profile-preview.js?identity-compat');
 const originalFetch=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url:String(url),body:options?.body});
  if(String(url).endsWith('/rpc/get_public_profile_by_username'))return {ok:true,json:async()=>[{freeupper_id:'FU8A3C91D42B67',username:'fu8a3c91d42b67'}]};
  if(String(url).includes('/rpc/get_profile_by_freeupper_id'))return {ok:true,json:async()=>[{freeupper_id:'FU8A3C91D42B67',username:'fu8a3c91d42b67',display_name:'FreeUpper User',is_private:false}]};
  if(String(url).includes('/rpc/get_public_profile_seo_status'))return {ok:true,json:async()=>false};
  throw Error('Unexpected request');
 };
 const headers={};const res={setHeader:(k,v)=>headers[k.toLowerCase()]=v,status(code){this.code=code;return this;},send(body){this.body=body;return this;}};
 try{
 await handler({headers:{'user-agent':'Twitterbot'},query:{username:'old@example.test'}},res);
 assert.equal(res.code,404);assert.equal(calls.length,0);assert.doesNotMatch(res.body,/old@example.test/);
 }finally{globalThis.fetch=originalFetch;if(previousKey===undefined)delete process.env.SUPABASE_ANON_KEY;else process.env.SUPABASE_ANON_KEY=previousKey;}
});
