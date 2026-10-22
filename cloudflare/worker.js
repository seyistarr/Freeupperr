// Migration staging entry point. Does not proxy private APIs or change production.
const dynamicPaths = [
  /^\\/api\\//,
  /^\\/v\\//,
  /^\\/p\\//,
  /^\\/u\\//,
  /^\\/@/,
  /^\\/sitemap-profiles\\.xml$/
];
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/__migration/health') {
      return Response.json({ ok: true, environment: 'cloudflare-staging', dynamicRoutesReady: false },
        { headers: { 'Cache-Control': 'no-store' } });
    }
    if (dynamicPaths.some((pattern) => pattern.test(url.pathname))) {
      return Response.json({ error: 'Dynamic route not migrated' }, {
        status: 503, headers: { 'Cache-Control': 'no-store' }
      });
    }
    return env.ASSETS.fetch(request);
  }
};
