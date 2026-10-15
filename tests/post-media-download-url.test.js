import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpiringDownloadUrl } from '../api/post-media-download-url.js';
const asset={status:'ready',delivery_type:'authenticated',resource_type:'image',cloudinary_public_id:'freeupper/posts/example',format:'jpg'};
function sdk() {
  return {private_download_url(publicId,format,opts) {
    const q=new URLSearchParams({public_id:publicId,format,expires_at:String(opts.expires_at),signature:'synthetic'});
    return 'https://api.cloudinary.com/v1_1/test-cloud/'+opts.resource_type+'/download?'+q;
  }};
}
test('generates 60-second expiring SDK request',()=>{
  const url=createExpiringDownloadUrl({asset,cloudinaryUtils:sdk(),nowSeconds:1000});
  assert.equal(new URL(url).searchParams.get('expires_at'),'1060');
});
test('rejects public delivery',()=>assert.throws(()=>createExpiringDownloadUrl({asset:{...asset,delivery_type:'upload'},cloudinaryUtils:sdk()})));
test('rejects missing format',()=>assert.throws(()=>createExpiringDownloadUrl({asset:{...asset,format:null},cloudinaryUtils:sdk()})));
test('rejects invalid ttl',()=>assert.throws(()=>createExpiringDownloadUrl({asset,cloudinaryUtils:sdk(),ttlSeconds:3600})));
test('rejects unexpected SDK host',()=>assert.throws(()=>createExpiringDownloadUrl({asset,cloudinaryUtils:{private_download_url:()=> 'https://evil.example/v1_1/x/image/download?expires_at=1060&signature=foo'},nowSeconds:1000})));
test('rejects SDK URL without signature',()=>assert.throws(()=>createExpiringDownloadUrl({asset,cloudinaryUtils:{private_download_url:()=> 'https://api.cloudinary.com/v1_1/x/image/download?expires_at=1060'},nowSeconds:1000})));
