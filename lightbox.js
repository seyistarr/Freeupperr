// ============================================================
// lightbox.js — shared image/video gallery viewer
// Used by both index.html (feed) and search.html (search results).
// Injects its own DOM + CSS; pages call window.FULightbox.open(...).
// ============================================================
(function () {
  'use strict';

  const CSS = `
  .fu-lb{position:fixed;inset:0;z-index:200;background:#000;display:none;flex-direction:column;opacity:0;pointer-events:none;transition:opacity .25s;touch-action:none;}
  .fu-lb.show{display:flex;opacity:1;pointer-events:auto;}
  .fu-lb-header{position:absolute;top:0;left:0;right:0;z-index:6;display:flex;align-items:center;gap:10px;padding:max(12px,env(safe-area-inset-top)) 14px 12px;background:linear-gradient(180deg,rgba(0,0,0,.65),transparent);}
  .fu-lb-back{background:none;border:none;color:#fff;font-size:22px;flex-shrink:0;width:32px;height:32px;}
  .fu-lb-searchpill{flex:1;padding:10px 16px;border-radius:100px;background:rgba(255,255,255,.15);color:#fff;font-size:14px;}
  .fu-lb-counter{color:#fff;font-size:13px;font-weight:700;}
  .fu-lb-media{position:relative;flex:1;min-height:0;overflow:hidden;background:#000;}
  .fu-lb-track{display:flex;width:100%;height:100%;transition:transform .3s ease;}
  .fu-lb-slide{flex:0 0 100%;width:100%;height:100%;display:flex;align-items:center;justify-content:center;}
  .fu-lb-slide img,.fu-lb-slide video{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;}
  .fu-lb-slide.pin-mode img{width:100%;height:auto;max-height:none;object-fit:cover;}
  .fu-lb-dots{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:5;}
  .fu-lb-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.4);}
  .fu-lb-dot.active{background:#fff;width:16px;border-radius:3px;}
  .fu-lb-sheet{background:var(--bg2,#fff);border-radius:20px 20px 0 0;margin-top:-16px;position:relative;z-index:2;padding:18px;max-height:45vh;overflow-y:auto;}
  .fu-lb-author{display:flex;align-items:center;gap:10px;margin-bottom:10px;cursor:pointer;}
  .fu-lb-author img{width:38px;height:38px;border-radius:50%;object-fit:cover;background:#eee;flex-shrink:0;}
  .fu-lb-author .nm{font-weight:800;font-size:14px;color:var(--text,#111);}
  .fu-lb-author .un{font-size:12px;color:#9CA3AF;}
  .fu-lb-caption{font-size:14px;line-height:1.5;color:var(--text,#111);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:14px;}
  .fu-lb-actions{display:flex;gap:10px;margin-bottom:16px;}
  .fu-lb-actions button{flex:1;padding:11px;border-radius:100px;border:1.5px solid #E4D9FB;background:#F2EDFD;color:#7C3AED;font-weight:700;font-size:13px;}
  .fu-lb-similar-title{font-size:15px;font-weight:800;margin-bottom:10px;color:var(--text,#111);}
  .fu-lb-similar-grid{column-count:2;column-gap:10px;}
  .fu-lb-similar-grid .fu-lb-sim-item{break-inside:avoid;margin-bottom:10px;border-radius:12px;overflow:hidden;cursor:pointer;}
  .fu-lb-similar-grid img{width:100%;display:block;}
  .fu-lb-footer{position:absolute;bottom:0;left:0;right:0;z-index:6;padding:16px 14px max(16px,env(safe-area-inset-bottom));background:linear-gradient(0deg,rgba(0,0,0,.75),transparent);color:#fff;}
  .fu-lb-footer .nm{display:flex;align-items:center;gap:8px;font-weight:800;margin-bottom:4px;}
  .fu-lb-footer .nm img{width:30px;height:30px;border-radius:50%;object-fit:cover;}
  .fu-lb-footer .cap{font-size:13px;opacity:.92;}
  `;

  function injectShell() {
    if (document.getElementById('fuLightbox')) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'fuLightbox';
    el.className = 'fu-lb';
    el.innerHTML = `
      <div class="fu-lb-header" id="fuLbHeader"></div>
      <div class="fu-lb-media" id="fuLbMedia">
        <div class="fu-lb-track" id="fuLbTrack"></div>
        <div class="fu-lb-dots" id="fuLbDots"></div>
      </div>
      <div id="fuLbBelow"></div>
    `;
    document.body.appendChild(el);
  }

  let state = { items: [], index: 0, mode: 'gallery', opts: {} };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function renderHeader() {
    const header = document.getElementById('fuLbHeader');
    if (state.mode === 'video-search') {
      header.innerHTML = `<button class="fu-lb-back" id="fuLbBack">&larr;</button><div class="fu-lb-searchpill">Search FreeUpper...</div>`;
    } else {
      header.innerHTML = `<button class="fu-lb-back" id="fuLbBack">&times;</button><span class="fu-lb-counter">${state.items.length>1?`${state.index+1} / ${state.items.length}`:''}</span><span style="width:32px;"></span>`;
    }
    document.getElementById('fuLbBack').onclick = close;
  }

  function renderTrack() {
    const track = document.getElementById('fuLbTrack');
    const dots = document.getElementById('fuLbDots');
    track.innerHTML = state.items.map(it => {
      const pinClass = state.opts.pinterestStyle ? ' pin-mode' : '';
      if (it.type === 'video') return `<div class="fu-lb-slide${pinClass}"><video src="${it.url}" controls autoplay playsinline muted></video></div>`;
      return `<div class="fu-lb-slide${pinClass}"><img src="${it.url}" alt=""></div>`;
    }).join('');
    track.style.transform = `translateX(-${state.index * 100}%)`;
    dots.innerHTML = state.items.length > 1
      ? state.items.map((_, i) => `<span class="fu-lb-dot ${i===state.index?'active':''}"></span>`).join('')
      : '';
  }

  function renderBelow() {
    const below = document.getElementById('fuLbBelow');
    const o = state.opts;
    if (state.mode === 'video-search') {
      below.innerHTML = `<div class="fu-lb-footer">
        ${o.author ? `<div class="nm"><img src="${o.author.avatar||''}">${escapeHtml(o.author.name||'')}</div>` : ''}
        ${o.caption ? `<div class="cap">${escapeHtml(o.caption)}</div>` : ''}
      </div>`;
      return;
    }
    // Pinterest-style sheet (images) or plain feed-style gallery (index.html videos/images)
    if (!o.showSheet) { below.innerHTML = ''; return; }
    let actionsHtml = (o.actions || []).map(a => `<button data-fu-lb-action="${a.id}">${escapeHtml(a.label)}</button>`).join('')
      || `<button data-fu-lb-action="close">Close</button>`;
    let similarHtml = '';
    if (o.similarItems && o.similarItems.length) {
      similarHtml = `<div class="fu-lb-similar-title">More like this</div>
        <div class="fu-lb-similar-grid">${o.similarItems.map(s => `<div class="fu-lb-sim-item" data-fu-lb-similar="${s.id}"><img src="${s.thumb}"></div>`).join('')}</div>`;
    }
    below.innerHTML = `<div class="fu-lb-sheet">
      ${o.author ? `<div class="fu-lb-author" id="fuLbAuthorRow"><img src="${o.author.avatar||''}"><div><div class="nm">${escapeHtml(o.author.name||'')}</div>${o.author.username?`<div class="un">@${escapeHtml(o.author.username)}</div>`:''}</div></div>` : ''}
      ${o.caption ? `<div class="fu-lb-caption">${escapeHtml(o.caption)}</div>` : ''}
      <div class="fu-lb-actions">${actionsHtml}</div>
      ${similarHtml}
    </div>`;
    const authorRow = document.getElementById('fuLbAuthorRow');
    if (authorRow && o.onAuthorClick) authorRow.onclick = o.onAuthorClick;
    below.querySelectorAll('[data-fu-lb-action]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.fuLbAction;
        if (id === 'close') return close();
        const action = (o.actions || []).find(a => a.id === id);
        if (action && action.onClick) action.onClick();
      };
    });
    below.querySelectorAll('[data-fu-lb-similar]').forEach(el => {
      el.onclick = () => { if (o.onSimilarClick) o.onSimilarClick(el.dataset.fuLbSimilar); };
    });
  }

  function render() { renderHeader(); renderTrack(); renderBelow(); }

  // mode: 'gallery' (index.html style, dark, swipeable, optional actions sheet)
  //       'pinterest' (image lightbox with Pinterest-style bottom sheet)
  //       'video-search' (search.html video fullscreen with search-bar header)
  function open(items, startIndex, opts) {
    injectShell();
    state = { items: items || [], index: startIndex || 0, opts: opts || {}, mode: (opts && opts.mode) || 'gallery' };
    if (state.mode === 'pinterest') state.opts.showSheet = true;
    render();
    document.getElementById('fuLightbox').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    const el = document.getElementById('fuLightbox');
    if (el) {
      el.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} });
      el.classList.remove('show');
    }
    document.body.style.overflow = '';
    if (state.opts && state.opts.onClose) state.opts.onClose();
  }

  function goTo(i) {
    if (!state.items.length) return;
    state.index = Math.max(0, Math.min(state.items.length - 1, i));
    renderHeader();
    document.getElementById('fuLbTrack').style.transform = `translateX(-${state.index * 100}%)`;
    document.querySelectorAll('.fu-lb-dot').forEach((d, i2) => d.classList.toggle('active', i2 === state.index));
  }

  (function setupSwipe() {
    document.addEventListener('touchstart', e => {
      const media = document.getElementById('fuLbMedia');
      if (!media || !media.contains(e.target)) return;
      window._fuLbSx = e.touches[0].clientX;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      const media = document.getElementById('fuLbMedia');
      if (!media || !media.contains(e.target) || window._fuLbSx == null) return;
      const dx = window._fuLbSx - e.changedTouches[0].clientX;
      window._fuLbSx = null;
      if (Math.abs(dx) > 40 && state.items.length > 1) goTo(state.index + (dx > 0 ? 1 : -1));
    }, { passive: true });
  })();

  window.FULightbox = { open, close, goTo };
})();
