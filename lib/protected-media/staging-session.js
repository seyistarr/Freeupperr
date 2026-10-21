// A separate, in-memory staging session. Never replace the production sb client.
let client;
let configuration;
let loading;
let generation = 0;
function adoptProductionSession(session) {
  const id = session?.user?.id || null;
  if (stagingSession.userId === id && stagingSession.enabled === !!id) return;
  generation++; stagingSession.userId = id; stagingSession.enabled = !!id;
  window.dispatchEvent(new CustomEvent('privacy-staging-session'));
}
export const stagingSession = {
  enabled: false,
  userId: null,
  get cloudName() { return configuration?.cloudName || 'sxdcqs5x'; },
  get mode() { return configuration?.mode || 'staging'; },
  async configure() {
    if (!loading) loading = (async () => {
      const response = await fetch('/api/privacy-v2-publish', { cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error('Isolated staging is not activated');
      const config = await response.json();
      const production = config.mode === 'production';
      if (config.enabled !== true ||
          (production ? (config.supabaseUrl !== 'https://jmjtqidirpmnegzvmiaq.supabase.co' || config.cloudName !== 'duzyf1kda' ||
            !window.sb || window.sb.supabaseUrl !== config.supabaseUrl) : config.supabaseUrl !== 'https://tagkrhvgcbnybiuyvjxt.supabase.co') ||
          typeof config.anonKey !== 'string' || !config.anonKey || !window.supabase) throw new Error('Staging configuration unavailable');
      configuration = config;
      if (production) {
        // Reuse the real account. Never create a second production session or
        // change the production login on navigation/pagehide.
        window.sb.auth.onAuthStateChange((_event, session) => adoptProductionSession(session));
        const run = generation;
        const { data, error } = await window.sb.auth.getSession();
        if (!error && run === generation) adoptProductionSession(data?.session);
      }
      return config;
    })().catch(error => { loading = null; throw error; });
    return loading;
  },
  async signIn(email, password) {
    const config = await this.configure();
    if (config.mode === 'production') throw Error('Use the FreeUpper account sign-in');
    // Clear old media before starting a replacement login, including failed logins.
    const loginGeneration = generation + 1;
    await this.signOut();
    if (loginGeneration !== generation) throw new Error('Staging sign-in superseded');
    if (!client) {
      client = window.supabase.createClient(config.supabaseUrl, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
      });
      client.auth.onAuthStateChange((event, session) => {
        // A pending/cancelled SIGNED_IN event must never reactivate a logged-out UI.
        if (event === 'SIGNED_OUT' && this.enabled) {
          generation++; this.userId = null; this.enabled = false;
          window.dispatchEvent(new CustomEvent('privacy-staging-session'));
        }
      });
    }
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (loginGeneration !== generation || error || !data?.session?.access_token) throw new Error('Staging sign-in unavailable');
    this.enabled = true; this.userId = data.session.user.id;
    window.dispatchEvent(new CustomEvent('privacy-staging-session'));
  },
  async getSession() {
    if (!this.enabled || !configuration) return null;
    const sessionClient = configuration.mode === 'production' ? window.sb : client;
    if (!sessionClient) return null;
    const sessionGeneration = generation, id = this.userId;
    const { data, error } = await sessionClient.auth.getSession();
    if (sessionGeneration !== generation || !this.enabled || id !== this.userId || data?.session?.user?.id !== id || error || !data?.session?.access_token) throw new Error('Staging session expired');
    return data.session;
  },
  async accessToken() {
    const session = await this.getSession();
    if (!session) throw new Error('Sign in to isolated staging first');
    return session.access_token;
  },
  async signOut() {
    generation++;
    this.enabled = false; this.userId = null;
    window.dispatchEvent(new CustomEvent('privacy-staging-session'));
    if (configuration?.mode !== 'production') await client?.auth.signOut({ scope: 'local' });
  }
};
window.PrivacyStaging = stagingSession;
window.addEventListener('pagehide', () => { stagingSession.signOut().catch(() => {}); });
window.addEventListener('pageshow', async () => {
  if (configuration?.mode !== 'production') return;
  const run = generation;
  const { data, error } = await window.sb.auth.getSession();
  if (!error && run === generation) adoptProductionSession(data?.session);
});
