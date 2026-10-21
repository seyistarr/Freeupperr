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

test('historical active follow is never sufficient without approved asset RPC',async()=>{
  let called=0;
  const deniedDb={
    rpc:async name=>{
      called++;
      return name==='protected_first_release_status'
        ? {data:{version:1,delivery:true,legacy_conversion:false},error:null}
        : {data:false,error:null};
    },
    from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:asset,error:null})};return q;}
  };
  assert.equal(await resolveProductionMedia({...args,db:deniedDb}),null);
  assert.equal(called,2);
});
test('no media lookup happens before database release approval',async()=>{
  let queried=false;
  const deniedDb={
    rpc:async()=>({data:{version:1,delivery:false,legacy_conversion:false},error:null}),
    from:()=>{queried=true;throw Error('should not query');}
  };
  assert.equal(await resolveProductionMedia({...args,db:deniedDb}),null);
  assert.equal(queried,false);
});
test('asset lookup errors and missing attachment metadata deny',async()=>{
  for(const value of [null,{...asset,post_id:null},{...asset,owner_id:null},
    {...asset,delivery_type:'upload'},{...asset,status:'pending'}]) {
    const database={
      rpc:async name=>name==='protected_first_release_status'
        ? {data:{version:1,delivery:true,legacy_conversion:false},error:null}
        : {data:true,error:null},
      from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:value,error:null})};return q;}
    };
    assert.equal(await resolveProductionMedia({...args,db:database}),null);
  }
});
