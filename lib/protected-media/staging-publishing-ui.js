import { validateProtectedStagingFiles } from './staging-upload-client.js';

let client;
let enabled = false;
export const protectedPublishing = {
  get enabled() { return enabled; },
  async accessToken() {
    if (!enabled || !client) throw new Error('Sign in to isolated staging first');
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error('Staging session expired');
    return data.session.access_token;
  },
  validateFiles(files) {
    validateProtectedStagingFiles(files);
  }
};
window.ProtectedPublishing = protectedPublishing;

async function init() {
  const selector = document.getElementById('postAudience') || document.getElementById('studioAudience');
  if (!selector || !window.supabase) return;
  let config;
  try {
    const res = await fetch('/api/privacy-v2-publish', { cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!res.ok) return;
    config = await res.json();
    if (config.enabled !== true || config.supabaseUrl !== 'https://tagkrhvgcbnybiuyvjxt.supabase.co' || !config.anonKey) return;
  } catch (_) { return; }
  const panel = document.createElement('div');
  panel.innerHTML = '<p>Isolated staging publishing</p><label>Staging email <input name="email" type="email" autocomplete="off" required></label>' +
    '<label>Staging password <input name="password" type="password" autocomplete="off" required></label>' +
    '<button type="button">Sign in to staging</button><p role="status"></p>';
  selector.parentElement.appendChild(panel);
  const signInButton = panel.querySelector('button');
  panel.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); signInButton.click(); }
  });
  signInButton.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    const status = panel.querySelector('[role="status"]');
    const button = panel.querySelector('button');
    button.disabled = true;
    try {
      client ||= window.supabase.createClient(config.supabaseUrl, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
      });
      const { data, error } = await client.auth.signInWithPassword({
        email: panel.querySelector('[name="email"]').value.trim(), password: panel.querySelector('[name="password"]').value
      });
      if (error || !data?.session?.access_token) throw new Error('Staging sign-in failed');
      enabled = true;
      for (const option of selector.options) if (option.value !== 'public') {
        option.disabled = false; option.textContent = option.textContent.replace('coming soon', 'isolated staging');
      }
      status.textContent = 'Staging account ready. Restricted posts stay in isolated staging. Choose an audience before adding files.';
    } catch (_) { status.textContent = 'Staging sign-in unavailable.'; }
    finally { panel.querySelector('[name="password"]').value = ''; button.disabled = false; }
  });
  window.addEventListener('pagehide', () => {
    enabled = false; panel.querySelectorAll('input').forEach(input => { input.value = ''; }); client?.auth.signOut({ scope: 'local' }).catch(() => {});
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
