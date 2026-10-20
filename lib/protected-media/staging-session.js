// A separate, in-memory staging session. Never replace the production sb client.
let client;
let configuration;
let loading;
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
    if (!client) {
      client = window.supabase.createClient(config.supabaseUrl, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
      });
      client.auth.onAuthStateChange((event, session) => {
        const id = session?.user?.id || null;
        if (id !== this.userId || event === 'SIGNED_OUT') {
          this.userId = id; this.enabled = !!id;
          window.dispatchEvent(new CustomEvent('privacy-staging-session'));
        }
      });
    }
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data?.session?.access_token) throw new Error('Staging sign-in unavailable');
    this.enabled = true; this.userId = data.session.user.id;
  },
  async getSession() {
    if (!this.enabled || !client || !configuration) return null;
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error('Staging session expired');
    return data.session;
  },
  async accessToken() {
    const session = await this.getSession();
    if (!session) throw new Error('Sign in to isolated staging first');
    return session.access_token;
  },
  async signOut() {
    this.enabled = false; this.userId = null;
    window.dispatchEvent(new CustomEvent('privacy-staging-session'));
    await client?.auth.signOut({ scope: 'local' });
  }
};
window.PrivacyStaging = stagingSession;
window.addEventListener('pagehide', () => { stagingSession.signOut().catch(() => {}); });
