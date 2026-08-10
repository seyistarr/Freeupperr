// =====================================================================
// onboarding.js
// FreeUpper Onboarding — v2.0.0 (pill picker, TikTok-style)
// =====================================================================

(function () {
  'use strict';

  const LOG = (...args) => console.log('[onboarding.js]', ...args);
  const ERR = (...args) => console.error('[onboarding.js]', ...args);

  const MIN_SELECT = 3; // set to 5 if you want a hard minimum before "Next" enables

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

  async function fetchInterests() {
    try {
      const sb = await waitForSupabase();
      const { data, error } = await sb
        .from('freeupper_interests')
        .select('key, label, group_name, sort_order')
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

  async function showOnboarding() {
    const overlay = document.getElementById('onboardingOverlay');
    const grid = document.getElementById('interestGrid');
    const nextBtn = document.getElementById('onboardingContinueBtn');
    const skipBtn = document.getElementById('onboardingSkipBtn');

    if (!overlay || !grid || !nextBtn || !skipBtn) {
      ERR('Required DOM elements missing.', {
        overlay: !!overlay, grid: !!grid, nextBtn: !!nextBtn, skipBtn: !!skipBtn
      });
      return;
    }
    if (overlay.classList.contains('open')) return;

    grid.innerHTML = '<div style="width:100%;text-align:center;padding:40px 0;color:#999;">Loading…</div>';
    nextBtn.disabled = true;
    nextBtn.textContent = 'Next (0)';
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    const interests = await fetchInterests();

    if (!interests.length) {
      ERR('No interests returned — check freeupper_interests table/RLS.');
      grid.innerHTML = '<div style="width:100%;text-align:center;padding:40px 0;color:#e55;">Couldn\'t load interests. Please try again shortly.</div>';
      return;
    }

    const selected = new Set();

    grid.innerHTML = interests.map(i => `
      <button type="button" class="interest-pill" data-key="${i.key}">
        <span>${i.label}</span>
        <span class="pill-icon">+</span>
      </button>
    `).join('');

    function updateNextBtn() {
      nextBtn.textContent = `Next (${selected.size})`;
      nextBtn.disabled = selected.size < MIN_SELECT;
    }
    updateNextBtn();

    grid.onclick = (e) => {
      const pill = e.target.closest('.interest-pill');
      if (!pill) return;
      const key = pill.dataset.key;
      if (selected.has(key)) {
        selected.delete(key);
        pill.classList.remove('selected');
      } else {
        selected.add(key);
        pill.classList.add('selected');
      }
      updateNextBtn();
    };

    async function finishOnboarding(interestsObj) {
      try {
        if (!window.FreeUpperFeed || typeof window.FreeUpperFeed.saveOnboardingInterests !== 'function') {
          throw new Error('FreeUpperFeed.saveOnboardingInterests is not available.');
        }
        const saved = await window.FreeUpperFeed.saveOnboardingInterests(interestsObj);
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        if (saved && typeof window.refreshHome === 'function') {
          window.refreshHome();
        }
        LOG('Onboarding finished:', interestsObj);
      } catch (err) {
        ERR('Failed to save onboarding interests:', err);
        alert('Something went wrong saving your interests. Please try again.');
      }
    }

    nextBtn.onclick = () => {
      if (selected.size < MIN_SELECT) return;
      nextBtn.disabled = true;
      nextBtn.textContent = 'Saving…';
      const interestsObj = {};
      selected.forEach(key => { interestsObj[key] = 0.8; });
      finishOnboarding(interestsObj);
    };

    skipBtn.onclick = () => {
      // Skipping still marks onboarding complete (with an empty interest
      // vector) so the modal never reappears — the algorithm just falls
      // back to pure freshness+engagement ranking for this user.
      finishOnboarding({});
    };

    LOG('Onboarding rendered with', interests.length, 'options.');
  }

  window.FreeUpperOnboarding = { showOnboarding };
  LOG('onboarding.js loaded.');
})();
