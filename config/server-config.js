import { configuration } from './public-config.mjs';
export const serverConfig = configuration(process.env);
// Preserve the existing production API key source. Preview never reads that legacy variable.
export const apiPublicKey = serverConfig.environment === 'production' ? process.env.SUPABASE_ANON_KEY : serverConfig.supabase.publicKey;
