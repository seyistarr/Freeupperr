export function senderEnvironment(env, account) {
    const production = { environment: 'production', appOrigin: 'https://www.freeupper.com', firebaseProjectId: 'freeupper-notifications' };
    const mode = env.get('APP_ENV');
    if (!mode || mode === 'production') {
        // Unset APP_ENV is compatible only with the verified existing production project.
        if (env.get('SUPABASE_URL') !== 'https://jmjtqidirpmnegzvmiaq.supabase.co') throw new Error('Non-production sender requires APP_ENV=staging');
        if ((env.get('APP_ORIGIN') && env.get('APP_ORIGIN') !== production.appOrigin) ||
            (env.get('FIREBASE_PROJECT_ID') && env.get('FIREBASE_PROJECT_ID') !== production.firebaseProjectId)) throw new Error('Production configuration mismatch');
        return production;
    }
    if (mode !== 'staging') throw new Error('Unknown APP_ENV');
    const appOrigin = env.get('APP_ORIGIN');
    const firebaseProjectId = env.get('FIREBASE_PROJECT_ID');
    const supabaseUrl = env.get('SUPABASE_URL');
    for (const value of [appOrigin, firebaseProjectId, supabaseUrl]) {
        if (!value || /jmjtqidirpmnegzvmiaq|freeupper-notifications|freeupper\.com|freeupper\.vercel\.app/i.test(value)) throw new Error('Missing or production staging configuration');
    }
    const url = new URL(appOrigin);
    if (url.protocol !== 'https:' || url.origin !== appOrigin || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(supabaseUrl)) throw new Error('Invalid staging origin/project URL');
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebaseProjectId) || account.project_id !== firebaseProjectId) throw new Error('Staging service account/project mismatch');
    if (!env.get('STAGING_WEBHOOK_SECRET') || env.get('STAGING_WEBHOOK_SECRET').length < 32) throw new Error('Staging webhook secret must be configured');
    return { environment: 'staging', appOrigin, firebaseProjectId };
}

export async function stagingRequestAllowed(request, env, config) {
    if (config.environment !== 'staging') return true;
    const expected = env.get('STAGING_WEBHOOK_SECRET');
    const supplied = request.headers?.get('x-freeupper-staging-secret') || '';
    if (!expected || supplied.length !== expected.length) return false;
    const encoder = new TextEncoder();
    const [left, right] = await Promise.all([expected, supplied].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
    const a = new Uint8Array(left), b = new Uint8Array(right);
    let difference = 0;
    for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
    return difference === 0;
}

export function isolatePayload(payload, config) {
    if (config.environment !== 'staging') return payload;
    const result = { ...payload };
    const destination = new URL(result.destination_url || '/index.html', config.appOrigin);
    if (destination.origin !== config.appOrigin) throw new Error('Cross-origin staging notification destination');
    result.destination_url = destination.href;
    // Staging has no media store; never load avatars/thumbnails from copied or injected production URLs.
    for (const key of Object.keys(result)) if (/(?:url|image|icon|avatar)$/.test(key) && key !== 'destination_url' && result[key]) {
        try { const url = new URL(result[key], config.appOrigin); result[key] = url.origin === config.appOrigin ? url.href : ''; }
        catch { result[key] = ''; }
    }
    return result;
}
