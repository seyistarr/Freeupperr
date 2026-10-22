// Fail closed: no account may select restricted audiences unless the server approves.
// The server independently checks every protected publishing operation.
(() => {
  'use strict';
  const audiences = ['followers', 'friends', 'only_me'];
  let lastUser = null;
  function setEnabled(enabled) {
    const select = document.getElementById('postAudience');
    if (!select) return;
    for (const option of select.options) {
      if (!audiences.includes(option.value)) continue;
      option.disabled = !enabled;
      option.textContent = ({
        followers: 'Followers', friends: 'Mutuals', only_me: 'Only Me'
      })[option.value] + (enabled ? '' : ' — coming soon');
    }
    if (!enabled && audiences.includes(select.value)) {
      select.value = 'public';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const note = document.getElementById('postAudienceNote');
    if (note) note.textContent = enabled
      ? 'Privacy V2 controlled test: restricted posts are visible only to their selected audience.'
      : 'Private publishing is being prepared. Public is the only available option.';
  }
  async function refresh() {
    setEnabled(false);
    const client = window.sb;
    if (!client?.auth?.getSession) return;
    try {
      const { data, error } = await client.auth.getSession();
      const session = !error && data?.session;
      if (!session?.access_token) { lastUser = null; return; }
      lastUser = session.user?.id || null;
      const response = await fetch('/api/privacy-v2-test-capability', {
        headers: { Authorization: 'Bearer ' + session.access_token },
        cache: 'no-store', credentials: 'same-origin'
      });
      if (!response.ok) return;
      const capability = await response.json();
      const latest = await client.auth.getSession();
      if (latest.data?.session?.user?.id !== lastUser) return;
      setEnabled(capability.enabled === true &&
        audiences.every(a => capability.audiences?.includes(a)));
    } catch (_) { setEnabled(false); }
  }
  function start() {
    setEnabled(false);
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) setEnabled(false);
      else refresh();
    });
    // Authentication may initialize after deferred scripts.
    window.addEventListener('load', refresh, { once: true });
    window.sb?.auth?.onAuthStateChange?.(() => { setEnabled(false); queueMicrotask(refresh); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
