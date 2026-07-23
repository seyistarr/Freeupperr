// ============================================================
// hashtags.js — shared hashtag routing + rendering
// ============================================================
(function () {
  'use strict';

  /**
   * Navigate to search.html in Hashtag Mode
   * @param {string} tag - the hashtag (with or without leading #)
   */
  function goToHashtag(tag) {
    if (!tag) return;
    const clean = tag.replace(/^#/, '');
    window.location.href = 'search.html?tag=' + encodeURIComponent(clean);
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

  // Helper to escape for HTML attributes (minimal)
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // Expose public API
  window.Hashtags = {
    goToHashtag: goToHashtag,
    hashifyHtml: hashifyHtml
  };

  console.log('✅ hashtags.js loaded (uses ?tag=)');
})();
