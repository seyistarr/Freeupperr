import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../cloudflare/api/worker.js';
test('quote RPCs traverse the unchanged gateway with the caller JWT and no shared caching',async()=>{
 const env={SUPABASE_URL:'https://jmjtqidirpmnegzvmiaq.supabase.co',SUPABASE_ANON_KEY:'public-test-key'};
 for(const name of ['quote_repost_status','get_quotable_post','load_quote_references','create_quote_post']){
  const request=new Request('https://api.freeupper.com/rest/v1/rpc/'+name,{method:'POST',headers:{Origin:'https://freeupper.com',Authorization:'Bearer user-fixture','Content-Type':'application/json'},body:'{}'});
  const result=await handle(request,env,async(url,options)=>{assert.equal(new URL(url).hostname,'jmjtqidirpmnegzvmiaq.supabase.co');assert.equal(options.headers.get('Authorization'),'Bearer user-fixture');assert.equal(options.headers.get('apikey'),'public-test-key');return Response.json({ok:true});});
  assert.equal(result.status,200);assert.match(result.headers.get('Cache-Control'),/private, no-store/);assert.match(result.headers.get('Vary'),/Authorization/);
 }
});
