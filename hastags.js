// ============================================================
// hashtags.js — shared hashtag routing + rendering
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
   * Navigate to search.html in Hashtag Mode
   * Uses canonical ?tag= URL parameter (not ?hashtag=)
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

  /**
   * Canonical content opener — routes to the ORIGINAL content page
   * Videos → video.html?post=ID
   * Everything else → index.html?post=ID
   * Prevents opening search duplicates or feed clones
   * @param {object} post - post object with id, media_type, mediaType
   */
  function openPost(post) {
    if (!post || !post.id) return;
    const mediaType = post.media_type || post.mediaType;
    const targetPage = mediaType === 'video' ? 'video.html' : 'index.html';
    window.location.href = targetPage + '?post=' + post.id;
  }

  /**
   * Convenience: open a post by ID and media type
   * Useful for inline onclick handlers where you don't have the full post object
   * @param {string|number} postId - the post ID
   * @param {string} mediaType - 'video' or anything else (default: 'image')
   */
  function openPostById(postId, mediaType) {
    if (!postId) return;
    const targetPage = mediaType === 'video' ? 'video.html' : 'index.html';
    window.location.href = targetPage + '?post=' + postId;
  }

  // Expose public API
  window.Hashtags = {
    goToHashtag,
    hashifyHtml,
    openPost,
    openPostById
  };

  console.log('✅ hashtags.js loaded (uses ?tag=, canonical routing)');
})();
