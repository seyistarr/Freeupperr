const SUPABASE_URL = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
const SITE_URL = 'https://www.freeupper.com';
const PAGE_SIZE = 1000;
const MAX_URLS = 50000;

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) return res.status(503).send('Sitemap unavailable');

  const urls = [];
  try {
    for (let offset = 0; offset < MAX_URLS; offset += PAGE_SIZE) {
      const params = new URLSearchParams({
        select: 'freeupper_id',
        is_private: 'eq.false',
        suspended: 'eq.false',
        profile_setup_completed_at: 'not.is.null',
        order: 'freeupper_id.asc',
        limit: String(PAGE_SIZE),
        offset: String(offset)
      });
      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${params}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`Profile sitemap lookup failed: ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Unexpected profile sitemap response');
      for (const row of rows) {
        const id = row?.freeupper_id;
        if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id)) {
          urls.push(`  <url><loc>${escapeXml(`${SITE_URL}/u/${encodeURIComponent(id)}`)}</loc></url>`);
        }
      }
      if (rows.length < PAGE_SIZE) break;
      if (offset + PAGE_SIZE >= MAX_URLS) throw new Error('Sitemap capacity exceeded; use sitemap pagination');
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.status(200).send(xml);
  } catch (error) {
    console.error('Profile sitemap generation failed:', error);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).send('Sitemap temporarily unavailable');
  }
}
