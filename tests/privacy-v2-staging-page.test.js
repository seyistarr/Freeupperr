import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import handler from '../api/privacy-v2-staging-test.js';

const config = {
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'feature/post-privacy-v2-integration',
  SUPABASE_URL: 'https://tagkrhvgcbnybiuyvjxt.supabase.co',
  FREEUPPER_MEDIA_TEST_ENV: 'isolated-freeupper-staging'
};
function render(overrides = {}, method = 'GET') {
  const saved = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, config, overrides);
    const res = { headers: {}, setHeader(k,v){this.headers[k.toLowerCase()]=v;},
      status(n){this.statusCode=n;return this;}, end(){return this;},
      send(body){this.body=body;return this;} };
    handler({method},res);
    return res;
  } finally {
    for (const [key,value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
test('page fails closed outside isolated staging and requested branch', () => {
  for (const overrides of [
    {VERCEL_ENV:'production'}, {VERCEL_ENV:''},
    {VERCEL_GIT_COMMIT_REF:'main'}, {SUPABASE_URL:'https://other.supabase.co'},
    {FREEUPPER_MEDIA_TEST_ENV:''}
  ]) {
    const response = render(overrides);
    assert.equal(response.statusCode,404);
    assert.equal(response.body,undefined);
  }
});
test('staging HTML has no-store, noindex and a matching script CSP hash', () => {
  const res=render();
  assert.equal(res.statusCode,200);
  assert.equal(res.headers['cache-control'],'private, no-store');
  assert.match(res.headers['x-robots-tag'],/noindex/);
  const script=res.body.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash=createHash('sha256').update(script).digest('base64');
  assert.ok(res.headers['content-security-policy'].includes("'sha256-"+hash+"'"));
  assert.match(res.body,/name="robots" content="noindex/);
});
test('staging route rejects non-GET',()=>assert.equal(render({},'POST').statusCode,405));

function browser({authStatus=200,mediaStatus=503,controlled=false,networkError=false}={}) {
  const html=render().body;
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements=new Map();
  const calls=[];
  let complete;
  const finished=new Promise(resolve=>{complete=resolve;});
  function element(id) {
    if (!elements.has(id)) elements.set(id,{
      value:id==='role'?'owner':'',textContent:'',disabled:false,
      listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},
      reset(){element('email').value='';element('password').value='';}
    });
    return elements.get(id);
  }
  let disabled=false;
  Object.defineProperty(element('controls'),'disabled',{
    get(){return disabled;},set(v){disabled=v;if(!v)complete();}
  });
  const secret='synthetic-access-token';
  const context={
    document:{getElementById:element},
    navigator:{serviceWorker:{controller:controlled?{}:null}},
    AbortController, setTimeout, clearTimeout,
    addEventListener(){},
    fetch:async(url,opts)=>{
      calls.push({url,opts});
      if(networkError) throw new Error('sensitive server detail '+secret);
      const status=url.includes('/token?')?authStatus:url.includes('/logout?')?204:mediaStatus;
      return {status,ok:status>=200&&status<300,
        json:async()=>({access_token:secret,refresh_token:'synthetic-refresh-token'}),
        body:{cancel:async()=>{}}};
    },
    console:{log(){throw Error('must not log');}}
  };
  Object.defineProperty(context,'localStorage',{get(){throw Error('storage accessed');}});
  Object.defineProperty(context,'sessionStorage',{get(){throw Error('storage accessed');}});
  vm.runInNewContext(script,context);
  return {element,calls,finished,secret};
}
for(const role of ['owner','follower','stranger']) {
  test(role+' signs in against staging, tests exact asset, then revokes session without displaying secrets',async()=>{
    const b=browser();
    b.element('role').value=role;
    b.element('email').value='test@example.invalid';
    b.element('password').value='synthetic-password';
    b.element('signin').listeners.submit({preventDefault(){}});
    assert.equal(b.element('password').value,'');
    await b.finished;
    assert.equal(b.calls.length,3);
    assert.equal(b.calls[0].url,'https://tagkrhvgcbnybiuyvjxt.supabase.co/auth/v1/token?grant_type=password');
    assert.match(b.calls[0].opts.headers.apikey,/^sb_publishable_/);
    assert.equal(b.calls[1].url,'/api/post-media?asset_id=30000000-0000-4000-8000-000000000003');
    assert.equal(b.calls[1].opts.headers.Authorization,'Bearer '+b.secret);
    assert.match(b.calls[2].url,/logout\?scope=local$/);
    for(const call of b.calls) {
      assert.equal(call.opts.credentials,'omit');
      assert.equal(call.opts.redirect,'error');
      assert.equal(call.opts.cache,'no-store');
    }
    assert.equal(b.element(role+'-auth').textContent,'200');
    assert.equal(b.element(role+'-media').textContent,'503');
    for(const id of [role+'-auth',role+'-media','notice']) {
      assert.doesNotMatch(b.element(id).textContent,/synthetic-|test@example/);
    }
  });
}
test('guest sends no auth, cookies or sign-in request',async()=>{
  const b=browser({mediaStatus:503});
  b.element('guest').listeners.click();
  await b.finished;
  assert.equal(b.calls.length,1);
  assert.equal(b.calls[0].opts.headers.Authorization,undefined);
  assert.equal(b.calls[0].opts.credentials,'omit');
  assert.equal(b.element('guest-media').textContent,'503');
});
test('failed sign-in records status and never sends media request',async()=>{
  const b=browser({authStatus:400});
  b.element('signin').listeners.submit({preventDefault(){}});
  await b.finished;
  assert.equal(b.calls.length,1);
  assert.equal(b.element('owner-auth').textContent,'400');
});
test('service worker control prevents credentials from leaving page',async()=>{
  const b=browser({controlled:true});
  b.element('signin').listeners.submit({preventDefault(){}});
  await b.finished;
  assert.equal(b.calls.length,0);
});
test('network errors do not reveal sensitive error messages',async()=>{
  const b=browser({networkError:true});
  b.element('guest').listeners.click();
  await b.finished;
  assert.doesNotMatch(b.element('notice').textContent,/synthetic-|sensitive server detail/);
});
