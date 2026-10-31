import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
const cacheSource=await readFile(new URL('../profile-cache.js',import.meta.url),'utf8');
const postsSource=await readFile(new URL('../posts.js',import.meta.url),'utf8');
test('offline owner snapshot lease never crosses accounts or survives expiry',()=>{
 const c={};vm.createContext(c);vm.runInContext(cacheSource,c);const now=Date.now(),snapshot={ownerId:'a',authorizedAt:now-1000};
 assert(c.profileSnapshotAllowed(snapshot,{viewer:'a',expiresAt:now+10000},now));
 assert.equal(c.profileSnapshotAllowed(snapshot,{viewer:'b',expiresAt:now+10000},now),false);
 assert.equal(c.profileSnapshotAllowed(snapshot,{viewer:'a',expiresAt:now-1},now),false);
 assert.equal(c.profileSnapshotAllowed({...snapshot,authorizedAt:now-300001},{viewer:'a',expiresAt:now+10000},now),false);
 assert.equal(c.profileSnapshotAllowed(snapshot,{viewer:'a'},now),false);
});
test('primary page requests 24 authorized rows and an exact total; failures never become an empty successful snapshot',async()=>{
 const start=postsSource.indexOf('  async function loadProfilePage('),end=postsSource.indexOf('  // ===================================================================\n  // LOAD SINGLE POST',start);const source=postsSource.slice(start,end);let response={data:Array.from({length:24},(_,id)=>({id})),count:40,error:null};const queries=[];
 const c={POST_SELECT:'id,user_id',normalizeOffset:Number,normalizeLimit:Number,mapPostsWithInteractionState:async rows=>rows,sb:{from(table){const seen={table,filters:[]};queries.push(seen);const q={select(columns,options){seen.count=options.count;return q},eq(k,v){seen.filters.push([k,v]);return q},order(){return q},range(a,b){seen.range=[a,b];return q},then(resolve,reject){return Promise.resolve(response).then(resolve,reject)}};return q;}}};vm.createContext(c);vm.runInContext(source,c);
 const page=await c.loadProfilePage('owner');assert.equal(page.total,40);assert.equal(page.posts.length,24);assert.deepEqual(queries[0].range,[0,23]);assert.equal(queries[0].count,'exact');assert.deepEqual(queries[0].filters,[['user_id','owner'],['is_deleted',false],['is_hidden',false],['publishing_state','published']]);
 await c.loadProfilePage('owner',{offset:24,limit:24});assert.deepEqual(queries[1].range,[24,47]);
 response={data:null,error:Error('offline'),count:null};await assert.rejects(c.loadProfilePage('owner'),/offline/);
 response={data:[],error:null,count:null};await assert.rejects(c.loadProfilePage('owner'),/count unavailable/);
});
