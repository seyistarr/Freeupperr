// =====================================================================
// index-render.js
// FreeUpper Render Coordinator — v4.0.0
// =====================================================================
//
// PURPOSE
// -----------------------------------------------------------------
// This file does NOT build any HTML itself.
//
// Your existing index.html already has fully working render logic:
//   - buildPostHTML(post, index)
//   - renderFeedContainer()
//   - loadInitialFeed() / loadMorePosts()
//   - initPlayers(), setupPostEventDelegation(), etc.
//
// Instead of replacing any of that, this file is a COORDINATOR that:
//
//   1. Lets index.html "register" its own render functions once,
//      on page load.
//   2. Listens to FreeUpperFeed's events (loaded, more, refreshed,
//      post-patched, post-removed).
//   3. Calls the REGISTERED functions at the right moments, passing
//      them the ranked posts FreeUpperFeed/FreeUpperAlgorithm produced.
//   4. Handles the one generic piece every feed needs regardless of
//      markup: an IntersectionObserver that marks posts "seen" and
//      triggers view increments — without caring what your card HTML
//      looks like internally, only that it has [data-post-id].
//
// So the flow becomes:
//
//   FreeUpperFeed (ranked posts)
//        ↓ emits 'loaded' / 'more' / 'refreshed'
//   index-render.js (this file)
//        ↓ calls your registered function
//   index.html's own buildPostHTML() / renderFeedContainer()
//        ↓
//   Real DOM (unchanged from what you already built)
//
// DEPENDENCIES:
//   window.FreeUpperFeed       (index-feed.js)
//   window.FreeUpperAlgorithm  (index-algorithm.js) — only for markSeen
//
// =====================================================================

(function () {
  'use strict';

  if (!window.FreeUpperFeed) {
    console.error('index-render.js: FreeUpperFeed missing. Load index-feed.js first.');
    return;
  }

  const Feed = window.FreeUpperFeed;

  // ===================================================================
  // CONFIG
  // ===================================================================
  const CONFIG = {
    SEEN_VISIBILITY_THRESHOLD: 0.55,   // % of card visible before counting as "seen"
    SEEN_MIN_VISIBLE_MS: 600,          // must stay visible this long before it counts
    VIEW_INCREMENT_ENABLED: true       // whether this file also triggers PostsAPI.incrementView
  };

  // ===================================================================
  // STATE
  // ===================================================================
  const state = {
    // Functions index.html registers with us. Each is optional —
    // if not registered, that hook is simply skipped.
    handlers: {
      renderInitial: null,   // (posts) => void   — full feed render, e.g. your loadInitialFeed()
      appendPosts: null,     // (posts) => void   — append-only render, e.g. your loadMorePosts()
      patchPost: null,       // (post) => void    — update one card in place
      removePost: null,      // (postId) => void  — remove one card from DOM
      getContainer: null     // () => HTMLElement — returns your #feed-container element
    },
    observer: null,
    visibilityTimers: new Map(),
    registered: false
  };

  // ===================================================================
  // REGISTRATION
  // ===================================================================
  // Call this ONCE from index.html, e.g.:
  //
  //   IndexRender.registerHandlers({
  //     renderInitial: (posts) => {
  //       window._currentFeedPosts = posts;
  //       document.getElementById('feed-container').innerHTML =
  //         posts.map((p, i) => buildPostHTML(p, i)).join('');
  //       initPlayers(document.getElementById('feed-container'));
  //     },
  //     appendPosts: (posts) => { ...your existing append logic... },
  //     patchPost: (post) => { ...update counters on the matching card... },
  //     removePost: (postId) => {
  //       document.querySelectorAll(`article[data-post-id="${postId}"]`)
  //         .forEach(el => el.remove());
  //     },
  //     getContainer: () => document.getElementById('feed-container')
  //   });
  //
  // This is intentionally shallow — it does not try to guess your DOM
  // structure. index.html stays in full control of its own markup.
  // ===================================================================
  function registerHandlers(handlers = {}) {
    Object.keys(handlers).forEach(key => {
      if (typeof handlers[key] === 'function' && key in state.handlers) {
        state.handlers[key] = handlers[key];
      }
    });
    state.registered = true;
    attachFeedListeners();
    console.log('✅ index-render.js: handlers registered from index.html.');
  }

  // ===================================================================
  // FEED EVENT WIRING
  // ===================================================================
  let listenersAttached = false;

  function attachFeedListeners() {
    if (listenersAttached) return;
    listenersAttached = true;

    Feed.on('loaded', event => {
      const posts = event.detail.posts || [];
      if (state.handlers.renderInitial) {
        state.handlers.renderInitial(posts);
      }
      observeVisiblePosts();
    });

    Feed.on('refreshed', event => {
      const posts = event.detail.posts || [];
      if (state.handlers.renderInitial) {
        state.handlers.renderInitial(posts);
      }
      observeVisiblePosts();
    });

    Feed.on('page-advanced', event => {
      const posts = event.detail.posts || [];
      // page-advanced gives the FULL current page (0..N), not just new
      // items, because it's slicing an already-ranked array. If your
      // index.html append logic expects only the delta, index.html can
      // diff against window._currentFeedPosts itself — this file just
      // hands over the authoritative full list.
      if (state.handlers.renderInitial) {
        state.handlers.renderInitial(posts);
      }
      observeVisiblePosts();
    });

    Feed.on('more', event => {
      const posts = event.detail.posts || [];
      if (state.handlers.renderInitial) {
        state.handlers.renderInitial(posts);
      }
      observeVisiblePosts();
    });

    Feed.on('post-patched', event => {
      const post = event.detail.post;
      if (post && state.handlers.patchPost) {
        state.handlers.patchPost(post);
      }
    });

    Feed.on('post-removed', event => {
      const postId = event.detail.postId;
      if (postId && state.handlers.removePost) {
        state.handlers.removePost(postId);
      }
    });

    // These two are informational — index.html can choose to react
    // (e.g. show a "new posts available" banner) via its own listener
    // on FreeUpperFeed directly, or we no-op them here.
    Feed.on('post-like-change', () => {});
    Feed.on('comment-change', () => {});
  }

  // ===================================================================
  // "SEEN" / VISIBILITY TRACKING
  // ===================================================================
  // This is the one piece that's genuinely generic across any card
  // markup: watch for [data-post-id] elements entering the viewport,
  // wait a short dwell time so a fast scroll-past doesn't count, then
  // tell FreeUpperFeed/FreeUpperAlgorithm this post was seen, and
  // optionally increment its view count via PostsAPI.
  // ===================================================================
  function getContainer() {
    if (state.handlers.getContainer) {
      return state.handlers.getContainer();
    }
    return document.getElementById('feed-container') || document.body;
  }

  function ensureObserver() {
    if (state.observer) return state.observer;
    if (!('IntersectionObserver' in window)) return null;

    state.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const el = entry.target;
        const postId = el.dataset.postId;
        if (!postId) return;

        if (entry.isIntersecting && entry.intersectionRatio >= CONFIG.SEEN_VISIBILITY_THRESHOLD) {
          startVisibilityTimer(postId);
        } else {
          cancelVisibilityTimer(postId);
        }
      });
    }, {
      threshold: [0, CONFIG.SEEN_VISIBILITY_THRESHOLD, 0.9]
    });

    return state.observer;
  }

  function startVisibilityTimer(postId) {
    if (state.visibilityTimers.has(postId)) return;
    if (Feed.getState && Algorithm_hasSeen(postId)) return;

    const timer = setTimeout(() => {
      state.visibilityTimers.delete(postId);
      Feed.markSeen(postId);

      if (CONFIG.VIEW_INCREMENT_ENABLED && window.PostsAPI?.incrementView) {
        window.PostsAPI.incrementView(postId).catch(() => {
          // View tracking should never break the feed — swallow silently
        });
      }
    }, CONFIG.SEEN_MIN_VISIBLE_MS);

    state.visibilityTimers.set(postId, timer);
  }

  function cancelVisibilityTimer(postId) {
    const timer = state.visibilityTimers.get(postId);
    if (timer) {
      clearTimeout(timer);
      state.visibilityTimers.delete(postId);
    }
  }

  function Algorithm_hasSeen(postId) {
    return !!(window.FreeUpperAlgorithm && window.FreeUpperAlgorithm.hasSeen(postId));
  }

  // Call this after any render (initial, append, page-advance) to make
  // sure newly-added cards get observed. Safe to call repeatedly —
  // re-observing an already-observed element is a no-op in the spec.
  function observeVisiblePosts() {
    const observer = ensureObserver();
    if (!observer) return;
    const container = getContainer();
    if (!container) return;
    container.querySelectorAll('[data-post-id]').forEach(el => {
      observer.observe(el);
    });
  }

  // ===================================================================
  // MANUAL TRIGGER
  // ===================================================================
  // Useful if index.html swaps DOM content itself (e.g. tab switch,
  // search results) without going through FreeUpperFeed events, and
  // just wants view-tracking wired up on whatever's currently in the DOM.
  // ===================================================================
  function rescan() {
    observeVisiblePosts();
  }

  // ===================================================================
  // CLEANUP
  // ===================================================================
  function disconnect() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    state.visibilityTimers.forEach(timer => clearTimeout(timer));
    state.visibilityTimers.clear();
  }

  // ===================================================================
  // PUBLIC API
  // ===================================================================
  window.IndexRender = {
    registerHandlers,
    rescan,
    disconnect,
    // exposed for debugging in console
    getState() {
      return {
        registered: state.registered,
        activeTimers: state.visibilityTimers.size,
        handlersSet: Object.keys(state.handlers).filter(k => !!state.handlers[k])
      };
    }
  };

  console.log('✅ index-render.js v4.0.0 loaded — coordinator only, no DOM building.');
})();
