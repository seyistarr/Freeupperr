// Per-document lifecycle, loaded before page code. No navigation/history owner.
(function () {
  'use strict';
  if (window.FreeUpperScreen) return;
  const path=location.pathname;
  const kind=/^\/(?:@|u\/)/.test(path)?'profile':({index:'home',search:'search',create:'create',video:'video',profile:'profile'})[path.split('/').pop()?.replace('.html','')] || 'home';
  let shell=null;
  try { if (parent!==window && parent.FreeUpperProfileShell) shell=parent.FreeUpperProfileShell; } catch (_) {}
  const mounted=!!shell && !!window.frameElement?.hasAttribute('data-fu-mounted');
  if (mounted) { document.documentElement.setAttribute('data-fu-screen-child','');window.FreeUpperProfileShell=shell; }
  const owned=!mounted && parent!==window && !!parent.FreeUpperScreen;
  let active=!mounted && (!owned || parent.FreeUpperScreen.isActive() && window.frameElement.getClientRects().length>0 && parent.getComputedStyle(window.frameElement).visibility!=='hidden');
  let initialized=false, disposed=false, scroll=null;
  const hooks=new Set(), observers=new Set(), realtime=new Map();
  let initialSnapshot=mounted?shell.takeSnapshot(kind):null;
  const NativeObserver=window.IntersectionObserver;
  if (NativeObserver) {
    // Each page still owns disconnect/unobserve. Hidden screens cannot keep
    // paging or restart autoplay because iframe visibilityState stays visible.
    window.IntersectionObserver=class ScreenObserver extends NativeObserver {
      constructor(callback,options) {
        super((entries,observer) => { if (active && !document.hidden) callback(entries,observer); },options);
        this.targets=new Set();
      }
      observe(target) { this.targets.add(target); observers.add(this); if (active && !document.hidden) super.observe(target); }
      unobserve(target) { this.targets.delete(target); super.unobserve(target); if (!this.targets.size) observers.delete(this); }
      disconnect() { super.disconnect(); this.targets.clear(); observers.delete(this); }
      suspend() { super.disconnect(); }
      resume() { for (const target of this.targets) if (target.isConnected) super.observe(target); }
    };
  }
  function descendants(method) {
    for(const frame of document.querySelectorAll('iframe:not([data-fu-mounted])')){
      if(method==='resume' && (!frame.getClientRects().length || getComputedStyle(frame).visibility==='hidden'))continue;
      try{frame.contentWindow.FreeUpperScreen?.[method]?.();}catch(_){}
    }
  }
  function stopMedia() {
    document.querySelectorAll('video,audio').forEach(el => { el.pause(); });
    window.VideoRender?.stopSoundPlayback?.();
    document.querySelectorAll('iframe').forEach(frame => {
      if (/youtube(?:-nocookie)?\.com\/embed\//.test(frame.src)) frame.contentWindow?.postMessage(JSON.stringify({event:'command',func:'pauseVideo',args:[]}),'*');
    });
  }
  function saveScroll() {
    scroll={x:window.scrollX,y:window.scrollY,owners:[...document.querySelectorAll('#mainScroll,#feedTrack')].map(el=>({id:el.id,x:el.scrollLeft,y:el.scrollTop}))};
  }
  function restoreScroll() {
    if (!scroll) return;
    window.scrollTo({left:scroll.x,top:scroll.y,behavior:'instant'});
    for (const saved of scroll.owners) document.getElementById(saved.id)?.scrollTo({left:saved.x,top:saved.y,behavior:'instant'});
  }
  function call(name) { for (const hook of hooks) { try { hook[name]?.(); } catch (error) { console.warn('Screen '+name+' failed',error); } } }
  function suspend() {
    if (active) saveScroll();
    active=false; document.documentElement.setAttribute('data-fu-screen-suspended','');
    for (const observer of observers) observer.suspend();
    call('suspend'); stopMedia();descendants('suspend');
  }
  function resume() {
    if (disposed) return;
    const wasActive=active;
    active=true; document.documentElement.removeAttribute('data-fu-screen-suspended');
    restoreScroll();
    if (!wasActive && !document.hidden) { call('resume'); for (const observer of observers) observer.resume();descendants('resume'); }
  }
  function ready() {
    initialized=true;
    if (mounted) shell.ready(kind,window);
    window.dispatchEvent(new CustomEvent('fu-screen-ready',{detail:{kind}}));
  }
  function register(hook) {
    hooks.add(hook);
    if (!active) hook.suspend?.();
    return () => hooks.delete(hook);
  }
  function trackRealtime(key,factory) {
    if (realtime.has(key)) return;
    const entry={channels:[],stopping:Promise.resolve(),version:0}; realtime.set(key,entry);
    const start=() => {
      if(entry.running)return;
      const version=++entry.version;
      entry.stopping.then(() => {
        if (!active || disposed || version!==entry.version) return;
        const before=new Set(window.sb?.getChannels?.() || []);
        entry.running=true; factory(); entry.channels=(window.sb?.getChannels?.() || []).filter(ch=>!before.has(ch));
      });
    };
    const stop=() => {
      ++entry.version; entry.running=false;
      const channels=entry.channels.splice(0);
      entry.stopping=Promise.allSettled([entry.stopping,...channels.map(ch=>window.sb.removeChannel(ch))]).then(()=>{});
    };
    register({suspend:stop,resume:start,dispose:stop});
    if (active) start();
  }
  window.FreeUpperScreen={
    kind, ready, navigationWindow:mounted?window.parent:window, isDisposed:()=>disposed, isReady:()=>initialized, isActive:()=>active && !document.hidden,
    register, realtime:trackRealtime, suspend, resume,
    takeSnapshot() { const data=initialSnapshot; initialSnapshot=null; return data; },
    snapshot() { for (const hook of hooks) { const data=hook.snapshot?.(); if (data) return data; } return null; },
    isDirty:() => [...hooks].some(hook=>hook.isDirty?.()),
    dispose() { disposed=true; suspend();descendants('dispose');call('dispose'); initialSnapshot=null; hooks.clear(); observers.clear(); }
  };
  window.addEventListener('message',event=>{
    if(active && !document.hidden)return;
    let data;try{data=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch(_){return;}
    if(data?.event!=='infoDelivery')return;
    for(const frame of document.querySelectorAll('iframe')){
      if(frame.contentWindow===event.source && /youtube(?:-nocookie)?\.com\/embed\//.test(frame.src)){
        frame.contentWindow.postMessage(JSON.stringify({event:'command',func:'pauseVideo',args:[]}),'*');
      }
    }
  });
  // Guard late async autoplay after a screen has been suspended.
  document.addEventListener('play',event => { if (!active || document.hidden) event.target.pause?.(); },true);
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) { for (const observer of observers) observer.suspend(); call('suspend'); stopMedia();descendants('suspend'); }
    else if (active) { call('resume'); for (const observer of observers) observer.resume();descendants('resume'); }
  });
  window.addEventListener('fu-app-hydrated',ready);
  window.addEventListener('fu-profile-view-ready',ready);
  document.addEventListener('DOMContentLoaded',() => {
    if (kind==='create') ready();
    if (mounted && !active) suspend();
  },{once:true});
})();
