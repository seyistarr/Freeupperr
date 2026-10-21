import { stagingSession } from './staging-session.js';
// No URLs or privileged credentials are read or rendered by this panel.
export function mountLegacyConsent(parent) {
  const panel = document.createElement('section');
  panel.hidden = true;
  panel.innerHTML = `<h3>Convert a legacy Public post</h3>
    <p>Your post stays Public while protected copies are prepared. Consent alone does not change its audience.</p>
    <label>Owned staging post ID <input name="legacy-post" required></label>
    <label>Requested audience <select name="legacy-audience"><option value="followers">Followers</option><option value="friends">Mutuals</option><option value="only_me">Only Me</option></select></label>
    <p>Quarantine hides the post while old URLs are revoked. After quarantine, restoring Public access or cancelling is unavailable. Previously downloaded copies cannot be recalled. Verification takes at least 31 days and may take longer.</p>
    <label><input name="legacy-ack" type="checkbox"> I understand the pending period and irreversible quarantine.</label>
    <button type="button" data-action="legacy-status">Check status</button>
    <button type="button" data-action="legacy-consent">Request conversion</button>
    <button type="button" data-action="legacy-quarantine-consent">Authorize irreversible quarantine</button>
    <p>After quarantine and replacement verification, deleting old public originals is a separate decision. Valid protected copies must remain available. Deletion and invalidation do not immediately revoke cached URLs.</p>
    <label><input name="legacy-delete-ack" type="checkbox"> I authorize permanent deletion of this post’s old public originals after the protected replacements have been verified.</label>
    <button type="button" data-action="legacy-delete-consent">Authorize deletion of old public originals</button>
    <p role="status" aria-live="polite"></p>`;
  parent.appendChild(panel);
  for (const input of panel.querySelectorAll('[name="legacy-post"],[name="legacy-audience"]')) input.addEventListener('change', () => {
    panel.querySelector('[name="legacy-ack"]').checked = false;
    panel.querySelector('[name="legacy-delete-ack"]').checked = false;
    panel.querySelector('[role="status"]').textContent = 'Post or audience changed. Review and acknowledge the request again.';
  });
  let generation = 0;
  window.addEventListener('privacy-staging-session', () => {
    generation++; panel.hidden = !stagingSession.enabled;
    panel.querySelectorAll('input').forEach(input => { input.value = ''; input.checked = false; });
    panel.querySelector('[role="status"]').textContent = '';
  });
  for (const button of panel.querySelectorAll('[data-action]')) button.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation();
    const current = generation, status = panel.querySelector('[role="status"]');
    const post = panel.querySelector('[name="legacy-post"]').value.trim();
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(post)) { status.textContent = 'Enter an owned staging post ID.'; return; }
    const acknowledge = panel.querySelector('[name="legacy-ack"]').checked;
    if (button.dataset.action !== 'legacy-status' && !acknowledge) { status.textContent = 'Read and acknowledge the quarantine conditions first.'; return; }
    if (button.dataset.action === 'legacy-delete-consent' && !panel.querySelector('[name="legacy-delete-ack"]').checked) {
      status.textContent = 'Separately authorize permanent deletion of the old public originals.'; return;
    }
    button.disabled = true;
    try {
      const token = await stagingSession.accessToken();
      const response = await fetch('/api/privacy-v2-publish', { method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: button.dataset.action, post_id: post, visibility: panel.querySelector('[name="legacy-audience"]').value, acknowledge }) });
      const result = await response.json();
      if (current !== generation || !stagingSession.enabled) return;
      if (!response.ok) throw Error();
      status.textContent = `Status: ${result.state}. Requested audience: ${result.visibility || 'none'}. ` +
        (result.irreversible ? 'Quarantine is irreversible; operator recovery must continue forward. ' : 'Public access remains unchanged until quarantine. ') +
        (result.earliest_check ? `Earliest verification: ${result.earliest_check}. ` : '') +
        (result.deletion_authorized ? 'Deletion authorized for the verified replacement set. ' : 'Deletion of public originals is not authorized. ') +
        (result.state === 'complete' ? 'Conversion complete; the requested audience is active.' :
          (result.quarantine_authorized ? 'Quarantine authorized; awaiting operator processing. ' : '') + 'Restricted publishing remains blocked until independent revocation verification completes.');
    } catch (_) { if (current === generation) status.textContent = 'Conversion unavailable. No audience change was made. An operator may need to prepare or recover this migration.'; }
    finally { button.disabled = false; }
  });
}
