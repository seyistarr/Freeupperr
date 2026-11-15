// Frontend denial propagation only; this is not a live RLS audit.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const script=await readFile('gallery-api.js','utf8');
for(const scenario of [
 {name:'owner sees own private profile',viewer:'owner',private:true,expected:1},
 {name:'visitor sees public eligible videos',viewer:'visitor',expected:1},
 {name:'anonymous sees public eligible videos',viewer:null,expected:1},
 {name:'unapproved visitor cannot see private profile',viewer:'visitor',private:true,expected:0},
 {name:'approved viewer sees private eligible videos',viewer:'visitor',private:true,approved:true,expected:1},
 {name:'anonymous cannot see private profile',viewer:null,private:true,expected:0},
 {name:'blocked backend-empty result remains empty without fallback',viewer:'blocked',denied:true,expected:0},
 {name:'blocked backend error remains an error',viewer:'blocked',error:true},
])test(scenario.name,async()=>{
 let reads=0;
 const window={AuthUser:{getCurrentUser:()=>({id:scenario.viewer,isLoggedIn:!!scenario.viewer})},sb:{rpc:async(name)=>({data:name==='get_profile_identity_by_id'?[{freeupper_id:'FU1'}]:name==='get_profile_by_freeupper_id'?[{id:'owner',is_private:!!scenario.private}]:!!scenario.approved})},PostsAPI:{loadProfilePage:async()=>{reads++;if(scenario.error)throw Error('Forbidden');return {posts:scenario.denied?[]:[{id:'canonical-post',user_id:'owner',mediaType:'video'}],total:scenario.denied?0:1}}}};
 vm.runInNewContext(script,{window,addEventListener(){}});
 if(scenario.error)await assert.rejects(window.GalleryAPI.items('owner','posts'),/Forbidden/);
 else assert.equal((await window.GalleryAPI.items('owner','posts')).length,scenario.expected);
 if(scenario.private&&!scenario.approved&&scenario.viewer!=='owner')assert.equal(reads,0);
 if(scenario.viewer!=='owner')assert.equal((await window.GalleryAPI.profile('owner','star')).length,0);
});
