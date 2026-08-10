// =====================================================================
// onboarding.js
// FreeUpper Onboarding — v3.1.0 (SVG icon pill grid, purple theme)
// =====================================================================

(function () {
  'use strict';

  const LOG = (...args) => console.log('[onboarding.js]', ...args);
  const ERR = (...args) => console.error('[onboarding.js]', ...args);

  const MIN_SELECT = 3;

  // ─── SVG ICONS (stroke="currentColor" so they inherit the badge color) ───
  const ICONS = {
    comedy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    entertainment_culture: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    food_drink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    sports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20"/><path d="M2 12h20"/><path d="M4.9 6.5c2 2 2 9 0 11"/><path d="M19.1 6.5c-2 2-2 9 0 11"/></svg>',
    beauty_style: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.9L19 9l-5.2 1.6L12 15l-1.8-4.4L5 9l5.2-1.1z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    travel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>',
    motivation_advice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    life_hacks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
    dance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M12 6v5"/><path d="M12 9l-4 3"/><path d="M12 9l4 2"/><path d="M12 11l-3 9"/><path d="M12 11l4 8"/></svg>',
    science_education: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 2.5 3 6 3s6-1.5 6-3v-5"/></svg>',
    gaming: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="10" r="1"/><circle cx="18" cy="13" r="1"/></svg>',
    fitness_health: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    daily_life: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    diy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
  };

  const FALLBACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="1.5"/></svg>';

  const WIDE_KEYS = new Set(['comedy', 'entertainment_culture', 'travel', 'motivation_advice', 'science_education']);

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

    grid.innerHTML = '<div style="grid-column:span 2;text-align:center;padding:40px 0;color:#999;">Loading…</div>';
    nextBtn.disabled = true;
    nextBtn.textContent = 'Next (0)';
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    const interests = await fetchInterests();

    if (!interests.length) {
      ERR('No interests returned — check freeupper_interests table/RLS.');
      grid.innerHTML = '<div style="grid-column:span 2;text-align:center;padding:40px 0;color:#e55;">Couldn\'t load interests. Please try again shortly.</div>';
      return;
    }

    const selected = new Set();

    grid.innerHTML = interests.map(i => {
      const icon = ICONS[i.key] || FALLBACK_ICON;
      const wideClass = WIDE_KEYS.has(i.key) ? ' wide' : '';
      return `<button type="button" class="interest-pill${wideClass}" data-key="${i.key}">
        <span class="pill-icon-badge">${icon}</span>
        <span class="pill-label">${i.label}</span>
        <span class="pill-plus">+</span>
      </button>`;
    }).join('');

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
      finishOnboarding({});
    };

    LOG('Onboarding rendered with', interests.length, 'options.');
  }

  window.FreeUpperOnboarding = { showOnboarding };
  LOG('onboarding.js loaded.');
})();
