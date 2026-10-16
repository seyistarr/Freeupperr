const SITE = 'https://www.freeupper.com';
const API = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY;
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = (s, max = 180) => String(s || '').replace(/\s+/g,' ').trim().slice(0,max);
function safeImage(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'res.cloudinary.com' || u.hostname.endsWith('.supabase.co')) ? u.href : null;
  } catch { return null; }
}
export default async function handler(req, res) {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const type = req.query.type === 'video' ? 'video' : 'post';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(code)) return res.status(404).send('Not found');
  if (!KEY) return res.status(503).send('Temporarily unavailable');
  let post;
  try {
    const response = await fetch(API + '/rest/v1/rpc/get_public_post_by_short_code', {
      method:'POST',
      headers:{'Content-Type':'application/json',apikey:KEY,Authorization:'Bearer '+KEY},
      body:JSON.stringify({p_code:code})
    });
    if (!response.ok) throw new Error('Public post lookup failed: ' + response.status);
    const data = await response.json();
    post = Array.isArray(data) ? data[0] : data;
  } catch (error) {
    console.error('Post preview lookup failed', error);
    res.setHeader('Cache-Control','no-store');
    return res.status(503).send('Temporarily unavailable');
  }
  if (!post || (type === 'video') !== (post.media_type === 'video')) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Robots-Tag','noindex, nofollow');
    return res.status(404).send('Post unavailable');
  }
  const url = SITE + '/' + (type === 'video' ? 'v' : 'p') + '/' + encodeURIComponent(code);
  const destination = SITE + '/' + (type === 'video' ? 'video.html' : 'index.html') + '?post=' + encodeURIComponent(post.id);
  const title = clean(post.title || post.content || post.description || 'FreeUpper post', 100);
  const description = clean(post.description || post.content || 'Discover this post on FreeUpper.');
  const img = safeImage(post.media_type === 'video' ? post.thumbnail_url : (post.thumbnail_url || post.media_url)) || SITE + '/freeupper.png';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} • FreeUpper</title><link rel="canonical" href="${esc(url)}">
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="FreeUpper">
<meta property="og:title" content="${esc(title)} • FreeUpper">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0;url=${esc(destination)}">
</head><body><p>Opening this FreeUpper post… <a href="${esc(destination)}">Continue</a></p>
<script>location.replace(${JSON.stringify(destination)})</script></body></html>`;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','public, max-age=60, s-maxage=60');
  return res.status(200).send(html);
}
