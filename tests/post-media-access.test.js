import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeProtectedMedia } from '../api/post-media-access.js';
function mockDb({post,author,follow=null,reverse=null,errorTable=null}) {
  return { from(table) {
    const values={posts:post,profiles:author,follows:null};
    const filters=[];
    const query={
      select(){return query;},
      eq(key,value){filters.push([key,value]);return query;},
      async maybeSingle(){
        if(table===errorTable)return {data:null,error:{message:'denied'}};
        if(table==='follows') {
          const f=Object.fromEntries(filters);
          return {data:f.follower_id==='viewer'?follow:reverse,error:null};
        }
        return {data:values[table],error:null};
      }
    };
    return query;
  }};
}
const asset={post_id:'post',owner_id:'author',status:'ready',delivery_type:'authenticated'};
const post={id:'post',user_id:'author',visibility:'followers',is_deleted:false,is_hidden:false};
const author={id:'author',is_private:false,suspended:false};
const check=(options={})=>authorizeProtectedMedia({db:mockDb({post:{...post,...options.post},author:{...author,...options.author},follow:options.follow??null,reverse:options.reverse??null,errorTable:options.errorTable}),asset:{...asset,...options.asset},viewerId:options.viewerId??'viewer'});
test('approved follower allowed',async()=>assert.equal(await check({follow:{follower_id:'viewer'}}),true));
test('pending or absent follower denied',async()=>assert.equal(await check(),false));
test('private author public post approved follower allowed',async()=>assert.equal(await check({post:{visibility:'public'},author:{is_private:true},follow:{follower_id:'viewer'}}),true));
test('friends one-way denied',async()=>assert.equal(await check({post:{visibility:'friends'},follow:{follower_id:'viewer'}}),false));
test('friends mutual allowed',async()=>assert.equal(await check({post:{visibility:'friends'},follow:{follower_id:'viewer'},reverse:{follower_id:'author'}}),true));
test('mismatched asset owner denied',async()=>assert.equal(await check({asset:{owner_id:'other'},follow:{follower_id:'viewer'}}),false));
test('database lookup error denied',async()=>assert.equal(await check({errorTable:'posts'}),false));
test('hidden post denied',async()=>assert.equal(await check({post:{is_hidden:true},follow:{follower_id:'viewer'}}),false));
test('null deletion status denied',async()=>assert.equal(await check({post:{is_deleted:null},follow:{follower_id:'viewer'}}),false));
test('public Cloudinary delivery rejected',async()=>assert.equal(await check({asset:{delivery_type:'upload'},follow:{follower_id:'viewer'}}),false));
