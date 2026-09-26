// ============================================================
// router.js — FreeUpper Centralized Navigation Hub
// Single source of truth for all app navigation.
// ============================================================
(function () {
  'use strict';

  // ─── HELPERS ──────────────────────────────────────────────

  /** Get the currently logged-in user (or guest) */
  function getCurrentUser() {
    if (window.AuthUser && typeof window.AuthUser.getCurrentUser === 'function') {
      return window.AuthUser.getCurrentUser();
    }
    return { id: 'guest', isLoggedIn: false };
  }

  /** Determine if a post is a video based on media_type */
  function isVideo(post) {
    if (!post) return false;
    const mediaType = post.media_type || post.mediaType || '';
    return mediaType === 'video';
  }

  /** Extract post ID from various post-like objects */
  function getPostId(post) {
    if (!post) return null;
    return post.id || post.post_id || null;
  }

  /** Safely get the current page name */
  function getCurrentPage() {
    const path = window.location.pathname;
    const page = path.split('/').pop() || 'index.html';
    return page;
  }

  /** Check if we're already on a specific page */
  function isOnPage(pageName) {
    return getCurrentPage() === pageName;
  }


  // ─── NAVIGATION METHODS ──────────────────────────────────

  /**
   * Open a post — routes to the correct page based on media type.
   * Videos → video.html?post=ID
   * Everything else → index.html?post=ID
   * If already on the correct page, updates URL without reload.
   */
  function openPost(post) {
    if (!post) {
      console.warn('Router.openPost: No post provided');
      return;
    }

    const id = getPostId(post);
    if (!id) {
      console.warn('Router.openPost: Post has no ID', post);
      return;
    }

    const targetPage = isVideo(post) ? 'video.html' : 'index.html';
    const currentPage = getCurrentPage();

    // If we're already on the target page, just update the URL (no reload)
    if (currentPage === targetPage) {
      const currentParams = new URLSearchParams(window.location.search);
      const currentPostId = currentParams.get('post');
      if (currentPostId === String(id)) {
        // Already viewing this post — do nothing
        return;
      }
      // Update URL without reloading
      history.pushState({}, '', targetPage + '?post=' + id);
      // Dispatch a custom event so the page can react
      window.dispatchEvent(new CustomEvent('router:navigate', {
        detail: { type: 'post', id: id, post: post, page: targetPage }
      }));
      return;
    }

    // Navigate to the target page
    window.location.href = targetPage + '?post=' + id;
  }

  /**
   * Open a post by ID and media type.
   * Use this when you only have an ID and a media type flag.
   */
  function openPostById(id, mediaType) {
    if (!id) {
      console.warn('Router.openPostById: No ID provided');
      return;
    }

    const targetPage = mediaType === 'video' ? 'video.html' : 'index.html';
    const currentPage = getCurrentPage();

    if (currentPage === targetPage) {
      const currentParams = new URLSearchParams(window.location.search);
      const currentPostId = currentParams.get('post');
      if (currentPostId === String(id)) return;
      history.pushState({}, '', targetPage + '?post=' + id);
      window.dispatchEvent(new CustomEvent('router:navigate', {
        detail: { type: 'post', id: id, mediaType: mediaType, page: targetPage }
      }));
      return;
    }

    window.location.href = targetPage + '?post=' + id;
  }

  /**
   * Open a video directly (bypasses media type check).
   */
  function openVideo(id) {
    if (!id) return;
    if (isOnPage('video.html')) {
      const currentParams = new URLSearchParams(window.location.search);
      if (currentParams.get('post') === String(id)) return;
      history.pushState({}, '', 'video.html?post=' + id);
      window.dispatchEvent(new CustomEvent('router:navigate', {
        detail: { type: 'video', id: id, page: 'video.html' }
      }));
      return;
    }
    window.location.href = 'video.html?post=' + id;
  }

  /**
   * Open a user profile.
   *
   * Accepts either:
   *   - a public FreeUpper ID (e.g. "FUA107621FDE21") → navigates directly
   *   - an internal Supabase UUID → resolved to a FreeUpper ID first
   *
   * Always performs a real navigation to /u/<FreeUpperID> so the
   * Vercel rewrite can serve profile.html.
   */
  async function openProfile(userId) {
    if (!userId) {
      console.warn('Router.openProfile: No userId provided');
      return;
    }

    // Already a public FreeUpper ID
    if (String(userId).startsWith('FU')) {
      window.location.href = '/u/' + encodeURIComponent(String(userId));
      return;
    }

    try {
      if (!window.sb) {
        console.error('Router.openProfile: Supabase client is unavailable');
        return;
      }

      const { data, error } = await window.sb.rpc(
        'get_profile_identity_by_id',
        {
          p_user_id: userId
        }
      );

      if (error) {
        console.error(
          'Router.openProfile: Failed to resolve FreeUpper ID',
          error
        );
        return;
      }

      const profile = Array.isArray(data) ? data[0] : data;

      if (!profile || !profile.freeupper_id) {
        console.warn(
          'Router.openProfile: No FreeUpper ID found for user',
          userId
        );
        return;
      }

      // Public profile URL
      window.location.href =
        '/u/' + encodeURIComponent(profile.freeupper_id);
    } catch (error) {
      console.error(
        'Router.openProfile: Unexpected error',
        error
      );
    }
  }

  /**
   * Open a marketplace listing.
   * Navigates to index.html with ?product= param.
   * index.html will read this and open the listing modal.
   */
  function openListing(listingId) {
    if (!listingId) {
      console.warn('Router.openListing: No listingId provided');
      return;
    }

    // If we're already on index.html, just update the URL
    if (isOnPage('index.html')) {
      const currentParams = new URLSearchParams(window.location.search);
      if (currentParams.get('product') === String(listingId)) return;
      history.pushState({}, '', 'index.html?product=' + listingId);
      window.dispatchEvent(new CustomEvent('router:navigate', {
        detail: { type: 'listing', id: listingId, page: 'index.html' }
      }));
      return;
    }

    window.location.href = 'index.html?product=' + listingId;
  }

  /**
   * Open a hashtag.
   * If already on search.html, enter hashtag mode without reload.
   * Otherwise, navigate to search.html?tag=...
   */
  function openHashtag(tag) {
    if (!tag) {
      console.warn('Router.openHashtag: No tag provided');
      return;
    }

    const clean = tag.replace(/^#/, '');
    const isOnSearch = isOnPage('search.html');

    if (isOnSearch && window.Search && typeof window.Search.openHashtag === 'function') {
      // Already on search page — use the search.js method (no reload)
      window.Search.openHashtag(clean);
      return;
    }

    window.location.href = 'search.html?tag=' + encodeURIComponent(clean);
  }

  /**
   * Open search with a query.
   * If already on search.html, apply the search without reload.
   * Otherwise, navigate to search.html?q=...
   */
  function openSearch(query) {
    if (!query) return;

    const isOnSearch = isOnPage('search.html');

    if (isOnSearch && window.Search && typeof window.Search.runSearch === 'function') {
      window.Search.runSearch(query);
      return;
    }

    window.location.href = 'search.html?q=' + encodeURIComponent(query);
  }

  /**
   * Navigate to chat with a specific user.
   */
  function openChat(userId) {
    if (!userId) {
      window.location.href = 'chat.html';
      return;
    }
    window.location.href = 'chat.html?uid=' + userId;
  }

  /**
   * Navigate to notifications.
   */
  function openNotifications() {
    window.location.href = 'notifications.html';
  }

  /**
   * Navigate back in history.
   */
  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = 'index.html';
    }
  }

  /**
   * Navigate to the home feed.
   */
  function goHome() {
    window.location.href = 'index.html';
  }

  /**
   * Reload the current page (useful for cache busting).
   */
  function reload() {
    window.location.reload();
  }


  // ─── URL PARAMETER HELPERS ──────────────────────────────

  /**
   * Get the current post ID from the URL.
   */
  function getCurrentPostId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('post') || null;
  }

  /**
   * Get the current product ID from the URL.
   */
  function getCurrentProductId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('product') || null;
  }

  /**
   * Get the current profile UID from the URL.
   */
  function getCurrentProfileId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('uid') || null;
  }

  /**
   * Get the current hashtag from the URL.
   */
  function getCurrentHashtag() {
    const params = new URLSearchParams(window.location.search);
    return params.get('tag') || null;
  }

  /**
   * Get the current search query from the URL.
   */
  function getCurrentSearchQuery() {
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || null;
  }


  // ─── INITIALIZATION ──────────────────────────────────────

  /**
   * Handle navigation events from the router.
   * Pages can listen to 'router:navigate' events.
   */
  function init() {
    // Listen for popstate (browser back/forward)
    window.addEventListener('popstate', function () {
      const params = new URLSearchParams(window.location.search);
      const postId = params.get('post');
      const productId = params.get('product');
      const profileId = params.get('uid');
      const hashtag = params.get('tag');
      const query = params.get('q');

      let eventDetail = { type: 'popstate' };

      if (postId) {
        eventDetail = { ...eventDetail, type: 'post', id: postId, page: getCurrentPage() };
      } else if (productId) {
        eventDetail = { ...eventDetail, type: 'listing', id: productId, page: 'index.html' };
      } else if (profileId) {
        eventDetail = { ...eventDetail, type: 'profile', id: profileId, page: 'profile.html' };
      } else if (hashtag) {
        eventDetail = { ...eventDetail, type: 'hashtag', tag: hashtag, page: 'search.html' };
      } else if (query) {
        eventDetail = { ...eventDetail, type: 'search', query: query, page: 'search.html' };
      }

      window.dispatchEvent(new CustomEvent('router:popstate', { detail: eventDetail }));
    });

    console.log('✅ Router initialized');
  }


  // ─── EXPOSE ──────────────────────────────────────────────

  window.Router = {
    // Navigation
    openPost,
    openPostById,
    openVideo,
    openProfile,
    openListing,
    openHashtag,
    openSearch,
    openChat,
    openNotifications,
    goBack,
    goHome,
    reload,

    // Helpers
    isVideo,
    getPostId,
    getCurrentUser,
    getCurrentPage,
    isOnPage,

    // URL param helpers
    getCurrentPostId,
    getCurrentProductId,
    getCurrentProfileId,
    getCurrentHashtag,
    getCurrentSearchQuery,

    // Init
    init
  };

  // Auto-init if the page is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.Router.init);
  } else {
    window.Router.init();
  }

  console.log('✅ router.js loaded (centralized navigation)');
})();
