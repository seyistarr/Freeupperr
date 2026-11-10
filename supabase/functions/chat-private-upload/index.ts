// REVIEW BRANCH ONLY. NOT DEPLOYED. Requires proposed-private-view-once.sql.
// This function is disabled unless CHAT_PRIVATE_MEDIA_ENABLED=true.
// Upload authenticated private media FIRST. A service-side transaction then
// creates the message and binds Cloudinary's immutable asset_id to it.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLOUD = Deno.env.get('CLOUDINARY_CLOUD_NAME') ?? '';
const API_KEY = Deno.env.get('CLOUDINARY_API_KEY') ?? '';
const API_SECRET = Deno.env.get('CLOUDINARY_API_SECRET') ?? '';
const MAX_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGINS = new Set(['https://www.freeupper.com', 'https://freeupper.com']);
const MIME_TYPES: Record<string,string> = {
  'image/jpeg':'image','image/png':'image','image/webp':'image',
  'video/mp4':'video','video/quicktime':'video','video/webm':'video'
};

function headers(req: Request): HeadersInit {
  const origin = req.headers.get('origin') ?? '';
  return {
    ...(ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
}
function response(req: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...headers(req), 'Content-Type': 'application/json' }
  });
}
async function sha1(s: string) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2,'0')).join('');
}
async function signedParameters(fields: Record<string,string>) {
  const canonical = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('&');
  const params = new URLSearchParams(fields);
  params.set('api_key',API_KEY);
  params.set('signature',await sha1(canonical + API_SECRET));
  return params;
}
async function removeUnregisteredAsset(publicId:string,kind:string):Promise<void> {
  if(!publicId || !['image','video'].includes(kind)) return;
  const timestamp=String(Math.floor(Date.now()/1000));
  const fields={invalidate:'true',public_id:publicId,timestamp,type:'authenticated'};
  const signed=await signedParameters(fields);
  const res=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUD)}/${kind}/destroy`,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:signed,signal:AbortSignal.timeout(12000)
  });
  if(!res.ok) throw new Error('Orphan destroy failed');
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:headers(req)});
  if (req.method !== 'POST') return response(req,{error:'Method not allowed'},405);
  if (Deno.env.get('CHAT_PRIVATE_MEDIA_ENABLED') !== 'true') {
    return response(req,{error:'Private media is not enabled'},503);
  }
  if (![SUPABASE_URL,SUPABASE_KEY,SERVICE_KEY,CLOUD,API_KEY,API_SECRET].every(Boolean)) {
    return response(req,{error:'Server is not configured'},503);
  }
  const origin=req.headers.get('origin');
  if (origin && !ORIGINS.has(origin)) return response(req,{error:'Origin rejected'},403);
  const authorization=req.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return response(req,{error:'Unauthorized'},401);
  const token=authorization.slice(7);
  const userClient=createClient(SUPABASE_URL,SUPABASE_KEY,{global:{headers:{Authorization:authorization}}});
  const { data: identity, error: authError }=await userClient.auth.getUser(token);
  if (authError || !identity.user) return response(req,{error:'Unauthorized'},401);

  // Enforce a transport-level size ceiling, then inspect the actual File.
  const length=Number(req.headers.get('content-length') || 0);
  if (length > MAX_BYTES + 65536) return response(req,{error:'Upload too large'},413);
  let body: FormData;
  try { body=await req.formData(); } catch { return response(req,{error:'Invalid multipart upload'},400); }
  const conversationId=body.get('conversation_id');
  const caption=body.get('caption');
  const file=body.get('file');
  if (typeof conversationId!=='string' || !UUID.test(conversationId) ||
      typeof caption!=='string' || caption.length>2000 || !(file instanceof File)) {
    return response(req,{error:'Missing message or file'},400);
  }
  const resourceType=MIME_TYPES[file.type];
  if (!resourceType || file.size < 1 || file.size > MAX_BYTES) {
    return response(req,{error:'Unsupported media or file size'},400);
  }
  // Use the caller's RLS context to verify an eligible DM before any upload.
  // The transactional publisher validates membership again to prevent TOCTOU.
  const {data:conv,error:convErr}=await userClient.from('conversations')
    .select('id,user1_id,user2_id,is_group,is_note')
    .eq('id',conversationId).maybeSingle();
  if(convErr || !conv || conv.is_group || conv.is_note ||
     ![conv.user1_id,conv.user2_id].includes(identity.user.id)) {
    return response(req,{error:'Conversation is not eligible'},403);
  }

  const timestamp=String(Math.floor(Date.now()/1000));
  const publicId='vo_'+crypto.randomUUID().replaceAll('-','');
  const folder='freeupper-chat-viewonce';
  const fields={folder,public_id:publicId,timestamp,type:'authenticated'};
  const signed=await signedParameters(fields);
  const upload=new FormData();
  for (const [k,v] of signed) upload.append(k,v);
  upload.append('file',file);
  let cloud: Record<string,unknown>;
  try {
    const upstream=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUD)}/${resourceType}/upload`,{
      method:'POST',body:upload,signal:AbortSignal.timeout(30000)
    });
    if (!upstream.ok) return response(req,{error:'Private media upload failed'},502);
    cloud=await upstream.json();
  } catch { return response(req,{error:'Private media upload unavailable'},502); }
  if (typeof cloud.asset_id !== 'string' || typeof cloud.public_id !== 'string' ||
      cloud.type !== 'authenticated' || cloud.resource_type !== resourceType ||
      cloud.bytes !== file.size) {
    if(typeof cloud.public_id==='string' && cloud.type==='authenticated' &&
       cloud.resource_type===resourceType) {
      try { await removeUnregisteredAsset(cloud.public_id,resourceType); } catch (_) {}
    }
    return response(req,{error:'Private upload verification failed'},502);
  }

  const admin=createClient(SUPABASE_URL,SERVICE_KEY);
  const {data:publishedId,error:publishError}=await admin.rpc('chat_publish_private_view_once',{
    p_conversation_id:conversationId,p_sender:identity.user.id,p_caption:caption,
    p_asset_id:cloud.asset_id,p_public_id:cloud.public_id,
    p_kind:resourceType,p_mime:file.type,p_bytes:file.size
  });
  if(publishError || typeof publishedId!=='string') {
    try { await removeUnregisteredAsset(cloud.public_id as string,resourceType); } catch (_) {}
    return response(req,{error:'Private media publication failed'},503);
  }
  return response(req,{status:'published',message_id:publishedId},201);
});
