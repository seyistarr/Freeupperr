import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeApprovedAsset } from '../lib/protected-media/approved-asset-access.js';

const asset = { id: 'asset-1', post_id: 'post-1', owner_id: 'owner-1',
  status: 'ready', delivery_type: 'authenticated' };
const db = result => ({ rpc: async (name, args) => {
  assert.equal(name, 'authorize_protected_asset');
  assert.deepEqual(args, { p_asset: 'asset-1', p_viewer: 'viewer-1' });
  return result;
}});
test('only exact database approval allows access', async () => {
  assert.equal(await authorizeApprovedAsset({db: db({data:true,error:null}),asset,viewerId:'viewer-1'}),true);
  for (const data of [false,null,1,'true',undefined]) {
    assert.equal(await authorizeApprovedAsset({db: db({data,error:null}),asset,viewerId:'viewer-1'}),false);
  }
});
test('missing, pending, public or detached assets fail closed', async () => {
  for (const changes of [{id:''},{post_id:null},{owner_id:null},{status:'pending'},
    {delivery_type:'upload'},{delivery_type:'private'}]) {
    assert.equal(await authorizeApprovedAsset({db:db({data:true}),asset:{...asset,...changes},viewerId:'viewer-1'}),false);
  }
  assert.equal(await authorizeApprovedAsset({db:db({data:true}),asset,viewerId:null}),false);
});
test('database errors and thrown failures deny access', async () => {
  assert.equal(await authorizeApprovedAsset({db:db({data:true,error:{message:'denied'}}),asset,viewerId:'viewer-1'}),false);
  assert.equal(await authorizeApprovedAsset({db:{rpc:async()=>{throw Error('network');}},asset,viewerId:'viewer-1'}),false);
  assert.equal(await authorizeApprovedAsset({db:null,asset,viewerId:'viewer-1'}),false);
});
