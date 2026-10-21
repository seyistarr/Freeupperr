import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/post-media.js';

function response() {
  const headers = {};
  return {headers,statusCode:200,body:null,
    setHeader(k,v){headers[k.toLowerCase()]=v;return this;},
    status(n){this.statusCode=n;return this;},
    json(v){this.body=v;return this;}
  };
}
async function request(method,headers={}) {
  const res=response();
  await handler({method,headers,query:{asset_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}},res);
  return res;
}
test('POST is denied with no-store headers',async()=>{
  const r=await request('POST');
  assert.equal(r.statusCode,405);
  assert.equal(r.headers.allow,'GET');
  assert.equal(r.headers['cache-control'],'private, no-store');
});
test('GET is disabled unless deployment is explicitly approved',async()=>{
  const r=await request('GET');
  assert.equal(r.statusCode,503);
  assert.equal(r.headers['x-robots-tag'],'noindex, nofollow');
  assert.equal(r.headers.vary,'Authorization');
});
test('missing bearer token cannot expose media',async()=>{
  const r=await request('GET');
  assert.notEqual(r.statusCode,200);
});
