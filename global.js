window.fuCommentsCount = function(node, count) {
  if (!node) return;
  const total = Math.max(0, Number(count) || 0);
  node.removeAttribute('data-i18n');
  node.dataset.i18nCount = String(total);
  node.textContent = window.FreeUpperI18n ? window.FreeUpperI18n.commentsCount(total) : total + (total === 1 ? ' comment' : ' comments');
};
window.fuT = window.fuT || function(key, values) { return window.FreeUpperI18n ? window.FreeUpperI18n.t(key, values) : key; };
// ============================================================
// GLOBAL UTILITIES – THEME, TOAST, USER CACHE, AUTHOR HELPERS
// Marketplace helpers: currency, time, badges, listings
// Used across all Freeupper pages
// ============================================================

(function() {
  'use strict';

  // ─── CONSTANTS ───────────────────────────────────────────────
  const USER_KEY = 'freeupper_user_profile';
  const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#E5E7EB"/><circle cx="50" cy="38" r="16" fill="#9CA3AF"/><ellipse cx="50" cy="75" rx="30" ry="22" fill="#9CA3AF"/></svg>'
  );

  // The early shared controller owns theme state; global utilities only render controls.
  function updateThemeButton() {
    const theme = window.getCurrentTheme();
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
      const svg = btn.querySelector('svg');
      if (svg) svg.innerHTML = theme === 'dark'
        ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
        : '<circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>';
    });
  }
  document.addEventListener('themeChanged', updateThemeButton);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateThemeButton);
  else updateThemeButton();

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
  // Default size is now 'sm' (small). Pass 'std' for the standard badge
  // or 'lg' for the large profile-page badge.
  window.getVerifiedBadgeHTML = function(verifiedStatus, size) {
    if (!verifiedStatus || verifiedStatus === 'none' || verifiedStatus === 'pending') return '';
    const sizeClass = size === 'lg' ? 'verified-badge-lg' :
                      size === 'std' ? 'verified-badge' :
                      'verified-badge-sm';
    const label = verifiedStatus === 'official' ? 'Official' :
                  verifiedStatus === 'staff' ? 'Staff' :
                  verifiedStatus === 'business' ? 'Business' : 'Verified';
    return `<span class="${sizeClass}" title="${label}"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>`;
  };

  // ─── UPDATE ALL VERIFIED BADGES IN A CONTAINER ──────────────
  // Scans all [data-author-badge-wrapper] elements and updates them
  window.updateVerifiedBadges = function(container) {
    if (!container) container = document.body;
    const wrappers = container.querySelectorAll('[data-author-badge-wrapper]');
    wrappers.forEach(wrapper => {
      const status = wrapper.dataset.verificationStatus || 'none';
      const size = wrapper.dataset.badgeSize || 'sm';
      wrapper.innerHTML = window.getVerifiedBadgeHTML(status, size);
      // Show/hide based on status
      if (status && status !== 'none' && status !== 'pending') {
        wrapper.style.display = 'inline-flex';
      } else {
        wrapper.style.display = 'none';
      }
    });
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
      // Verified badge wrapper
      const badgeWrapper = el.querySelector('[data-author-badge-wrapper]');
      if (badgeWrapper) {
        if (isVerified) {
          badgeWrapper.innerHTML = window.getVerifiedBadgeHTML(verifiedStatus, badgeWrapper.dataset.badgeSize || 'sm');
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

  // ─── MARKETPLACE HELPERS ─────────────────────────────────────

  /**
   * Format a number as Nigerian Naira (₦) with commas.
   * @param {number|string} amount - The amount to format.
   * @returns {string} Formatted currency string.
   */
  window.formatCurrency = function(amount) {
    if (amount == null) return '₦0';
    const num = Number(amount);
    if (isNaN(num)) return '₦0';
    return window.FreeUpperI18n ? window.FreeUpperI18n.number(num, {style:'currency',currency:'NGN'}) : '₦' + num.toLocaleString('en-US');
  };

  /**
   * Get a human-readable relative time (e.g., "2h", "3d").
   * @param {string|Date} date - The date to compare.
   * @returns {string} Relative time string.
   */
  window.timeAgo = function(date) {
    const now = new Date();
    const diff = now - new Date(date);
    if (diff < 0) return 'just now';
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd';
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return weeks + 'w';
    const months = Math.floor(days / 30);
    if (months < 12) return months + 'mo';
    const years = Math.floor(days / 365);
    return years + 'y';
  };

  /**
   * Generate skeleton loader HTML for a listing card.
   * @param {number} count - Number of skeleton cards to generate.
   * @returns {string} HTML string of skeleton cards.
   */
  window.getListingSkeletons = function(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div class="skeleton-card fade-in">
          <div class="skeleton skeleton-image"></div>
          <div class="skeleton skeleton-text w-75 mt-2"></div>
          <div class="skeleton skeleton-text w-50"></div>
          <div class="skeleton skeleton-text w-25 mt-1"></div>
        </div>
      `;
    }
    return html;
  };

  /**
   * Render a single listing card (for use in market tab or profile).
   * @param {Object} listing - Listing data from API.
   * @param {Object} options - { showSeller, showActions, onSave, onSelect }
   * @returns {string} HTML string.
   */
  window.renderListingCard = function(listing, options) {
    options = options || {};
    const cover = listing.images && listing.images.length > 0 ? listing.images[0].url : '';
    const price = window.formatCurrency(listing.price);
    const time = window.timeAgo(listing.created_at);
    const status = listing.status || 'active';
    const statusClass = status === 'active' ? 'active' :
                        status === 'sold' ? 'sold' :
                        status === 'archived' ? 'archived' : 'deleted';
    const seller = listing.profiles || {};
    const sellerName = seller.display_name || 'Anonymous';
    const sellerAvatar = seller.avatar_url || DEFAULT_AVATAR;
    const isVerified = seller.verified_status && seller.verified_status !== 'none' && seller.verified_status !== 'pending';
    const badgeHTML = isVerified ? window.getVerifiedBadgeHTML(seller.verified_status, 'sm') : '';

    const showSeller = options.showSeller !== false;
    const showActions = options.showActions !== false;

    let actionsHTML = '';
    if (showActions) {
      const isSaved = listing.saved || false;
      actionsHTML = `
        <button class="fav-btn ${isSaved ? 'saved' : ''}" data-listing-id="${listing.id}" onclick="event.stopPropagation();${options.onSave ? `window.${options.onSave}('${listing.id}')` : ''}">
          <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      `;
    }

    return `
      <div class="listing-card fade-in" data-listing-id="${listing.id}" onclick="${options.onSelect ? `window.${options.onSelect}('${listing.id}')` : ''}">
        <div class="relative">
          ${cover ? `<img class="cover-image" src="${cover}" alt="${listing.title}" loading="lazy" />` : `<div class="cover-image skeleton" style="aspect-ratio:16/9;"></div>`}
          ${actionsHTML}
        </div>
        <div class="title">${listing.title}</div>
        <div class="price">${price}</div>
        ${showSeller ? `
          <div class="seller">
            <img class="avatar" src="${sellerAvatar}" alt="" />
            <span class="name">${sellerName} ${badgeHTML}</span>
          </div>
        ` : ''}
        <div class="meta">
          <span class="status-badge ${statusClass}">${status}</span>
          <span>${listing.location || 'Campus'}</span>
          <span>${time}</span>
          ${listing.views_count ? `<span>${listing.views_count}</span>` : ''}
        </div>
      </div>
    `;
  };

  // ─── INIT ────────────────────────────────────────────────────
  function initGlobal() {
    updateNavAvatar();
    // Update all badges on the page
    window.updateVerifiedBadges(document.body);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobal);
  } else {
    initGlobal();
  }

  console.log('global.js loaded (full version with marketplace helpers)');
})();
