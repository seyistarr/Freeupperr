// ============================================================
// hashtags.js — shared hashtag rendering
// ============================================================
(function () {
  'use strict';

  /**
   * Escape HTML entities for safe insertion into DOM
   * @param {string} str - string to escape
   * @returns {string} escaped string
   */
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  /**
   * Navigate to a hashtag using the central Router.
   * This is the ONLY public navigation method in this file.
   * @param {string} tag - the hashtag (with or without leading #)
   */
  function goToHashtag(tag) {
    if (!tag) return;
    const clean = tag.replace(/^#/, '');
    if (window.Router && typeof window.Router.openHashtag === 'function') {
      window.Router.openHashtag(clean);
    } else {
      // Fallback (should never happen if router.js loads first)
      window.location.href = 'search.html?tag=' + encodeURIComponent(clean);
    }
  }

  /**
   * Turn #word occurrences in plain text into clickable spans.
   * Should be called AFTER escaping HTML and handling mentions.
   * @param {string} html - already-escaped HTML string
   * @returns {string} HTML with clickable hashtag spans
   */
  function hashifyHtml(html) {
    if (!html) return '';
    return html.replace(/(^|[\s>])#(\w+)/g, function (m, pre, word) {
      const escapedWord = word.replace(/'/g, "\\'");
      return pre + '<span class="hashtag-link" data-tag="' + escapeHtml(word) + '" onclick="event.stopPropagation();window.Hashtags.goToHashtag(\'' + escapedWord + '\')">#' + escapeHtml(word) + '</span>';
    });
  }

  // Expose public API
  window.Hashtags = {
    goToHashtag: goToHashtag,
    hashifyHtml: hashifyHtml
  };

  console.log('✅ hashtags.js loaded (hashtag rendering only, uses Router)');
})();
