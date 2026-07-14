// ══════════════════════════════════════════
// GLOBAL UTILITIES – THEME, TOAST, USER CACHE
// Used across all Freeupper pages
// ══════════════════════════════════════════

(function () {
  'use strict';

  // ─── CONSTANTS ──────────────────────────
  const THEME_KEY = 'freeupper_theme';
  const USER_KEY = 'freeupper_user_profile'; // cached user object
  const ALL_USERS_KEY = 'freeupper_all_users'; // deprecated – kept for compatibility

  // ─── THEME ──────────────────────────────
  let currentTheme = localStorage.getItem(THEME_KEY) || 'dark';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    currentTheme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
    updateThemeButton();
  }

  window.toggleTheme = function () {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
  };

  window.getCurrentTheme = function () {
    return currentTheme;
  };

  function updateThemeButton() {
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      const svg = btn.querySelector('svg');
      if (svg) {
        if (currentTheme === 'dark') {
          svg.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
        } else {
          svg.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
        }
      }
    });
  }

  // Init theme
  (function initTheme() {
    applyTheme(currentTheme);
    window.addEventListener('storage', function (e) {
      if (e.key === THEME_KEY && e.newValue && e.newValue !== currentTheme) {
        applyTheme(e.newValue);
      }
    });
    document.addEventListener('themeChanged', function (e) {
      if (e.detail && e.detail.theme) {
        currentTheme = e.detail.theme;
        updateThemeButton();
      }
    });
  })();

  // ─── TOAST ──────────────────────────────
  window.showToast = function (msg, type) {
    type = type || 'p';
    const w = document.getElementById('tw');
    if (!w) return;
    const el = document.createElement('div');
    el.className = 'toast';
    const colorMap = { p: 'tp', g: 'tg', r: 'tr', o: 'to' };
    el.innerHTML = '<div class="td ' + (colorMap[type] || 'tp') + '"></div>' + msg;
    w.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 2600);
  };

  // ─── USER SESSION CACHE ──────────────────
  // We keep a lightweight cache of the current user (from Supabase session)
  // but it should be refreshed on auth changes.
  function getDefaultUser() {
    return {
      id: 'GUEST-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      username: '',
      displayName: 'Guest',
      bio: '',
      avatar: 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#E5E7EB"/><circle cx="50" cy="38" r="16" fill="#9CA3AF"/><ellipse cx="50" cy="75" rx="30" ry="22" fill="#9CA3AF"/></svg>'
      ),
      isLoggedIn: false,
      verified: false,
      isAdmin: false,
      verificationStatus: 'none'
    };
  }

  window.getCurrentUser = function () {
    let user = JSON.parse(localStorage.getItem(USER_KEY));
    if (!user) {
      user = getDefaultUser();
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
    return user;
  };

  window.saveCurrentUser = function (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    // Dispatch event so other tabs can update
    try {
      window.dispatchEvent(new StorageEvent('storage', {
        key: USER_KEY,
        newValue: JSON.stringify(user)
      }));
    } catch (e) { /* ignore */ }
  };

  // ─── AVATAR / NAV UPDATES ──────────────
  window.updateNavAvatar = function () {
    const user = getCurrentUser();
    const avatars = document.querySelectorAll('.side-av, .nav-av');
    avatars.forEach(el => {
      el.src = user.avatar;
      el.onerror = function () { this.style.display = 'none'; };
    });
  };

  // ─── VERIFICATION BADGE HELPERS ─────────
  window.updateVerificationBadge = function () {
    const user = getCurrentUser();
    const badges = document.querySelectorAll('.verified-badge, .verified-badge-sm, .verified-badge-lg');
    badges.forEach(badge => {
      if (user && user.verified) {
        badge.classList.remove('hidden');
        badge.style.display = 'inline-flex';
      } else {
        badge.classList.add('hidden');
        badge.style.display = 'none';
      }
    });
  };

  window.getVerifiedBadgeHTML = function (size) {
    const user = getCurrentUser();
    if (!user || !user.verified) return '';
    const sizeClass = size === 'sm' ? 'verified-badge-sm' :
      size === 'lg' ? 'verified-badge-lg' : 'verified-badge';
    return `<span class="${sizeClass}"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>`;
  };

  // ─── PROFILE UPDATE HELPER ──────────────
  window.updateUserProfile = function (updates) {
    const user = getCurrentUser();
    Object.assign(user, updates);
    saveCurrentUser(user);
    updateNavAvatar();
    updateVerificationBadge();
    document.dispatchEvent(new CustomEvent('profileUpdated', {
      detail: { user: user }
    }));
    return user;
  };

  // ─── CROSS‑TAB PROFILE SYNC ─────────────
  window.setupProfileSync = function (refreshCallback) {
    window.addEventListener('storage', function (e) {
      if (e.key === USER_KEY) {
        const user = getCurrentUser();
        updateNavAvatar();
        updateVerificationBadge();
        if (typeof refreshCallback === 'function') {
          refreshCallback(user);
        }
      }
    });

    document.addEventListener('profileUpdated', function (e) {
      if (e.detail && e.detail.user) {
        updateNavAvatar();
        updateVerificationBadge();
        if (typeof refreshCallback === 'function') {
          refreshCallback(e.detail.user);
        }
      }
    });
  };

  // ─── INIT ───────────────────────────────
  // Run once on DOM ready
  function initGlobal() {
    updateNavAvatar();
    updateVerificationBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobal);
  } else {
    initGlobal();
  }

  // ─── DEPRECATED – removed all localStorage data functions ──
  // The following functions are no longer used for persistent data:
  // - getPosts, savePost, deletePost
  // - getMarketItems, saveMarketItem, deleteMarketItem
  // - toggleFollow, isFollowing, getFollowCounts
  // - toggleReaction, hasReacted
  // - toggleBookmark, isBookmarked
  // - toggleShare, isShared
  // - submitVerificationRequest, approveVerification, rejectVerification
  // - getAllUsers (replaced by direct Supabase queries)
  // - getVerificationRequests (replaced by Supabase)
  // These have been moved to their respective API modules (posts.js, etc.)

  console.log('✅ global.js loaded (UI/theme only – data now via Supabase)');

})();