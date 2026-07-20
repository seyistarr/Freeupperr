// ============================================================
// GLOBAL UTILITIES – THEME, TOAST, USER CACHE, AUTHOR HELPERS
// Used across all Freeupper pages
// ============================================================

(function() {
  'use strict';

  // ─── CONSTANTS ───────────────────────────────────────────────
  const THEME_KEY = 'freeupper_theme';
  const USER_KEY = 'freeupper_user_profile';
  const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#E5E7EB"/><circle cx="50" cy="38" r="16" fill="#9CA3AF"/><ellipse cx="50" cy="75" rx="30" ry="22" fill="#9CA3AF"/></svg>'
  );

  // ─── THEME ────────────────────────────────────────────────────
  let currentTheme = localStorage.getItem(THEME_KEY) || 'dark';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    currentTheme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
    updateThemeButton();
  }

  window.toggleTheme = function() {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
  };

  window.getCurrentTheme = function() {
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
    window.addEventListener('storage', function(e) {
      if (e.key === THEME_KEY && e.newValue && e.newValue !== currentTheme) {
        applyTheme(e.newValue);
      }
    });
    document.addEventListener('themeChanged', function(e) {
      if (e.detail && e.detail.theme) {
        currentTheme = e.detail.theme;
        updateThemeButton();
      }
    });
  })();

  // ─── TOAST ────────────────────────────────────────────────────
  window.showToast = function(msg, type) {
    type = type || 'p';
    const w = document.getElementById('tw');
    if (!w) return;
    const el = document.createElement('div');
    el.className = 'toast';
    const colorMap = { p: 'tp', g: 'tg', r: 'tr', o: 'to' };
    el.innerHTML = '<div class="td ' + (colorMap[type] || 'tp') + '"></div>' + msg;
    w.appendChild(el);
    setTimeout(function() {
      el.classList.add('out');
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 2600);
  };

  // ─── USER SESSION CACHE ──────────────────────────────────────
  // Caches only the current user's session info (for UI state like avatar in navbar)
  // All post/comment author data comes from Supabase profiles join – NOT from this cache.
  function getDefaultUser() {
    return {
      id: 'GUEST-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      username: '',
      displayName: 'Guest',
      bio: '',
      avatar: DEFAULT_AVATAR,
      isLoggedIn: false,
      verified: false,
      verificationStatus: 'none'
    };
  }

  window.getCurrentUser = function() {
    let user = JSON.parse(localStorage.getItem(USER_KEY));
    if (!user) {
      user = getDefaultUser();
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
    return user;
  };

  window.saveCurrentUser = function(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    try {
      window.dispatchEvent(new StorageEvent('storage', {
        key: USER_KEY,
        newValue: JSON.stringify(user)
      }));
    } catch (e) { /* ignore */ }
  };

  // ─── AVATAR / NAV UPDATES ────────────────────────────────────
  window.updateNavAvatar = function() {
    const user = getCurrentUser();
    const avatars = document.querySelectorAll('.side-av, .nav-av');
    avatars.forEach(el => {
      el.src = user.avatar || DEFAULT_AVATAR;
      el.onerror = function() { this.style.display = 'none'; };
    });
  };

  // ─── AUTHOR HELPER ───────────────────────────────────────────
  // Given a profile object (from a post or comment join), return a clean author object.
  // Supports both new verified_status and old verified boolean columns.
  // Now safe: always returns an object with an id (empty if profile missing).
  window.getAuthorFromProfile = function(profile) {
    if (!profile || !profile.id) {
      return {
        id: '',
        name: 'Anonymous',
        username: '',
        avatar: DEFAULT_AVATAR,
        verified_status: 'none',
        verified: false,
        is_private: false,
      };
    }

    // Determine verified status: prefer verified_status, fallback to verified boolean
    let verifiedStatus = profile.verified_status || 'none';
    if (verifiedStatus === 'none' && profile.verified === true) {
      verifiedStatus = 'verified';
    }

    return {
      id: profile.id,
      name: profile.display_name || 'Anonymous',
      username: profile.username || '',
      avatar: profile.avatar_url || DEFAULT_AVATAR,
      verified_status: verifiedStatus,
      verified: verifiedStatus !== 'none' && verifiedStatus !== 'pending',
      is_private: profile.is_private || false,
    };
  };

  // ─── VERIFIED BADGE HTML ─────────────────────────────────────
  // Now accepts verifiedStatus and optional size.
  window.getVerifiedBadgeHTML = function(verifiedStatus, size) {
    if (!verifiedStatus || verifiedStatus === 'none' || verifiedStatus === 'pending') return '';
    const sizeClass = size === 'sm' ? 'verified-badge-sm' :
                      size === 'lg' ? 'verified-badge-lg' :
                      'verified-badge';
    const label = verifiedStatus === 'official' ? 'Official' :
                  verifiedStatus === 'staff' ? 'Staff' :
                  verifiedStatus === 'business' ? 'Business' : 'Verified';
    return `<span class="${sizeClass}" title="${label}"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>`;
  };

  // ─── UPDATE AUTHOR UI ────────────────────────────────────────
  // Updates all DOM elements belonging to a specific user when their profile changes.
  window.updateAuthorUI = function(updatedProfile) {
    const avatar = updatedProfile.avatar_url || DEFAULT_AVATAR;
    const displayName = updatedProfile.display_name || 'Anonymous';
    const verifiedStatus = updatedProfile.verified_status || 'none';
    const isVerified = verifiedStatus !== 'none' && verifiedStatus !== 'pending';

    document.querySelectorAll(`[data-author-id="${updatedProfile.id}"]`).forEach(el => {
      // Avatar
      const avatarEl = el.querySelector('[data-author-avatar]');
      if (avatarEl) avatarEl.src = avatar;
      // Display name
      const nameEl = el.querySelector('[data-author-name]');
      if (nameEl) nameEl.textContent = displayName;
      // Verified badge wrapper (use innerHTML to replace content)
      const badgeWrapper = el.querySelector('[data-author-badge-wrapper]');
      if (badgeWrapper) {
        if (isVerified) {
          badgeWrapper.innerHTML = window.getVerifiedBadgeHTML(verifiedStatus);
          badgeWrapper.style.display = '';
        } else {
          badgeWrapper.innerHTML = '';
          badgeWrapper.style.display = 'none';
        }
      }
    });
  };

  // ─── PROFILE UPDATE HELPER ──────────────────────────────────
  window.updateUserProfile = function(updates) {
    const user = getCurrentUser();
    Object.assign(user, updates);
    saveCurrentUser(user);
    updateNavAvatar();
    // Update own profile badge (if displayed)
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
    document.dispatchEvent(new CustomEvent('profileUpdated', {
      detail: { user: user }
    }));
    return user;
  };

  // ─── CROSS‑TAB PROFILE SYNC ─────────────────────────────────
  window.setupProfileSync = function(refreshCallback) {
    window.addEventListener('storage', function(e) {
      if (e.key === USER_KEY) {
        const user = getCurrentUser();
        updateNavAvatar();
        if (typeof refreshCallback === 'function') {
          refreshCallback(user);
        }
      }
    });

    document.addEventListener('profileUpdated', function(e) {
      if (e.detail && e.detail.user) {
        updateNavAvatar();
        if (typeof refreshCallback === 'function') {
          refreshCallback(e.detail.user);
        }
      }
    });
  };

  // ─── INIT ────────────────────────────────────────────────────
  function initGlobal() {
    updateNavAvatar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobal);
  } else {
    initGlobal();
  }

  console.log('✅ global.js loaded (theme, toast, helpers, Supabase profile joins)');
})();
