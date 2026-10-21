import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProductionMedia } from '../lib/protected-media/production-media-resolver.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const asset={id,post_id:'post',owner_id:'owner',status:'ready',delivery_type:'authenticated'};
const context={mode:'production',schema:'public'};
const db=(approval=true,decision=true)=>({
 rpc:async name=>name==='protected_first_release_status'
   ? {data:{version:1,delivery:approval,legacy_conversion:false},error:null}
   : {data:decision,error:null},
 from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:asset,error:null})};return q;}
});
const authClient={auth:{getUser:async()=>({data:{user:{id:'viewer'}},error:null})}};
const args={assetId:id,bearerToken:'token',authClient,db:db(),context};
test('requires authenticated user, approved release and approved asset',async()=>{
 assert.deepEqual(await resolveProductionMedia(args),{asset,viewerId:'viewer'});
 assert.equal(await resolveProductionMedia({...args,db:db(false)}),null);
 assert.equal(await resolveProductionMedia({...args,db:db(true,false)}),null);
 assert.equal(await resolveProductionMedia({...args,context:null}),null);
 assert.equal(await resolveProductionMedia({...args,bearerToken:''}),null);
 assert.equal(await resolveProductionMedia({...args,assetId:'invalid'}),null);
 assert.equal(await resolveProductionMedia({...args,authClient:{auth:{getUser:async()=>({data:null,error:null})}}}),null);
});
test('database failures deny',async()=>{
 assert.equal(await resolveProductionMedia({...args,db:{...db(),from:()=>{throw Error('fail');}}}),null);
});
