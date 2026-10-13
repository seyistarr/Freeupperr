import production from './production-public.json' with { type: 'json' };
export { production };
export const productionMarkers = ['jmjtqidirpmnegzvmiaq', 'freeupper-notifications', '37328138260', 'www.freeupper.com', 'freeupper.com', 'freeupper.vercel.app'];
const fields = { apiKey: 'FIREBASE_API_KEY', authDomain: 'FIREBASE_AUTH_DOMAIN', projectId: 'FIREBASE_PROJECT_ID',
    storageBucket: 'FIREBASE_STORAGE_BUCKET', messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID', appId: 'FIREBASE_APP_ID' };
function required(env, key) {
    const value = env[key]?.trim();
    if (!value || /[<>]|YOUR_|PLACEHOLDER/i.test(value)) throw new Error('Missing or placeholder configuration: ' + key);
    if (productionMarkers.some(marker => value.toLowerCase().includes(marker))) throw new Error('Production value forbidden in staging: ' + key);
    return value;
}
function origin(value, key) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw new Error(key + ' must be an HTTPS origin without path or credentials');
    return value;
}
export function configuration(env) {
    // NODE_ENV deliberately has no role here. Never infer production from missing metadata.
    if (env.VERCEL_ENV === 'production') {
        if (env.FREEUPPER_ENV && env.FREEUPPER_ENV !== 'production') throw new Error('Production cannot use staging configuration');
        return { ...structuredClone(production), allowedOrigins: [production.appOrigin, 'https://freeupper.com', 'https://freeupper.vercel.app',
            ...(env.VERCEL_URL ? [origin('https://' + env.VERCEL_URL, 'VERCEL_URL')] : [])] };
    }
    if (!['preview', 'development'].includes(env.VERCEL_ENV)) throw new Error('Set VERCEL_ENV explicitly to preview, development, or production');
    if (env.FREEUPPER_ENV !== 'staging') throw new Error('Preview/development require FREEUPPER_ENV=staging');
    const appOrigin = origin(required(env, 'APP_ORIGIN'), 'APP_ORIGIN');
    const url = origin(required(env, 'SUPABASE_URL'), 'SUPABASE_URL');
    if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) throw new Error('Staging requires its own hosted Supabase project');
    const publicKey = required(env, 'SUPABASE_PUBLISHABLE_KEY');
    if (publicKey === production.supabase.publicKey || publicKey.startsWith('sb_secret_')) throw new Error('Invalid staging public key');
    if (publicKey.startsWith('eyJ')) {
        let claims;
        try { claims = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString()); } catch { throw new Error('Invalid legacy anon key'); }
        if (claims.role !== 'anon' || claims.ref !== new URL(url).hostname.split('.')[0]) throw new Error('Anon key does not belong to staging project');
    } else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)) throw new Error('Use a publishable key or matching legacy anon key');
    const firebase = Object.fromEntries(Object.entries(fields).map(([key, name]) => [key, required(env, name)]));
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebase.projectId) ||
        firebase.authDomain !== firebase.projectId + '.firebaseapp.com' ||
        ![firebase.projectId + '.firebasestorage.app', firebase.projectId + '.appspot.com'].includes(firebase.storageBucket) ||
        !/^\d+$/.test(firebase.messagingSenderId) || !firebase.appId.startsWith('1:' + firebase.messagingSenderId + ':web:')) {
        throw new Error('Inconsistent staging Firebase configuration');
    }
    const vapidKey = required(env, 'FIREBASE_VAPID_KEY');
    if (vapidKey === production.vapidKey || firebase.apiKey === production.firebase.apiKey || !/^[A-Za-z0-9_-]{87}$/.test(vapidKey)) throw new Error('Invalid or production VAPID/Firebase key');
    const allowedOrigins = [appOrigin];
    for (const name of ['VERCEL_URL', 'VERCEL_BRANCH_URL']) if (env[name]) {
        const host = required(env, name);
        if (!host.endsWith('.vercel.app')) throw new Error('Invalid preview hostname');
        allowedOrigins.push(origin('https://' + host, name));
    }
    return { environment: 'staging', appOrigin, allowedOrigins: [...new Set(allowedOrigins)],
        supabase: { url, publicKey }, firebase, vapidKey, uploadsEnabled: false };
}
