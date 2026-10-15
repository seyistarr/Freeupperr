import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyProtectedMedia } from '../api/post-media-proxy.js';
function response() {
  return { statusCode:200, headers:{},setHeader(k,v){this.headers[k]=v;},
    status(n){this.statusCode=n;return this;},end(){this.ended=true;return this;} };
}
test('rejects non-Cloudinary upstream',async()=>{
  const res=response();
  await proxyProtectedMedia({req:{headers:{}},res,upstreamUrl:'https://example.com/a',fetchImpl:()=>{throw Error('must not fetch')}});
  assert.equal(res.statusCode,503);
});
test('rejects insecure transport',async()=>{
  const res=response();
  await proxyProtectedMedia({req:{headers:{}},res,upstreamUrl:'http://api.cloudinary.com/a',fetchImpl:()=>{throw Error('must not fetch')}});
  assert.equal(res.statusCode,503);
});
test('rejects invalid byte range before upstream request',async()=>{
  const res=response();
  await proxyProtectedMedia({req:{headers:{range:'bytes=0-1,3-4'}},res,upstreamUrl:'https://api.cloudinary.com/a',fetchImpl:()=>{throw Error('must not fetch')}});
  assert.equal(res.statusCode,416);
});
test('does not follow redirect',async()=>{
  const res=response();
  let redirect;
  await proxyProtectedMedia({req:{headers:{}},res,upstreamUrl:'https://api.cloudinary.com/a',fetchImpl:async(_url,opts)=>{
    redirect=opts.redirect;return {status:302,body:null};
  }});
  assert.equal(redirect,'manual');
  assert.equal(res.statusCode,404);
});
test('rejects unexpected content type',async()=>{
  const res=response();
  let cancelled=false;
  await proxyProtectedMedia({req:{headers:{}},res,upstreamUrl:'https://api.cloudinary.com/a',fetchImpl:async()=>({
    status:200,body:{cancel:async()=>{cancelled=true}},headers:new Headers({'content-type':'text/html'})
  })});
  assert.equal(res.statusCode,503);
  assert.equal(cancelled,true);
});
