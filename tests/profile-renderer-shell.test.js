import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {chromium} from '@playwright/test';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const time=await readFile(new URL('../js/freeupper-time.js',import.meta.url),'utf8');
const main=html.slice(html.indexOf('        (function()',html.indexOf('<!-- Main application')),html.indexOf('</script>',html.indexOf('<!-- Main application')));
test('complete index shell boots without loading a feed and renders authorized cached posts', {timeout:30000},async()=>{
 const bootstrap=`window.feedCalls=0;window.AuthUser={getCurrentUser:()=>({id:'guest',isLoggedIn:false}),onChange(){}};window.updateNavAvatar=()=>{};window.fuT=s=>s;window.getAuthorFromProfile=p=>({id:p.id,name:p.display_name,avatar:''});window.PostsAPI={loadFeedWithReposts:async()=>{feedCalls++;return [];},incrementView:async()=>({success:true,counted:false})};`;
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url.startsWith('/index.html')?html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',`<script>${time}</script><script>${bootstrap}</script><script type="module">${main}</script></body>`):'<script>window.boots=0;window.addEventListener("message",e=>{if(e.data?.type==="fu-profile-detail-boot")boots++;});</script><iframe style="width:390px;height:844px" src="/index.html?from=profile-overlay&profileShell=1"></iframe>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'&&m.text().includes('Profile detail'))errors.push(m.text());});await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin+'/profile.html');
 await page.waitForFunction(()=>window.boots===1 && document.querySelector('iframe').contentWindow.ProfilePostRenderer);
 const frame=page.frameLocator('iframe');
 for(const id of ['A','B']){
 const opened=await frame.locator('body').evaluate((_,id)=>window.ProfilePostRenderer.open({id,user_id:'author',title:'Cached '+id,content:'Already authorized',profile:{id:'author',display_name:'Author'},media:[],commentsHidden:true,likes:7},'guest'),id);
 await page.waitForTimeout(10);assert.equal(opened,true,JSON.stringify(errors));assert.equal(await frame.locator('.single-post-container').getAttribute('data-post-id'),id);assert.equal(await frame.locator('.single-post-container [data-post-reactions]').getAttribute('data-post-reactions'),id);
 }
 await frame.locator('body').evaluate(()=>window.reloadData());
 assert.equal(await frame.locator('body').evaluate(()=>window.getAllPosts().length),2);
 assert.equal(await frame.locator('body').evaluate(()=>feedCalls),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
