// A separate, in-memory staging session. Never replace the production sb client.
let client;
let configuration;
let loading;
let generation = 0;
export const stagingSession = {
  enabled: false,
  userId: null,
  async configure() {
    if (!loading) loading = (async () => {
      const response = await fetch('/api/privacy-v2-publish', { cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error('Isolated staging is not activated');
      const config = await response.json();
      if (config.enabled !== true || config.supabaseUrl !== 'https://tagkrhvgcbnybiuyvjxt.supabase.co' ||
          typeof config.anonKey !== 'string' || !config.anonKey || !window.supabase) throw new Error('Staging configuration unavailable');
      configuration = config;
      return config;
    })().catch(error => { loading = null; throw error; });
    return loading;
  },
  async signIn(email, password) {
    const config = await this.configure();
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
    if (!this.enabled || !client || !configuration) return null;
    const sessionGeneration = generation, id = this.userId;
    const { data, error } = await client.auth.getSession();
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
    await client?.auth.signOut({ scope: 'local' });
  }
};
window.PrivacyStaging = stagingSession;
window.addEventListener('pagehide', () => { stagingSession.signOut().catch(() => {}); });
