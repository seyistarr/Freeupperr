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

test('rejects ignored range requests',async()=>{
  const res=response();
  let cancelled=false;
  await proxyProtectedMedia({req:{headers:{range:'bytes=0-1023'}},res,
    upstreamUrl:'https://api.cloudinary.com/a',fetchImpl:async()=>({
      status:200,body:{cancel:async()=>{cancelled=true}},
      headers:new Headers({'content-type':'video/mp4'})
    })});
  assert.equal(res.statusCode,503);
  assert.equal(cancelled,true);
});
test('rejects oversized declared upstream payloads',async()=>{
  const res=response();
  let cancelled=false;
  await proxyProtectedMedia({req:{headers:{}},res,
    upstreamUrl:'https://api.cloudinary.com/a',fetchImpl:async()=>({
      status:200,body:{cancel:async()=>{cancelled=true}},
      headers:new Headers({'content-type':'video/mp4','content-length':String(51*1024*1024)})
    })});
  assert.equal(res.statusCode,413);
  assert.equal(cancelled,true);
});

test('accepts numeric declared length and streams small media',async()=>{
  const { Writable } = await import('node:stream');
  const { ReadableStream } = await import('node:stream/web');
  const chunks=[];
  const res=new Writable({write(chunk,_enc,cb){chunks.push(chunk);cb();}});
  res.headers={};
  res.statusCode=200;
  res.setHeader=(k,v)=>{res.headers[k]=v;};
  res.status=(n)=>{res.statusCode=n;return res;};
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3]));controller.close();}});
  await proxyProtectedMedia({req:{headers:{}},res,upstreamUrl:'https://api.cloudinary.com/a',
    fetchImpl:async()=>({status:200,body,headers:new Headers({'content-type':'image/png','content-length':'3'})})});
  assert.equal(res.statusCode,200);
  assert.equal(Buffer.concat(chunks).length,3);
});
test('rejects invalid declared content length',async()=>{
  const res=response();
  let cancelled=false;
  await proxyProtectedMedia({req:{headers:{}},res,upstreamUrl:'https://api.cloudinary.com/a',
    fetchImpl:async()=>({status:200,body:{cancel:async()=>{cancelled=true}},headers:new Headers({'content-type':'image/png','content-length':'invalid'})})});
  assert.equal(res.statusCode,413);
  assert.equal(cancelled,true);
});

test('aborts streams exceeding 50 MiB even without Content-Length',async()=>{
  const { Writable } = await import('node:stream');
  const { ReadableStream } = await import('node:stream/web');
  const res=new Writable({write(_chunk,_enc,cb){cb();}});
  res.setHeader=()=>{};
  res.status=function(n){this.statusCode=n;return this;};
  let cancelled=false;
  const chunk=new Uint8Array(1024*1024);
  let sent=0;
  const body=new ReadableStream({
    pull(controller) {
      if(sent++ < 51) controller.enqueue(chunk);
      else controller.close();
    },
    cancel(){cancelled=true;}
  });
  await proxyProtectedMedia({req:{headers:{}},res,upstreamUrl:'https://api.cloudinary.com/a',
    fetchImpl:async()=>({status:200,body,headers:new Headers({'content-type':'video/mp4'})})});
  assert.equal(res.destroyed,true);
  assert.ok(cancelled || sent>=51);
});
