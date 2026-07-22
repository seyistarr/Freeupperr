/* ══════════════════════════════════════════
   <bottom-nav> — shared custom element
   Drop <bottom-nav></bottom-nav> where the old
   <nav class="bottom-nav">...</nav> block was.

   Usage:
     <link rel="stylesheet" href="bottom-nav.css">
     ...
     <bottom-nav></bottom-nav>
     ...
     <script src="bottom-nav.js" defer></script>

   Notes:
   - Reads active tab from location.pathname.
   - Reads avatar from window.getCurrentUser() (global.js),
     falls back gracefully if not loaded yet.
   - Re-syncs avatar on 'profileUpdated' event, same event
     your pages already dispatch after saves.
   - Has a public badge API: bottom-nav.setBadge('search', true)
     if you ever want unread dots on other tabs (video/chat).
══════════════════════════════════════════ */

(function () {
  'use strict';

  const NAV_ITEMS = [
    {
      key: 'home',
      href: 'index.html',
      label: 'Home',
      svg: '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1"/>'
    },
    {
      key: 'search',
      href: 'search.html',
      label: 'Search',
      svg: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
    },
    { key: 'create', isCreateButton: true, href: 'create.html' },
    {
      key: 'video',
      href: 'video.html',
      label: 'Video',
      svg: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>'
    },
    {
      key: 'profile',
      href: 'profile.html',
      label: 'Profile',
      isAvatar: true
    }
  ];

  function currentPageKey() {
    const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (path === '' || path === 'index.html') return 'home';
    if (path.startsWith('search')) return 'search';
    if (path.startsWith('create')) return 'create';
    if (path.startsWith('video')) return 'video';
    if (path.startsWith('profile')) return 'profile';
    return ''; // settings.html, chat.html, etc. -> no tab highlighted
  }

  function getUser() {
    try {
      if (window.AuthUser && typeof window.AuthUser.getCurrentUser === 'function') {
        return window.AuthUser.getCurrentUser();
      }
      if (typeof window.getCurrentUser === 'function') {
        return window.getCurrentUser();
      }
    } catch (e) {}
    return { avatar: '' };
  }

  class BottomNav extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      this._badges = {};
      this.render();
      this.updateAvatar();

      // Keep avatar in sync when profile/theme changes elsewhere on the page
      document.addEventListener('profileUpdated', () => this.updateAvatar());
      window.addEventListener('storage', (e) => {
        if (e.key === 'freeupper_user_profile') this.updateAvatar();
      });
    }

    render() {
      const activeKey = currentPageKey();

      const itemsHtml = NAV_ITEMS.map((item) => {
        if (item.isCreateButton) {
          return `
            <button class="add-post-btn" aria-label="Create" data-nav-create>
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>`;
        }
        const isActive = item.key === activeKey;
        if (item.isAvatar) {
          return `
            <a href="${item.href}" class="nav-item${isActive ? ' active' : ''}" data-nav-key="${item.key}">
              <img class="nav-av" data-nav-avatar src="" alt=""
                   onerror="this.style.background='linear-gradient(135deg,#1a1035,#3b1a6b)'">
              <span>${item.label}</span>
            </a>`;
        }
        return `
          <a href="${item.href}" class="nav-item${isActive ? ' active' : ''}" data-nav-key="${item.key}">
            <svg viewBox="0 0 24 24">${item.svg}</svg>
            <span>${item.label}</span>
          </a>`;
      }).join('');

      this.innerHTML = `<nav class="bottom-nav">${itemsHtml}</nav>`;

      const createBtn = this.querySelector('[data-nav-create]');
      if (createBtn) {
        createBtn.addEventListener('click', () => { window.location.href = 'create.html'; });
      }
    }

    updateAvatar() {
      const user = getUser();
      const img = this.querySelector('[data-nav-avatar]');
      if (img && user && user.avatar) img.src = user.avatar;
    }

    // Optional: bottomNavEl.setBadge('search', true)
    setBadge(key, on) {
      const item = this.querySelector(`[data-nav-key="${key}"]`);
      if (!item) return;
      let dot = item.querySelector('.nav-badge');
      if (on && !dot) {
        dot = document.createElement('div');
        dot.className = 'nav-badge';
        item.appendChild(dot);
      } else if (!on && dot) {
        dot.remove();
      }
    }
  }

  customElements.define('bottom-nav', BottomNav);
})();
