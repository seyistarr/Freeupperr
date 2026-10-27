(function () {
  'use strict';
  const status = document.getElementById('status');
  const message = document.getElementById('message');
  const list = document.getElementById('posts');
  let generation = 0;
  async function refresh() {
    const stamp = ++generation;
    list.replaceChildren(); message.textContent = '';
    try {
      const { data, error } = await window.sb.auth.getSession();
      if (stamp !== generation) return;
      const signedIn = !error && !!data?.session?.access_token;
      document.getElementById('signin').hidden = signedIn;
      if (!signedIn) { status.textContent = 'Sign in here with your existing FreeUpper account.'; return; }
      const { data: beta, error: betaError } = await window.sb.rpc('protected_studio_beta_status');
      if (stamp !== generation) return;
      status.textContent = !betaError && beta?.approved && beta?.ready && beta.mode === 'production'
        ? 'Controlled beta publishing is active for your account. Temporary verification publishing has ended.'
        : 'Restricted publishing is unavailable for this account. You can still clean up your own verification posts.';
      const result = await window.FreeUpperProtectedPublish.verificationList();
      if (stamp !== generation) return;
      if (!Array.isArray(result.posts)) throw Error('Verification list unavailable');
      if (!result.posts.length) { message.textContent = 'No verification posts for this account.'; return; }
      for (const post of result.posts) {
        const item = document.createElement('li');
        const label = document.createElement('p');
        label.textContent = post.id + ' · ' + post.visibility + ' · ' + post.status + ' · expires ' + new Date(post.expires_at).toLocaleString();
        const link = document.createElement('a');
        link.href = '/video.html?post=' + encodeURIComponent(post.id); link.textContent = 'Open post';
        item.append(label, link);
        const cleanup = document.createElement('button');
        cleanup.textContent = post.retired ? (post.cleanupPending ? 'Retry pending asset cleanup' : 'Removed and cleaned up') : 'Remove verification post';
        cleanup.disabled = post.retired && !post.cleanupPending;
        cleanup.addEventListener('click', async () => {
          cleanup.disabled = true;
          try {
            const result = await window.FreeUpperProtectedPublish.verificationCleanup(post.id);
            if (stamp !== generation) return;
            await refresh();
            message.textContent = result.cleanupPending ? 'Post removed. Remote asset deletion is pending; retry cleanup later.' : 'Post removed and remote asset cleanup confirmed.';
          } catch (_) { if (stamp === generation) { message.textContent = 'Cleanup could not be confirmed. Refresh the list and retry.'; cleanup.disabled = false; } }
        });
        item.append(cleanup); list.append(item);
      }
    } catch (_) { if (stamp === generation) message.textContent = 'Unable to load verification status. Check your session and retry.'; }
  }
  document.getElementById('signin').addEventListener('click', () => window.AuthUser?.openModal('signin'));
  document.getElementById('refresh').addEventListener('click', refresh);
  window.sb?.auth?.onAuthStateChange?.(() => { generation++; list.replaceChildren(); setTimeout(refresh, 0); });
  refresh();
})();
