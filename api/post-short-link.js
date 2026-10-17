const API = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!UUID.test(id)) return res.status(400).json({error:'Invalid post ID'});
  if (!KEY) return res.status(503).json({error:'Unavailable'});
  try {
    const result = await fetch(API + '/rest/v1/rpc/get_public_short_code_for_post', {
      method:'POST',
      headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},
      body:JSON.stringify({p_post_id:id}),
      signal:AbortSignal.timeout(5000)
    });
    if (!result.ok) return res.status(503).json({error:'Lookup unavailable'});
    const data = await result.json();
    const code = Array.isArray(data) ? data[0]?.short_code : data?.short_code;
    if (!/^[A-Za-z0-9_-]{6,16}$/.test(code || '')) return res.status(404).json({error:'Not found'});
    return res.status(200).json({short_code:code});
  } catch {
    return res.status(503).json({error:'Lookup unavailable'});
  }
}
