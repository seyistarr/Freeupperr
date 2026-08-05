// =====================================================================
// index-feed.js
// FreeUpper Feed Controller — v4.0.0
// =====================================================================
//
// PURPOSE
// -----------------------------------------------------------------
// This is the middle layer between data and ranking:
//
//   posts.js (raw data) → index-feed.js (this file) → index-algorithm.js
//                              ↓
//                     ranked, paginated feed
//                              ↓
//                  index.html's existing render functions
//
// It does NOT:
//   - render any HTML
//   - query Supabase directly for posts (PostsAPI does that)
//   - decide scoring math (index-algorithm.js does that)
//
// It DOES:
//   - load a candidate pool from PostsAPI
//   - run it through FreeUpperAlgorithm.rank()
//   - hand out pages of ranked posts (matches your PAGE_SIZE pattern)
//   - load/cache the user's profile.interests from Supabase
//   - debounce-save interest updates so we don't hammer the DB on
//     every single like
//   - track per-creator affinity in memory + localStorage
//   - listen to PostsAPI realtime and re-rank/patch as needed
//   - expose a small event bus so index.html can react without
//     this file knowing anything about your DOM
//
// DEPENDENCIES:
//   window.PostsAPI          (posts.js)
//   window.FreeUpperAlgorithm (index-algorithm.js)
//   window.sb                (Supabase client, for profile persistence)
//
// =====================================================================

(function () {
  'use strict';

  if (!window.PostsAPI) {
    console.error('index-feed.js: PostsAPI missing. Load posts.js first.');
    return;
  }
  if (!window.FreeUpperAlgorithm) {
    console.error('index-feed.js: FreeUpperAlgorithm missing. Load index-algorithm.js first.');
    return;
  }

  const API = window.PostsAPI;
  const Algorithm = window.FreeUpperAlgorithm;

  // ===================================================================
  // CONFIG
  // ===================================================================
  const CONFIG = {
    CANDIDATE_POOL_SIZE: 100,   // how many posts we pull + rank at once
    PAGE_SIZE: 5,               // matches your existing index.html PAGE_SIZE
    INTEREST_SAVE_DEBOUNCE_MS: 4000,
    CREATOR_SCORES_STORAGE_KEY: 'freeupper_creator_scores',
    SEEN_STORAGE_KEY: 'freeupper_seen_posts',
    MAX_STORED_SEEN: 500
  };

  // ===================================================================
  // STATE
  // ===================================================================
  const state = {
    profile: null,               // { id, interests: {...}, onboarding_completed }
    rawPosts: [],                // unranked candidate pool from PostsAPI
    rankedPosts: [],             // after FreeUpperAlgorithm.rank()
    creatorScores: new Map(),    // userId -> 0..1 affinity
    source: 'composer',
    page: 0,                     // current page index into rankedPosts
    loading: false,
    refreshing: false,
    hasMore: true,
    initialized: false,
    realtimeStarted: false,
    interestSaveTimer: null,
    pendingInterests: null
  };

  // ===================================================================
  // EVENT BUS
  // ===================================================================
  const bus = new EventTarget();
  function emit(name, detail = {}) {
    bus.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // ===================================================================
  // PROFILE / INTERESTS
  // ===================================================================
  async function loadProfile(userId) {
    if (!userId) {
      state.profile = null;
      return null;
    }
    try {
      const { data, error } = await window.sb
        .from('profiles')
        .select('id, interests, onboarding_completed')
        .eq('id', userId)
        .single();
      if (error) throw error;
      state.profile = {
        id: data.id,
        interests: data.interests || {},
        onboarding_completed: !!data.onboarding_completed
      };
      return state.profile;
    } catch (err) {
      console.warn('index-feed.js: failed to load profile interests:', err);
      state.profile = { id: userId, interests: {}, onboarding_completed: false };
      return state.profile;
    }
  }

  function getProfile() {
    return state.profile;
  }

  function needsOnboarding() {
    return !!state.profile && !state.profile.onboarding_completed;
  }

  // Debounced save so we don't write to Supabase on every single tap.
  // Multiple registerInteraction() calls within the window get merged
  // into one write of the latest interests object.
  function scheduleInterestSave(interests) {
    state.pendingInterests = interests;
    if (state.interestSaveTimer) {
      clearTimeout(state.interestSaveTimer);
    }
    state.interestSaveTimer = setTimeout(async () => {
      const toSave = state.pendingInterests;
      state.pendingInterests = null;
      state.interestSaveTimer = null;
      if (!state.profile || !state.profile.id || !toSave) return;
      try {
        await window.sb
          .from('profiles')
          .update({ interests: toSave })
          .eq('id', state.profile.id);
        emit('interests-saved', { interests: toSave });
      } catch (err) {
        console.warn('index-feed.js: failed to save interests:', err);
      }
    }, CONFIG.INTEREST_SAVE_DEBOUNCE_MS);
  }

  // Called by index.html once, right after onboarding chips are submitted.
  // This writes immediately (no debounce) since it's a deliberate one-time action.
  async function saveOnboardingInterests(interestsObject) {
    if (!state.profile || !state.profile.id) return false;
    try {
      await window.sb
        .from('profiles')
        .update({ interests: interestsObject, onboarding_completed: true })
        .eq('id', state.profile.id);
      state.profile.interests = interestsObject;
      state.profile.onboarding_completed = true;
      emit('onboarding-completed', { interests: interestsObject });
      return true;
    } catch (err) {
      console.error('index-feed.js: failed to save onboarding interests:', err);
      return false;
    }
  }

  // ===================================================================
  // CREATOR SCORES (in-memory + localStorage persistence)
  // ===================================================================
  function loadCreatorScoresFromStorage() {
    try {
      const raw = localStorage.getItem(CONFIG.CREATOR_SCORES_STORAGE_KEY);
      if (!raw) return new Map();
      const obj = JSON.parse(raw);
      return new Map(Object.entries(obj));
    } catch (_) {
      return new Map();
    }
  }

  function saveCreatorScoresToStorage() {
    try {
      const obj = Object.fromEntries(state.creatorScores);
      localStorage.setItem(CONFIG.CREATOR_SCORES_STORAGE_KEY, JSON.stringify(obj));
    } catch (_) {
      // localStorage full or unavailable — non-fatal, just skip persistence
    }
  }

  // ===================================================================
  // SEEN POSTS (persisted across reloads so scroll position feels stable)
  // ===================================================================
  function loadSeenFromStorage() {
    try {
      const raw = localStorage.getItem(CONFIG.SEEN_STORAGE_KEY);
      if (!raw) return;
      const ids = JSON.parse(raw);
      Algorithm.markManySeen(ids);
    } catch (_) { /* non-fatal */ }
  }

  function saveSeenToStorage(postId) {
    try {
      const raw = localStorage.getItem(CONFIG.SEEN_STORAGE_KEY);
      let ids = raw ? JSON.parse(raw) : [];
      if (!ids.includes(postId)) {
        ids.push(postId);
        if (ids.length > CONFIG.MAX_STORED_SEEN) {
          ids = ids.slice(ids.length - CONFIG.MAX_STORED_SEEN);
        }
        localStorage.setItem(CONFIG.SEEN_STORAGE_KEY, JSON.stringify(ids));
      }
    } catch (_) { /* non-fatal */ }
  }

  // ===================================================================
  // RANKING
  // ===================================================================
  function rerank() {
    state.rankedPosts = Algorithm.rank(
      state.rawPosts,
      state.profile,
      state.creatorScores
    );
    state.page = 0; // reset pagination whenever the ranking changes
  }

  // ===================================================================
  // CANDIDATE POOL LOADING
  // ===================================================================
  // Note: this pulls a larger pool than one page needs (CANDIDATE_POOL_SIZE)
  // so the algorithm has enough posts to meaningfully rank. Pagination
  // afterward (getPage / loadMore) just slices the already-ranked array —
  // it does NOT re-query Supabase per page. This matches your existing
  // index.html pattern of loading everything then paginating client-side.
  // ===================================================================
  async function loadCandidatePool(source) {
    const items = await API.loadFeedWithReposts(0, CONFIG.CANDIDATE_POOL_SIZE, source);
    // Unwrap { feedType, sortTime, post } → flat post objects, but keep
    // feedType/context accessible via PostsAPI.getFeedContext(post.id)
    // exactly like your current index.html already does.
    return items.map(item => item.post).filter(Boolean);
  }

  // ===================================================================
  // PUBLIC: INITIAL LOAD
  // ===================================================================
  async function loadInitial(options = {}) {
    if (state.loading) return getCurrentPage();
    state.loading = true;

    const source = options.source !== undefined ? options.source : state.source;
    state.source = source;

    try {
      const userId = options.userId || state.profile?.id || null;

      if (userId && !state.profile) {
        await loadProfile(userId);
      }
      if (!state.creatorScores.size) {
        state.creatorScores = loadCreatorScoresFromStorage();
      }
      loadSeenFromStorage();

      state.rawPosts = await loadCandidatePool(source);
      rerank();
      state.hasMore = state.rawPosts.length >= CONFIG.CANDIDATE_POOL_SIZE;
      state.initialized = true;

      emit('loaded', { posts: getCurrentPage() });
      return getCurrentPage();
    } catch (err) {
      console.error('index-feed.js: loadInitial error:', err);
      emit('error', { error: err });
      return [];
    } finally {
      state.loading = false;
    }
  }

  // ===================================================================
  // PUBLIC: PAGINATION (client-side, over the already-ranked pool)
  // ===================================================================
  function getCurrentPage() {
    const start = 0;
    const end = (state.page + 1) * CONFIG.PAGE_SIZE;
    return state.rankedPosts.slice(start, end);
  }

  function loadNextPage() {
    const maxPage = Math.ceil(state.rankedPosts.length / CONFIG.PAGE_SIZE) - 1;
    if (state.page >= maxPage) {
      // Ran out of ranked posts — try pulling a fresh, larger pool.
      return loadMoreFromSource();
    }
    state.page += 1;
    const posts = getCurrentPage();
    emit('page-advanced', { posts, page: state.page });
    return posts;
  }

  // Falls back to re-fetching more candidates from PostsAPI when the
  // ranked pool is exhausted (user has scrolled through everything).
  async function loadMoreFromSource() {
    if (state.loading || !state.hasMore) return getCurrentPage();
    state.loading = true;
    try {
      const items = await API.loadFeedWithReposts(
        state.rawPosts.length,
        CONFIG.CANDIDATE_POOL_SIZE,
        state.source
      );
      const newPosts = items.map(item => item.post).filter(Boolean);
      if (!newPosts.length) {
        state.hasMore = false;
        emit('end');
        return getCurrentPage();
      }
      // Merge, dedupe by id, re-rank the whole thing.
      const merged = new Map(state.rawPosts.map(p => [p.id, p]));
      newPosts.forEach(p => merged.set(p.id, p));
      state.rawPosts = [...merged.values()];
      rerank();
      state.page = Math.floor((state.rawPosts.length - newPosts.length) / CONFIG.PAGE_SIZE);
      state.hasMore = newPosts.length >= CONFIG.CANDIDATE_POOL_SIZE;
      const posts = getCurrentPage();
      emit('more', { posts });
      return posts;
    } catch (err) {
      console.error('index-feed.js: loadMoreFromSource error:', err);
      emit('error', { error: err });
      return getCurrentPage();
    } finally {
      state.loading = false;
    }
  }

  // ===================================================================
  // PUBLIC: REFRESH (pull-to-refresh, tab switch, logo tap)
  // ===================================================================
  async function refresh(options = {}) {
    if (state.refreshing) return getCurrentPage();
    state.refreshing = true;
    try {
      Algorithm.resetSeen();
      const source = options.source !== undefined ? options.source : state.source;
      state.source = source;
      state.rawPosts = await loadCandidatePool(source);
      rerank();
      state.hasMore = state.rawPosts.length >= CONFIG.CANDIDATE_POOL_SIZE;
      emit('refreshed', { posts: getCurrentPage() });
      return getCurrentPage();
    } catch (err) {
      console.error('index-feed.js: refresh error:', err);
      emit('error', { error: err });
      return [];
    } finally {
      state.refreshing = false;
    }
  }

  // ===================================================================
  // PUBLIC: SOURCE SWITCH (e.g. composer vs studio feeds, if you use that)
  // ===================================================================
  async function setSource(source) {
    return refresh({ source });
  }

  // ===================================================================
  // PUBLIC: INTERACTION REGISTRATION
  // ===================================================================
  // Call this from index-interactions.js / your existing toggleReaction()
  // etc. right after a successful API call. Example:
  //
  //   const result = await PostsAPI.toggleLike(postId);
  //   FreeUpperFeed.registerInteraction(postId, result.liked ? 'like' : 'unlike');
  //
  // This updates BOTH the topic-interest vector and the creator-affinity
  // map, then debounce-saves the interest vector to Supabase.
  // ===================================================================
  function registerInteraction(postId, type) {
    const post = state.rawPosts.find(p => p.id === postId);
    if (!post) return;

    // Update topic interests
    if (state.profile) {
      const updated = Algorithm.updateInterests(state.profile.interests, post, type);
      state.profile.interests = updated;
      scheduleInterestSave(updated);
    }

    // Update creator affinity
    state.creatorScores = Algorithm.updateCreatorScore(
      state.creatorScores,
      post.user_id,
      type
    );
    saveCreatorScoresToStorage();

    // A meaningful interaction implicitly counts as "seen"
    markSeen(postId);

    emit('interaction-registered', { postId, type });
  }

  // ===================================================================
  // PUBLIC: SEEN TRACKING
  // ===================================================================
  function markSeen(postId) {
    Algorithm.markSeen(postId);
    saveSeenToStorage(postId);
  }

  function markManySeen(ids = []) {
    ids.forEach(markSeen);
  }

  // ===================================================================
  // PUBLIC: LOCAL PATCHING (for optimistic UI / realtime updates)
  // ===================================================================
  function patchPost(postId, changes = {}) {
    const idx = state.rawPosts.findIndex(p => p.id === postId);
    if (idx === -1) return null;
    const updated = { ...state.rawPosts[idx], ...changes };
    // Clear cached topic inference if text fields changed
    if (changes.title || changes.content || changes.description || changes.tags) {
      delete updated._topics;
    }
    state.rawPosts[idx] = updated;
    const rankedIdx = state.rankedPosts.findIndex(p => p.id === postId);
    if (rankedIdx !== -1) {
      state.rankedPosts[rankedIdx] = updated;
    }
    emit('post-patched', { post: updated });
    return updated;
  }

  function removePost(postId) {
    state.rawPosts = state.rawPosts.filter(p => p.id !== postId);
    state.rankedPosts = state.rankedPosts.filter(p => p.id !== postId);
    emit('post-removed', { postId });
  }

  async function reloadSinglePost(postId) {
    try {
      const fresh = await API.loadPostById(postId);
      if (fresh) {
        patchPost(postId, fresh);
      }
      return fresh;
    } catch (err) {
      console.warn('index-feed.js: reloadSinglePost error:', err);
      return null;
    }
  }

  // ===================================================================
  // REALTIME
  // ===================================================================
  function startRealtime() {
    if (state.realtimeStarted) return;
    if (typeof API.subscribeToAll !== 'function') {
      console.warn('index-feed.js: PostsAPI.subscribeToAll unavailable.');
      return;
    }
    state.realtimeStarted = true;
    API.subscribeToAll(change => handleRealtimeChange(change));
  }

  function handleRealtimeChange(change) {
    if (!change || !change.table) return;
    const { table, event, payload } = change;

    switch (table) {
      case 'posts':
        if (event === 'INSERT') {
          emit('new-post-available', { postId: payload.id });
        } else if (event === 'UPDATE') {
          if (payload.is_hidden === true) {
            removePost(payload.id);
          } else {
            patchPost(payload.id, payload);
          }
        } else if (event === 'DELETE') {
          removePost(payload.id);
        }
        break;

      case 'post_likes':
        emit('post-like-change', { postId: payload.post_id, event });
        break;

      case 'comments':
        emit('comment-change', { postId: payload.post_id, event });
        break;

      case 'reposts':
        API.clearFeedContext?.();
        emit('repost-change', { postId: payload.post_id, event });
        break;

      case 'bookmarks':
        emit('bookmark-change', { postId: payload.post_id, event });
        break;

      case 'shares':
        emit('share-change', { postId: payload.post_id, event });
        break;
    }
  }

  function stopRealtime() {
    if (typeof API.unsubscribe === 'function') {
      API.unsubscribe();
    }
    state.realtimeStarted = false;
  }

  // ===================================================================
  // DEBUG HELPERS
  // ===================================================================
  function getState() {
    return {
      profile: state.profile,
      rawCount: state.rawPosts.length,
      rankedCount: state.rankedPosts.length,
      page: state.page,
      hasMore: state.hasMore,
      creatorScoreCount: state.creatorScores.size,
      source: state.source
    };
  }

  function explainPost(postId) {
    const post = state.rawPosts.find(p => p.id === postId);
    if (!post) return null;
    return Algorithm.explain(post, state.profile, state.creatorScores);
  }

  // ===================================================================
  // PUBLIC API
  // ===================================================================
  window.FreeUpperFeed = {
    // lifecycle
    loadInitial,
    refresh,
    setSource,

    // pagination
    getCurrentPage,
    loadNextPage,

    // profile / onboarding
    loadProfile,
    getProfile,
    needsOnboarding,
    saveOnboardingInterests,

    // interactions
    registerInteraction,
    markSeen,
    markManySeen,

    // local patching
    patchPost,
    removePost,
    reloadSinglePost,

    // realtime
    startRealtime,
    stopRealtime,

    // events
    on(name, cb) { bus.addEventListener(name, cb); },
    off(name, cb) { bus.removeEventListener(name, cb); },

    // debug
    getState,
    explainPost
  };

  console.log('✅ FreeUpper Feed Controller v4.0.0 loaded.');
})();
