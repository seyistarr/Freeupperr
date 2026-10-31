import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const source=await readFile(new URL('../profile-cache.js',import.meta.url),'utf8');
function fixture(){const c={};vm.createContext(c);vm.runInContext(source,c);const cache=c.createProfileCache({limit:3});cache.scope('viewer');return cache;}
test('counts and relationships dedupe per target; optimistic updates invalidate older responses; viewer switches discard requests',async()=>{
 const cache=fixture();let done,calls=0;
 const loader=()=>{calls++;return new Promise(r=>done=r);};const a=cache.loadResource('target','relationship',loader,true),b=cache.loadResource('target','relationship',loader,true);
 await Promise.resolve();assert.equal(calls,1);cache.setResource('target','relationship',{outgoingActive:true});done({outgoingActive:false});assert.equal(await a,null);assert.equal(await b,null);assert.equal(cache.resource('target','relationship').value.outgoingActive,true);
 cache.setResource('target','relationship',{outgoingActive:false,mutating:true});const serverTruth=await cache.loadResource('target','relationship',()=>({outgoingActive:true,iFollowThem:true}),true);assert.equal(serverTruth.iFollowThem,true);assert.equal(cache.resource('target','relationship').value.outgoingActive,false);assert.equal(cache.resource('target','relationship').value.mutating,true);
 cache.setResource('target','counts',{followers:7,following:3});cache.invalidate('target','counts',true);assert.equal(cache.resource('target','counts').value.followers,7);
 let release;const pending=cache.loadResource('target','counts',()=>new Promise(r=>release=r),true);await Promise.resolve();cache.scope('other');release({followers:99});assert.equal(await pending,null);assert.equal(cache.resource('target','counts'),undefined);
 await assert.rejects(cache.loadResource('target','counts',()=>Promise.reject(Error('offline')),true));assert.equal(cache.resource('target','counts'),undefined);
});
test('history snapshots survive visible-row prefetch without exceeding the bounded profile cache',()=>{
 const cache=fixture();const owner=cache.put({id:'source'},true);owner.modalViews=new Map([['entry',{data:{friends:[1]}}]]);
 for(let i=0;i<20;i++)cache.put({id:'row'+i},false);
 assert.equal(cache.get('source'),owner);assert.equal(cache.get('row0'),undefined);assert(cache.get('row19'));
});
test('partial resolver data preserves known identity, while explicit null clears it',()=>{
 const cache=fixture();cache.put({id:'a',avatar_url:'avatar',cover_url:'cover',verified:true},false);cache.put({id:'a',username:'name'},true);
 assert.equal(cache.get('a').profile.cover_url,'cover');assert.equal(cache.get('a').profile.verified,true);cache.put({id:'a',avatar_url:null},true);assert.equal(cache.get('a').profile.avatar_url,null);
});
test('self-edge CHECK preserves historical rows, prevents all future self-writes, and leaves normal relationships intact',async()=>{
 const sql=await readFile(new URL('../supabase/migrations/20261031073211_prevent_self_relationships.sql',import.meta.url),'utf8');const db=new PGlite();
 try{
 await db.exec('create table public.follows (id int primary key,follower_id int not null,following_id int not null,status text);insert into follows values (1,10,10,\'active\'),(2,10,20,\'active\');');
 await db.exec(sql);await db.exec(sql);assert.equal((await db.query('select count(*)::int as n from follows')).rows[0].n,2);
 await assert.rejects(db.exec("insert into follows values (3,30,30,'active')"),e=>e.code==='23514');
 await assert.rejects(db.exec('update follows set following_id=10 where id=2'),e=>e.code==='23514');
 await db.exec("insert into follows values (4,30,40,'pending');update follows set status='active' where id=4;");
 assert.equal((await db.query("select convalidated from pg_constraint where conname='follows_no_self_relationship'")).rows[0].convalidated,false);
 assert.equal((await db.query('select count(*)::int as n from follows where follower_id<>following_id')).rows[0].n,2);
 }finally{await db.close();}
});
