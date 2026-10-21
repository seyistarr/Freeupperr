import React from 'react';
import { ImageResponse } from '@vercel/og';

const API = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY;
const allowed = new Set(['res.cloudinary.com', 'jmjtqidirpmnegzvmiaq.supabase.co']);
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(code)) return res.status(404).end();
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
        if (match) poster = u.origin + '/' + match[1] + '/video/upload/so_1,w_1200,h_630,c_fill/' + match[2].replace(/\.[^/.]+$/, '.jpg');
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
    const png = Buffer.from(await new ImageResponse(layout, { width: 1200, height: 630 }).arrayBuffer());
    res.setHeader('Content-Type','image/png');
    res.setHeader('Cache-Control','public, max-age=300, s-maxage=3600');
    return res.status(200).end(png);
  } catch (error) {
    console.error('Video preview image failed', error);
    return res.status(503).end();
  }
}
