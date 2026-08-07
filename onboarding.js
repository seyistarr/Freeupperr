// onboarding.js
(function () {
  'use strict';

  async function fetchInterests() {
    const { data, error } = await window.sb
      .from('freeupper_interests')
      .select('key, label, emoji, group_name, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('onboarding.js: failed to fetch interests:', error);
      return [];
    }
    return data || [];
  }

  async function showOnboarding() {
    const overlay = document.getElementById('onboardingOverlay');
    const grid = document.getElementById('interestGrid');
    const continueBtn = document.getElementById('onboardingContinueBtn');
    if (!overlay || !grid || !continueBtn) return;

    const interests = await fetchInterests();
    if (!interests.length) return; // fail silently rather than block the app

    const selected = new Set();

    grid.innerHTML = interests.map(i => `
      <button type="button" class="interest-chip" data-key="${i.key}">
        <span>${i.emoji}</span> ${i.label}
      </button>
    `).join('');

    grid.addEventListener('click', e => {
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
    });

    continueBtn.addEventListener('click', async () => {
      continueBtn.disabled = true;
      continueBtn.textContent = 'Saving…';
      const interestsObj = {};
      selected.forEach(key => { interestsObj[key] = 0.8; });

      const saved = await window.FreeUpperFeed.saveOnboardingInterests(interestsObj);
      overlay.style.display = 'none';

      if (saved && typeof window.refreshHome === 'function') {
        window.refreshHome();
      }
    }, { once: true });

    overlay.style.display = 'flex';
  }

  window.FreeUpperOnboarding = { showOnboarding };
})();
