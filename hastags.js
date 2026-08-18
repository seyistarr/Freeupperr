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
    // FIX: inline style guarantees hashtags render identically to mentions
    // (deep light purple, bold) everywhere hashifyHtml runs — titles,
    // content, comments — regardless of what any external .hashtag-link
    // CSS rule says.
    return html.replace(/(^|[\s>])#(\w+)/g, function (m, pre, word) {
      const escapedWord = word.replace(/'/g, "\\'");
      return pre + '<span class="hashtag-link" data-tag="' + escapeHtml(word) + '" style="color:var(--pl);font-weight:800;cursor:pointer;" onclick="event.stopPropagation();window.Hashtags.goToHashtag(\'' + escapedWord + '\')">#' + escapeHtml(word) + '</span>';
    });
  }

  /**
   * Search hashtags for autocomplete, with live post counts pulled
   * from post_hashtags. Matches by prefix first, falling back to
   * substring, capped at `limit` results.
   * @param {string} query - partial hashtag text, without '#'
   * @param {number} limit
   * @returns {Promise<Array<{id:number, tag:string, count:number}>>}
   */
  async function searchHashtags(query, limit = 6) {
    const clean = (query || '').trim();
    if (!clean || !window.sb) return [];

    try {
      const { data: tagRows, error: tagErr } = await window.sb
        .from('hashtags')
        .select('id, tag')
        .ilike('tag', `${clean}%`)
        .limit(limit);

      if (tagErr) {
        console.warn('searchHashtags error:', tagErr);
        return [];
      }
      if (!tagRows || !tagRows.length) return [];

      const ids = tagRows.map(r => r.id);
      const { data: linkRows, error: linkErr } = await window.sb
        .from('post_hashtags')
        .select('hashtag_id')
        .in('hashtag_id', ids);

      if (linkErr) {
        console.warn('searchHashtags count error:', linkErr);
        return tagRows.map(r => ({ id: r.id, tag: r.tag, count: 0 }));
      }

      const counts = {};
      (linkRows || []).forEach(row => {
        counts[row.hashtag_id] = (counts[row.hashtag_id] || 0) + 1;
      });

      return tagRows
        .map(r => ({ id: r.id, tag: r.tag, count: counts[r.id] || 0 }))
        .sort((a, b) => b.count - a.count);
    } catch (err) {
      console.warn('searchHashtags exception:', err);
      return [];
    }
  }

  /**
   * Trending hashtags across the whole platform, ranked by post count.
   * Backed by post_hashtags rather than scanning posts.tags arrays.
   * @param {number} limit
   */
  async function fetchTrendingHashtags(limit = 10) {
    if (!window.sb) return [];
    try {
      const { data: linkRows, error } = await window.sb
        .from('post_hashtags')
        .select('hashtag_id')
        .limit(5000); // safety cap; fine for current scale

      if (error || !linkRows || !linkRows.length) return [];

      const counts = {};
      linkRows.forEach(row => { counts[row.hashtag_id] = (counts[row.hashtag_id] || 0) + 1; });

      const topIds = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([id]) => Number(id));

      if (!topIds.length) return [];

      const { data: tagRows, error: tagErr } = await window.sb
        .from('hashtags')
        .select('id, tag')
        .in('id', topIds);

      if (tagErr || !tagRows) return [];

      return topIds
        .map(id => {
          const row = tagRows.find(t => t.id === id);
          return row ? { tag: row.tag, count: counts[id] } : null;
        })
        .filter(Boolean);
    } catch (err) {
      console.warn('fetchTrendingHashtags exception:', err);
      return [];
    }
  }

  /**
   * All posts for a given hashtag, via post_hashtags join.
   * @param {string} tag - without '#'
   */
  async function fetchHashtagPostIds(tag) {
    if (!tag || !window.sb) return [];
    try {
      const { data: tagRow, error: tagErr } = await window.sb
        .from('hashtags')
        .select('id')
        .eq('tag', tag)
        .maybeSingle();

      if (tagErr || !tagRow) return [];

      const { data: linkRows, error: linkErr } = await window.sb
        .from('post_hashtags')
        .select('post_id')
        .eq('hashtag_id', tagRow.id);

      if (linkErr || !linkRows) return [];
      return linkRows.map(r => r.post_id);
    } catch (err) {
      console.warn('fetchHashtagPostIds exception:', err);
      return [];
    }
  }

  // Expose public API
  window.Hashtags = {
    goToHashtag: goToHashtag,
    hashifyHtml: hashifyHtml,
    searchHashtags: searchHashtags,
    fetchTrendingHashtags: fetchTrendingHashtags,
    fetchHashtagPostIds: fetchHashtagPostIds
  };

  console.log('✅ hashtags.js loaded (rendering + post_hashtags-backed search/trending)');
})();
