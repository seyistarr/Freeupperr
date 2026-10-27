import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

// Browser fixtures exercise real decoding, poster generation, DOM rendering and
// session invalidation. They are not live Supabase/Cloudinary acceptance tests.
const chromium = process.env.FREEUPPER_CHROMIUM;
test('browser decodes private images/videos/posters and rejects cross-session delivery', { skip: !chromium, timeout: 45000 }, async () => {
  const png = await readFile('icon-192.png');
  const video = await readFile('tests/fixtures/protected-video.mp4');
  const client = await readFile('protected-media-client.js');
  const publisher = await readFile('privacy-v2-composer.js');
  const owner = '9341af03-e007-4fc6-9c23-b06073379088';
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const calls = [], uploads = [];
  let reportResolve;
  const reported = new Promise(resolve => { reportResolve = resolve; });
  const html = `<!doctype html><html><body>
    <div id="photo" data-protected-asset="${id}" data-protected-kind="image"></div>
    <div id="video" data-protected-asset="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" data-protected-kind="video" data-protected-poster="${id}"></div>
    <script>
      let session = {access_token:'owner-fixture'};
      let authCallback;
      window.sb = {auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{authCallback=fn;}},
        rpc:async()=>({data:{approved:true,ready:true,mode:'verification'}})};
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (url,init) => nativeFetch(url.startsWith('https://api.cloudinary.com/') ? '/fixture-upload' :
        url.startsWith('https://api.freeupper.com/') ? '/fixture-publish' : url, init);
    </script>
    <script src="/protected-media-client.js"></script><script src="/privacy-v2-composer.js"></script>
    <script>
    (async()=>{
      const checks=[];
      const check=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
      const until=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out');};
      await until(()=>document.querySelector('#photo img')?.naturalWidth>0);
      await until(()=>document.querySelector('#video video')?.readyState>=2);
      check(document.querySelector('#photo img').src.startsWith('blob:'),'private image decodes');
      const vid=document.querySelector('#video video');
      check(vid.videoWidth===64 && vid.poster.startsWith('blob:'),'private video and authenticated poster decode');
      const file = new File([await (await nativeFetch('/fixture-video')).blob()],'test.mp4',{type:'video/mp4'});
      const result=await window.FreeUpperProtectedPublish.publish({audience:'only_me',source:'studio',title:'test',content:'',tags:[],media:[{type:'video',protectedFile:file}]});
      check(result.status==='published','Studio pipeline publishes video and generated poster');
      const oldSrc=document.querySelector('#photo img').src;
      session=null;authCallback('SIGNED_OUT');
      check(!document.querySelector('#photo img'),'sign out removes rendered bytes synchronously');
      let denied=false;try{await window.FreeUpperProtectedMedia.asset('${id}','image');}catch(e){denied=true;}
      check(denied,'anonymous playback is denied');
      session={access_token:'stranger-fixture'};authCallback('SIGNED_IN');
      await until(()=>document.querySelector('#photo').dataset.protectedState==='failed');
      check(!document.querySelector('#photo img'),'stranger cannot reuse owner blob');
      session={access_token:'owner-fixture'};authCallback('SIGNED_IN');
      await until(()=>document.querySelector('#photo img')?.naturalWidth>0);
      check(document.querySelector('#photo img').src!==oldSrc,'new session reauthorizes and obtains a new blob');
      await nativeFetch('/report',{method:'POST',body:JSON.stringify({ok:true,checks})});
    })().catch(async error=>{await nativeFetch('/report',{method:'POST',body:JSON.stringify({ok:false,error:error.message,stack:error.stack})});});
    </script></body></html>`;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const send = (status, type, body) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'private, no-store' }); response.end(body); };
    if (url.pathname === '/') return send(200, 'text/html', html);
    if (url.pathname === '/protected-media-client.js') return send(200, 'text/javascript', client);
    if (url.pathname === '/privacy-v2-composer.js') return send(200, 'text/javascript', publisher);
    if (url.pathname === '/fixture-video') return send(200, 'video/mp4', video);
    if (url.pathname === '/api/post-media') {
      calls.push(request.headers.authorization);
      if (request.headers.authorization !== 'Bearer owner-fixture') return send(404, 'application/json', '{}');
      return url.searchParams.get('asset_id') === id ? send(200, 'image/png', png) : send(200, 'video/mp4', video);
    }
    let body = Buffer.alloc(0);
    for await (const chunk of request) body = Buffer.concat([body, chunk]);
    if (url.pathname === '/report') { reportResolve(JSON.parse(body)); return send(200, 'application/json', '{}'); }
    if (url.pathname === '/fixture-publish') {
      const data = JSON.parse(body); calls.push(data.action);
      if (data.action === 'create') return data.verification === true ? send(201, 'application/json', JSON.stringify({id,status:'draft',verification:true})) : send(400,'application/json','{}');
      if (data.action === 'sign') return send(200, 'application/json', JSON.stringify({cloud_name:'duzyf1kda',api_key:'fixture',type:'authenticated',overwrite:false,
        timestamp:1234567890,folder:'freeupper-protected-v2/'+owner,public_id:'asset_'+String(data.slot).padStart(32,'0'),signature:'fixture'}));
      if (data.action === 'register') return send(201, 'application/json', JSON.stringify({status:'ready',asset_id:id}));
      if (data.action === 'publish') return send(200, 'application/json', JSON.stringify({status:'published',id}));
    }
    if (url.pathname === '/fixture-upload') {
      const text = body.toString('latin1');
      const value = key => new RegExp('name="'+key+'"\\r\\n\\r\\n([^\\r]+)').exec(text)?.[1];
      uploads.push({ type:value('type'), publicId:value('public_id') });
      const resource = uploads.length === 1 ? 'video' : 'image';
      return send(200,'application/json',JSON.stringify({asset_id:'0'.repeat(32),public_id:value('folder')+'/'+value('public_id'),type:'authenticated',resource_type:resource}));
    }
    send(404, 'text/plain', 'Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const temp = await mkdtemp(tmpdir() + '/freeupper-chromium-');
  const child = spawn(chromium, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--user-data-dir=' + temp, 'http://127.0.0.1:' + server.address().port], { stdio: 'ignore' });
  let timeout;
  try {
    const result = await Promise.race([reported, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Browser acceptance timed out')), 35000); })]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.checks.length, 7);
    assert.deepEqual(uploads.map(x => x.type), ['authenticated', 'authenticated']);
    assert.deepEqual(calls.filter(x => ['create','sign','register','publish'].includes(x)), ['create','sign','register','sign','register','publish']);
  } finally {
    clearTimeout(timeout); child.kill('SIGTERM'); await once(child, 'exit').catch(() => {});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    // Chromium helpers may finish profile writes just after the parent exits.
    // Retry transient ENOTEMPTY/EBUSY failures; persistent cleanup errors still fail.
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
