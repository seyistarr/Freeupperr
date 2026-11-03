// Shared by classic browser scripts, service workers and the web Worker.
// Document names remain stable identities for existing page event listeners.
(function (root) {
  'use strict';
  const pages = Object.freeze({
    home: Object.freeze({ path: '/home', document: '/index.html' }),
    search: Object.freeze({ path: '/search', document: '/search.html' }),
    create: Object.freeze({ path: '/create', document: '/create.html' }),
    video: Object.freeze({ path: '/videos', document: '/video.html' }),
    profile: Object.freeze({ path: '/profile', document: '/profile.html' }),
    messages: Object.freeze({ path: '/messages', document: '/chat.html' }),
    settings: Object.freeze({ path: '/settings', document: '/settings.html' }),
    notifications: Object.freeze({ path: '/notifications', document: '/notification.html' })
  });
  function key(path) {
    if (path === '/') return 'home';
    return Object.keys(pages).find(name => pages[name].path === path || pages[name].document === path) || null;
  }
  function screen(path) {
    return /^\/(?:@[^/]+|u\/[^/]+)\/?$/.test(path) ? 'profile' : key(path);
  }
  function documentPath(path) { return pages[key(path)]?.document || null; }
  function href(value) {
    // Only exact local page aliases are migrated. Preserve query/hash bytes,
    // public identities, external URLs and unknown routes without interpreting them.
    const match = String(value).match(/^([^?#]*)([\s\S]*)$/);
    const path = match[1].startsWith('/') ? match[1] : '/' + match[1];
    const name = key(path);
    return name ? (path === '/' ? '/' : pages[name].path) + match[2] : value;
  }
  root.FreeUpperRoutes = Object.freeze({ pages, key, screen, documentPath, href });
})(globalThis);
