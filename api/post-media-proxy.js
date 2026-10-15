// Protected Cloudinary proxy transport. Caller must authenticate and authorize
// each request and supply an expiring, authenticated Cloudinary URL.
// This module NEVER creates a URL from an untrusted public_id.
export async function proxyProtectedMedia({ req, res, upstreamUrl, fetchImpl = fetch }) {
  let url;
  try { url = new URL(upstreamUrl); } catch { return res.status(503).end(); }
  // No redirects, alternate ports, credentials or non-Cloudinary hosts.
  if (url.protocol !== 'https:' || url.hostname !== 'api.cloudinary.com' ||
      url.port || url.username || url.password) return res.status(503).end();
  const headers = {};
  const range = req.headers?.range;
  if (range !== undefined) {
    if (typeof range !== 'string' || !/^bytes=\d+-\d*$/.test(range)) {
      res.setHeader('Content-Range', 'bytes */*');
      return res.status(416).end();
    }
    headers.Range = range;
  }
  let upstream;
  try {
    upstream = await fetchImpl(url.toString(), {
      method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(15000)
    });
  } catch { return res.status(503).end(); }
  if (![200, 206].includes(upstream.status) || !upstream.body) {
    try { await upstream.body?.cancel(); } catch {}
    return res.status(404).end();
  }
  const type = upstream.headers.get('content-type') || '';
  if (!/^(image\/|video\/|audio\/|application\/octet-stream)/i.test(type)) {
    try { await upstream.body.cancel(); } catch {}
    return res.status(503).end();
  }
  // Reject unexpected partial responses and excessive declared payload sizes.
  if (range && upstream.status !== 206) {
    try { await upstream.body.cancel(); } catch {}
    return res.status(503).end();
  }
  const contentLength = upstream.headers.get('content-length');
  if (contentLength !== null && (!/^\\d+$/.test(contentLength) ||
      Number(contentLength) > 50 * 1024 * 1024)) {
    try { await upstream.body.cancel(); } catch {}
    return res.status(413).end();
  }
  res.status(upstream.status);
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('Accept-Ranges', 'bytes');
  for (const h of ['content-range','content-length']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  // Stream with backpressure and abort on client disconnect.
  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  try { await pipeline(Readable.fromWeb(upstream.body), res); }
  catch { if (!res.destroyed) res.destroy(); }
}
