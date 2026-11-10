// REVIEW ONLY. NOT DEPLOYED.
// Invoke with a private scheduled HTTP job supplying X-Chat-Cleanup-Key.
// Never expose CHAT_CLEANUP_TOKEN in browser code, chat logs or GitHub.
import { createClient } from 'jsr:@supabase/supabase-js@2.110.8';

const DB = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLOUD = Deno.env.get('CLOUDINARY_CLOUD_NAME') ?? '';
const KEY = Deno.env.get('CLOUDINARY_API_KEY') ?? '';
const SECRET = Deno.env.get('CLOUDINARY_API_SECRET') ?? '';
const TOKEN = Deno.env.get('CHAT_CLEANUP_TOKEN') ?? '';
const enabled = () => Deno.env.get('CHAT_PRIVATE_MEDIA_ENABLED') === 'true';

function equalSecrets(a:string,b:string) {
  const x=new TextEncoder().encode(a), y=new TextEncoder().encode(b);
  let mismatch=x.length ^ y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++) mismatch |= (x[i]??0)^(y[i]??0);
  return mismatch===0;
}
async function sha1(s:string) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-1',new TextEncoder().encode(s)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
async function destroy(publicId:string,resourceType:string) {
  // Cloudinary Upload API destroy endpoint. Authenticated delivery type is included
  // in the signed parameters, so this does not delete ordinary public chat media.
  const timestamp=String(Math.floor(Date.now()/1000));
  const fields={invalidate:'true',public_id:publicId,timestamp,type:'authenticated'};
  const canonical=Object.keys(fields).sort().map(k=>`${k}=${fields[k as keyof typeof fields]}`).join('&');
  const params=new URLSearchParams(fields);
  params.set('api_key',KEY);
  params.set('signature',await sha1(canonical+SECRET));
  const result=await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUD)}/${resourceType}/destroy`,
    {method:'POST',body:params,headers:{'Content-Type':'application/x-www-form-urlencoded'},
     signal:AbortSignal.timeout(20000)}
  );
  if(!result.ok) throw new Error(`Cloudinary HTTP ${result.status}`);
  const body=await result.json() as {result?:string};
  if(body.result!=='ok' && body.result!=='not found') throw new Error('Cloudinary destroy not confirmed');
}
Deno.serve(async req=>{
  if(req.method!=='POST') return new Response('Method not allowed',{status:405});
  if(!enabled()) return new Response('Disabled',{status:503});
  if(![DB,SERVICE,CLOUD,KEY,SECRET,TOKEN].every(Boolean) || TOKEN.length<32)
    return new Response('Not configured',{status:503});
  const supplied=req.headers.get('x-chat-cleanup-key')??'';
  if(!equalSecrets(supplied,TOKEN)) return new Response('Unauthorized',{status:401});
  const admin=createClient(DB,SERVICE);
  const {data:rows,error}=await admin.rpc('chat_claim_private_cleanup_batch',{p_limit:25});
  if(error) return new Response('Cleanup queue unavailable',{status:503});
  let completed=0,failed=0;
  for(const a of rows??[]) {
    if(!a || typeof a.asset_id!=='string' || typeof a.public_id!=='string'
        || !['image','video'].includes(a.kind)) {failed++;continue;}
    try {
      await destroy(a.public_id,a.kind);
      const finish=await admin.rpc('chat_finish_private_cleanup',{
        p_asset_id:a.asset_id,p_success:true,p_error:null
      });
      if(finish.error || finish.data!==true) throw new Error('Failed to confirm cleanup');
      completed++;
    } catch (e) {
      failed++;
      await admin.rpc('chat_finish_private_cleanup',{
        p_asset_id:a.asset_id,p_success:false,
        p_error:e instanceof Error?e.message:'Unknown cleanup failure'
      });
    }
  }
  // No identifiers or private media details in the response.
  return new Response(JSON.stringify({processed:(rows??[]).length,completed,failed}),{
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  });
});
