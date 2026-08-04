// ============================================================================
// index-interactions.js
// FreeUpper Feed Interaction Controller v3.0.0
// ============================================================================
//
// RESPONSIBILITY:
//   - Like / unlike
//   - Comment
//   - Reply
//   - Repost / undo repost
//   - Bookmark / unbookmark
//   - Share
//   - View tracking
//   - Hide / unhide post
//   - Toggle comments
//   - Delete post
//   - Report post
//   - Optimistic UI
//   - Realtime interaction synchronization
//
// DEPENDENCY:
//   PostsAPI v3.0.0
//
// DOES NOT:
//   - Query Supabase directly
//   - Render the entire feed
//   - Rank posts
//   - Load feed pages
//
// Architecture:
//
// index.html
//    ↓
// index-interactions.js
//    ↓
// PostsAPI
//    ↓
// Supabase
//
// ============================================================================

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // SAFETY
  // --------------------------------------------------------------------------

  if (!window.PostsAPI) {
    console.error(
      '❌ index-interactions.js: PostsAPI is missing. Load posts.js first.'
    );
    return;
  }

  const API = window.PostsAPI;

  // --------------------------------------------------------------------------
  // CONFIG
  // --------------------------------------------------------------------------

  const CONFIG = {
    selectors: {
      feed: '[data-feed], #feed, #posts-feed, .feed-container'
    },

    view: {
      minimumVisibleMs: 700,
      cooldownMs: 8000
    },

    interaction: {
      lockMs: 500
    }
  };

  // --------------------------------------------------------------------------
  // INTERNAL STATE
  // --------------------------------------------------------------------------

  const state = {
    initialized: false,

    interactionLocks: new Set(),

    viewedPosts: new Set(),

    viewTimers: new Map(),

    viewCooldowns: new Map(),

    commentLoading: new Set(),

    pendingComments: new Set(),

    pendingReplies: new Set(),

    optimistic: new Map(),

    feedElement: null
  };

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  function log(...args) {
    if (window.FREEUPPER_DEBUG) {
      console.log('[FreeUpper Interactions]', ...args);
    }
  }

  function warn(...args) {
    console.warn('[FreeUpper Interactions]', ...args);
  }

  function getFeedElement() {
    if (state.feedElement && document.body.contains(state.feedElement)) {
      return state.feedElement;
    }

    state.feedElement =
      document.querySelector(CONFIG.selectors.feed) || document.body;

    return state.feedElement;
  }

  function getPostElement(postId) {
    if (!postId) return null;

    return document.querySelector(
      `[data-post-id="${CSS.escape(String(postId))}"]`
    );
  }

  function getPostIdFromElement(element) {
    if (!element) return null;

    const post =
      element.closest('[data-post-id]') ||
      element.closest('[data-post]');

    if (!post) return null;

    return (
      post.dataset.postId ||
      post.dataset.id ||
      post.getAttribute('data-post-id') ||
      null
    );
  }

  function getButtonPostId(button) {
    return (
      button?.dataset?.postId ||
      getPostIdFromElement(button)
    );
  }

  function setButtonBusy(button, busy) {
    if (!button) return;

    button.disabled = !!busy;

    if (busy) {
      button.setAttribute('aria-busy', 'true');
      button.classList.add('is-loading');
    } else {
      button.removeAttribute('aria-busy');
      button.classList.remove('is-loading');
    }
  }

  function lock(key) {
    if (state.interactionLocks.has(key)) {
      return false;
    }

    state.interactionLocks.add(key);

    window.setTimeout(() => {
      state.interactionLocks.delete(key);
    }, CONFIG.interaction.lockMs);

    return true;
  }

  function setText(element, value) {
    if (!element) return;

    element.textContent =
      value === null || value === undefined
        ? ''
        : String(value);
  }

  function formatCount(value) {
    const count = Number(value) || 0;

    if (count < 1000) {
      return String(count);
    }

    if (count < 1000000) {
      const n = count / 1000;
      return `${n % 1 === 0 ? n : n.toFixed(1)}K`;
    }

    if (count < 1000000000) {
      const n = count / 1000000;
      return `${n % 1 === 0 ? n : n.toFixed(1)}M`;
    }

    const n = count / 1000000000;
    return `${n % 1 === 0 ? n : n.toFixed(1)}B`;
  }

  function updateCounter(postId, type, value) {
    const post = getPostElement(postId);

    if (!post) return;

    const selectors = {
      like: [
        '[data-like-count]',
        '[data-counter="likes"]',
        '.like-count'
      ],

      comment: [
        '[data-comment-count]',
        '[data-counter="comments"]',
        '.comment-count'
      ],

      repost: [
        '[data-repost-count]',
        '[data-counter="reposts"]',
        '.repost-count'
      ],

      bookmark: [
        '[data-bookmark-count]',
        '[data-counter="bookmarks"]',
        '.bookmark-count'
      ],

      share: [
        '[data-share-count]',
        '[data-counter="shares"]',
        '.share-count'
      ],

      view: [
        '[data-view-count]',
        '[data-counter="views"]',
        '.view-count'
      ]
    };

    const list = selectors[type] || [];

    list.forEach(selector => {
      post.querySelectorAll(selector).forEach(el => {
        setText(el, formatCount(value));
      });
    });
  }

  function updateActionState(postId, type, active) {
    const post = getPostElement(postId);

    if (!post) return;

    const selectors = {
      like: [
        '[data-action="like"]',
        '[data-action="toggle-like"]'
      ],

      repost: [
        '[data-action="repost"]',
        '[data-action="toggle-repost"]'
      ],

      bookmark: [
        '[data-action="bookmark"]',
        '[data-action="toggle-bookmark"]'
      ]
    };

    (selectors[type] || []).forEach(selector => {
      post.querySelectorAll(selector).forEach(button => {
        button.classList.toggle('active', !!active);
        button.classList.toggle('is-active', !!active);

        button.setAttribute(
          'aria-pressed',
          active ? 'true' : 'false'
        );

        if (active) {
          button.dataset.active = 'true';
        } else {
          delete button.dataset.active;
        }
      });
    });
  }

  function showToast(message, type = 'default') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }

    if (typeof window.toast === 'function') {
      window.toast(message, type);
      return;
    }

    log(message);
  }

  function showError(error, fallback = 'Something went wrong.') {
    console.error(error);

    const message =
      error?.message ||
      error?.error_description ||
      fallback;

    showToast(message, 'error');
  }

  // --------------------------------------------------------------------------
  // OPTIMISTIC STATE
  // --------------------------------------------------------------------------

  function saveOptimistic(postId, key, value) {
    if (!state.optimistic.has(postId)) {
      state.optimistic.set(postId, {});
    }

    state.optimistic.get(postId)[key] = value;
  }

  function getOptimistic(postId, key) {
    return state.optimistic.get(postId)?.[key];
  }

  // --------------------------------------------------------------------------
  // LIKE
  // --------------------------------------------------------------------------

  async function toggleLike(button, postId = null) {
    postId = postId || getButtonPostId(button);

    if (!postId) return;

    const lockKey = `like:${postId}`;

    if (!lock(lockKey)) return;

    setButtonBusy(button, true);

    const previousActive =
      button?.classList.contains('active') ||
      button?.classList.contains('is-active');

    try {
      // Optimistic state
      updateActionState(postId, 'like', !previousActive);

      const result = await API.toggleLike(postId);

      updateActionState(
        postId,
        'like',
        !!result.liked
      );

      updateCounter(
        postId,
        'like',
        result.count
      );

      saveOptimistic(postId, 'liked', result.liked);

      emitInteraction('like', {
        postId,
        liked: result.liked,
        count: result.count
      });

    } catch (error) {
      // Roll back
      updateActionState(
        postId,
        'like',
        previousActive
      );

      showError(error, 'Unable to update like.');
    } finally {
      setButtonBusy(button, false);
    }
  }

  // --------------------------------------------------------------------------
  // BOOKMARK
  // --------------------------------------------------------------------------

  async function toggleBookmark(button, postId = null) {
    postId = postId || getButtonPostId(button);

    if (!postId) return;

    const lockKey = `bookmark:${postId}`;

    if (!lock(lockKey)) return;

    setButtonBusy(button, true);

    const previousActive =
      button?.classList.contains('active') ||
      button?.classList.contains('is-active');

    try {
      updateActionState(
        postId,
        'bookmark',
        !previousActive
      );

      const result = await API.toggleBookmark(postId);

      updateActionState(
        postId,
        'bookmark',
        !!result.bookmarked
      );

      updateCounter(
        postId,
        'bookmark',
        result.count
      );

      saveOptimistic(
        postId,
        'bookmarked',
        result.bookmarked
      );

      emitInteraction('bookmark', {
        postId,
        bookmarked: result.bookmarked,
        count: result.count
      });

    } catch (error) {
      updateActionState(
        postId,
        'bookmark',
        previousActive
      );

      showError(
        error,
        'Unable to update bookmark.'
      );
    } finally {
      setButtonBusy(button, false);
    }
  }

  // --------------------------------------------------------------------------
  // REPOST
  // --------------------------------------------------------------------------

  async function toggleRepost(button, postId = null, comment = '') {
    postId = postId || getButtonPostId(button);

    if (!postId) return;

    const lockKey = `repost:${postId}`;

    if (!lock(lockKey)) return;

    setButtonBusy(button, true);

    const previousActive =
      button?.classList.contains('active') ||
      button?.classList.contains('is-active');

    try {
      const result = await API.toggleRepostAPI(
        postId,
        comment
      );

      updateActionState(
        postId,
        'repost',
        !!result.reposted
      );

      updateCounter(
        postId,
        'repost',
        result.count
      );

      saveOptimistic(
        postId,
        'reposted',
        result.reposted
      );

      emitInteraction('repost', {
        postId,
        reposted: result.reposted,
        count: result.count,
        comment: result.comment || '',
        time: result.time || null
      });

      // The algorithm/feed can decide whether it needs a refresh.
      document.dispatchEvent(
        new CustomEvent('freeupper:repost-changed', {
          detail: {
            postId,
            reposted: result.reposted,
            count: result.count
          }
        })
      );

    } catch (error) {
      updateActionState(
        postId,
        'repost',
        previousActive
      );

      showError(
        error,
        'Unable to repost this post.'
      );
    } finally {
      setButtonBusy(button, false);
    }
  }

  // --------------------------------------------------------------------------
  // UPDATE REPOST COMMENT
  // --------------------------------------------------------------------------

  async function updateRepostComment(
    postId,
    comment
  ) {
    if (!postId) return null;

    try {
      const result =
        await API.updateRepostComment(
          postId,
          comment || ''
        );

      emitInteraction(
        'repost-comment-updated',
        {
          postId,
          comment: result.comment || '',
          time: result.time || null
        }
      );

      return result;

    } catch (error) {
      showError(
        error,
        'Unable to update repost.'
      );

      return null;
    }
  }

  // --------------------------------------------------------------------------
  // SHARE
  // --------------------------------------------------------------------------

  async function sharePost(postId, shareData = {}) {
    if (!postId) return;

    const lockKey = `share:${postId}`;

    if (!lock(lockKey)) return;

    try {
      const url =
        shareData.url ||
        `${window.location.origin}/post.html?id=${encodeURIComponent(postId)}`;

      let nativeShared = false;

      // Native Web Share
      if (
        navigator.share &&
        shareData.useNative !== false
      ) {
        try {
          await navigator.share({
            title: shareData.title || 'FreeUpper',
            text: shareData.text || '',
            url
          });

          nativeShared = true;
        } catch (error) {
          // User cancelled native share.
          if (error?.name === 'AbortError') {
            return;
          }
        }
      }

      // If native sharing wasn't used, still record the share.
      const result =
        await API.recordShare(postId);

      updateCounter(
        postId,
        'share',
        result.count
      );

      emitInteraction('share', {
        postId,
        count: result.count,
        alreadyShared:
          result.alreadyShared,
        nativeShared
      });

      return result;

    } catch (error) {
      showError(
        error,
        'Unable to share this post.'
      );

      return null;
    }
  }

  // --------------------------------------------------------------------------
  // COPY POST LINK
  // --------------------------------------------------------------------------

  async function copyPostLink(postId) {
    if (!postId) return;

    const url =
      `${window.location.origin}/post.html?id=${encodeURIComponent(postId)}`;

    try {
      await navigator.clipboard.writeText(url);

      // Count the share even when the user copies the link.
      const result =
        await API.recordShare(postId);

      updateCounter(
        postId,
        'share',
        result.count
      );

      showToast(
        'Post link copied.',
        'success'
      );

      emitInteraction('share-copy', {
        postId,
        count: result.count
      });

      return result;

    } catch (error) {
      showError(
        error,
        'Unable to copy post link.'
      );

      return null;
    }
  }

  // --------------------------------------------------------------------------
  // COMMENTS
  // --------------------------------------------------------------------------

  async function loadComments(postId, container = null) {
    if (!postId) return [];

    if (state.commentLoading.has(postId)) {
      return [];
    }

    state.commentLoading.add(postId);

    try {
      const comments =
        await API.loadComments(postId);

      if (container) {
        renderComments(container, comments);
      }

      document.dispatchEvent(
        new CustomEvent(
          'freeupper:comments-loaded',
          {
            detail: {
              postId,
              comments
            }
          }
        )
      );

      return comments;

    } catch (error) {
      showError(
        error,
        'Unable to load comments.'
      );

      return [];

    } finally {
      state.commentLoading.delete(postId);
    }
  }

  async function addComment(
    postId,
    message,
    options = {}
  ) {
    if (!postId) return null;

    const text =
      String(message || '').trim();

    if (!text) {
      showToast(
        'Write a comment first.',
        'error'
      );

      return null;
    }

    const parentId =
      options.parentId || null;

    const mentions =
      options.mentions || [];

    const key =
      `${postId}:${parentId || 'root'}`;

    const pendingSet =
      parentId
        ? state.pendingReplies
        : state.pendingComments;

    if (pendingSet.has(key)) {
      return null;
    }

    pendingSet.add(key);

    try {
      const comment =
        await API.addComment(
          postId,
          parentId,
          text,
          mentions
        );

      emitInteraction(
        parentId
          ? 'reply-added'
          : 'comment-added',
        {
          postId,
          comment
        }
      );

      // Increment is already handled atomically by PostsAPI.
      // We only update the visual count here if the rendered card
      // is currently available.
      const post =
        getPostElement(postId);

      if (post) {
        const counter =
          post.querySelector(
            '[data-comment-count]'
          );

        if (counter) {
          const current =
            parseInt(
              counter.dataset.rawCount ||
              counter.textContent ||
              '0',
              10
            ) || 0;

          const next =
            current + 1;

          counter.dataset.rawCount =
            String(next);

          setText(
            counter,
            formatCount(next)
          );
        }
      }

      return comment;

    } catch (error) {
      showError(
        error,
        'Unable to add comment.'
      );

      return null;

    } finally {
      pendingSet.delete(key);
    }
  }

  // --------------------------------------------------------------------------
  // COMMENT LIKE
  // --------------------------------------------------------------------------

  async function toggleCommentLike(
    button,
    commentId
  ) {
    if (!commentId) return;

    const lockKey =
      `comment-like:${commentId}`;

    if (!lock(lockKey)) return;

    setButtonBusy(button, true);

    try {
      const result =
        await API.toggleCommentLike(
          commentId
        );

      const commentElement =
        document.querySelector(
          `[data-comment-id="${CSS.escape(String(commentId))}"]`
        );

      if (commentElement) {
        const count =
          commentElement.querySelector(
            '[data-comment-like-count], .comment-like-count'
          );

        if (count) {
          setText(
            count,
            formatCount(result.count)
          );
        }

        const active =
          !!result.liked;

        commentElement
          .querySelectorAll(
            '[data-action="comment-like"], [data-action="toggle-comment-like"]'
          )
          .forEach(el => {
            el.classList.toggle(
              'active',
              active
            );

            el.classList.toggle(
              'is-active',
              active
            );

            el.setAttribute(
              'aria-pressed',
              active ? 'true' : 'false'
            );
          });
      }

      emitInteraction(
        'comment-like',
        {
          commentId,
          liked: result.liked,
          count: result.count
        }
      );

      return result;

    } catch (error) {
      showError(
        error,
        'Unable to like comment.'
      );

      return null;

    } finally {
      setButtonBusy(button, false);
    }
  }

  // --------------------------------------------------------------------------
  // COMMENTS RENDERER
  // --------------------------------------------------------------------------

  function renderComments(container, comments) {
    if (!container) return;

    // If index-render.js has its own comment renderer, use it.
    if (
      typeof window.IndexRender?.renderComments ===
      'function'
    ) {
      window.IndexRender.renderComments(
        container,
        comments
      );
      return;
    }

    // Otherwise dispatch an event and allow index-render.js
    // to respond.
    document.dispatchEvent(
      new CustomEvent(
        'freeupper:render-comments',
        {
          detail: {
            container,
            comments
          }
        }
      )
    );
  }

  // --------------------------------------------------------------------------
  // VIEW TRACKING
  // --------------------------------------------------------------------------

  function observePost(postElement) {
    if (!postElement) return;

    const postId =
      getPostIdFromElement(postElement);

    if (!postId) return;

    if (
      state.viewedPosts.has(postId) ||
      state.viewCooldowns.has(postId)
    ) {
      return;
    }

    if (
      !('IntersectionObserver' in window)
    ) {
      startViewTimer(postElement);
      return;
    }

    ensureViewObserver();

    viewObserver.observe(postElement);
  }

  let viewObserver = null;

  function ensureViewObserver() {
    if (viewObserver) return;

    viewObserver =
      new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            const postId =
              getPostIdFromElement(
                entry.target
              );

            if (!postId) return;

            if (
              entry.isIntersecting &&
              entry.intersectionRatio >= 0.55
            ) {
              startViewTimer(entry.target);
            } else {
              cancelViewTimer(postId);
            }
          });
        },
        {
          threshold: [0, 0.55, 0.75, 1]
        }
      );
  }

  function startViewTimer(postElement) {
    const postId =
      getPostIdFromElement(postElement);

    if (!postId) return;

    if (
      state.viewedPosts.has(postId) ||
      state.viewCooldowns.has(postId)
    ) {
      return;
    }

    if (state.viewTimers.has(postId)) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          state.viewTimers.delete(postId);

          recordView(postId);
        },
        CONFIG.view.minimumVisibleMs
      );

    state.viewTimers.set(
      postId,
      timer
    );
  }

  function cancelViewTimer(postId) {
    const timer =
      state.viewTimers.get(postId);

    if (!timer) return;

    clearTimeout(timer);

    state.viewTimers.delete(postId);
  }

  async function recordView(postId) {
    if (!postId) return;

    if (state.viewedPosts.has(postId)) {
      return;
    }

    if (state.viewCooldowns.has(postId)) {
      return;
    }

    state.viewedPosts.add(postId);

    try {
      await API.incrementView(
        postId
      );

      emitInteraction(
        'view',
        { postId }
      );

    } catch (error) {
      // A view should never break the feed.
      warn(
        'View tracking failed:',
        error
      );

      state.viewedPosts.delete(
        postId
      );
    }

    state.viewCooldowns.set(
      postId,
      Date.now()
    );

    window.setTimeout(
      () => {
        state.viewCooldowns.delete(
          postId
        );
      },
      CONFIG.view.cooldownMs
    );
  }

  // --------------------------------------------------------------------------
  // HIDE POST
  // --------------------------------------------------------------------------

  async function hidePost(
    postId,
    hidden = true
  ) {
    if (!postId) return null;

    try {
      const result =
        await API.toggleHidePost(
          postId,
          hidden
        );

      const post =
        getPostElement(postId);

      if (post) {
        post.dataset.hidden =
          result.is_hidden
            ? 'true'
            : 'false';

        post.classList.toggle(
          'is-hidden',
          !!result.is_hidden
        );
      }

      emitInteraction(
        'post-hidden',
        {
          postId,
          hidden: result.is_hidden
        }
      );

      return result;

    } catch (error) {
      showError(
        error,
        'Unable to hide post.'
      );

      return null;
    }
  }

  // --------------------------------------------------------------------------
  // COMMENTS HIDDEN
  // --------------------------------------------------------------------------

  async function toggleCommentsHidden(
    postId,
    hidden
  ) {
    if (!postId) return null;

    try {
      const result =
        await API.toggleCommentsHidden(
          postId,
          hidden
        );

      const post =
        getPostElement(postId);

      if (post) {
        post.dataset.commentsHidden =
          result.commentsHidden
            ? 'true'
            : 'false';

        post.classList.toggle(
          'comments-disabled',
          !!result.commentsHidden
        );
      }

      emitInteraction(
        'comments-visibility-changed',
        {
          postId,
          hidden: result.commentsHidden
        }
      );

      return result;

    } catch (error) {
      showError(
        error,
        'Unable to change comment settings.'
      );

      return null;
    }
  }

  // --------------------------------------------------------------------------
  // DELETE POST
  // --------------------------------------------------------------------------

  async function deletePost(postId) {
    if (!postId) return false;

    try {
      await API.deletePost(
        postId
      );

      const post =
        getPostElement(postId);

      if (post) {
        // Let render/feed decide how removal should happen.
        post.dispatchEvent(
          new CustomEvent(
            'freeupper:post-deleted',
            {
              bubbles: true,
              detail: { postId }
            }
          )
        );

        post.remove();
      }

      emitInteraction(
        'post-deleted',
        { postId }
      );

      return true;

    } catch (error) {
      showError(
        error,
        'Unable to delete post.'
      );

      return false;
    }
  }

  // --------------------------------------------------------------------------
  // REPORT POST
  // --------------------------------------------------------------------------

  async function reportPost(
    postId,
    reason
  ) {
    if (!postId) return null;

    try {
      const result =
        await API.reportPost(
          postId,
          reason
        );

      emitInteraction(
        'post-reported',
        {
          postId,
          reason,
          result
        }
      );

      showToast(
        'Post reported. Thank you for helping keep FreeUpper safe.',
        'success'
      );

      return result;

    } catch (error) {
      showError(
        error,
        'Unable to report this post.'
      );

      return null;
    }
  }

  // --------------------------------------------------------------------------
  // EVENT BUS
  // --------------------------------------------------------------------------

  function emitInteraction(
    type,
    detail = {}
  ) {
    document.dispatchEvent(
      new CustomEvent(
        `freeupper:interaction:${type}`,
        {
          detail
        }
      )
    );

    document.dispatchEvent(
      new CustomEvent(
        'freeupper:interaction',
        {
          detail: {
            type,
            ...detail
          }
        }
      )
    );
  }

  // --------------------------------------------------------------------------
  // CLICK HANDLER
  // --------------------------------------------------------------------------

  async function handleClick(event) {
    const target =
      event.target.closest(
        '[data-action]'
      );

    if (!target) return;

    const action =
      target.dataset.action;

    const postId =
      getButtonPostId(target);

    // ------------------------------------------------------
    // LIKE
    // ------------------------------------------------------

    if (
      action === 'like' ||
      action === 'toggle-like'
    ) {
      event.preventDefault();

      await toggleLike(
        target,
        postId
      );

      return;
    }

    // ------------------------------------------------------
    // BOOKMARK
    // ------------------------------------------------------

    if (
      action === 'bookmark' ||
      action === 'toggle-bookmark'
    ) {
      event.preventDefault();

      await toggleBookmark(
        target,
        postId
      );

      return;
    }

    // ------------------------------------------------------
    // REPOST
    // ------------------------------------------------------

    if (
      action === 'repost' ||
      action === 'toggle-repost'
    ) {
      event.preventDefault();

      const comment =
        target.dataset.repostComment ||
        '';

      await toggleRepost(
        target,
        postId,
        comment
      );

      return;
    }

    // ------------------------------------------------------
    // SHARE
    // ------------------------------------------------------

    if (
      action === 'share'
    ) {
      event.preventDefault();

      await sharePost(
        postId,
        {
          title:
            target.dataset.shareTitle ||
            'FreeUpper',
          text:
            target.dataset.shareText ||
            '',
          useNative:
            target.dataset.nativeShare !== 'false'
        }
      );

      return;
    }

    // ------------------------------------------------------
    // COPY LINK
    // ------------------------------------------------------

    if (
      action === 'copy-link'
    ) {
      event.preventDefault();

      await copyPostLink(
        postId
      );

      return;
    }

    // ------------------------------------------------------
    // HIDE
    // ------------------------------------------------------

    if (
      action === 'hide-post'
    ) {
      event.preventDefault();

      await hidePost(
        postId,
        true
      );

      return;
    }

    // ------------------------------------------------------
    // UNHIDE
    // ------------------------------------------------------

    if (
      action === 'unhide-post'
    ) {
      event.preventDefault();

      await hidePost(
        postId,
        false
      );

      return;
    }

    // ------------------------------------------------------
    // DELETE
    // ------------------------------------------------------

    if (
      action === 'delete-post'
    ) {
      event.preventDefault();

      const confirmed =
        window.confirm(
          'Delete this post? This action cannot be undone.'
        );

      if (!confirmed) return;

      await deletePost(
        postId
      );

      return;
    }

    // ------------------------------------------------------
    // TURN COMMENTS OFF
    // ------------------------------------------------------

    if (
      action === 'disable-comments'
    ) {
      event.preventDefault();

      await toggleCommentsHidden(
        postId,
        true
      );

      return;
    }

    // ------------------------------------------------------
    // TURN COMMENTS ON
    // ------------------------------------------------------

    if (
      action === 'enable-comments'
    ) {
      event.preventDefault();

      await toggleCommentsHidden(
        postId,
        false
      );

      return;
    }

    // ------------------------------------------------------
    // REPORT
    // ------------------------------------------------------

    if (
      action === 'report-post'
    ) {
      event.preventDefault();

      const reason =
        target.dataset.reason ||
        'Inappropriate content';

      await reportPost(
        postId,
        reason
      );

      return;
    }

    // ------------------------------------------------------
    // COMMENTS
    // ------------------------------------------------------

    if (
      action === 'open-comments'
    ) {
      event.preventDefault();

      const container =
        target.closest(
          '[data-post-id]'
        )?.querySelector(
          '[data-comments-container]'
        );

      await loadComments(
        postId,
        container
      );

      return;
    }

    // ------------------------------------------------------
    // COMMENT LIKE
    // ------------------------------------------------------

    if (
      action === 'comment-like' ||
      action === 'toggle-comment-like'
    ) {
      event.preventDefault();

      const commentId =
        target.dataset.commentId ||
        target.closest(
          '[data-comment-id]'
        )?.dataset.commentId;

      await toggleCommentLike(
        target,
        commentId
      );

      return;
    }
  }

  // --------------------------------------------------------------------------
  // FORM HANDLER
  // --------------------------------------------------------------------------

  async function handleSubmit(event) {
    const form =
      event.target.closest(
        '[data-comment-form]'
      );

    if (!form) return;

    event.preventDefault();

    const postId =
      form.dataset.postId ||
      getPostIdFromElement(form);

    const parentId =
      form.dataset.parentId ||
      null;

    const input =
      form.querySelector(
        '[data-comment-input], textarea, input[name="comment"], textarea[name="comment"]'
      );

    if (!input) return;

    const message =
      input.value.trim();

    const mentions =
      parseMentions(input);

    const submit =
      form.querySelector(
        'button[type="submit"], [data-submit-comment]'
      );

    setButtonBusy(
      submit,
      true
    );

    try {
      const comment =
        await addComment(
          postId,
          message,
          {
            parentId,
            mentions
          }
        );

      if (!comment) return;

      input.value = '';

      emitInteraction(
        'comment-form-cleared',
        {
          postId,
          parentId
        }
      );

    } finally {
      setButtonBusy(
        submit,
        false
      );
    }
  }

  function parseMentions(input) {
    if (!input) return [];

    const text =
      input.value || '';

    const matches =
      text.match(
        /@[a-zA-Z0-9_.-]+/g
      );

    if (!matches) return [];

    return [
      ...new Set(
        matches.map(
          mention =>
            mention.slice(1)
        )
      )
    ];
  }

  // --------------------------------------------------------------------------
  // MEDIA VIEW TRACKING
  // --------------------------------------------------------------------------

  function scanForPosts() {
    const root =
      getFeedElement();

    if (!root) return;

    root
      .querySelectorAll(
        '[data-post-id]'
      )
      .forEach(
        observePost
      );
  }

  // --------------------------------------------------------------------------
  // REALTIME
  // --------------------------------------------------------------------------

  function handleRealtimeChange(change) {
    if (!change) return;

    const {
      table,
      event,
      payload,
      old
    } = change;

    log(
      'Realtime:',
      table,
      event,
      payload
    );

    // We intentionally DON'T blindly overwrite DOM here.
    //
    // index-feed.js / index-render.js can listen to these events
    // and decide whether the affected card should be patched,
    // refreshed, or re-ranked.

    document.dispatchEvent(
      new CustomEvent(
        'freeupper:realtime',
        {
          detail: {
            table,
            event,
            payload,
            old
          }
        }
      )
    );

    // Interaction-specific events.
    switch (table) {
      case 'post_likes':
        document.dispatchEvent(
          new CustomEvent(
            'freeupper:realtime:like',
            {
              detail: {
                event,
                payload,
                old
              }
            }
          )
        );
        break;

      case 'comment_likes':
        document.dispatchEvent(
          new CustomEvent(
            'freeupper:realtime:comment-like',
            {
              detail: {
                event,
                payload,
                old
              }
            }
          )
        );
        break;

      case 'reposts':
        document.dispatchEvent(
          new CustomEvent(
            'freeupper:realtime:repost',
            {
              detail: {
                event,
                payload,
                old
              }
            }
          )
        );
        break;

      case 'bookmarks':
        document.dispatchEvent(
          new CustomEvent(
            'freeupper:realtime:bookmark',
            {
              detail: {
                event,
                payload,
                old
              }
            }
          )
        );
        break;

      case 'shares':
        document.dispatchEvent(
          new CustomEvent(
            'freeupper:realtime:share',
            {
              detail: {
                event,
                payload,
                old
              }
            }
          )
        );
        break;

      case 'comments':
        document.dispatchEvent(
          new CustomEvent(
            'freeupper:realtime:comment',
            {
              detail: {
                event,
                payload,
                old
              }
            }
          )
        );
        break;

      case 'posts':
        document.dispatchEvent(
          new CustomEvent(
            'freeupper:realtime:post',
            {
              detail: {
                event,
                payload,
                old
              }
            }
          )
        );
        break;
    }
  }

  // --------------------------------------------------------------------------
  // MUTATION OBSERVER
  // --------------------------------------------------------------------------

  let mutationObserver = null;

  function observeFeedChanges() {
    const root =
      getFeedElement();

    if (!root) return;

    if (mutationObserver) {
      mutationObserver.disconnect();
    }

    mutationObserver =
      new MutationObserver(
        mutations => {
          let shouldScan = false;

          mutations.forEach(
            mutation => {
              if (
                mutation.type ===
                'childList'
              ) {
                shouldScan = true;
              }
            }
          );

          if (shouldScan) {
            scanForPosts();
          }
        }
      );

    mutationObserver.observe(
      root,
      {
        childList: true,
        subtree: true
      }
    );
  }

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  const Interactions = {

    // Likes
    toggleLike,

    // Comments
    loadComments,
    addComment,
    toggleCommentLike,

    // Reposts
    toggleRepost,
    updateRepostComment,

    // Bookmarks
    toggleBookmark,

    // Shares
    sharePost,
    copyPostLink,

    // Views
    recordView,
    observePost,

    // Moderation / ownership
    hidePost,
    toggleCommentsHidden,
    deletePost,
    reportPost,

    // UI
    updateCounter,
    updateActionState,

    // Events
    emitInteraction,

    // State
    getState() {
      return state;
    },

    refreshObservers() {
      scanForPosts();
    }
  };

  window.IndexInteractions =
    Interactions;

  // --------------------------------------------------------------------------
  // INITIALIZE
  // --------------------------------------------------------------------------

  function init() {
    if (state.initialized) return;

    state.initialized = true;

    state.feedElement =
      getFeedElement();

    // Delegated events.
    document.addEventListener(
      'click',
      handleClick
    );

    document.addEventListener(
      'submit',
      handleSubmit
    );

    // PostsAPI realtime.
    if (
      typeof API.subscribeToAll ===
      'function'
    ) {
      API.subscribeToAll(
        handleRealtimeChange
      );
    }

    scanForPosts();

    observeFeedChanges();

    log(
      '✅ index-interactions.js v3.0.0 initialized.'
    );
  }

  // --------------------------------------------------------------------------
  // DOM READY
  // --------------------------------------------------------------------------

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }

})();
