const BASE = 'https://www.freeupper.com';
const SB = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY;
const escape = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact = (v,n=180) => String(v||'').replace(/\s+/g,' ').trim().slice(0,n);
const headers = () => ({apikey:KEY,Authorization:'Bearer '+KEY});
async function rpc(name,body) {
  const r=await fetch(SB+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) throw new Error('RPC '+name+' '+r.status);
  return r.json();
}
async function getRows(table,query) {
  const r=await fetch(SB+'/rest/v1/'+table+'?'+query,{headers:headers()});
  if(!r.ok) throw new Error('REST '+table+' '+r.status);
  return r.json();
}
function imageFrom(post) {
  const item=Array.isArray(post.media)?post.media.find(x=>x?.type==='image'&&x.url):null;
  const raw=post.media_type==='video' ? post.thumbnail_url : (post.thumbnail_url||item?.url||post.media_url);
  const valid = v => {try {const u=new URL(v);return u.protocol==='https:'&&u.hostname==='res.cloudinary.com'?u.href:null;}catch{return null;}};
  if(valid(raw)) return valid(raw);
  if(post.media_type==='video' && valid(post.media_url)) {
    const u=new URL(post.media_url);
    const m=u.pathname.match(/^\/([^/]+)\/video\/upload\/(?:.*\/)?(v\d+\/)?([^/]+)\.[^.\/]+$/);
    if(m) return u.origin+'/'+m[1]+'/video/upload/so_1,f_jpg/'+(m[2]||'')+m[3]+'.jpg';
  }
  return BASE+'/freeupper.png';
}
export default async function handler(req,res) {
  const code=String(req.query?.code||'');
  if(!/^[A-Za-z0-9_-]{6,16}$/.test(code)){res.setHeader('X-Robots-Tag','noindex');return res.status(404).send('Post unavailable');}
  if(!KEY) return res.status(503).send('Unavailable');
  try {
    const id=await rpc('resolve_public_post_short_link',{p_code:code});
    if(!id){res.setHeader('X-Robots-Tag','noindex');return res.status(404).send('Post unavailable');}
    const rows=await getRows('posts',new URLSearchParams({select:'id,user_id,title,description,content,media_type,media_url,thumbnail_url,media',id:'eq.'+id,visibility:'eq.public',is_deleted:'eq.false',is_hidden:'eq.false',limit:'1'}));
    const post=rows[0];
    if(!post){res.setHeader('X-Robots-Tag','noindex');return res.status(404).send('Post unavailable');}
    const profiles=await getRows('profiles',new URLSearchParams({select:'username,display_name',id:'eq.'+post.user_id,limit:'1'})).catch(()=>[]);
    const author=compact(profiles[0]?.display_name||profiles[0]?.username||'FreeUpper creator',80);
    const title=compact(post.title||post.content||post.description||'Post on FreeUpper',100);
    const desc=compact(post.description||post.content||('A post by '+author+' on FreeUpper.'),200);
    const img=imageFrom(post);
    const canonical=BASE+'/p/'+code;
    const destination=BASE+'/index.html?post='+encodeURIComponent(id);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','public, s-maxage=60, stale-while-revalidate=120');
    res.setHeader('X-Content-Type-Options','nosniff');
    return res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · FreeUpper</title><link rel="canonical" href="${escape(canonical)}"><meta name="description" content="${escape(desc)}"><meta property="og:type" content="article"><meta property="og:site_name" content="FreeUpper"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(desc)}"><meta property="og:url" content="${escape(canonical)}"><meta property="og:image" content="${escape(img)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(desc)}"><meta name="twitter:image" content="${escape(img)}"><meta http-equiv="refresh" content="0;url=${escape(destination)}"><style>body{background:#090909;color:white;font:16px system-ui;display:grid;place-items:center;min-height:90vh}a{color:#a78bfa}</style></head><body><main>Opening post on FreeUpper… <a href="${escape(destination)}">Open post</a></main><script>location.replace(${JSON.stringify(destination).replace(/</g,'\\u003c')})</script></body></html>`);
  } catch(err) {
    console.error('Post preview unavailable:',err);
    res.setHeader('Cache-Control','no-store');
    return res.status(503).send('Post preview temporarily unavailable');
  }
}