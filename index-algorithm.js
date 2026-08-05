 =====================================================================
// index-algorithm.js
// FreeUpper Feed Ranking Engine v3.0.0
// =====================================================================

(function () {
  'use strict';

  const CONFIG = {
    MAX_SCORE: 100,

    // Freshness
    FRESHNESS_WEIGHT: 24,

    // Engagement
    LIKE_WEIGHT: 8,
    COMMENT_WEIGHT: 10,
    REPOST_WEIGHT: 9,
    SHARE_WEIGHT: 12,
    VIEW_WEIGHT: 3,

    // User affinity
    CATEGORY_AFFINITY_WEIGHT: 16,
    CREATOR_AFFINITY_WEIGHT: 18,
    TAG_AFFINITY_WEIGHT: 10,

    // Content quality
    VIDEO_WEIGHT: 3,
    IMAGE_WEIGHT: 2,
    TEXT_WEIGHT: 1,

    // Penalties
    SEEN_PENALTY: 18,
    REPEAT_PENALTY: 10,

    // Small exploration factor
    EXPLORATION_WEIGHT: 7
  };

  const state = {
    seen: new Set(),
    interactionHistory: new Map(),
    categoryScores: new Map(),
    creatorScores: new Map(),
    tagScores: new Map()
  };

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function ageHours(timestamp) {
    const time = new Date(timestamp || Date.now()).getTime();

    if (!Number.isFinite(time)) return 24;

    return Math.max(
      0,
      (Date.now() - time) / (1000 * 60 * 60)
    );
  }

  function freshnessScore(post) {
    const hours = ageHours(post.timestamp);

    // New posts receive stronger initial boost.
    // Slowly decays over time.
    return 1 / Math.pow(1 + hours / 12, 0.65);
  }

  function engagementScore(post) {
    const likes = safeNumber(post.likes);
    const comments = safeNumber(post.comments);
    const reposts = safeNumber(post.repostCount);
    const shares = safeNumber(post.shareCount);
    const views = safeNumber(post.views);

    // Logarithmic growth prevents viral posts from completely
    // destroying discovery for smaller creators.
    return (
      Math.log1p(likes) * CONFIG.LIKE_WEIGHT +
      Math.log1p(comments) * CONFIG.COMMENT_WEIGHT +
      Math.log1p(reposts) * CONFIG.REPOST_WEIGHT +
      Math.log1p(shares) * CONFIG.SHARE_WEIGHT +
      Math.log1p(views) * CONFIG.VIEW_WEIGHT
    );
  }

  function contentTypeScore(post) {
    const media = Array.isArray(post.media) ? post.media : [];

    if (media.some(m => normalize(m.type) === 'video')) {
      return CONFIG.VIDEO_WEIGHT;
    }

    if (media.length > 0) {
      return CONFIG.IMAGE_WEIGHT;
    }

    return CONFIG.TEXT_WEIGHT;
  }

  function categoryAffinity(post) {
    const category = normalize(post.category);

    if (!category) return 0;

    return (
      state.categoryScores.get(category) || 0
    ) * CONFIG.CATEGORY_AFFINITY_WEIGHT;
  }

  function creatorAffinity(post) {
    const creatorId = post.user_id;

    if (!creatorId) return 0;

    return (
      state.creatorScores.get(creatorId) || 0
    ) * CONFIG.CREATOR_AFFINITY_WEIGHT;
  }

  function tagAffinity(post) {
    const tags = Array.isArray(post.tags)
      ? post.tags
      : [];

    if (!tags.length) return 0;

    let score = 0;

    tags.forEach(tag => {
      score += state.tagScores.get(normalize(tag)) || 0;
    });

    return score * CONFIG.TAG_AFFINITY_WEIGHT;
  }

  function seenPenalty(post) {
    if (state.seen.has(post.id)) {
      return CONFIG.SEEN_PENALTY;
    }

    return 0;
  }

  function repeatPenalty(post, index, allPosts) {
    if (!post.user_id) return 0;

    const nearby = allPosts.slice(
      Math.max(0, index - 4),
      Math.min(allPosts.length, index + 5)
    );

    const creatorPosts = nearby.filter(
      p => p.user_id === post.user_id
    );

    if (creatorPosts.length > 2) {
      return CONFIG.REPEAT_PENALTY;
    }

    return 0;
  }

  function explorationScore(post) {
    // Deterministic enough for one ranking pass,
    // but still gives lesser-known posts opportunities.
    const id = String(post.id || '');

    let hash = 0;

    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }

    const normalized = Math.abs(hash % 100) / 100;

    return normalized * CONFIG.EXPLORATION_WEIGHT;
  }

  // -------------------------------------------------------------
  // Score a single post
  // -------------------------------------------------------------

  function scorePost(post, index, allPosts) {
    if (!post || !post.id) return 0;

    let score = 0;

    score += freshnessScore(post) * CONFIG.FRESHNESS_WEIGHT;
    score += engagementScore(post);
    score += categoryAffinity(post);
    score += creatorAffinity(post);
    score += tagAffinity(post);
    score += contentTypeScore(post);
    score += explorationScore(post);

    score -= seenPenalty(post);
    score -= repeatPenalty(post, index, allPosts);

    // User already liked it: don't completely remove it.
    // It can still appear because the user may want to revisit it.
    if (post.likedByMe) {
      score -= 2;
    }

    // Hidden posts should never rank.
    if (post.is_hidden) {
      return -Infinity;
    }

    return clamp(
      score,
      -100,
      CONFIG.MAX_SCORE
    );
  }

  // -------------------------------------------------------------
  // Rank posts
  // -------------------------------------------------------------

  function rank(posts, options = {}) {
    if (!Array.isArray(posts)) return [];

    const input = posts.filter(Boolean);

    const scored = input.map((post, index) => ({
      ...post,
      _algorithmScore: scorePost(post, index, input)
    }));

    const filtered = scored.filter(
      post => post._algorithmScore !== -Infinity
    );

    filtered.sort((a, b) => {
      if (b._algorithmScore !== a._algorithmScore) {
        return b._algorithmScore - a._algorithmScore;
      }

      return (
        new Date(b.timestamp || 0) -
        new Date(a.timestamp || 0)
      );
    });

    if (options.removeScore === true) {
      return filtered.map(post => {
        const copy = { ...post };
        delete copy._algorithmScore;
        return copy;
      });
    }

    return filtered;
  }

  // -------------------------------------------------------------
  // Mark as seen
  // -------------------------------------------------------------

  function markSeen(postId) {
    if (!postId) return;

    state.seen.add(postId);

    // Prevent unlimited memory growth.
    if (state.seen.size > 5000) {
      const first = state.seen.values().next().value;
      state.seen.delete(first);
    }
  }

  function markManySeen(ids = []) {
    ids.forEach(markSeen);
  }

  function hasSeen(postId) {
    return state.seen.has(postId);
  }

  // -------------------------------------------------------------
  // Register interaction
  // -------------------------------------------------------------

  function registerInteraction(post, type) {
    if (!post || !post.id) return;

    const weightMap = {
      view: 0.05,
      like: 1,
      unlike: -0.5,
      comment: 1.5,
      repost: 2,
      share: 2,
      bookmark: 1.5,
      skip: -0.5
    };

    const weight = weightMap[type] || 0;

    const current =
      state.interactionHistory.get(post.id) || 0;

    state.interactionHistory.set(
      post.id,
      current + weight
    );

    if (post.category) {
      const category = normalize(post.category);

      const old =
        state.categoryScores.get(category) || 0;

      state.categoryScores.set(
        category,
        clamp(old + weight * 0.1, -10, 10)
      );
    }

    if (post.user_id) {
      const old =
        state.creatorScores.get(post.user_id) || 0;

      state.creatorScores.set(
        post.user_id,
        clamp(old + weight * 0.1, -10, 10)
      );
    }

    if (Array.isArray(post.tags)) {
      post.tags.forEach(tag => {
        const key = normalize(tag);

        const old =
          state.tagScores.get(key) || 0;

        state.tagScores.set(
          key,
          clamp(old + weight * 0.05, -10, 10)
        );
      });
    }
  }

  // -------------------------------------------------------------
  // Remove duplicates
  // -------------------------------------------------------------

  function dedupe(posts) {
    const map = new Map();

    posts.forEach(post => {
      if (!post || !post.id) return;

      if (!map.has(post.id)) {
        map.set(post.id, post);
      }
    });

    return [...map.values()];
  }

  // -------------------------------------------------------------
  // Prepare feed
  // -------------------------------------------------------------

  function prepare(posts, options = {}) {
    const unique = dedupe(posts);

    const ranked = rank(unique, options);

    return ranked;
  }

  // -------------------------------------------------------------
  // Reset algorithm
  // -------------------------------------------------------------

  function reset() {
    state.seen.clear();
    state.interactionHistory.clear();
    state.categoryScores.clear();
    state.creatorScores.clear();
    state.tagScores.clear();
  }

  // -------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------

  window.FreeUpperAlgorithm = {
    rank,
    prepare,
    scorePost,
    markSeen,
    markManySeen,
    hasSeen,
    registerInteraction,
    dedupe,
    reset,

    getState() {
      return {
        seen: new Set(state.seen),
        interactionHistory: new Map(state.interactionHistory),
        categoryScores: new Map(state.categoryScores),
        creatorScores: new Map(state.creatorScores),
        tagScores: new Map(state.tagScores)
      };
    }
  };

})();
