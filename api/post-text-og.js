import React from 'react';
import { ImageResponse } from '@vercel/og';

const API = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY;
const CODE = /^[A-Za-z0-9_-]{6,16}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET') return res.status(405).end();
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!CODE.test(code)) return res.status(404).end();
  if (!KEY) return res.status(503).end();

  let post;
  try {
    const response = await fetch(API + '/rest/v1/rpc/get_public_post_by_short_code', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return res.status(503).end();
    const rows = await response.json();
    post = Array.isArray(rows) ? rows[0] : rows;
  } catch {
    return res.status(503).end();
  }
  if (!post || post.media_type !== 'text') return res.status(404).end();

  const message = String(post.content || post.title || 'A post on FreeUpper').trim().slice(0, 220);
  const h = React.createElement;
  const layout = h('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', padding: '70px', color: 'white',
      background: 'linear-gradient(130deg, #111827, #312e81)',
      fontFamily: 'sans-serif'
    }
  },
    h('div', { style: { display: 'flex', fontSize: 30, fontWeight: 700, color: '#c7d2fe' } }, 'FreeUpper'),
    h('div', { style: { display: 'flex', fontSize: message.length > 120 ? 42 : 56, fontWeight: 700, lineHeight: 1.25, overflow: 'hidden' } }, message),
    h('div', { style: { display: 'flex', fontSize: 23, color: '#cbd5e1' } }, 'Discover more on FreeUpper')
  );

  try {
    const rendered = new ImageResponse(layout, { width: 1200, height: 630 });
    const png = Buffer.from(await rendered.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).end(png);
  } catch (error) {
    console.error('Text OG image render failed', error);
    return res.status(503).end();
  }
}
