// One coordinator for authenticated tabs. Keep the legacy public name for the
// Profile integration; Router still owns post, profile and modal deep links.
(function () {
  'use strict';
  if (window.FreeUpperProfileShell) return;
  if (window.parent !== window) {
    try { window.FreeUpperProfileShell = window.parent.FreeUpperProfileShell; } catch (_) {}
    return;
  }
  const pages = {home:'index', search:'search', create:'create', video:'video', profile:'profile'};
  const path = location.pathname;
  const host = /^\/(?:@|u\/)/.test(path) ? 'profile' : Object.keys(pages).find(k => path.endsWith('/'+pages[k]+'.html')) || (path === '/' ? 'home' : 'root');
  // Settings/chat/detail documents keep their established native routing.
  // Entering a primary tab creates its shell rather than retaining a sixth page.
  if(host==='root')return;
  const baseURL = location.href;
  const frames = new Map(), screens = new Map(), snapshots = new Map(), rootState = new Map();
  const MAX_FRAMES = 3; // four retained tab documents including the launch page
  let active = host, desired = host, session = null, bound = null, authKnown = false;
  let resetting=false;
  let pendingKind = null, idle = null, expiry = null, generation = 0, prefetchedOwn = false;
  let status = null;
  const user = () => window.AuthUser?.getCurrentUser?.();
  const valid = () => !resetting && !!session && session.viewer === user()?.id && !!user()?.isLoggedIn && session.expiresAt > Date.now();
  const winFor = kind => kind === host ? window : frames.get(kind)?.contentWindow;
  const stateFor = kind => {
    if (!screens.has(kind)) screens.set(kind, {state:'Uninitialized', visits:0});
    return screens.get(kind);
  };
  stateFor(host).state = 'Active';stateFor(host).visits=1;
  function announce(kind) {
    document.querySelectorAll('bottom-nav').forEach(nav => nav.setActive?.(kind));
  }
  function message(text, failed = false) {
    if (!status) {
      status = document.createElement('div'); status.dataset.fuMounted = 'status';
      status.className = 'fu-navigation-status'; status.setAttribute('role','status');
      document.body.append(status);
    }
    status.textContent = text; status.hidden = !text;
    status.setAttribute('aria-live', failed ? 'assertive' : 'polite');
    document.querySelector('bottom-nav')?.setAttribute('aria-busy',String(!!text && !failed));
  }
  function pause(win) {
    try {
      win.FreeUpperScreen?.suspend();
      win.pauseAllVideos?.();
      win.document.querySelectorAll('video,audio').forEach(v => v.pause());
      win.VideoRender?.stopSoundPlayback?.();
    } catch (_) {}
  }
  function rootVisible(visible) {
    // The component may be nested in .layout. Move it once to the outer body,
    // retaining its node identity and all shared sizing/safe-area CSS.
    const nav = document.querySelector('bottom-nav');
    if (nav && nav.parentElement !== document.body) document.body.append(nav);
    nav?.setAttribute('data-fu-shell-nav','');
    document.documentElement.setAttribute('data-fu-shell','');
    for (const el of document.body.children) {
      if (el === nav || el.hasAttribute('data-fu-mounted') || /^(SCRIPT|STYLE|LINK)$/.test(el.tagName)) continue;
      if (!visible && !rootState.has(el)) rootState.set(el, {inert:el.inert, aria:el.getAttribute('aria-hidden'), visibility:el.style.visibility});
      if (!visible) { el.inert = true; el.setAttribute('aria-hidden','true'); el.style.visibility='hidden'; }
      else if (rootState.has(el)) {
        const old = rootState.get(el); el.inert=old.inert; el.style.visibility=old.visibility;
        if (old.aria === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden',old.aria);
        rootState.delete(el);
      }
    }
  }
  function frameVisible(frame, visible) {
    frame.style.visibility=visible?'visible':'hidden'; frame.style.pointerEvents=visible?'auto':'none';
    frame.inert=!visible; frame.setAttribute('aria-hidden',String(!visible));
  }
  function syncLayout(frame) {
    try{
      const nav=document.querySelector('bottom-nav .bottom-nav');
      const contentHeight=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-nav-height')) || 64;
      const inset=Math.max(0,(nav?.getBoundingClientRect().height || 0)-contentHeight)+'px';
      const root=frame.contentDocument?.documentElement;
      if(root && root.style.getPropertyValue('--bottom-safe-area')!==inset)root.style.setProperty('--bottom-safe-area',inset);
    }catch(_){}
  }
  function syncTheme(frame) {
    try { frame.contentWindow.applyTheme?.(document.documentElement.dataset.theme,false); } catch (_) {}
    syncLayout(frame);
  }
  function evict(kind) {
    const win=winFor(kind), entry=stateFor(kind);
    try {
      const data=win.FreeUpperScreen?.snapshot?.();
      if (data) {
        // No references to a detached Window/DOM, no disk or SW private cache.
        const copy=structuredClone(data);
        if (JSON.stringify(copy).length <= 2*1024*1024) snapshots.set(kind,{viewer:session.viewer, expiresAt:Math.min(session.expiresAt,Date.now()+60000), data:copy});
      }
      win.FreeUpperScreen?.dispose();
    } catch (_) { snapshots.delete(kind); }
    pause(win); frames.get(kind)?.remove(); frames.delete(kind);
    clearTimeout(entry.timeout); entry.state='Uninitialized'; entry.loaded=false;
  }
  const draftOverflow=()=>['search','video'].includes(host) && !!winFor('create')?.FreeUpperScreen?.isDirty?.();
  function makeRoom() {
    if (frames.size < MAX_FRAMES) return true;
    // Keep feed DOM, profile hydration and draft File objects. Drop an empty
    // composer first, then video buffers, then the Search snapshot.
    const candidates=['create','video','search'].filter(k => frames.has(k) && k!==active && k!==desired && !winFor(k)?.FreeUpperScreen?.isDirty?.());
    // A cold handoff may temporarily need one extra initializing document.
    // Keep the active pixels until ready, then evict its snapshot immediately.
    if (!candidates.length) {
      // A Search/Video launch document cannot itself be removed. Permit one
      // extra active screen rather than discard a draft or either retained feed.
      // The extra screen is evicted as soon as it becomes suspendable.
      if(frames.size===MAX_FRAMES && draftOverflow())return true;
      return ['video','search','create'].includes(active) && !winFor(active)?.FreeUpperScreen?.isDirty?.();
    }
    evict(candidates[0]); return true;
  }
  function ready(kind, win) {
    if (!valid() || win !== winFor(kind)) return;
    const entry=stateFor(kind); if(entry.loaded)return; entry.loaded=true; clearTimeout(entry.timeout);
    const frame=frames.get(kind); if (frame) { frame.dataset.loaded='true'; syncTheme(frame); }
    if (desired===kind) activate(kind); else { pause(win); entry.state='Suspended'; }
  }
  function makeFrame(kind) {
    if (frames.has(kind)) return frames.get(kind);
    if (!makeRoom()) return null;
    const frame=document.createElement('iframe');
    frame.dataset.fuMounted=kind; frame.title=kind[0].toUpperCase()+kind.slice(1);
    frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:19000;background:var(--bg);visibility:hidden;pointer-events:none';
    frame.allow='autoplay; fullscreen; encrypted-media; picture-in-picture';
    frameVisible(frame,false); frames.set(kind,frame);
    const entry=stateFor(kind); entry.state='Initializing'; entry.started=performance.now();
    frame.addEventListener('load',() => {
      if (frames.get(kind)!==frame || !valid()) return;
      syncTheme(frame);
      try {
        // The standalone HTML must really be this screen (auth redirects and
        // offline Home fallbacks must never masquerade as a ready destination).
        if (!frame.contentWindow.location.pathname.endsWith('/'+pages[kind]+'.html')) { fail(kind); return; }
        if (!frame.contentWindow.FreeUpperScreen || frame.contentWindow.FreeUpperScreen.isReady()) ready(kind,frame.contentWindow);

      } catch (_) { fail(kind); }
    });
    entry.timeout=setTimeout(() => fail(kind),20000);
    frame.src='/'+pages[kind]+'.html?fuMounted=1'; document.body.append(frame);
    return frame;
  }
  function fail(kind) {
    if (desired!==kind || !valid()) return;
    desired=active; announce(active); message('Unable to open this tab. Please try again.',true);
    if (kind!==active && frames.has(kind)) evict(kind);
    history.replaceState({...history.state,fuMountedView:{kind:active,viewer:session.viewer}},'',active===host?baseURL:'/'+pages[active]+'.html');
  }
  function activate(kind) {
    if (!valid() || desired!==kind) return;
    const win=winFor(kind), target=kind===host?null:frames.get(kind), entry=stateFor(kind);
    if (kind!==host && !entry.loaded) return;
    const profile=winFor('profile');
    if (active!==kind) {
      if (active==='profile') profile?.ProfileMounted?.beforeHide();
      pause(winFor(active)); stateFor(active).state='Suspended';
    }
    if (kind==='profile') profile?.ProfileMounted?.prepareVisible(session,{own:entry.own!==false,history:active==='profile'?'push':profile===window?'none':'replace'});
    rootVisible(!target);
    for (const [key,frame] of frames) frameVisible(frame,key===kind);
    active=kind;
    document.documentElement.removeAttribute('data-nav-overlay');
    const nav=document.querySelector('bottom-nav');if(nav)nav.inert=false;
    if(frames.size>MAX_FRAMES)makeRoom();
    entry.state=entry.visits?'Restored':'Active'; ++entry.visits;
    try { win.FreeUpperScreen?.resume(); } catch (_) {}
    announce(kind); message('');
    document.documentElement.toggleAttribute('data-nav-keyboard',!!win.document.documentElement.hasAttribute('data-nav-keyboard'));
    window.dispatchEvent(new CustomEvent('fu-tab-active',{detail:{kind,state:entry.state,mode:entry.wasWarm?'warm':'cold',ms:performance.now()-(entry.requestedAt || performance.now())}}));
  }
  function request(kind,push=true) {
    if (!Object.hasOwn(pages,kind) && kind!==host) return false;
    if (!valid()) { if (!authKnown && user()?.isLoggedIn) { pendingKind=kind; return true; } return false; }
    if (desired===kind && (active===kind || stateFor(kind).state==='Initializing')) {
      if(kind==='profile' && active===kind)winFor(kind)?.ProfileMounted?.prepareVisible(session,{own:push,history:'push'});
      return true;
    }
    desired=kind; stateFor(kind).own=push;
    stateFor(kind).requestedAt=performance.now();stateFor(kind).wasWarm=kind===host || !!stateFor(kind).loaded;
    announce(kind); // the persistent bar responds in the tap task
    if (push) {
      if (!history.state?.fuMountedView) history.replaceState({...history.state,fuMountedView:{kind:active,viewer:session.viewer}},'',location.href);
      history.pushState({fuMountedView:{kind,viewer:session.viewer}},'',kind===host?baseURL:'/'+pages[kind]+'.html');
    }
    const frame=kind===host?null:makeFrame(kind);
    if (kind!==host && !frame) { fail(kind); return true; }
    if (kind===host || stateFor(kind).loaded) activate(kind);
    else message('Opening '+kind+'…'); // current screen stays painted and usable
    return true;
  }
  function clear(resetRoot=false) {
    if(resetting)return;
    if(resetRoot && window.FreeUpperScreen)resetting=true;
    ++generation; pendingKind=null; prefetchedOwn=false;
    clearTimeout(idle); idle=null; clearTimeout(expiry); expiry=null;
    for (const [kind,frame] of frames) { clearTimeout(stateFor(kind).timeout); pause(frame.contentWindow); try{frame.contentWindow.FreeUpperScreen?.dispose();}catch(_){} frame.remove(); }
    frames.clear(); snapshots.clear(); screens.clear();
    if (host==='profile') window.ProfileMounted?.suspend();
    document.documentElement.removeAttribute('data-nav-overlay');
    const nav=document.querySelector('bottom-nav');if(nav)nav.inert=false;
    rootVisible(true); active=desired=host; stateFor(host).state='Active'; announce(host); message('');
    if (!resetRoot && history.state?.fuMountedView) history.replaceState({...history.state,fuMountedView:null},'',baseURL);
    // The launch page cannot be removed like a child. Reset its JS heap as
    // well as DOM on account boundaries; never reveal the previous user's feed.
    if (resetRoot && window.FreeUpperScreen) {
      window.FreeUpperScreen.dispose();
      for (const el of document.body.children) if (!/^(SCRIPT|STYLE|LINK|BOTTOM-NAV)$/.test(el.tagName)) el.remove();
      // Let queued auth callbacks finish before replacing their document.
      setTimeout(()=>location.replace(baseURL),0);
    }
  }
  function schedulePrefetch() {
    if (!valid() || frames.has('profile') || idle!==null || prefetchedOwn) return;
    if (host==='home' && !window.__fuInitialHydrated || host==='profile' && !window.__fuProfileHydrated) return;
    const version=generation;
    idle=setTimeout(() => {
      idle=null;
      if (version!==generation || !valid()) return;
      prefetchedOwn=true;
      if (host==='profile') window.ProfileMounted?.prefetchOwn(); else makeFrame('profile');
    },250);
  }
  function expireLease() {
    if(!valid()){clear(true);return;}
    expiry=setTimeout(expireLease,Math.min(2147483647,Math.max(1,Math.ceil(session.expiresAt-Date.now()))));
  }
  function accept(next) {
    if(resetting)return;
    authKnown=true;
    const nextSession=next?.user?.id && Number.isFinite(next.expires_at)?{viewer:next.user.id,expiresAt:next.expires_at*1000}:null;
    const boundary=!!session && (session.viewer!==nextSession?.viewer || nextSession.expiresAt<=Date.now());
    if (boundary) clear(true);
    session=nextSession; clearTimeout(expiry);
    if (!valid()) { if (frames.size) clear(true); return; }
    expiry=setTimeout(expireLease,Math.min(2147483647,Math.max(1,Math.ceil(session.expiresAt-Date.now()))));
    rootVisible(active===host);
    if (host==='profile' && !window.__freeupperProfileLoading && !window.ProfileMounted?.status().loaded) window.ProfileMounted?.prepareVisible(session,{own:false});
    schedulePrefetch();
    if (pendingKind) { const next=pendingKind; pendingKind=null; request(next); }
  }
  async function bind() {
    if(resetting)return;
    const sb=window.sb; if (!sb?.auth?.getSession) return;
    if (bound!==sb) { bound=sb; sb.auth.onAuthStateChange((_event,next) => queueMicrotask(() => accept(next))); }
    try { const result=await sb.auth.getSession(); if (bound===sb) accept(result.data?.session); } catch (_) { if (!valid()) clear(true); }
  }
  window.FreeUpperProfileShell={
    request, clear, ready,
    setOverlay(win,covered){
      if(!valid() || win!==winFor(active))return;
      document.documentElement.toggleAttribute('data-nav-overlay',!!covered);
      const nav=document.querySelector('bottom-nav');if(nav)nav.inert=!!covered;
    },
    profileReady(win) {
      if (!valid() || win!==winFor('profile')) return;
      if (desired==='profile') win.ProfileMounted?.prepareVisible(session,{own:false});
    },
    takeSnapshot(kind) {
      const entry=snapshots.get(kind); snapshots.delete(kind);
      if(!valid() || entry?.viewer!==session.viewer)return null;
      return entry.expiresAt>Date.now()?entry.data:{controls:entry.data.controls,...(kind==='video'?entry.data:{})};
    },
    getSession:() => valid()?{...session}:null,
    getActive:() => active,
    status:() => ({active,desired,documents:frames.size+1,limit:MAX_FRAMES+1+(draftOverflow()?1:0),snapshots:snapshots.size,screens:Object.fromEntries([...screens].map(([k,v])=>[k,v.state]))})
  };
  window.addEventListener('popstate',e => {
    const state=e.state?.fuMountedView;
    if (!state) return; // Profile/modal/detail keeps its native history
    if (!valid() || state.viewer!==session.viewer) { e.stopImmediatePropagation(); clear(true); return; }
    // A Profile relationship/modal entry may also carry a shell marker.
    // Let the existing Profile listener restore it when already on that screen.
    if (state.kind===active && desired===active) return;
    e.stopImmediatePropagation(); request(state.kind,false);
  },true);
  window.addEventListener('pageshow',event=>{
    if(event.persisted && window.FreeUpperScreen?.isDisposed()){location.replace(baseURL);return;}
    if(session && !valid())clear(true);else bind();
  });
  document.addEventListener('themeChanged',() => { for (const frame of frames.values()) syncTheme(frame); });
  const resize=()=>{for(const frame of frames.values())syncLayout(frame);};
  window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
  window.addEventListener('fu-app-hydrated',schedulePrefetch);
  window.addEventListener('fu-profile-view-ready',schedulePrefetch);
  document.addEventListener('profileUpdated',bind); document.addEventListener('userRefreshed',bind);
  window.addEventListener('storage',e => { if (e.key==='freeupper_user_profile' || /auth-token/.test(e.key||'')) { if (!valid()) clear(true); bind(); } });
  document.addEventListener('visibilitychange',() => { if (!valid() && session) clear(true); });
  window.AuthUser?.onChange?.(() => { if (!valid() && session) clear(true); bind(); });
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true}); else bind();
})();
