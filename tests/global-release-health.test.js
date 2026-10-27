import test from 'node:test';import assert from 'node:assert/strict';import {releaseHealth} from '../cloudflare/release-health.js';
test('production health reflects database gates without exposing credentials',async()=>{
 const r=await releaseHealth({SUPABASE_ANON_KEY:'public-key'},async(url,init)=>{assert.equal(url,'https://api.freeupper.com/rest/v1/rpc/privacy_release_status');assert.equal(init.redirect,'manual');return Response.json({delivery:true,publishing:true,legacy_conversion:false,scope:'eligible-authenticated-users'});});
 const body=await r.json();assert.equal(body.restrictedAudiencesEnabled,true);assert.equal(body.releaseVerified,true);assert.equal(body.release.legacy_conversion,false);assert.ok(!JSON.stringify(body).includes('public-key'));assert.match(r.headers.get('Cache-Control'),/private, no-store/);
});
test('health never claims activation on absent configuration, network errors, redirects, or malformed capabilities',async()=>{
 for(const fetcher of [async()=>{throw Error();},async()=>new Response(null,{status:302}),async()=>Response.json({delivery:true,publishing:true,legacy_conversion:true})]){const b=await (await releaseHealth({SUPABASE_ANON_KEY:'key'},fetcher)).json();assert.equal(b.releaseVerified,false);assert.equal(b.restrictedAudiencesEnabled,false);}
 const b=await (await releaseHealth({},()=>{throw Error('must not fetch');})).json();assert.equal(b.releaseVerified,false);
});
