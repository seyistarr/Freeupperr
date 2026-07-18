(function() {
  'use strict';

  // ── 1. DYNAMIC ORIGIN ──────────────────────────────────────
  // Use the current origin (works on any domain)
  const origin = window.location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ── 2. REGEX – matches both /post/ and /video.html?post= ──
  const POST_REGEX = new RegExp(`${origin}/(?:post|video\\.html\\?post=)([a-zA-Z0-9_-]+)`);

  // ── 3. CACHE – stores Promises to avoid duplicate inflight requests ──
  const previewCache = new Map();

  // ── 4. DETECTION ──────────────────────────────────────────
  function detectFreeupperLink(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(POST_REGEX);
    return match ? match[1] : null;
  }

  // ── 5. BUILD POST URL (for sharing) ──────────────────────
  function getPostUrl(postId) {
    return `${window.location.origin}/post/${postId}`;
  }

  // ── 6. FETCH PREVIEW DATA ─────────────────────────────────
  async function fetchPreview(postId) {
    // Return cached promise if exists
    if (previewCache.has(postId)) {
      return previewCache.get(postId);
    }

    // Ensure PostsAPI is available
    if (!window.PostsAPI || typeof window.PostsAPI.loadPostPreview !== 'function') {
      console.warn('PostsAPI.loadPostPreview not available');
      return null;
    }

    // Create the promise and cache it
    const promise = window.PostsAPI.loadPostPreview(postId);
    previewCache.set(postId, promise);

    try {
      const preview = await promise;
      // Store the resolved value (not the promise) for future calls
      previewCache.set(postId, preview);
      return preview;
    } catch (err) {
      previewCache.delete(postId);
      console.error('fetchPreview error:', err);
      return null;
    }
  }

  // ── 7. RENDER PREVIEW CARD ────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function renderPreviewCardHTML(preview) {
    const isVideo = preview.mediaType === 'video';
    const durationBadge = isVideo ? `
      <div class="fu-preview-play">
        <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>` : '';

    return `
      <div class="fu-link-preview" data-post-id="${escapeHtml(preview.id)}" onclick="window.FreeupperLinkPreview.openPost('${escapeHtml(preview.id)}')" tabindex="0" role="button">
        <div class="fu-preview-thumb-wrap">
          ${preview.thumbnailUrl
            ? `<img class="fu-preview-thumb" src="${escapeHtml(preview.thumbnailUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
            : `<div class="fu-preview-thumb fu-preview-thumb-empty"></div>`}
          ${durationBadge}
        </div>
        <div class="fu-preview-meta">
          <div class="fu-preview-title">${escapeHtml(preview.title || 'View post')}</div>
          <div class="fu-preview-author">
            ${preview.avatarUrl ? `<img class="fu-preview-avatar" src="${escapeHtml(preview.avatarUrl)}" alt="">` : ''}
            <span>@${escapeHtml(preview.username || preview.displayName)}</span>
          </div>
          <div class="fu-preview-domain">${window.location.hostname}</div>
        </div>
      </div>
    `;
  }

  function renderLoadingCardHTML() {
    return `
      <div class="fu-link-preview fu-preview-loading">
        <div class="fu-preview-thumb-wrap">
          <div class="fu-preview-thumb fu-preview-thumb-empty fu-preview-pulse"></div>
        </div>
        <div class="fu-preview-meta">
          <div class="fu-preview-title fu-preview-pulse-line" style="width:70%"></div>
          <div class="fu-preview-author fu-preview-pulse-line" style="width:40%"></div>
        </div>
      </div>
    `;
  }

  // ── 8. ATTACH TO INPUT (debounced) ───────────────────────
  function attachLinkPreview(inputEl, previewContainerEl, onLinkDetected) {
    let lastDetectedId = null;
    let debounceTimer = null;

    inputEl.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const postId = detectFreeupperLink(inputEl.value);

        if (!postId) {
          if (lastDetectedId !== null) {
            lastDetectedId = null;
            previewContainerEl.innerHTML = '';
            previewContainerEl.style.display = 'none';
            if (onLinkDetected) onLinkDetected(null);
          }
          return;
        }

        if (postId === lastDetectedId) return;
        lastDetectedId = postId;

        previewContainerEl.style.display = 'block';
        previewContainerEl.innerHTML = renderLoadingCardHTML();

        const preview = await fetchPreview(postId);

        // Guard against race condition: input may have changed while fetching
        if (detectFreeupperLink(inputEl.value) !== postId) return;

        if (preview) {
          previewContainerEl.innerHTML = renderPreviewCardHTML(preview);
          if (onLinkDetected) onLinkDetected(postId);
        } else {
          previewContainerEl.innerHTML = '';
          previewContainerEl.style.display = 'none';
          if (onLinkDetected) onLinkDetected(null);
        }
      }, 400);
    });
  }

  // ── 9. INLINE PREVIEW FOR ALREADY‑POSTED TEXT ────────────
  async function renderInlinePreviewForText(text) {
    const postId = detectFreeupperLink(text);
    if (!postId) return '';
    const preview = await fetchPreview(postId);
    if (!preview) return '';
    return renderPreviewCardHTML(preview);
  }

  // ── 10. OPEN POST (navigate to the post page) ──────────
  function openPost(postId) {
    window.location.href = `/post/${encodeURIComponent(postId)}`;
  }

  // ── 11. EXPOSE PUBLIC API ─────────────────────────────────
  window.FreeupperLinkPreview = {
    detectFreeupperLink,
    fetchPreview,
    attachLinkPreview,
    renderInlinePreviewForText,
    renderPreviewCardHTML,
    openPost,
    getPostUrl,
  };
})();
