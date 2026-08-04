// =====================================================================
// index-interactions.js – FreeUpper Feed Interactions
// =====================================================================
//
// Works with:
//   - posts.js
//   - index-feed.js
//   - index-render.js
//   - index-algorithm.js
//
// IMPORTANT:
// This file does NOT directly query Supabase.
// All database operations go through PostsAPI.
//
// Expected PostsAPI:
//   toggleLike()
//   toggleRepostAPI()
//   updateRepostComment()
//   toggleBookmark()
//   recordShare()
//   addComment()
//   incrementView()
//   toggleHidePost()
//   toggleCommentsHidden()
//   deletePost()
//   reportPost()
//
// =====================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------
  // REQUIREMENTS
  // ---------------------------------------------------------------

  if (!window.PostsAPI) {
    console.error(
      'index-interactions.js: PostsAPI is missing. Load posts.js first.'
    );
    return;
  }

  const API = window.PostsAPI;

  // ---------------------------------------------------------------
  // INTERNAL STATE
  // ---------------------------------------------------------------

  const state = {
    processing: new Set(),
    viewed: new Set(),
    shareProcessing: new Set(),
  };

  // ---------------------------------------------------------------
  // EVENT BUS
  // ---------------------------------------------------------------

  function emit(name, detail = {}) {
    try {
      window.dispatchEvent(
        new CustomEvent(`freeupper:${name}`, {
          detail,
        })
      );
    } catch (error) {
      console.warn('Interaction event error:', error);
    }
  }

  // ---------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------

  function normalizeId(id) {
    return id == null ? '' : String(id);
  }

  function lock(key) {
    if (state.processing.has(key)) return false;

    state.processing.add(key);
    return true;
  }

  function unlock(key) {
    state.processing.delete(key);
  }

  function getPostIdFromElement(element) {
    if (!element) return null;

    const postElement = element.closest(
      '[data-post-id], [data-id], article, .post-card'
    );

    if (!postElement) return null;

    return (
      postElement.dataset.postId ||
      postElement.dataset.id ||
      null
    );
  }

  function getPostElement(postId) {
    const id = normalizeId(postId);

    return (
      document.querySelector(`[data-post-id="${CSS.escape(id)}"]`) ||
      document.querySelector(`[data-id="${CSS.escape(id)}"]`)
    );
  }

  function updateCounter(postId, selectors, value) {
    const post = getPostElement(postId);
    if (!post) return;

    const list = Array.isArray(selectors)
      ? selectors
      : [selectors];

    list.forEach(selector => {
      post.querySelectorAll(selector).forEach(el => {
        el.textContent = Number(value || 0).toLocaleString();
      });
    });
  }

  function setButtonState(button, active) {
    if (!button) return;

    button.classList.toggle('active', !!active);
    button.classList.toggle('is-active', !!active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');

    if (active) {
      button.dataset.active = 'true';
    } else {
      delete button.dataset.active;
    }
  }

  function setBusy(button, busy) {
    if (!button) return;

    button.disabled = !!busy;
    button.classList.toggle('is-loading', !!busy);

    if (busy) {
      button.setAttribute('aria-busy', 'true');
    } else {
      button.removeAttribute('aria-busy');
    }
  }

  function toast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }

    if (typeof window.toast === 'function') {
      window.toast(message, type);
      return;
    }

    console.log(`[FreeUpper:${type}] ${message}`);
  }

  function handleError(error, fallback = 'Something went wrong.') {
    console.error('FreeUpper interaction error:', error);

    const message =
      error?.message ||
      fallback;

    toast(message, 'error');
  }

  // ---------------------------------------------------------------
  // FIND BUTTON
  // ---------------------------------------------------------------

  function findInteractionButton(postId, type) {
    const post = getPostElement(postId);
    if (!post) return null;

    return (
      post.querySelector(`[data-action="${type}"]`) ||
      post.querySelector(`[data-interaction="${type}"]`) ||
      post.querySelector(`.${type}-button`) ||
      post.querySelector(`.${type}-btn`)
    );
  }

  // ---------------------------------------------------------------
  // LIKE
  // ---------------------------------------------------------------

  async function likePost(postId, button = null) {
    postId = normalizeId(postId);

    if (!postId) return null;

    const key = `like:${postId}`;

    if (!lock(key)) return null;

    button =
      button ||
      findInteractionButton(postId, 'like');

    const previousActive =
      button?.classList.contains('active') ||
      button?.classList.contains('is-active');

    const previousCount =
      parseInt(
        button?.dataset.count ||
        button?.querySelector('[data-count]')?.textContent ||
        '0',
        10
      ) || 0;

    // -------------------------------------------------------------
    // OPTIMISTIC UI
    // -------------------------------------------------------------

    setButtonState(button, !previousActive);

    if (button) {
      button.dataset.count = String(
        Math.max(0, previousCount + (previousActive ? -1 : 1))
      );
    }

    updateCounter(
      postId,
      [
        '[data-like-count]',
        '[data-count="likes"]',
        '.like-count'
      ],
      Math.max(0, previousCount + (previousActive ? -1 : 1))
    );

    try {
      const result = await API.toggleLike(postId);

      const liked = !!result?.liked;
      const count = Number(result?.count || 0);

      setButtonState(button, liked);

      if (button) {
        button.dataset.count = String(count);
      }

      updateCounter(
        postId,
        [
          '[data-like-count]',
          '[data-count="likes"]',
          '.like-count'
        ],
        count
      );

      emit('post-like-changed', {
        postId,
        liked,
        count,
      });

      return result;

    } catch (error) {

      // Rollback optimistic UI
      setButtonState(button, previousActive);

      if (button) {
        button.dataset.count = String(previousCount);
      }

      updateCounter(
        postId,
        [
          '[data-like-count]',
          '[data-count="likes"]',
          '.like-count'
        ],
        previousCount
      );

      handleError(error, 'Unable to update like.');

      return null;

    } finally {
      unlock(key);
    }
  }

  // ---------------------------------------------------------------
  // REPOST
  // ---------------------------------------------------------------

  async function repostPost(postId, comment = '', button = null) {
    postId = normalizeId(postId);

    if (!postId) return null;

    const key = `repost:${postId}`;

    if (!lock(key)) return null;

    button =
      button ||
      findInteractionButton(postId, 'repost');

    try {
      const result = await API.toggleRepostAPI(
        postId,
        comment || ''
      );

      const reposted = !!result?.reposted;
      const count = Number(result?.count || 0);

      setButtonState(button, reposted);

      if (button) {
        button.dataset.count = String(count);
      }

      updateCounter(
        postId,
        [
          '[data-repost-count]',
          '[data-count="reposts"]',
          '.repost-count'
        ],
        count
      );

      emit('post-repost-changed', {
        postId,
        reposted,
        count,
        comment: result?.comment || '',
        time: result?.time || null,
      });

      return result;

    } catch (error) {
      handleError(error, 'Unable to repost this post.');
      return null;

    } finally {
      unlock(key);
    }
  }

  // ---------------------------------------------------------------
  // UPDATE REPOST COMMENT
  // ---------------------------------------------------------------

  async function updateRepostComment(postId, comment) {
    postId = normalizeId(postId);

    if (!postId) return null;

    const key = `repost-comment:${postId}`;

    if (!lock(key)) return null;

    try {
      const result =
        await API.updateRepostComment(
          postId,
          comment || ''
        );

      emit('post-repost-comment-changed', {
        postId,
        comment: result?.comment || '',
        count: result?.count || 0,
        time: result?.time || null,
      });

      return result;

    } catch (error) {
      handleError(
        error,
        'Unable to update repost comment.'
      );

      return null;

    } finally {
      unlock(key);
    }
  }

  // ---------------------------------------------------------------
  // BOOKMARK
  // ---------------------------------------------------------------

  async function bookmarkPost(postId, button = null) {
    postId = normalizeId(postId);

    if (!postId) return null;

    const key = `bookmark:${postId}`;

    if (!lock(key)) return null;

    button =
      button ||
      findInteractionButton(postId, 'bookmark');

    try {
      const result =
        await API.toggleBookmark(postId);

      const bookmarked =
        !!result?.bookmarked;

      const count =
        Number(result?.count || 0);

      setButtonState(
        button,
        bookmarked
      );

      if (button) {
        button.dataset.count = String(count);
      }

      updateCounter(
        postId,
        [
          '[data-bookmark-count]',
          '[data-count="bookmarks"]',
          '.bookmark-count'
        ],
        count
      );

      emit('post-bookmark-changed', {
        postId,
        bookmarked,
        count,
      });

      return result;

    } catch (error) {
      handleError(
        error,
        'Unable to update bookmark.'
      );

      return null;

    } finally {
      unlock(key);
    }
  }

  // ---------------------------------------------------------------
  // SHARE
  // ---------------------------------------------------------------

  async function sharePost(postId, shareData = {}) {
    postId = normalizeId(postId);

    if (!postId) return null;

    const key = `share:${postId}`;

    if (state.shareProcessing.has(key)) {
      return null;
    }

    state.shareProcessing.add(key);

    try {
      const result =
        await API.recordShare(postId);

      const count =
        Number(result?.count || 0);

      updateCounter(
        postId,
        [
          '[data-share-count]',
          '[data-count="shares"]',
          '.share-count'
        ],
        count
      );

      emit('post-share-recorded', {
        postId,
        count,
        alreadyShared:
          !!result?.alreadyShared,
      });

      // -----------------------------------------------------------
      // Native Web Share
      // -----------------------------------------------------------

      if (
        shareData.native !== false &&
        navigator.share
      ) {
        try {
          await navigator.share({
            title:
              shareData.title ||
              'FreeUpper',

            text:
              shareData.text ||
              '',

            url:
              shareData.url ||
              `${location.origin}/post.html?id=${encodeURIComponent(postId)}`,
          });

        } catch (shareError) {
          // User cancelling native share is not an error.
          if (
            shareError?.name !==
            'AbortError'
          ) {
            console.warn(
              'Native share failed:',
              shareError
            );
          }
        }
      }

      return result;

    } catch (error) {
      handleError(
        error,
        'Unable to share this post.'
      );

      return null;

    } finally {
      state.shareProcessing.delete(key);
    }
  }

  // ---------------------------------------------------------------
  // COMMENT
  // ---------------------------------------------------------------

  async function commentOnPost(
    postId,
    message,
    parentId = null,
    mentions = []
  ) {
    postId = normalizeId(postId);

    if (!postId) return null;

    const text =
      String(message || '').trim();

    if (!text) {
      toast(
        'Write something before commenting.',
        'warning'
      );

      return null;
    }

    const key =
      `comment:${postId}:${parentId || 'root'}`;

    if (!lock(key)) return null;

    try {
      const comment =
        await API.addComment(
          postId,
          parentId,
          text,
          mentions
        );

      emit('post-comment-added', {
        postId,
        parentId,
        comment,
      });

      return comment;

    } catch (error) {
      handleError(
        error,
        'Unable to add comment.'
      );

      return null;

    } finally {
      unlock(key);
    }
  }

  // ---------------------------------------------------------------
  // VIEW
  // ---------------------------------------------------------------

  async function recordPostView(postId) {
    postId = normalizeId(postId);

    if (!postId) return;

    // Only record once per browser session.
    if (state.viewed.has(postId)) {
      return;
    }

    state.viewed.add(postId);

    try {
      await API.incrementView(postId);

      emit('post-view-recorded', {
        postId,
      });

    } catch (error) {
      // Views should never break the feed.
      console.warn(
        'Unable to record post view:',
        error
      );
    }
  }

  // ---------------------------------------------------------------
  // HIDE / UNHIDE
  // ---------------------------------------------------------------

  async function hidePost(postId, hidden = true) {
    postId = normalizeId(postId);

    if (!postId) return null;

    const key =
      `hide:${postId}`;

    if (!lock(key)) return null;

    try {
      const result =
        await API.toggleHidePost(
          postId,
          !!hidden
        );

      emit('post-hidden-changed', {
        postId,
        hidden:
          !!result?.is_hidden,
      });

      return result;

    } catch (error) {
      handleError(
        error,
        'Unable to hide this post.'
      );

      return null;

    } finally {
      unlock(key);
    }
  }

  // ---------------------------------------------------------------
  // COMMENTS ON / OFF
  // ---------------------------------------------------------------

  async function toggleComments(
    postId,
    hidden = true
  ) {
    postId = normalizeId(postId);

    if (!postId) return null;

    const key =
      `comments-hidden:${postId}`;

    if (!lock(key)) return null;

    try {
      const result =
        await API.toggleCommentsHidden(
          postId,
          !!hidden
        );

      emit('post-comments-visibility-changed', {
        postId,
        commentsHidden:
          !!result?.commentsHidden,
      });

      return result;

    } catch (error) {
      handleError(
        error,
        'Unable to update comment settings.'
      );

      return null;

    } finally {
      unlock(key);
    }
  }

  // ---------------------------------------------------------------
  // DELETE POST
  // ---------------------------------------------------------------

  async function deletePost(postId) {
    postId = normalizeId(postId);

    if (!postId) return false;

    const key =
      `delete:${postId}`;

    if (!lock(key)) return false;

    try {
      await API.deletePost(postId);

      emit('post-deleted', {
        postId,
      });

      return true;

    } catch (error) {
      handleError(
        error,
        'Unable to delete this post.'
      );

      return false;

    } finally {
      unlock(key);
    }
  }

  // ---------------------------------------------------------------
  // REPORT
  // ---------------------------------------------------------------

  async function reportPost(
    postId,
    reason
  ) {
    postId = normalizeId(postId);

    if (!postId) return null;

    const key =
      `report:${postId}`;

    if (!lock(key)) return null;

    try {
      const result =
        await API.reportPost(
          postId,
          reason
        );

      emit('post-reported', {
        postId,
        reason,
        result,
      });

      toast(
        'Thanks. Your report has been submitted.',
        'success'
      );

      return result;

    } catch (error) {
      handleError(
        error,
        'Unable to report this post.'
      );

      return null;

    } finally {
      unlock(key);
    }
  }

  // ---------------------------------------------------------------
  // REACTION / INTERACTION DISPATCHER
  // ---------------------------------------------------------------

  async function handleAction(
    action,
    postId,
    options = {}
  ) {
    switch (action) {

      case 'like':
        return likePost(
          postId,
          options.button
        );

      case 'repost':
        return repostPost(
          postId,
          options.comment || '',
          options.button
        );

      case 'bookmark':
        return bookmarkPost(
          postId,
          options.button
        );

      case 'share':
        return sharePost(
          postId,
          options
        );

      case 'comment':
        return commentOnPost(
          postId,
          options.message,
          options.parentId || null,
          options.mentions || []
        );

      case 'view':
        return recordPostView(postId);

      case 'hide':
        return hidePost(
          postId,
          true
        );

      case 'unhide':
        return hidePost(
          postId,
          false
        );

      case 'comments-on':
        return toggleComments(
          postId,
          false
        );

      case 'comments-off':
        return toggleComments(
          postId,
          true
        );

      case 'delete':
        return deletePost(postId);

      case 'report':
        return reportPost(
          postId,
          options.reason
        );

      default:
        console.warn(
          `Unknown FreeUpper interaction: ${action}`
        );

        return null;
    }
  }

  // ---------------------------------------------------------------
  // DATA ATTRIBUTE EVENT DELEGATION
  // ---------------------------------------------------------------
  //
  // Your HTML can use:
  //
  // <button
  //   data-action="like"
  //   data-post-id="POST_ID">
  // </button>
  //
  // or place data-post-id on the post card:
  //
  // <article data-post-id="POST_ID">
  //   <button data-action="like"></button>
  // </article>
  //
  // ---------------------------------------------------------------

  document.addEventListener(
    'click',
    async function (event) {

      const button =
        event.target.closest(
          '[data-action]'
        );

      if (!button) return;

      const action =
        button.dataset.action;

      // Only handle interaction actions.
      const supported = [
        'like',
        'repost',
        'bookmark',
        'share',
        'hide',
        'unhide',
        'comments-on',
        'comments-off',
        'delete',
        'report',
      ];

      if (!supported.includes(action)) {
        return;
      }

      const postId =
        button.dataset.postId ||
        getPostIdFromElement(button);

      if (!postId) {
        console.warn(
          'FreeUpper interaction: post ID missing.'
        );
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      setBusy(button, true);

      try {

        if (action === 'share') {
          await sharePost(
            postId,
            {
              title:
                button.dataset.shareTitle ||
                'FreeUpper',

              text:
                button.dataset.shareText ||
                '',

              url:
                button.dataset.shareUrl ||
                `${location.origin}/post.html?id=${encodeURIComponent(postId)}`,
            }
          );

        } else if (
          action === 'hide' ||
          action === 'unhide'
        ) {

          await hidePost(
            postId,
            action === 'hide'
          );

        } else if (
          action === 'comments-on' ||
          action === 'comments-off'
        ) {

          await toggleComments(
            postId,
            action === 'comments-off'
          );

        } else if (action === 'delete') {

          const confirmed =
            window.confirm(
              'Delete this post permanently?'
            );

          if (!confirmed) return;

          await deletePost(postId);

        } else if (action === 'report') {

          await reportPost(
            postId,
            button.dataset.reason ||
            'Inappropriate content'
          );

        } else {

          await handleAction(
            action,
            postId,
            {
              button,
            }
          );
        }

      } finally {
        setBusy(button, false);
      }
    },
    false
  );

  // ---------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------

  window.IndexInteractions = {

    // Main interactions
    likePost,
    repostPost,
    updateRepostComment,
    bookmarkPost,
    sharePost,

    // Comments
    commentOnPost,

    // Views
    recordPostView,

    // Post controls
    hidePost,
    toggleComments,
    deletePost,
    reportPost,

    // Dispatcher
    handleAction,

    // Helpers
    emit,

    // State
    get processing() {
      return state.processing;
    },

    get viewed() {
      return state.viewed;
    },
  };

  console.log(
    '✅ FreeUpper index-interactions.js loaded.'
  );

})();
