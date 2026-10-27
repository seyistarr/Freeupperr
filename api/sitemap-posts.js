const API = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
const SITE = 'https://freeupper.com';
const LIMIT = 1000;
const MAX = 50000;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) return res.status(503).send('Sitemap unavailable');
  try {
    let after = '';
    const urls = [];
    for (let offset = 0; offset < MAX; offset += LIMIT) {
      const response = await fetch(API + '/rest/v1/rpc/list_public_post_sitemap', {
        method: 'POST',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_after: after, p_limit: LIMIT }),
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error('Public post listing failed: ' + response.status);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid sitemap data');
      for (const row of rows) {
        if (!/^[A-Za-z0-9_-]{6,16}$/.test(row.short_code || '')) continue;
        const path = row.media_type === 'video' ? 'v' : 'p';
        const lastmod = row.created_at && !Number.isNaN(Date.parse(row.created_at)) ? new Date(row.created_at).toISOString().slice(0, 10) : null;
        urls.push('  <url><loc>' + esc(SITE + '/' + path + '/' + row.short_code) + '</loc>' + (lastmod ? '<lastmod>' + lastmod + '</lastmod>' : '') + '</url>');
      }
      if (rows.length < LIMIT) break;
      after = rows[rows.length - 1]?.short_code;
      if (!after || offset + LIMIT >= MAX) throw new Error('Sitemap pagination limit reached');
    }
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(req.method === 'HEAD' ? '' : xml);
  } catch (error) {
    console.error('Public post sitemap failed', error);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).send('Sitemap temporarily unavailable');
  }
}
