// REVIEW ONLY: disabled until SQL and Cloudinary integration tests pass.
// Supabase Edge Function: view-once-open
// Returns raw bytes on success; application/json on error.
// Uses Cloudinary's documented asset-ID download endpoint; never exposes its URL.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_BASE = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLOUD = Deno.env.get('CLOUDINARY_CLOUD_NAME') ?? '';
const KEY = Deno.env.get('CLOUDINARY_API_KEY') ?? '';
const SECRET = Deno.env.get('CLOUDINARY_API_SECRET') ?? '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGINS = new Set(['https://freeupper.com','https://www.freeupper.com']);
const MAX_BYTES = 10 * 1024 * 1024;
function cors(request: Request): Record<string,string> {
  const origin = request.headers.get('origin') ?? '';
  return {
    ...(ORIGINS.has(origin) ? {'Access-Control-Allow-Origin':origin} : {}),
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',
    'Cache-Control':'private, no-store, max-age=0',
    'Vary':'Origin',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  };
}
function json(req:Request, value:unknown, status=200) {
  return new Response(JSON.stringify(value), {
    status, headers:{...cors(req),'Content-Type':'application/json'}
  });
}
async function signedDownloadUrl(assetId:string) {
  const timestamp=String(Math.floor(Date.now()/1000));
  const fields={asset_id:assetId,timestamp};
  const sigData=`asset_id=${assetId}&timestamp=${timestamp}${SECRET}`;
  const digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(sigData));
  const signature=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  const qs=new URLSearchParams({...fields,api_key:KEY,signature});
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUD)}/asset/download?${qs}`;
}
function errorResponse(req:Request,status:string):Response {
  switch(status) {
    case 'already_viewed':return json(req,{status},409);
    case 'not_found':return json(req,{status},404);
    case 'forbidden':return json(req,{status},403);
    default:return json(req,{error:'Media access unavailable'},503);
  }
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors(req)});
  if(req.method!=='POST') return json(req,{error:'Method not allowed'},405);
  if(Deno.env.get('CHAT_PRIVATE_MEDIA_ENABLED')!=='true')
    return json(req,{error:'Private media not enabled'},503);
  if(![URL_BASE,ANON,SERVICE,CLOUD,KEY,SECRET].every(Boolean))
    return json(req,{error:'Server not configured'},503);
  const origin=req.headers.get('origin');
  if(origin && !ORIGINS.has(origin)) return json(req,{error:'Origin rejected'},403);
  const authorization=req.headers.get('authorization')??'';
  if(!authorization.startsWith('Bearer ')) return json(req,{error:'Unauthorized'},401);
  const userDb=createClient(URL_BASE,ANON,{global:{headers:{Authorization:authorization}}});
  const {data:{user},error:userErr}=await userDb.auth.getUser(authorization.slice(7));
  if(userErr||!user) return json(req,{error:'Unauthorized'},401);
  let data:unknown;
  try {
    if(Number(req.headers.get('content-length')??0)>4096)
      return json(req,{error:'Request too large'},413);
    data=await req.json();
  }catch{return json(req,{error:'Invalid JSON'},400);}
  if(!data||typeof data!=='object') return json(req,{error:'Invalid request'},400);
  const args=data as Record<string,unknown>;
  const id=args.message_id;
  if(typeof id!=='string'||!UUID.test(id)||args.media_index!==0)
    return json(req,{error:'Invalid message or media index'},400);
  const admin=createClient(URL_BASE,SERVICE);
  const {data:checked,error:checkErr}=await admin.rpc('chat_check_private_asset',{
    p_viewer:user.id,p_message_id:id
  });
  if(checkErr||!checked) return json(req,{error:'Authorization unavailable'},503);
  if(checked.status!=='ok') return errorResponse(req,checked.status);
  if(typeof checked.asset_id!=='string'||!['image','video'].includes(checked.resource_type))
    return json(req,{error:'Invalid stored media'},503);
  let upstream:Response;
  try {
    upstream=await fetch(await signedDownloadUrl(checked.asset_id),{
      headers:{'Accept':'application/octet-stream'},
      redirect:'error',signal:AbortSignal.timeout(20000)
    });
  }catch{return json(req,{error:'Private media unavailable'},502);}
  if(!upstream.ok||!upstream.body) {
    try{await upstream.body?.cancel();}catch{}
    return json(req,{error:'Private media unavailable'},502);
  }
  const length=Number(upstream.headers.get('content-length')??0);
  if(length>MAX_BYTES) {
    await upstream.body.cancel();
    return json(req,{error:'Private media size exceeded'},502);
  }
  // Buffer the entire file before consuming the one-time claim. Do not claim for
  // partial transfers, failed Cloudinary responses, or oversized downloads.
  let bytes:Uint8Array;
  try {
    const reader=upstream.body.getReader();
    const chunks:Uint8Array[]=[];
    let count=0;
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      count+=value.byteLength;
      if(count>MAX_BYTES) {await reader.cancel();return json(req,{error:'Private media size exceeded'},502);}
      chunks.push(value);
    }
    bytes=new Uint8Array(count);
    let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  }catch{return json(req,{error:'Private media fetch failed'},502);}
  if(!bytes.byteLength) return json(req,{error:'Private media empty'},502);
  // Reuse FreeUpper's EXISTING atomic claim_view_once RPC with the recipient JWT.
  // It validates sender, participant/group membership, message expiry, media index
  // and the unique (message_id, viewer_id, media_index) consumption key.
  // The service-role connection must NEVER claim on behalf of a user.
  const {data:claim,error:claimErr}=await userDb.rpc('claim_view_once',{
    p_message_id:id,p_media_index:0
  });
  if(claimErr||!claim) return json(req,{error:'View-once claim failed'},403);
  if(claim.status==='already_viewed') return errorResponse(req,'already_viewed');
  if(claim.status!=='opened') return errorResponse(req,'forbidden');
  // Once claimed, never unclaim on network/disconnect error: retry would disclose
  // the asset a second time. The user experience must explain that limitation.
  const mime=['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']
    .includes(checked.mime_type) ? checked.mime_type : 'application/octet-stream';
  return new Response(bytes,{
    status:200,headers:{
      ...cors(req),'Content-Type':mime,
      'Content-Disposition':'inline',
      'Content-Length':String(bytes.byteLength)
    }
  });
});
