import React from 'react';
import { ImageResponse } from '@vercel/og';
const SITE = 'https://freeupper.com';
const API = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY;
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = (s, max = 180) => String(s || '').replace(/\s+/g,' ').trim().slice(0,max);
function safeImage(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'res.cloudinary.com' || u.hostname === 'jmjtqidirpmnegzvmiaq.supabase.co') ? u.href : null;
  } catch { return null; }
}
function cloudinaryVideoPoster(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com') return null;
    // Strip delivery transformations before the version; use a still image
    // from the existing video asset, without storing or modifying anything.
    const match = u.pathname.match(/^\/(.+?)\/video\/upload\/(?:.*\/)?(v\d+\/[^?#]+)$/);
    if (!match) return null;
    const asset = match[2].replace(/\.[^/.]+$/, '.jpg');
    return u.origin + '/' + match[1] + '/video/upload/so_1,w_800,h_800,c_fill/' + asset;
  } catch { return null; }
}
export default async function handler(req, res) {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (req.query.image === 'video') {
    if (!/^[A-Za-z0-9_-]{6,16}$/.test(code)) return res.status(404).end();
    return renderVideoImage(req, res, code);
  }
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
  // /v/ and /p/ describe the page where the link was shared, not media type.
  if (!post) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Robots-Tag','noindex, nofollow');
    return res.status(404).send('Post unavailable');
  }
  const requestHost = String(req.headers.host || '').toLowerCase().split(':')[0];
  const origin = requestHost.endsWith('.vercel.app') ? 'https://' + requestHost : SITE;
  const url = origin + '/' + (type === 'video' ? 'v' : 'p') + '/' + encodeURIComponent(code);
  const destination = origin + '/' + (type === 'video' ? 'video.html' : 'index.html') + '?post=' + encodeURIComponent(post.id);
  const title = clean(post.title || post.content || post.description || 'FreeUpper post', 100);
  // Text posts already show their content in the preview image and title.
  // Avoid repeating the same words in the social card description.
  const rawDescription = clean(post.description || post.content || '', 180);
  const titleText = clean(post.title || post.content || post.description || '', 180);
  const description = rawDescription && rawDescription !== titleText &&
    !titleText.startsWith(rawDescription) && !rawDescription.startsWith(titleText)
    ? rawDescription
    : 'Discover this post on FreeUpper.';
  const img = post.media_type === 'video' ? origin + '/api/post-preview?image=video&code=' + encodeURIComponent(code) : (post.media_type === 'text' || (!post.media_url && !post.thumbnail_url)) ? origin + '/api/post-text-og?code=' + encodeURIComponent(code) + (type === 'video' ? '&style=video' : '') : (safeImage(post.thumbnail_url) || safeImage(post.media_url) || SITE + '/freeupper.png');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} • FreeUpper</title><link rel="canonical" href="${esc(url)}">
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="FreeUpper">
<meta property="og:title" content="${esc(title)} • FreeUpper">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">
<link rel="manifest" href="/manifest.webmanifest">\n<meta name="theme-color" content="#2e1065">\n<meta name="robots" content="index,follow">
</head><body><main><article><h1>${esc(title)}</h1><p>${esc(clean(post.content || post.description || post.title || '', 3000))}</p><a href="${esc(destination)}">View post on FreeUpper</a></article></main>
<script>location.replace(${JSON.stringify(destination)})</script></body></html>`;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  return res.status(200).send(html);
}

// Image mode shares this serverless function with the HTML preview route.
async function renderVideoImage(req, res, code) {
  const API = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
  const KEY = process.env.SUPABASE_ANON_KEY;
  const allowed = new Set(['res.cloudinary.com', 'jmjtqidirpmnegzvmiaq.supabase.co']);
  if (!KEY) return res.status(503).end();
  try {
    const response = await fetch(API + '/rest/v1/rpc/get_public_post_by_short_code', {
      method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return res.status(503).end();
    const rows = await response.json();
    const post = Array.isArray(rows) ? rows[0] : rows;
    if (!post || post.media_type !== 'video') return res.status(404).end();
    let poster = post.thumbnail_url;
    if (!poster && post.media_url) {
      const u = new URL(post.media_url);
      if (u.hostname === 'res.cloudinary.com') {
        const match = u.pathname.match(/^\/(.+?)\/video\/upload\/(?:.*\/)?(v\d+\/[^?#]+)$/);
        if (match) poster = u.origin + '/' + match[1] + '/video/upload/so_1,w_800,h_800,c_fill/' + match[2].replace(/\.[^/.]+$/, '.jpg');
      }
    }
    if (!poster) return res.status(404).end();
    const u = new URL(poster);
    if (u.protocol !== 'https:' || !allowed.has(u.hostname)) return res.status(404).end();
    const imgResponse = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (!imgResponse.ok) return res.status(502).end();
    const imageBytes = await imgResponse.arrayBuffer();
    if (imageBytes.byteLength > 8 * 1024 * 1024) return res.status(413).end();
    const mime = imgResponse.headers.get('content-type')?.split(';')[0];
    if (!['image/jpeg','image/png','image/webp'].includes(mime)) return res.status(415).end();
    const data = 'data:' + mime + ';base64,' + Buffer.from(imageBytes).toString('base64');
    const h = React.createElement;
    const layout = h('div', { style: { display: 'flex', width: '100%', height: '100%', position: 'relative', alignItems: 'center', justifyContent: 'center', backgroundColor: '#101016' } },
      h('img', { src: data, style: { position: 'absolute', width: '100%', height: '100%', objectFit: 'cover' } }),
      h('div', { style: { display: 'flex', width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)', border: '4px solid white' } },
        h('svg', { width: 54, height: 54, viewBox: '0 0 54 54' }, h('path', { d: 'M16 8 L45 27 L16 46 Z', fill: '#ffffff' })))
    );
    const png = Buffer.from(await new ImageResponse(layout, { width: 800, height: 800 }).arrayBuffer());
    res.setHeader('Content-Type','image/png');
    res.setHeader('Cache-Control','public, max-age=300, s-maxage=3600');
    return res.status(200).end(png);
  } catch (error) {
    console.error('Video preview image failed', error);
    return res.status(503).end();
  }
}
