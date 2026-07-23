// ============================================================
// hashtags.js — shared hashtag routing + rendering
// ============================================================
(function () {
  'use strict';

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // Navigate to search.html in Hashtag Mode from ANYWHERE (feed, video, comments, notifications...)
  function goToHashtag(tag) {
    if (!tag) return;
    const clean = tag.replace(/^#/, '');
    window.location.href = 'search.html?hashtag=' + encodeURIComponent(clean);
  }

  // Turn #word occurrences in plain text into clickable spans.
  // Call this AFTER escaping/mentions have already been applied.
  function hashifyHtml(html) {
    if (!html) return '';
    return html.replace(/(^|[\s>])#(\w+)/g, function (m, pre, word) {
      return pre + '<span class="hashtag-link" data-tag="' + escapeHtml(word) + '" onclick="event.stopPropagation();window.Hashtags.goToHashtag(\'' + word.replace(/'/g, "\\'") + '\')">#' + escapeHtml(word) + '</span>';
    });
  }

  window.Hashtags = { goToHashtag, hashifyHtml };
  console.log('✅ hashtags.js loaded');
})();
