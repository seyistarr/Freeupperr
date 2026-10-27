import test from 'node:test';
import assert from 'node:assert/strict';
import {runProtectedMaintenance} from '../cloudflare/protected-cleanup.js';
test('scheduled maintenance has a fixed backend and no user-controlled parameters',async()=>{
 const calls=[];await runProtectedMaintenance({PRIVACY_CLEANUP_TOKEN:'ab'.repeat(32),SUPABASE_ANON_KEY:'public-anon'},async(url,init)=>{calls.push({url,init});return Response.json({});});
 assert.equal(calls.length,2);
 assert.deepEqual(calls.map(c=>c.init.headers['X-FreeUpper-Action']),['cleanup','security-audit']);
 for(const c of calls){assert.equal(c.url,'https://jmjtqidirpmnegzvmiaq.supabase.co/functions/v1/protected-publishing');assert.equal(c.init.redirect,'manual');assert.equal(c.init.headers.Authorization,'Bearer public-anon');}
});
test('maintenance fails closed on missing config, redirect, denial and upstream failure',async()=>{
 let calls=0;await assert.rejects(runProtectedMaintenance({},async()=>{calls++;}),/configuration/);assert.equal(calls,0);
 for(const status of [302,401,403,503])await assert.rejects(runProtectedMaintenance({PRIVACY_CLEANUP_TOKEN:'ab'.repeat(32),SUPABASE_ANON_KEY:'anon'},async()=>new Response(null,{status})),/failed/);
});
