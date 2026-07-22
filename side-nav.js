/* ══════════════════════════════════════════
   <side-nav> — shared custom element (desktop rail)
   Drop <side-nav></side-nav> where the old
   <nav class="side-nav">...</nav> block was.

   Usage:
     <link rel="stylesheet" href="side-nav.css">
     ...
     <side-nav></side-nav>
     ...
     <script src="side-nav.js" defer></script>

   Optional: add a Chat link with unread badge (currently
   only video.html had this) by adding the attribute:
     <side-nav show-chat></side-nav>
══════════════════════════════════════════ */

(function () {
  'use strict';

  const BASE_ITEMS = [
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
    {
      key: 'chat',
      href: 'chat.html',
      label: 'Chat',
      svg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      optional: true,
      badge: true
    },
    {
      key: 'create',
      href: 'create.html',
      label: 'Create',
      svg: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>'
    },
    {
      key: 'video',
      href: 'video.html',
      label: 'Video',
      svg: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>'
    },
    { key: 'gap' },
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
    if (path.startsWith('chat')) return 'chat';
    if (path.startsWith('create')) return 'create';
    if (path.startsWith('video')) return 'video';
    if (path.startsWith('profile')) return 'profile';
    return ''; // settings.html etc -> no tab highlighted
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

  class SideNav extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      this.render();
      this.updateAvatar();

      document.addEventListener('profileUpdated', () => this.updateAvatar());
      window.addEventListener('storage', (e) => {
        if (e.key === 'freeupper_user_profile') this.updateAvatar();
      });
    }

    render() {
      const showChat = this.hasAttribute('show-chat');
      const activeKey = currentPageKey();

      const itemsHtml = BASE_ITEMS.map((item) => {
        if (item.key === 'gap') return '<div class="side-gap"></div>';
        if (item.optional && !showChat) return '';

        const isActive = item.key === activeKey;
        const badgeHtml = item.badge ? '<div class="side-badge"></div>' : '';

        if (item.isAvatar) {
          return `
            <a href="${item.href}" class="side-btn${isActive ? ' active' : ''}" data-side-key="${item.key}">
              <img class="side-av" data-side-avatar src="" alt=""
                   onerror="this.style.display='none'">
              <span>${item.label}</span>
            </a>`;
        }
        return `
          <a href="${item.href}" class="side-btn${isActive ? ' active' : ''}" data-side-key="${item.key}">
            <svg viewBox="0 0 24 24">${item.svg}</svg>
            <span>${item.label}</span>
            ${badgeHtml}
          </a>`;
      }).join('');

      this.innerHTML = `
        <nav class="side-nav">
          <div class="side-logo"><a href="index.html">◈</a></div>
          ${itemsHtml}
        </nav>`;
    }

    updateAvatar() {
      const user = getUser();
      const img = this.querySelector('[data-side-avatar]');
      if (img && user && user.avatar) img.src = user.avatar;
    }
  }

  customElements.define('side-nav', SideNav);
})();
