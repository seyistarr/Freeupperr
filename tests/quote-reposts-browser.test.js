import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
const html=await readFile(new URL('../create.html',import.meta.url),'utf8');
const composer=html.slice(html.indexOf('// Quote composer: publication requires'),html.indexOf('</script>',html.indexOf('// Quote composer: publication requires')));
const submit=html.slice(html.indexOf('        async function submitPost()'),html.indexOf('        // 25. SUBMIT ITEM'));
const original='00000000-0000-4000-8000-000000000100';
const authored='00000000-0000-4000-8000-000000000200';
test('quote composer gates, quote-only payload, duplicate guard, errors and authored URL', {timeout:60000}, async t=>{
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');
  res.end(req.url.startsWith('/create.html')?html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*https:[^>]*>/gi,''):'fixture');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 async function open({approved=false,unavailable=false}={}){
  await page.goto(origin+'/create.html?quote='+original+'&keep=1');
  await page.evaluate(({approved,unavailable,original,authored})=>{
   window.state={postMedia:[],postEmbeddings:[]};window.calls=[];window.toasts=[];
   window.fuT=s=>s;window.showToast=s=>toasts.push(s);window.syncAudienceLabel=()=>{};
   window.requireAuth=()=>({id:'actor',isLoggedIn:true});window.extractHashtags=()=>[];window.mergeHashtagLists=()=>[];window.resolveMediaThumbnail=()=>'';window.renderPostImageGrid=()=>{};
   window.CONFIG={LIMITS:{maxTitleLength:100}};
   window.PostsAPI={loadQuotablePost:async()=>unavailable?null:({id:original,visibility:'public',title:'Original <unsafe>',profile:{display_name:'Author'},media:[]}),canPublishQuote:async()=>approved,
    createPost:payload=>{calls.push(payload);return new Promise((resolve,reject)=>{window.resolvePublish=()=>resolve({id:authored});window.rejectPublish=()=>reject(Error('This post cannot be quoted'));});}};
  },{approved,unavailable,original,authored});
  await page.addScriptTag({content:submit});await page.addScriptTag({content:composer});
  await page.waitForFunction(()=>document.getElementById('composerQuoteStatus').textContent!=='Loading quoted post…');
 }
 await t.test('disabled release and unavailable target cannot publish via direct submit',async()=>{
  await open();assert(await page.locator('#postSubmitBtn').isDisabled());assert((await page.locator('#composerQuotePreview').innerText()).includes('Original <unsafe>'));
  await page.evaluate(()=>submitPost());assert.equal(await page.evaluate(()=>calls.length),0);
  await open({approved:true,unavailable:true});assert(await page.locator('#postSubmitBtn').isDisabled());await page.evaluate(()=>submitPost());assert.equal(await page.evaluate(()=>calls.length),0);
 });
 await t.test('simulated approved backend permits quote-only, prevents duplicates and opens B',async()=>{
  await open({approved:true});await page.waitForFunction(()=>!document.getElementById('postSubmitBtn').disabled);
  await page.evaluate(()=>{submitPost();submitPost();submitPost();});await page.waitForFunction(()=>calls.length===1);
  const payload=await page.evaluate(()=>calls[0]);assert.equal(payload.quotedPostId,original);assert.match(payload.quotePostId,/^[0-9a-f-]{36}$/);assert.equal(payload.content,'');assert.equal(payload.media.length,0);
  await page.evaluate(()=>resolvePublish());await page.waitForURL('**/index.html?post='+authored);
 });
 await t.test('errors are visible, retry keeps ID, and quote audience stays Public',async()=>{
  await open({approved:true});await page.locator('#postContent').fill('My comment');
  await page.evaluate(()=>{state.postMedia=[{url:'https://example.com/photo.jpg',type:'image'}];submitPost();});await page.waitForFunction(()=>calls.length===1);
  const requestId=await page.evaluate(()=>calls[0].quotePostId);await page.evaluate(()=>rejectPublish());await page.waitForFunction(()=>!state.quoteSubmitting);
  assert((await page.evaluate(()=>toasts)).includes('This post cannot be quoted'));
  await page.evaluate(()=>{submitPost();});await page.waitForFunction(()=>calls.length===2);assert.equal(await page.evaluate(()=>calls[1].quotePostId),requestId);assert.equal(await page.evaluate(()=>calls[1].content),'My comment');assert.equal(await page.evaluate(()=>calls[1].media[0].type),'image');
  await page.evaluate(()=>rejectPublish());await page.waitForFunction(()=>!state.quoteSubmitting);
  await page.evaluate(()=>{document.getElementById('postAudience').value='followers';submitPost();});await page.waitForFunction(()=>!state.quoteSubmitting);assert.equal(await page.evaluate(()=>calls.length),2);assert((await page.evaluate(()=>toasts)).includes('Quote posts must be Public'));
 });
 await t.test('removal preserves text and other parameters; normal publishing still works',async()=>{
  await open();await page.locator('#postContent').fill('Normal text');await page.evaluate(()=>removeComposerQuote());assert(page.url().includes('keep=1'));assert(!page.url().includes('quote='));assert.equal(await page.locator('#postContent').inputValue(),'Normal text');
  await page.evaluate(()=>{submitPost();});await page.waitForFunction(()=>calls.length===1);assert(!('quotedPostId' in await page.evaluate(()=>calls[0])));await page.evaluate(()=>resolvePublish());await page.waitForURL('**/index.html?refresh=*');
 });
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
