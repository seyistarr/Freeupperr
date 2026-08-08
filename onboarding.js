// =====================================================================
// onboarding.js
// FreeUpper Onboarding — v1.1.0 (defensive rewrite)
// =====================================================================

(function () {
  'use strict';

  const LOG = (...args) => console.log('[onboarding.js]', ...args);
  const ERR = (...args) => console.error('[onboarding.js]', ...args);

  // ===================================================================
  // Wait for window.sb to exist before doing anything. This handles
  // any script-load-order race condition where onboarding.js runs
  // before your Supabase client is initialized.
  // ===================================================================
  function waitForSupabase(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (window.sb) return resolve(window.sb);

      const start = Date.now();
      const interval = setInterval(() => {
        if (window.sb) {
          clearInterval(interval);
          resolve(window.sb);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error('window.sb never became available'));
        }
      }, 100);
    });
  }

  // ===================================================================
  // FETCH INTERESTS
  // ===================================================================
  async function fetchInterests() {
    try {
      const sb = await waitForSupabase();

      LOG('Fetching interests from freeupper_interests...');

      const { data, error } = await sb
        .from('freeupper_interests')
        .select('key, label, emoji, group_name, sort_order')
        .eq('active', true)
        .order('sort_order', { ascending: true });

      if (error) {
        ERR('Supabase query error:', error.message, error);
        return [];
      }

      LOG(`Fetched ${data ? data.length : 0} interests.`);
      return data || [];
    } catch (err) {
      ERR('fetchInterests exception:', err);
      return [];
    }
  }

  // ===================================================================
  // SHOW ONBOARDING
  // ===================================================================
  async function showOnboarding() {
    const overlay = document.getElementById('onboardingOverlay');
    const grid = document.getElementById('interestGrid');
    const continueBtn = document.getElementById('onboardingContinueBtn');

    if (!overlay || !grid || !continueBtn) {
      ERR('Required DOM elements missing.', {
        overlay: !!overlay,
        grid: !!grid,
        continueBtn: !!continueBtn
      });
      return;
    }

    if (overlay.classList.contains('open')) {
      LOG('Overlay already open, skipping.');
      return;
    }

    LOG('Opening onboarding overlay...');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--muted,#888);">Loading…</div>';
    continueBtn.disabled = true;
    continueBtn.textContent = 'Continue';
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    const interests = await fetchInterests();

    if (!interests.length) {
      ERR('No interests returned — check console above for the real cause (query error, empty table, or RLS).');
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:20px;color:#e55;">
          Couldn't load interests. Please try again shortly.
        </div>`;
      // Don't auto-close — let the user see the error instead of it
      // silently vanishing, which was the original confusing symptom.
      return;
    }

    const selected = new Set();

    grid.innerHTML = interests.map(i => `
      <button type="button" class="interest-chip" data-key="${i.key}">
        <span>${i.emoji || ''}</span> ${i.label}
      </button>
    `).join('');

    grid.onclick = (e) => {
      const chip = e.target.closest('.interest-chip');
      if (!chip) return;
      const key = chip.dataset.key;
      if (selected.has(key)) {
        selected.delete(key);
        chip.classList.remove('active');
      } else {
        selected.add(key);
        chip.classList.add('active');
      }
      continueBtn.disabled = selected.size < 5;
    };

    continueBtn.onclick = async () => {
      if (selected.size < 5) return;

      continueBtn.disabled = true;
      continueBtn.textContent = 'Saving…';

      const interestsObj = {};
      selected.forEach(key => { interestsObj[key] = 0.8; });

      try {
        if (!window.FreeUpperFeed || typeof window.FreeUpperFeed.saveOnboardingInterests !== 'function') {
          throw new Error('FreeUpperFeed.saveOnboardingInterests is not available. Check that index-feed.js loaded before onboarding.js.');
        }

        const saved = await window.FreeUpperFeed.saveOnboardingInterests(interestsObj);

        overlay.classList.remove('open');
        document.body.style.overflow = '';

        if (saved && typeof window.refreshHome === 'function') {
          window.refreshHome();
        }

        LOG('Onboarding saved successfully:', interestsObj);
      } catch (err) {
        ERR('Failed to save onboarding interests:', err);
        continueBtn.disabled = false;
        continueBtn.textContent = 'Continue';
        alert('Something went wrong saving your interests. Please try again.');
      }
    };

    LOG('Onboarding rendered successfully with', interests.length, 'options.');
  }

  window.FreeUpperOnboarding = { showOnboarding };
  LOG('onboarding.js loaded.');
})();
