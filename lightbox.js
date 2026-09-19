// ============================================================
// lightbox.js — shared gallery lightbox + comments sheet
//
// Extracted from index.html. Injects its own markup + CSS on load
// so neither index.html nor search.html hand-maintains the DOM.
//
// STATUS: SCAFFOLD. Every function marked "PORT FROM index.html"
// below has a stub body that logs a warning. Replace each stub
// with the corresponding function body from index.html's inline
// <script type="module">. The public API surface is final — do
// not change signatures here without updating both callers.
// ============================================================
(function () {
  'use strict';

  // ─── MARKUP + CSS INJECTION ───────────────────────────────
  // TODO: paste the exact markup from index.html's #lightbox
  // and #lightboxCommentsOverlay here. Keep IDs identical so the
  // ported JS below finds them the same way.
  const LIGHTBOX_CSS = `
    /* TODO: paste from index.html — every rule matching:
       .lightbox-modal, .gallery-lightbox-*, .lightbox-comments-*, .lb-* */
  `;

  const LIGHTBOX_HTML = `
    <!-- TODO: paste #lightbox markup from index.html -->
    <!-- TODO: paste #lightboxCommentsOverlay markup from index.html -->
  `;

  function injectOnce() {
    if (document.getElementById('lightbox')) return;
    const style = document.createElement('style');
    style.id = 'lightboxStyles';
    style.textContent = LIGHTBOX_CSS;
    document.head.appendChild(style);
    document.body.insertAdjacentHTML('beforeend', LIGHTBOX_HTML);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectOnce);
  else injectOnce();

  // ─── SHARED UTILITIES ─────────────────────────────────────
  // These may already exist as window.* globals from global.js.
  // Prefer those; fall back to local copies only if missing.
  function escapeHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML;
  }
  function formatCount(n) {
    if (typeof window.formatCount === 'function') return window.formatCount(n);
    n = n || 0;
    if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M';
    if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K';
    return String(n);
  }
  function formatRelativeTime(t) {
    if (typeof window.formatRelativeTime === 'function') return window.formatRelativeTime(t);
    if (typeof window.timeAgo === 'function') return window.timeAgo(t);
    return '';
  }
  function truncateName(s, n) { s = s || ''; n = n || 20; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function linkifyContent(s) {
    if (typeof window.linkifyContent === 'function') return window.linkifyContent(s);
    return escapeHtml(s);
  }

  function _warn(name) {
    console.warn('[lightbox.js] ' + name + ' is a stub — port from index.html');
  }

  // ─── PORT FROM index.html (paste bodies below each comment) ─

  function getMediaItems(post) {
    // PORT FROM index.html
    _warn('getMediaItems');
    if (!post) return [];
    if (Array.isArray(post.media) && post.media.length) return post.media;
    const url = post.media_url || post.mediaUrl;
    if (!url) return [];
    return [{ url, type: post.media_type || post.mediaType || 'image' }];
  }

  function buildActionsRow(post) { _warn('buildActionsRow'); return ''; }
  function buildReactionButton(post) { _warn('buildReactionButton'); return ''; }
  function buildFollowButton(userId) { _warn('buildFollowButton'); return ''; }
  function buildLightboxCaptionHTML(post) { _warn('buildLightboxCaptionHTML'); return ''; }
  function buildLbScrubberHTML() { _warn('buildLbScrubberHTML'); return ''; }
  function buildLbSheetHeaderHTML(post) { _warn('buildLbSheetHeaderHTML'); return ''; }

  function renderGalleryTrack() { _warn('renderGalleryTrack'); }
  function galleryGoTo() { _warn('galleryGoTo'); }
  function releaseGalleryVideos() { _warn('releaseGalleryVideos'); }
  function updateLbScrubberUI() { _warn('updateLbScrubberUI'); }
  function updateLbMuteIcon() { _warn('updateLbMuteIcon'); }
  function updateLbPlayPauseIcon() { _warn('updateLbPlayPauseIcon'); }
  function getActiveLightboxVideo() { return null; }
  function seekLbVideo() { _warn('seekLbVideo'); }
  function toggleActiveLightboxPlayback() { _warn('toggleActiveLightboxPlayback'); }
  function setupLightboxVideoControls() { _warn('setupLightboxVideoControls'); }
  function setupLightboxNextPostSwipe() { _warn('setupLightboxNextPostSwipe'); }
  function goToNextLightboxPost() { _warn('goToNextLightboxPost'); }

  // ─── MAIN OPEN ────────────────────────────────────────────
  function openGalleryLightbox(mediaItems, startIndex, postId, resumeState) {
    injectOnce();
    // PORT FROM index.html — this is the big one. Populate #lightbox
    // using mediaItems (shape depends on your existing code — usually
    // [{ url, type: 'image'|'video', ... }]), set the initial slide to
    // startIndex, wire buildActionsRow/buildLightboxCaptionHTML into
    // the sheet, call setupLightboxVideoControls, setupLightboxNextPostSwipe,
    // setupLightboxCommentsBar, setupLightboxCommentsDelegation, and
    // run the swipe / vertical-dismiss IIFEs.
    _warn('openGalleryLightbox');
    // Minimal fallback so callers don't hard-crash:
    const modal = document.getElementById('lightbox');
    if (modal) modal.classList.add('show');
  }

  function closeLightbox() {
    // PORT FROM index.html
    _warn('closeLightbox');
    const modal = document.getElementById('lightbox');
    if (modal) modal.classList.remove('show');
    releaseGalleryVideos();
  }

  // ─── COMMENTS SHEET ───────────────────────────────────────
  function openLightboxCommentsSheet() { _warn('openLightboxCommentsSheet'); }
  function closeLightboxCommentsSheet() { _warn('closeLightboxCommentsSheet'); }
  function submitLightboxComment() { _warn('submitLightboxComment'); }
  function setupLightboxCommentsBar() { _warn('setupLightboxCommentsBar'); }
  function setupLightboxCommentsDelegation() { _warn('setupLightboxCommentsDelegation'); }
  function lightboxExpandReplies() { _warn('lightboxExpandReplies'); }
  function lightboxCollapseReplies() { _warn('lightboxCollapseReplies'); }
  function lightbox refreshLoadMoreComments() { _warn('lightboxLoadMoreCommentsComments'); }

  // ─── SUPPORTING PIListECES CALLED BY THE FOOTER/COMMENTS() ─────
  function { _warn('refreshCommentsList'); }
  function commentSkeletons() { _warn('commentSkeletons'); return ''; }
  function getCommentSort() { return 'top'; }
  function openCommentSortModal() { _warn('openCommentSortModal'); }
  function toggleReaction() { _warn('toggleReaction'); }
  function toggleBookmarkUI() { _warn('toggleBookmarkUI'); }
  function openShareModal() { _warn('openShareModal'); }
  function triggerRepostFromFeed() { _warn('triggerRepostFromFeed'); }

  // ─── PUBLIC API (final — do not change shape) ────────────
  window.Lightbox = {
    open: openGalleryLightbox,
    close: closeLightbox,
    openComments: openLightboxCommentsSheet,
    closeComments: closeLightboxCommentsSheet,
    getMediaItems: getMediaItems,
  };
})();
