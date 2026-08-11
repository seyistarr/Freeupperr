// =====================================================================
// onboarding.js
// FreeUpper Onboarding — v4.0.0 (36-category taxonomy, sourced interests)
// =====================================================================

(function () {
  'use strict';

  const LOG = (...args) => console.log('[onboarding.js]', ...args);
  const ERR = (...args) => console.error('[onboarding.js]', ...args);

  const MIN_SELECT = 3;
  const ONBOARDING_STRENGTH = 0.5; // moderate, not maximal — behavior earns the rest

  // ─── SVG ICONS ────────────────────────────────────────────────────────────
  // Keys must match freeupper_interests.key exactly (post-normalization).
  const ICONS = {
    comedy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    dance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M12 6v5"/><path d="M12 9l-4 3"/><path d="M12 9l4 2"/><path d="M12 11l-3 9"/><path d="M12 11l4 8"/></svg>',
    movies_tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l1.5-4h3L6 8z"/><path d="M8.5 8L10 4h3L11.5 8z"/><path d="M14 8l1.5-4h3L17 8z"/><rect x="3" y="8" width="18" height="12" rx="1"/><line x1="3" y1="8" x2="21" y2="8"/></svg>',
    gaming: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="10" r="1"/><circle cx="18" cy="13" r="1"/></svg>',
    esports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5H5a3 3 0 0 0 3 5"/><path d="M16 5h3a3 3 0 0 1-3 5"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="9" y1="21" x2="15" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    sports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20"/><path d="M2 12h20"/><path d="M4.9 6.5c2 2 2 9 0 11"/><path d="M19.1 6.5c-2 2-2 9 0 11"/></svg>',
    politics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="21" x2="21" y2="21"/><line x1="5" y1="21" x2="5" y2="10"/><line x1="9" y1="21" x2="9" y2="10"/><line x1="15" y1="21" x2="15" y2="10"/><line x1="19" y1="21" x2="19" y2="10"/><polygon points="12 3 21 9 3 9"/></svg>',
    news_current_events: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z"/><path d="M20 20H7a3 3 0 0 1-3-3"/><line x1="8" y1="8" x2="14" y2="8"/><line x1="8" y1="12" x2="14" y2="12"/></svg>',
    fashion_beauty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.9L19 9l-5.2 1.6L12 15l-1.8-4.4L5 9l5.2-1.1z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    food_drink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    food_culture: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16"/><path d="M4 12h16"/></svg>',
    travel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>',
    lifestyle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    relationships: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6.5 5.5 5.5 0 0 1 21.5 12c-2.5 4.5-9.5 9-9.5 9z"/></svg>',
    family_parenting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="18" cy="9" r="2.5"/><path d="M15 20c0-2.2 1.8-4 4-4"/></svg>',
    health_fitness: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    education: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 2.5 3 6 3s6-1.5 6-3v-5"/></svg>',
    science_technology: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/></svg>',
    business_finance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="4" y2="12"/><line x1="10" y1="20" x2="10" y2="8"/><line x1="16" y1="20" x2="16" y2="14"/><line x1="20" y1="20" x2="20" y2="4"/><line x1="2" y1="20" x2="22" y2="20"/></svg>',
    careers_jobs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="2" y1="13" x2="22" y2="13"/></svg>',
    art_creativity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.6 1.5-1.4 0-.4-.2-.7-.4-1a1.6 1.6 0 0 1 1.3-2.6H16a4 4 0 0 0 4-4c0-5-3.6-9-8-9z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15.5" cy="7.5" r="1"/></svg>',
    diy_crafts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    automotive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l2-6h14l2 6"/><rect x="2" y="13" width="20" height="6" rx="2"/><circle cx="7" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>',
    pets_animals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="9" r="1.5"/><circle cx="18" cy="9" r="1.5"/><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><path d="M12 12c-3 0-6 2.2-6 5a3 3 0 0 0 3 3c1.3 0 2-1 3-1s1.7 1 3 1a3 3 0 0 0 3-3c0-2.8-3-5-6-5z"/></svg>',
    religion_spirituality: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/><path d="M19 15l.6 2.2L22 18l-2.4.8L19 21l-.6-2.2L16 18l2.4-.8z"/></svg>',
    self_improvement: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    culture_language: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 0 20"/><path d="M12 2a15 15 0 0 0 0 20"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12"/><path d="M6 22h12"/><path d="M6 2c0 6 6 6 6 10s-6 4-6 10"/><path d="M18 2c0 6-6 6-6 10s6 4 6 10"/></svg>',
    books_writing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h7a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5H2z"/><path d="M22 4h-7a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5H22z"/></svg>',
    photography: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/></svg>',
    nature_outdoors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20l6-10 4 6 3-4 5 8z"/><circle cx="17" cy="6" r="2"/></svg>',
    home_garden: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M12 20v-5"/><path d="M9 17c0-2 1.5-3 3-3s3 1 3 3"/></svg>',
    shopping_products: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    celebrity_pop_culture: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    podcasts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/></svg>'
  };

  const FALLBACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/></svg>';

  // ─── KEY NORMALIZER ────────────────────────────────────────────────────────
  function normalizeKey(k) {
    return (k || '')
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[\s&-]+/g, '_')
      .replace(/_+/g, '_');
  }

  // ─── SUPABASE HELPER ──────────────────────────────────────────────────────
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

  // ─── SHOW ONBOARDING ──────────────────────────────────────────────────────
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

    grid.style.overflow = 'hidden';
    grid.style.maxWidth = '100%';

    // No WIDE_KEYS — every pill is the same size; long labels wrap via CSS
    // (.pill-label needs white-space: normal; overflow-wrap: break-word;)
    grid.innerHTML = interests.map(i => {
      const nk = normalizeKey(i.key);
      const icon = ICONS[nk] || FALLBACK_ICON;
      if (!ICONS[nk]) {
        LOG('No icon match for key:', JSON.stringify(i.key), '→ normalized:', nk);
      }
      return `<button type="button" class="interest-pill" data-key="${i.key}" style="min-width:0;">
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
        // Restore the button instead of leaving it stuck on "Saving…"
        updateNextBtn();
      }
    }

    nextBtn.onclick = () => {
      if (selected.size < MIN_SELECT) return;
      nextBtn.disabled = true;
      nextBtn.textContent = 'Saving…';
      const interestsObj = {};
      selected.forEach(key => {
        interestsObj[key] = { sources: ['onboarding'], strength: ONBOARDING_STRENGTH };
      });
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
