// The public handlers use only this subset of Vercel's request/response API.
// Protected streaming handlers are intentionally excluded from this adapter.
export async function invoke(handler, request, query) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  let status = 200;
  let body = null;
  const res = {
    get statusCode() { return status; },
    set statusCode(value) { status = value; },
    setHeader(name, value) { headers.set(name, value); return this; },
    status(value) { status = value; return this; },
    send(value) { body = value; if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/plain; charset=utf-8'); return this; },
    end(value) { body = value ?? null; return this; },
    json(value) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(value); return this; },
    redirect(code, destination) { status = code; headers.set('Location', destination); return this; }
  };
  const url = new URL(request.url);
  await handler({ method: request.method === 'HEAD' ? 'GET' : request.method, url: url.pathname + url.search,
    query, headers: { ...Object.fromEntries(request.headers), host: url.host } }, res);
  // No shared cache for crawler/person variants or user-related metadata.
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Vary', 'User-Agent');
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}
