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
      href: '/index.html',
      label: 'Home',
      svg: '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1"/>'
    },
    {
      key: 'search',
      href: '/search.html',
      label: 'Search',
      svg: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
    },
    { key: 'create', isCreateButton: true, href: '/create.html' },
    {
      key: 'video',
      href: '/video.html',
      label: 'Video',
      svg: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>'
    },
    {
      key: 'profile',
      href: '/profile.html',
      label: 'Profile',
      isAvatar: true
    }
  ];

  function currentPageKey() {
    const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (/^\/(?:@|u\/)/.test(location.pathname)) return 'profile';
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

  let shellLoading=null;
  function loadProfileShell() {
    if(window.FreeUpperProfileShell)return Promise.resolve(window.FreeUpperProfileShell);
    if(!shellLoading)shellLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='/profile-shell.js?v=five-tabs-v2';
      script.onload=()=>resolve(window.FreeUpperProfileShell);script.onerror=()=>{shellLoading=null;reject(new Error('Profile navigation unavailable'));};
      document.head.appendChild(script);
    });
    return shellLoading;
  }

  class BottomNav extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      this._badges = {};
      const markLeaving = () => { this._leaving = true; setTimeout(() => { this._leaving = false; }, 400); };
      this._markLeaving = markLeaving;
      const childScreen=document.documentElement.hasAttribute('data-fu-screen-child');
      if(!childScreen)this.render();
      this.updateAvatar();
      // Visual viewport shrinks for an iOS keyboard even when 100dvh does not.
      const viewport = window.visualViewport;
      const syncViewport = () => {
        if (!viewport) return;
        let owner=window, tab=window, root=window;
        try {
          if(window.parent!==window && window.parent.FreeUpperProfileShell){
            if(!childScreen || window.parent.FreeUpperProfileShell.getActive()!==window.FreeUpperScreen?.kind)return;
            root=window.parent;
          }else if(window.FreeUpperProfileShell && window.FreeUpperScreen && window.FreeUpperProfileShell.getActive()!==window.FreeUpperScreen.kind){
            tab=document.querySelector('iframe[data-fu-mounted="'+window.FreeUpperProfileShell.getActive()+'"]')?.contentWindow || window;
            owner=tab;
          }
          // Focus events do not bubble out of a retained document or a Profile
          // detail renderer. Use the active leaf and the outer visual viewport.
          while(owner.document.activeElement?.tagName==='IFRAME')owner=owner.document.activeElement.contentWindow;
          const height=Math.min(viewport.height,root.visualViewport?.height || Infinity,owner.visualViewport?.height || Infinity);
          const typing=owner.document.activeElement?.matches('input, textarea, [contenteditable="true"]');
          const keyboard=!!typing && Math.max(root.innerHeight,tab.innerHeight)-height>100;
          for(const doc of new Set([document,root.document,tab.document,owner.document])){
            doc.documentElement.toggleAttribute('data-nav-keyboard',keyboard);
            if(keyboard)doc.documentElement.style.setProperty('--visual-viewport-height',height+'px');
            else doc.documentElement.style.removeProperty('--visual-viewport-height');
          }
        }catch(_){}
      };
      viewport?.addEventListener('resize', syncViewport);
      document.addEventListener('focusin', syncViewport);
      document.addEventListener('focusout', () => requestAnimationFrame(syncViewport));
      window.addEventListener('pageshow', () => { this._leaving = false; syncViewport(); });
      if(childScreen){this.remove();return;}
      try{if(window.parent!==window && window.parent.FreeUpperProfileShell)window.FreeUpperProfileShell=window.parent.FreeUpperProfileShell;}catch(_){}
      // Native anchors remain the fallback for guests, modified clicks, and
      // environments without authenticated session support.
      this.addEventListener('click',event=>{
        const link=event.target.closest('[data-nav-key]');
        const key=link?.dataset.navKey;
        if (!link || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (key === currentPageKey() && !window.FreeUpperProfileShell) { event.preventDefault(); return; }
        if (this._leaving) { event.preventDefault(); return; }
        if(!getUser()?.isLoggedIn || !window.sb?.auth?.getSession){markLeaving();if(key==='create'){event.preventDefault();window.location.href='/create.html';}return;}
        const shell=window.FreeUpperProfileShell;
        if(shell?.request(key)){event.preventDefault();return;}
        if(shell && key==='create'){event.preventDefault();window.location.href='/create.html';return;}
        if(!shell){
          event.preventDefault();
          if (this._shellPending) return;
          this._shellPending = true;
          loadProfileShell().then(next=>{if(!next?.request(key))window.location.href=link.href || '/create.html';}).catch(()=>{window.location.href=link.href || '/create.html';}).finally(()=>{this._shellPending=false;});
        }
      });
      const start=()=>{if(getUser()?.isLoggedIn && window.sb?.auth?.getSession)loadProfileShell().catch(()=>{});};
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
      document.addEventListener('profileUpdated',start);
      window.AuthUser?.onChange?.(start);

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
            <button class="add-post-btn" aria-label="Create" data-nav-create data-nav-key="create"${activeKey === 'create' ? ' aria-current="page"' : ''}>
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>`;
        }
        const isActive = item.key === activeKey;
        if (item.isAvatar) {
          return `
            <a href="${item.href}" class="nav-item${isActive ? ' active' : ''}" data-nav-key="${item.key}"${isActive ? ' aria-current="page"' : ''}>
              <img class="nav-av" data-nav-avatar src="" alt=""
                   onerror="this.style.background='linear-gradient(135deg,#1a1035,#3b1a6b)'">
              <span data-i18n="${item.label}">${item.label}</span>
            </a>`;
        }
        return `
          <a href="${item.href}" class="nav-item${isActive ? ' active' : ''}" data-nav-key="${item.key}"${isActive ? ' aria-current="page"' : ''}>
            <svg viewBox="0 0 24 24">${item.svg}</svg>
            <span data-i18n="${item.label}">${item.label}</span>
          </a>`;
      }).join('');

      this.innerHTML = `<nav class="bottom-nav">${itemsHtml}</nav>`;

    }

    setActive(key) {
      this.querySelectorAll('[data-nav-key]').forEach(item => {
        const active = item.dataset.navKey === key;
        item.classList.toggle('active', active);
        if (active) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
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
