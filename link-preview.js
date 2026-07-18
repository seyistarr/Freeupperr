(function() {
  'use strict';

  // Use the current origin dynamically
  const origin = window.location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const POST_REGEX = new RegExp(`${origin}/post/([a-zA-Z0-9_-]+)`);

  // Cache: key = postId, value = Promise (to avoid duplicate in-flight requests)
  const previewCache = new Map();

  function detectFreeupperLink(text) {
    if (!text) return null;
    const match = text.match(POST_REGEX);
    return match ? match[1] : null;
  }

  function getPostUrl(postId) {
    return `${window.location.origin}/post/${postId}`;
  }

  async function fetchPreview(postId) {
    if (previewCache.has(postId)) {
      return previewCache.get(postId);
    }
    if (!window.PostsAPI || !window.PostsAPI.loadPostPreview) {
      return null;
    }
    const promise = window.PostsAPI.loadPostPreview(postId);
    previewCache.set(postId, promise);
    try {
      const preview = await promise;
      // Store the resolved value, not the promise
      previewCache.set(postId, preview);
      return preview;
    } catch (e) {
      previewCache.delete(postId);
      return null;
    }
  }

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

        // Guard against race condition
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

  async function renderInlinePreviewForText(text) {
    const postId = detectFreeupperLink(text);
    if (!postId) return '';
    const preview = await fetchPreview(postId);
    if (!preview) return '';
    return renderPreviewCardHTML(preview);
  }

  function openPost(postId) {
    // Use your app's router if available; fallback to full page load
    window.location.href = `/video.html?post=${encodeURIComponent(postId)}`;
  }

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