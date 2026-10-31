// Retain at most one Home and one Profile document. No user data is persisted
// here or sent to a public cache; the Profile owns its viewer-scoped memory.
(function () {
  'use strict';
  if (window.FreeUpperProfileShell) return;
  if (window.parent !== window) {
    try { if (window.parent.FreeUpperProfileShell) window.FreeUpperProfileShell = window.parent.FreeUpperProfileShell; } catch (_) {}
    return;
  }
  const path = location.pathname;
  const host = /(?:\/profile\.html$|^\/@|^\/u\/)/.test(path) ? 'profile' : /(?:^\/$|\/index\.html$)/.test(path) ? 'home' : 'root';
  const baseURL = location.href;
  const frames = new Map();
  let active = host, session = null, bound = null, epoch = 0, idle = null, authKnown = false, pendingKind = null, prefetchedOwn = false;
  const rootState = new Map();
  const user = () => window.AuthUser?.getCurrentUser?.();
  const valid = () => !!session && session.viewer === user()?.id && !!user()?.isLoggedIn && session.expiresAt > Date.now();
  function pause(win) {
    try { win.pauseAllVideos?.(); win.document.querySelectorAll('video').forEach(v => v.pause()); } catch (_) {}
  }
  function rootVisible(visible) {
    for (const el of document.body.children) {
      if (el.hasAttribute('data-fu-mounted') || /^(SCRIPT|STYLE|LINK)$/.test(el.tagName)) continue;
      if (!visible && !rootState.has(el)) rootState.set(el, {inert: el.inert, aria: el.getAttribute('aria-hidden')});
      if (!visible) { el.inert = true; el.setAttribute('aria-hidden', 'true'); }
      else if (rootState.has(el)) { const old = rootState.get(el); el.inert = old.inert; if (old.aria === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', old.aria); rootState.delete(el); }
    }
  }
  function frameVisible(frame, visible) {
    frame.style.visibility = visible ? 'visible' : 'hidden';
    frame.style.pointerEvents = visible ? 'auto' : 'none';
    frame.inert = !visible; frame.setAttribute('aria-hidden', String(!visible));
  }
  function profileWindow() { return host === 'profile' ? window : frames.get('profile')?.contentWindow; }
  function syncTheme(frame) {
    try { frame.contentWindow.applyTheme?.(document.documentElement.dataset.theme); } catch (_) {}
  }
  function makeFrame(kind) {
    if (frames.has(kind)) return frames.get(kind);
    const frame = document.createElement('iframe');
    frame.dataset.fuMounted = kind; frame.title = kind === 'profile' ? 'Profile' : 'Home';
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:19000;background:var(--bg);visibility:hidden;pointer-events:none';
    frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
    frameVisible(frame, false); frames.set(kind, frame);
    frame.addEventListener('load', () => {
      if (frames.get(kind) !== frame || !valid()) return;
      frame.dataset.loaded='true';syncTheme(frame);
      try{if (active === kind && kind === 'profile') frame.contentWindow.ProfileMounted?.prepareVisible(session);}catch(_){}
    });
    frame.src = '/' + (kind === 'profile' ? 'profile.html' : 'index.html') + '?fuMounted=1';
    document.body.appendChild(frame);
    return frame;
  }
  function clear() {
    ++epoch; pendingKind=null;prefetchedOwn=false; if (idle !== null) { clearTimeout(idle); idle = null; }
    for (const frame of frames.values()) { pause(frame.contentWindow); frame.remove(); }
    frames.clear();
    if (host === 'profile') window.ProfileMounted?.suspend();
    rootVisible(true); active = host;
    const state = history.state;
    if (state?.fuMountedView) history.replaceState({...state, fuMountedView: null}, '', baseURL);
  }
  function request(kind, push = true) {
    if (!['home', 'profile', 'root'].includes(kind)) return false;
    if(!valid()){if(!authKnown && user()?.isLoggedIn){pendingKind=kind;return true;}return false;}
    const target = kind === host ? null : makeFrame(kind);
    if(target?.dataset.loaded==='true'){
      try{const current=target.contentWindow.location.pathname;const expected=kind==='profile'?/\/profile\.html$|^\/@|^\/u\//:/^\/$|\/index\.html$/;if(!expected.test(current)){target.dataset.loaded='false';target.src='/' +(kind==='profile'?'profile.html':'index.html')+'?fuMounted=1';}}catch(_){target.dataset.loaded='false';target.src='/'+(kind==='profile'?'profile.html':'index.html')+'?fuMounted=1';}
    }
    const profile = profileWindow();
    try{if (kind === 'profile') profile?.ProfileMounted?.prepareVisible(session,{own:push,history:active==='profile'?'push':profile===window?'none':'replace'});}catch(_){}
    if (active === kind) return true; // repeated taps never reload or add history
    if (active === 'profile') profile?.ProfileMounted?.beforeHide();
    pause(active === host ? window : frames.get(active)?.contentWindow);
    if (push) {
      if (!history.state?.fuMountedView) history.replaceState({...history.state, fuMountedView: {kind: active, viewer: session.viewer}}, '', location.href);
      const url = kind === 'root' ? baseURL : kind === 'profile' ? '/profile.html' : '/index.html';
      history.pushState({fuMountedView: {kind, viewer: session.viewer}}, '', url);
    }
    active = kind;
    rootVisible(!target);
    for (const [key, frame] of frames) frameVisible(frame, key === kind);
    if (target) syncTheme(target);
    return true;
  }
  function schedulePrefetch() {
    if (!valid() || frames.has('profile') || idle !== null || prefetchedOwn) return;
    if(host==='home' && !window.__fuInitialHydrated)return;
    if(host==='profile' && !window.__fuProfileHydrated)return;
    const version = epoch;
    // Wait until the initial document has painted. Prefetch one bounded page,
    // never the feed renderer or foreign collections, and never poll.
    requestAnimationFrame(() => {
      idle = setTimeout(() => { idle = null; if (version === epoch && valid()){prefetchedOwn=true;if(host==='profile')window.ProfileMounted?.prefetchOwn();else makeFrame('profile');} }, 250);
    });
  }
  function accept(next) {
    authKnown=true;
    const nextSession = next?.user?.id && Number.isFinite(next.expires_at) ? {viewer: next.user.id, expiresAt: next.expires_at * 1000} : null;
    if (session && session.viewer !== nextSession?.viewer) clear();
    session = nextSession;
    if (!valid()) { if (frames.size) clear(); return; }
    if(host==='profile' && !window.__freeupperProfileLoading && !window.ProfileMounted?.status().loaded)window.ProfileMounted?.prepareVisible(session,{own:false});
    schedulePrefetch();
    if(pendingKind){const next=pendingKind;pendingKind=null;request(next);}
  }
  async function bind() {
    const sb = window.sb;
    if (!sb?.auth?.getSession) return;
    if (bound !== sb) {
      bound = sb;
      sb.auth.onAuthStateChange((_event, next) => { queueMicrotask(() => accept(next)); });
    }
    try { const result = await sb.auth.getSession(); if (bound === sb) accept(result.data?.session); } catch (_) { if (!valid()) clear(); }
  }
  window.FreeUpperProfileShell = {
    request,
    profileReady(win) {
      if (!valid() || (win !== window && win !== frames.get('profile')?.contentWindow)) return;
      if (active === 'profile') win.ProfileMounted?.prepareVisible(session,{own:false});
    },
    getSession: () => valid() ? {...session} : null,
    getActive: () => active,
    clear
  };
  // Own shell history only. Profile/modal/detail history inside the retained
  // Profile uses its existing native history and router handlers unchanged.
  window.addEventListener('popstate', e => {
    const state = e.state?.fuMountedView;
    if (!state) return;
    e.stopImmediatePropagation();
    if (!valid() || state.viewer !== session.viewer) { clear(); return; }
    request(state.kind, false);
  }, true);
  document.addEventListener('themeChanged', () => { for (const frame of frames.values()) syncTheme(frame); });
  window.addEventListener('fu-app-hydrated',schedulePrefetch);
  window.addEventListener('fu-profile-view-ready',schedulePrefetch);
  document.addEventListener('profileUpdated', bind);
  document.addEventListener('userRefreshed', bind);
  window.addEventListener('storage', e => {
    if (e.key === 'freeupper_user_profile' || /auth-token/.test(e.key || '')) {
      if (!valid()) clear(); bind();
    }
  });
  window.AuthUser?.onChange?.(() => { if (!valid()) clear(); bind(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once: true}); else bind();
})();
