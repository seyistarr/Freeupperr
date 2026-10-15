import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCloudinarySdk } from '../api/post-media-cloudinary.js';
const config={cloudName:'example-cloud',apiKey:'test-key',apiSecret:'test-secret'};
test('rejects missing configuration before importing SDK',async()=>{
  let imported=false;
  await assert.rejects(loadCloudinarySdk({},async()=>{imported=true;}));
  assert.equal(imported,false);
});
test('rejects SDK without private download support',async()=>{
  await assert.rejects(loadCloudinarySdk(config,async()=>({v2:{config(){},utils:{}}})));
});
test('configures SDK and returns download utilities',async()=>{
  let configured;
  const utils={private_download_url(){return 'synthetic';}};
  const result=await loadCloudinarySdk(config,async()=>({v2:{
    config(opts){configured=opts;},utils
  }}));
  assert.equal(result,utils);
  assert.equal(configured.cloud_name,'example-cloud');
  assert.equal(configured.secure,true);
});
