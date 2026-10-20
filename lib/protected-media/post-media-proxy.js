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
    const requestedRange = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = Number(requestedRange[1]);
    const end = requestedRange[2] === '' ? null : Number(requestedRange[2]);
    if (!Number.isSafeInteger(start) ||
        (end !== null && (!Number.isSafeInteger(end) || end < start ||
        end - start + 1 > 50 * 1024 * 1024))) {
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
  if (!/^(image\/|video\/)/i.test(type)) {
    try { await upstream.body.cancel(); } catch {}
    return res.status(503).end();
  }
  // Reject unexpected partial responses and excessive declared payload sizes.
  if (range && upstream.status !== 206) {
    try { await upstream.body.cancel(); } catch {}
    return res.status(503).end();
  }
  const contentLength = upstream.headers.get('content-length');
  const maxBytes = 50 * 1024 * 1024;
  if (contentLength !== null && (!/^[0-9]+$/.test(contentLength) ||
      !Number.isSafeInteger(Number(contentLength)) ||
      Number(contentLength) > maxBytes)) {
    try { await upstream.body.cancel(); } catch {}
    return res.status(413).end();
  }
  // Unsolicited partial responses are not valid for an unrestricted request.
  if (!range && upstream.status === 206) {
    try { await upstream.body.cancel(); } catch {}
    return res.status(503).end();
  }
  if (upstream.status === 206) {
    const contentRange = upstream.headers.get('content-range') || '';
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    const requested = range && /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!requested || !match) {
      try { await upstream.body.cancel(); } catch {}
      return res.status(503).end();
    }
    const [start, end, total, requestedStart] =
      [match[1], match[2], match[3], requested[1]].map(Number);
    const requestedEnd = requested[2] === '' ? null : Number(requested[2]);
    const expectedLength = end - start + 1;
    if (![start, end, total, requestedStart].every(Number.isSafeInteger) ||
        (requestedEnd !== null && !Number.isSafeInteger(requestedEnd)) ||
        start !== requestedStart || end < start || total <= end ||
        (requestedEnd !== null && (requestedEnd < start || end > requestedEnd)) ||
        expectedLength > maxBytes ||
        (contentLength !== null && Number(contentLength) !== expectedLength)) {
      try { await upstream.body.cancel(); } catch {}
      return res.status(503).end();
    }
  }

  res.status(upstream.status);
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('Accept-Ranges', 'bytes');
  for (const h of ['content-range','content-length']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  // Stream with backpressure and abort on client disconnect.
  const { Readable, Transform } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  const limitBytes = 50 * 1024 * 1024;
  let transferred = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      transferred += chunk.length;
      if (transferred > limitBytes) {
        callback(new Error('Protected media stream exceeded limit'));
      } else {
        callback(null, chunk);
      }
    }
  });
  try { await pipeline(Readable.fromWeb(upstream.body), limiter, res); }
  catch {
    try { await upstream.body.cancel(); } catch {}
    if (!res.destroyed) res.destroy();
  }
}
