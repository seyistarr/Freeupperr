// =====================================================================
// index-feed.js
// FreeUpper Feed Controller v3.0.0
// =====================================================================

(function () {
  'use strict';

  const API = window.PostsAPI;
  const Algorithm = window.FreeUpperAlgorithm;

  if (!API) {
    console.error('index-feed.js: PostsAPI missing.');
    return;
  }

  if (!Algorithm) {
    console.error('index-feed.js: FreeUpperAlgorithm missing.');
    return;
  }

  const state = {
    posts: [],
    postMap: new Map(),

    offset: 0,
    limit: 20,

    loading: false,
    refreshing: false,
    hasMore: true,

    source: 'composer',

    initialized: false,
    realtimeStarted: false,

    requestId: 0
  };

  // -------------------------------------------------------------
  // Events
  // -------------------------------------------------------------

  const events = new EventTarget();

  function emit(name, detail = {}) {
    events.dispatchEvent(
      new CustomEvent(name, { detail })
    );
  }

  // -------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------

  function getPosts() {
    return [...state.posts];
  }

  function getState() {
    return {
      ...state,
      posts: [...state.posts]
    };
  }

  // -------------------------------------------------------------
  // Normalize API feed result
  // -------------------------------------------------------------

  function normalizeFeedItems(items) {
    if (!Array.isArray(items)) return [];

    return items
      .map(item => {
        // PostsAPI v3 returns:
        // { feedType, sortTime, post }
        if (item && item.post) {
          return item;
        }

        // Safety for direct post arrays.
        return {
          feedType: 'post',
          sortTime: item?.timestamp,
          post: item
        };
      })
      .filter(item => item.post && item.post.id);
  }

  // -------------------------------------------------------------
  // Merge posts
  // -------------------------------------------------------------

  function mergeItems(items) {
    const normalized = normalizeFeedItems(items);

    normalized.forEach(item => {
      state.postMap.set(item.post.id, item);
    });

    state.posts = [...state.postMap.values()];
  }

  // -------------------------------------------------------------
  // Run algorithm
  // -------------------------------------------------------------

  function rankFeed() {
    const posts = state.posts.map(item => item.post);

    const ranked = Algorithm.prepare(posts);

    const rankedMap = new Map(
      ranked.map(post => [post.id, post])
    );

    state.posts = state.posts
      .map(item => {
        const post = rankedMap.get(item.post.id);

        if (!post) return null;

        return {
          ...item,
          post
        };
      })
      .filter(Boolean);

    return state.posts;
  }

  // -------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------

  async function loadInitial(options = {}) {
    if (state.loading) return getPosts();

    state.loading = true;

    const requestId = ++state.requestId;

    state.offset = 0;
    state.hasMore = true;

    if (options.source !== undefined) {
      state.source = options.source;
    }

    if (options.limit) {
      state.limit = options.limit;
    }

    try {
      const items = await API.loadFeedWithReposts(
        0,
        state.limit,
        state.source
      );

      if (requestId !== state.requestId) {
        return getPosts();
      }

      state.postMap.clear();
      state.posts = [];

      mergeItems(items);

      rankFeed();

      state.offset = items.length;

      if (items.length < state.limit) {
        state.hasMore = false;
      }

      state.initialized = true;

      emit('loaded', {
        posts: getPosts()
      });

      return getPosts();

    } catch (error) {
      console.error(
        'FreeUpper feed initial load error:',
        error
      );

      emit('error', { error });

      return [];
    } finally {
      state.loading = false;
    }
  }

  // -------------------------------------------------------------
  // Load more
  // -------------------------------------------------------------

  async function loadMore() {
    if (
      state.loading ||
      !state.hasMore
    ) {
      return [];
    }

    state.loading = true;

    try {
      const items = await API.loadFeedWithReposts(
        state.offset,
        state.limit,
        state.source
      );

      if (!items.length) {
        state.hasMore = false;

        emit('end');

        return [];
      }

      mergeItems(items);

      rankFeed();

      state.offset += items.length;

      if (items.length < state.limit) {
        state.hasMore = false;
      }

      emit('more', {
        posts: getPosts()
      });

      return items;

    } catch (error) {
      console.error(
        'FreeUpper loadMore error:',
        error
      );

      emit('error', { error });

      return [];

    } finally {
      state.loading = false;
    }
  }

  // -------------------------------------------------------------
  // Refresh
  // -------------------------------------------------------------

  async function refresh(options = {}) {
    if (state.refreshing) {
      return getPosts();
    }

    state.refreshing = true;

    try {
      Algorithm.reset();

      state.offset = 0;
      state.hasMore = true;

      const source =
        options.source !== undefined
          ? options.source
          : state.source;

      state.source = source;

      const items = await API.loadFeedWithReposts(
        0,
        state.limit,
        source
      );

      state.postMap.clear();
      state.posts = [];

      mergeItems(items);

      rankFeed();

      state.offset = items.length;

      if (items.length < state.limit) {
        state.hasMore = false;
      }

      emit('refreshed', {
        posts: getPosts()
      });

      return getPosts();

    } catch (error) {
      console.error(
        'FreeUpper refresh error:',
        error
      );

      emit('error', { error });

      return [];

    } finally {
      state.refreshing = false;
    }
  }

  // -------------------------------------------------------------
  // Add/update single post
  // -------------------------------------------------------------

  function upsertPost(post, feedType = 'post') {
    if (!post || !post.id) return;

    state.postMap.set(post.id, {
      feedType,
      sortTime: post.timestamp,
      post
    });

    state.posts = [...state.postMap.values()];

    rankFeed();

    emit('updated', {
      post
    });
  }

  // -------------------------------------------------------------
  // Remove post
  // -------------------------------------------------------------

  function removePost(postId) {
    if (!postId) return;

    state.postMap.delete(postId);

    state.posts = [...state.postMap.values()];

    emit('removed', {
      postId
    });
  }

  // -------------------------------------------------------------
  // Update post locally
  // -------------------------------------------------------------

  function updatePost(postId, changes = {}) {
    const item = state.postMap.get(postId);

    if (!item) return null;

    const updatedPost = {
      ...item.post,
      ...changes
    };

    state.postMap.set(postId, {
      ...item,
      post: updatedPost
    });

    state.posts = [...state.postMap.values()];

    emit('updated', {
      post: updatedPost
    });

    return updatedPost;
  }

  // -------------------------------------------------------------
  // Interaction notification
  // -------------------------------------------------------------

  function registerInteraction(postId, type) {
    const item = state.postMap.get(postId);

    if (!item) return;

    Algorithm.registerInteraction(
      item.post,
      type
    );

    Algorithm.markSeen(postId);

    emit('interaction', {
      post: item.post,
      type
    });
  }

  // -------------------------------------------------------------
  // Mark visible posts as seen
  // -------------------------------------------------------------

  function markSeen(postId) {
    Algorithm.markSeen(postId);
  }

  function markVisibleSeen(ids = []) {
    Algorithm.markManySeen(ids);
  }

  // -------------------------------------------------------------
  // Realtime
  // -------------------------------------------------------------

  function startRealtime() {
    if (state.realtimeStarted) return;

    if (
      typeof API.subscribeToAll !== 'function'
    ) {
      console.warn(
        'PostsAPI.subscribeToAll() unavailable.'
      );
      return;
    }

    state.realtimeStarted = true;

    API.subscribeToAll(change => {
      handleRealtimeChange(change);
    });
  }

  function handleRealtimeChange(change) {
    if (!change || !change.table) return;

    const table = change.table;
    const payload = change.payload || {};
    const event = change.event;

    // ---------------------------------------------------------
    // POSTS
    // ---------------------------------------------------------

    if (table === 'posts') {
      if (event === 'INSERT') {
        // Do not automatically insert every new post into the
        // user's feed if it belongs to another source.
        if (
          state.source &&
          payload.source &&
          payload.source !== state.source
        ) {
          return;
        }

        // We don't have profile information here, so reload
        // the feed to obtain the complete post shape.
        emit('new-post-available', {
          postId: payload.id
        });

        return;
      }

      if (event === 'UPDATE') {
        if (payload.is_hidden === true) {
          removePost(payload.id);
          return;
        }

        updatePost(payload.id, {
          ...payload
        });

        return;
      }

      if (event === 'DELETE') {
        removePost(payload.id);
        return;
      }
    }

    // ---------------------------------------------------------
    // LIKES
    // ---------------------------------------------------------

    if (table === 'post_likes') {
      const postId = payload.post_id;

      if (!postId) return;

      emit('post-like-change', {
        postId,
        event
      });

      return;
    }

    // ---------------------------------------------------------
    // COMMENTS
    // ---------------------------------------------------------

    if (table === 'comments') {
      const postId = payload.post_id;

      if (!postId) return;

      emit('comment-change', {
        postId,
        event
      });

      return;
    }

    // ---------------------------------------------------------
    // REPOSTS
    // ---------------------------------------------------------

    if (table === 'reposts') {
      const postId = payload.post_id;

      if (!postId) return;

      // Repost changes can affect ranking.
      emit('repost-change', {
        postId,
        event
      });

      return;
    }

    // ---------------------------------------------------------
    // BOOKMARKS
    // ---------------------------------------------------------

    if (table === 'bookmarks') {
      emit('bookmark-change', {
        postId: payload.post_id,
        event
      });

      return;
    }

    // ---------------------------------------------------------
    // SHARES
    // ---------------------------------------------------------

    if (table === 'shares') {
      emit('share-change', {
        postId: payload.post_id,
        event
      });
    }
  }

  // -------------------------------------------------------------
  // Reload one post
  // -------------------------------------------------------------

  async function reloadPost(postId) {
    if (!postId) return null;

    try {
      const post = await API.loadPostById(postId);

      if (post) {
        upsertPost(post);
      }

      return post;

    } catch (error) {
      console.error(
        'reloadPost error:',
        error
      );

      return null;
    }
  }

  // -------------------------------------------------------------
  // Change feed source
  // -------------------------------------------------------------

  async function setSource(source) {
    state.source = source || null;

    return refresh({
      source: state.source
    });
  }

  // -------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------

  window.FreeUpperFeed = {
    loadInitial,
    loadMore,
    refresh,

    getPosts,
    getState,

    upsertPost,
    updatePost,
    removePost,
    reloadPost,

    markSeen,
    markVisibleSeen,

    registerInteraction,

    startRealtime,
    handleRealtimeChange,

    setSource,

    on(name, callback) {
      events.addEventListener(name, callback);
    },

    off(name, callback) {
      events.removeEventListener(name, callback);
    }
  };

})();
