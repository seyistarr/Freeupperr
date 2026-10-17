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
  if (!post || (post.media_type !== 'text' && (post.media_url || post.thumbnail_url))) return res.status(404).end();

  // Each video.html text post stores its selected studio template in text_template_id.
  // Use the same IDs and primary palette as video-render.js; do not apply one
  // notebook background to every /v/ link.
  const rawMessage = String(post.content || post.title || 'A post on FreeUpper').trim();
  const message = rawMessage.length > 195 ? rawMessage.slice(0, 192).trimEnd() + '…' : rawMessage;
  const previewMessage = message.replace(/\r/g, '').replace(/[\t ]+/g, ' ').trim();
  const h = React.createElement;
  const videoStyle = req.query.style === 'video';
  const templates = {
    neon:     ['#0d0020', '#e879f9', 'radial-gradient(ellipse at center, #492070, #0d0020)'],
    sunset:   ['#ff6b6b', '#ffffff', 'linear-gradient(135deg, #ff6b6b, #ffa500, #ff2d55)'],
    gold:     ['#0a0600', '#ffd700', 'radial-gradient(ellipse at center, #503900, #0a0600)'],
    aura:     ['#050510', '#ffffff', 'radial-gradient(ellipse at center, #535370, #050510)'],
    notebook: ['#fdf8f0', '#1e293b', 'repeating-linear-gradient(to bottom, #fdf8f0 0px, #fdf8f0 37px, #d4dff2 38px, #fdf8f0 40px)'],
    sticky:   ['#ffe566', '#374151', '#ffe566'],
    darkq:    ['#111118', '#f5f5f5', '#111118'],
    cleanq:   ['#ffffff', '#111111', '#ffffff'],
    aurora:   ['#020c18', '#ffffff', 'linear-gradient(145deg, #020c18, #12624d, #352060)'],
    ocean:    ['#0072ff', '#ffffff', 'linear-gradient(135deg, #0072ff, #00c6ff)'],
    midnight: ['#06061a', '#c4b5fd', '#06061a'],
    galaxy:   ['#03001e', '#c4b5fd', 'radial-gradient(ellipse at center, #3c235e, #03001e)'],
    pastel:   ['#fce4ec', '#4c1d6b', 'linear-gradient(135deg, #fce4ec, #e1bee7, #b3e5fc)'],
    cotton:   ['#fbc2eb', '#5c1a6e', 'linear-gradient(135deg, #fbc2eb, #a6c1ee, #ffecd2)'],
    whitemin: ['#ffffff', '#111111', '#ffffff'],
    blackmin: ['#111111', '#f5f5f5', '#111111'],
    confetti: ['#ffe0f6', '#1a0a2e', 'linear-gradient(135deg, #ffe0f6, #fff0e0)'],
    rainbow:  ['#ff6b6b', '#ffffff', 'linear-gradient(135deg, #ff6b6b, #ffa500, #ffe600, #2dce89, #25f4ee, #a259ff)']
  };
  const templateId = String(post.text_template_id || '').toLowerCase();
  const theme = templates[templateId] || templates.neon;
  const lines = previewMessage.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const fontSize = lines.length >= 7 ? 35 : previewMessage.length > 165 ? 37 : previewMessage.length > 110 ? 43 : previewMessage.length > 70 ? 49 : 57;
  const textCard = h('div', {
    style: {
      display: 'flex', width: '100%', height: '100%', position: 'relative',
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      padding: '58px 95px', boxSizing: 'border-box',
      backgroundColor: theme[0], backgroundImage: theme[2],
      fontFamily: 'sans-serif'
    }
  },
    templateId === 'notebook' ? h('div', { style: {
      display: 'flex', position: 'absolute', left: 48, top: 0, bottom: 0,
      width: 2, backgroundColor: '#efa7a7'
    } }) : null,
    h('div', { style: {
      display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', fontSize, lineHeight: 1.24, fontWeight: 800,
      color: theme[1], flexDirection: 'column'
    } }, ...lines.slice(0, 10).map(line => h('div', { style: { display: 'flex', justifyContent: 'center', width: '100%', textAlign: 'center' } }, line)))
  );
  const layout = videoStyle ? textCard : h('div', {
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
    let png;
    try {
      const rendered = new ImageResponse(layout, { width: 1200, height: 630 });
      png = Buffer.from(await rendered.arrayBuffer());
    } catch (primaryError) {
      // Never leave WhatsApp with a title-only card because a particular
      // template or long multiline caption cannot be rendered by Satori.
      console.error('Template OG render failed; using safe fallback', templateId, primaryError);
      const fallback = h('div', { style: { display: 'flex', width: '100%', height: '100%', backgroundColor: theme[0], color: theme[1], alignItems: 'center', justifyContent: 'center', padding: 65, fontSize: 40, fontWeight: 700, textAlign: 'center', fontFamily: 'sans-serif' } }, previewMessage.replace(/\s+/g, ' ').slice(0, 160));
      png = Buffer.from(await new ImageResponse(fallback, { width: 1200, height: 630 }).arrayBuffer());
    }
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).end(png);
  } catch (error) {
    console.error('Text OG image render failed', error);
    return res.status(503).end();
  }
}
