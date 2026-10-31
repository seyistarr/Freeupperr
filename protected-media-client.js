// Ephemeral authenticated media only: never persist blobs, JWTs, or signed URLs.
(function () {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const LIMIT = 50 * 1024 * 1024;
  const urls = new Set();
  const loaded = new Set();
  const observed = new Set();
  let generation = 0;
  let controller = new AbortController();
  let active = 0;
  const queue = [];
  async function bounded(task) {
    if (active >= 3) await new Promise(resolve => queue.push(resolve));
    else active++;
    try { return await task(); }
    finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  }
  function release(url) {
    if (urls.delete(url)) URL.revokeObjectURL(url);
  }
  function clear() {
    generation++;
    controller.abort();
    controller = new AbortController();
    document.querySelectorAll('video, img, source').forEach(el => {
      if (urls.has(el.src)) {
        if (el.tagName === 'VIDEO') el.pause();
        el.removeAttribute('src');
        if (el.tagName === 'VIDEO') el.load();
      }
      if (urls.has(el.poster)) el.removeAttribute('poster');
    });
    for (const url of [...urls]) release(url);
    loaded.clear();
    document.querySelectorAll('[data-protected-asset]').forEach(node => {
      delete node.dataset.protectedState;
      node.replaceChildren(document.createTextNode('Protected media'));
    });
  }
  async function asset(id, kind) {
    if (!UUID.test(id || '') || !['image', 'video'].includes(kind)) throw Error('Invalid protected media');
    const expectedGeneration = generation;
    const signal = controller.signal;
    return bounded(async () => {
      if (signal.aborted || expectedGeneration !== generation) throw Error('Session changed');
      const { data, error } = await window.sb.auth.getSession();
      const token = !error && data?.session?.access_token;
      if (!token || signal.aborted || expectedGeneration !== generation) throw Error('Sign in to view protected media');
      const response = await fetch('/api/post-media?asset_id=' + encodeURIComponent(id), {
        headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
        credentials: 'same-origin', redirect: 'error', signal
      });
      if (response.status !== 200 || !response.body ||
          !(response.headers.get('Content-Type') || '').startsWith(kind + '/')) {
        await response.body?.cancel();
        throw Error('Protected media unavailable');
      }
      const length = response.headers.get('Content-Length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > LIMIT)) {
        await response.body.cancel();
        throw Error('Media too large');
      }
      // Enforce the size limit while reading, even without Content-Length.
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > LIMIT || signal.aborted || expectedGeneration !== generation) throw Error('Media unavailable');
          chunks.push(value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      if (!size || signal.aborted || expectedGeneration !== generation) throw Error('Media unavailable');
      const url = URL.createObjectURL(new Blob(chunks, { type: response.headers.get('Content-Type') }));
      urls.add(url);
      return url;
    });
  }
  async function loadNode(node) {
    if (document.hidden || node.dataset.protectedState || !node.isConnected) return;
    const stamp = generation;
    node.dataset.protectedState = 'loading';
    let mediaUrl, posterUrl;
    try {
      const kind = node.dataset.protectedKind === 'video' ? 'video' : 'image';
      // Profile grids request only the image/poster, never the entire video.
      mediaUrl = await asset(node.dataset.protectedAsset, kind);
      if (kind === 'video' && node.dataset.protectedPoster) posterUrl = await asset(node.dataset.protectedPoster, 'image');
      if (!node.isConnected || stamp !== generation || document.hidden) throw Error('View changed');
      const el = document.createElement(kind === 'video' ? 'video' : 'img');
      el.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      if (kind === 'video') {
        el.controls = true; el.playsInline = true; el.preload = 'metadata';
        if (posterUrl) el.poster = posterUrl;
      } else { el.alt = 'Protected post image'; el.className = 'fade-in-image loaded'; }
      el.src = mediaUrl;
      node.replaceChildren(el);
      node.dataset.protectedState = 'loaded';
      loaded.add({ node, mediaUrl, posterUrl });
    } catch (_) {
      release(mediaUrl); release(posterUrl);
      if (node.isConnected && stamp === generation) {
        node.dataset.protectedState = 'failed';
        node.textContent = 'Protected media unavailable';
      }
    }
  }
  const visible = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) loadNode(entry.target).catch(() => {});
  }, { rootMargin: '200px' }) : null;
  function scan() {
    if(window.FreeUpperScreen && !window.FreeUpperScreen.isActive())return;
    for (const node of observed) if (!node.isConnected) {
      visible?.unobserve(node); observed.delete(node);
    }
    for (const entry of loaded) if (!entry.node.isConnected) {
      release(entry.mediaUrl); release(entry.posterUrl); loaded.delete(entry);
    }
    document.querySelectorAll('[data-protected-asset]').forEach(node => {
      if (node.dataset.protectedState) return;
      if (visible) {
        if (!observed.has(node)) { observed.add(node); visible.observe(node); }
      } else loadNode(node).catch(() => {});
    });
  }
  function refresh() {
    clear();
    // Re-observe visible nodes after a session/visibility change.
    visible?.disconnect();
    observed.clear();
    scan();
  }
  window.FreeUpperScreen?.register({suspend(){clear();visible?.disconnect();observed.clear();},resume:refresh,dispose:clear});
  window.addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); else refresh(); });
  window.sb?.auth?.onAuthStateChange?.((event) => {
    if (['SIGNED_OUT', 'SIGNED_IN', 'USER_UPDATED', 'TOKEN_REFRESHED'].includes(event)) {
      // Supabase warns against awaiting auth APIs inside this callback.
      clear();
      setTimeout(() => { visible?.disconnect(); observed.clear(); scan(); }, 0);
    }
  });
  function start() {
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    scan();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  window.FreeUpperProtectedMedia = { asset, release, clear };
})();
