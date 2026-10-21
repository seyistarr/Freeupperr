import { mountLegacyConsent } from './legacy-consent-ui.js';
import { stagingSession } from './staging-session.js';
import { validateProtectedStagingFiles } from './staging-upload-client.js';

export const protectedPublishing = {
  get enabled() { return stagingSession.enabled; },
  async accessToken() {
    return stagingSession.accessToken();
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
    config = await stagingSession.configure();
  } catch (_) { return; }
  const panel = document.createElement('div');
  panel.dataset.stagingAuth = '';
  panel.innerHTML = '<p>Isolated staging publishing</p><label>Staging email <input name="email" type="email" autocomplete="off" required></label>' +
    '<label>Staging password <input name="password" type="password" autocomplete="off" required></label>' +
    '<button type="button">Sign in to staging</button><p role="status"></p>';
  selector.parentElement.appendChild(panel);
  const signOutButton = document.createElement('button');
  signOutButton.type = 'button'; signOutButton.textContent = 'Sign out of staging';
  panel.appendChild(signOutButton);
  signOutButton.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation(); await stagingSession.signOut();
  });
  window.addEventListener('privacy-staging-session', () => {
    signOutButton.hidden = !stagingSession.enabled;
    if (!stagingSession.enabled) {
      selector.value = 'public';
      for (const option of selector.options) if (option.value !== 'public') option.disabled = true;
      panel.querySelector('[role="status"]').textContent = 'Staging signed out. Restricted publishing is disabled.';
    }
  });
  signOutButton.hidden = true;
  mountLegacyConsent(panel);
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
      await stagingSession.signIn(panel.querySelector('[name="email"]').value.trim(),
        panel.querySelector('[name="password"]').value);
      for (const option of selector.options) if (option.value !== 'public') {
        option.disabled = false; option.textContent = option.textContent.replace('coming soon', 'isolated staging');
      }
      status.textContent = 'Staging account ready. Choose an audience before adding files. ';
      const readers = document.createElement('a'); readers.href = 'index.html?privacy_staging=1';
      readers.textContent = 'Open staging readers'; status.appendChild(readers);
    } catch (_) { status.textContent = 'Staging sign-in unavailable.'; }
    finally { panel.querySelector('[name="password"]').value = ''; button.disabled = false; }
  });
  window.addEventListener('pagehide', () => {
    panel.querySelectorAll('input').forEach(input => { input.value = ''; });
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
