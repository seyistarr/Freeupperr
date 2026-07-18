(function () {
  'use strict';

  const FREEUPPER_POST_REGEX = /https:\/\/freeupper\.vercel\.app\/post\/([a-zA-Z0-9_-]+)/;
  const previewCache = new Map(); // postId -> preview data (avoid refetching same link repeatedly)

  function detectFreeupperLink(text) {
    if (!text) return null;
    const match = text.match(FREEUPPER_POST_REGEX);
    return match ? match[1] : null;
  }

  async function fetchPreview(postId) {
    if (previewCache.has(postId)) return previewCache.get(postId);
    if (!window.PostsAPI || !window.PostsAPI.loadPostPreview) return null;
    const preview = await window.PostsAPI.loadPostPreview(postId);
    if (preview) previewCache.set(postId, preview);
    return preview;
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
      <div class="fu-link-preview" data-post-id="${escapeHtml(preview.id)}" onclick="window.FreeupperLinkPreview.openPost('${escapeHtml(preview.id)}')">
        <div class="fu-preview-thumb-wrap">
          ${preview.thumbnailUrl
            ? `<img class="fu-preview-thumb" src="${escapeHtml(preview.thumbnailUrl)}" alt="" onerror="this.style.display='none'">`
            : `<div class="fu-preview-thumb fu-preview-thumb-empty"></div>`}
          ${durationBadge}
        </div>
        <div class="fu-preview-meta">
          <div class="fu-preview-title">${escapeHtml(preview.title || 'View post')}</div>
          <div class="fu-preview-author">
            ${preview.avatarUrl ? `<img class="fu-preview-avatar" src="${escapeHtml(preview.avatarUrl)}" alt="">` : ''}
            <span>@${escapeHtml(preview.username || preview.displayName)}</span>
          </div>
          <div class="fu-preview-domain">freeupper.vercel.app</div>
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

  /**
   * Attaches live preview detection to a text input/textarea.
   * Renders the preview card into `previewContainerEl` below the input.
   * Calls onLinkDetected(postId|null) so callers can track state (e.g. attach postId to a comment on submit).
   */
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

        if (postId === lastDetectedId) return; // same link, already shown/loading
        lastDetectedId = postId;

        previewContainerEl.style.display = 'block';
        previewContainerEl.innerHTML = renderLoadingCardHTML();

        const preview = await fetchPreview(postId);

        // Guard against race: input may have changed while fetching
        if (detectFreeupperLink(inputEl.value) !== postId) return;

        if (preview) {
          previewContainerEl.innerHTML = renderPreviewCardHTML(preview);
          if (onLinkDetected) onLinkDetected(postId);
        } else {
          previewContainerEl.innerHTML = '';
          previewContainerEl.style.display = 'none';
          if (onLinkDetected) onLinkDetected(null);
        }
      }, 400); // debounce so we don't fetch on every keystroke
    });
  }

  /**
   * Renders a preview card for a link found inside already-posted text
   * (e.g. a comment or chat message that contains a Freeupper URL).
   * Returns a Promise<string> of HTML to inject after the text content.
   */
  async function renderInlinePreviewForText(text) {
    const postId = detectFreeupperLink(text);
    if (!postId) return '';
    const preview = await fetchPreview(postId);
    if (!preview) return '';
    return renderPreviewCardHTML(preview);
  }

  function openPost(postId) {
    window.location.href = `/post/${postId}`;
  }

  window.FreeupperLinkPreview = {
    detectFreeupperLink,
    fetchPreview,
    attachLinkPreview,
    renderInlinePreviewForText,
    renderPreviewCardHTML,
    openPost,
  };
})();
