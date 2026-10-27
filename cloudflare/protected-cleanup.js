// Maintenance only: no user publishing, media delivery or HTTP trigger.
export async function runProtectedMaintenance(env, upstreamFetch = fetch) {
  if (!/^[a-f0-9]{64}$/.test(env.PRIVACY_CLEANUP_TOKEN || '') || !env.SUPABASE_ANON_KEY) {
    throw new Error('Protected cleanup configuration unavailable');
  }
  for (const action of ['cleanup', 'security-audit']) {
    const response = await upstreamFetch('https://jmjtqidirpmnegzvmiaq.supabase.co/functions/v1/protected-publishing', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(90000),
      headers: { Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY, apikey: env.SUPABASE_ANON_KEY,
        'X-FreeUpper-Action': action, 'X-FreeUpper-Worker-Secret': env.PRIVACY_CLEANUP_TOKEN }
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Protected maintenance failed: ' + response.status); }
    await response.body?.cancel();
  }
}
