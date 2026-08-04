// =====================================================================
// index-render.js
// FreeUpper Feed Renderer v3.0.0
// =====================================================================

(function () {
  'use strict';

  const state = {
    container: null,
    posts: new Map()
  };

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------

  function escapeHTML(value) {
    const div = document.createElement('div');

    div.textContent = value == null
      ? ''
      : String(value);

    return div.innerHTML;
  }

  function escapeAttribute(value) {
    return escapeHTML(value)
      .replace(/"/g, '&quot;');
  }

  function formatNumber(value) {
    const number = Number(value) || 0;

    if (number < 1000) {
      return String(number);
    }

    if (number < 1000000) {
      return `${(number / 1000)
        .toFixed(number >= 10000 ? 0 : 1)}K`;
    }

    if (number < 1000000000) {
      return `${(number / 1000000)
        .toFixed(number >= 10000000 ? 0 : 1)}M`;
    }

    return `${(number / 1000000000)
      .toFixed(1)}B`;
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const diff =
      Date.now() - date.getTime();

    const seconds =
      Math.floor(diff / 1000);

    if (seconds < 60) {
      return 'now';
    }

    const minutes =
      Math.floor(seconds / 60);

    if (minutes < 60) {
      return `${minutes}m`;
    }

    const hours =
      Math.floor(minutes / 60);

    if (hours < 24) {
      return `${hours}h`;
    }

    const days =
      Math.floor(hours / 24);

    if (days < 7) {
      return `${days}d`;
    }

    return date.toLocaleDateString(
      undefined,
      {
        month: 'short',
        day: 'numeric'
      }
    );
  }

  function profileAvatar(profile) {
    const avatar =
      profile?.avatar_url || '';

    if (avatar) {
      return `
        <img
          class="fu-avatar"
          src="${escapeAttribute(avatar)}"
          alt=""
          loading="lazy"
        >
      `;
    }

    const name =
      profile?.display_name ||
      profile?.username ||
      'A';

    return `
      <div class="fu-avatar fu-avatar-placeholder">
        ${escapeHTML(
          name.charAt(0).toUpperCase()
        )}
      </div>
    `;
  }

  function verifiedBadge(profile) {
    if (
      !profile?.verified &&
      profile?.verified_status === 'none'
    ) {
      return '';
    }

    return `
      <span
        class="fu-verified"
        aria-label="Verified"
      >
        ✓
      </span>
    `;
  }

  function renderMedia(post) {
    const media = Array.isArray(post.media)
      ? post.media
      : [];

    if (!media.length) {
      return '';
    }

    const html = media.map((item, index) => {
      const url = item?.url || '';

      if (!url) return '';

      const type =
        String(item?.type || 'image')
          .toLowerCase();

      if (type === 'video') {
        return `
          <div
            class="fu-media-item fu-video-item"
            data-media-index="${index}"
          >
            <video
              class="fu-post-video"
              src="${escapeAttribute(url)}"
              ${item.thumbnail
                ? `poster="${escapeAttribute(item.thumbnail)}"`
                : ''}
              playsinline
              preload="metadata"
              controls
            ></video>
          </div>
        `;
      }

      return `
        <div
          class="fu-media-item fu-image-item"
          data-media-index="${index}"
        >
          <img
            class="fu-post-image"
            src="${escapeAttribute(url)}"
            alt=""
            loading="lazy"
          >
        </div>
      `;
    }).join('');

    return `
      <div
        class="fu-post-media fu-media-count-${media.length}"
        data-media-count="${media.length}"
      >
        ${html}
      </div>
    `;
  }

  function renderText(post) {
    const title =
      String(post.title || '').trim();

    const content =
      String(
        post.content ||
        post.description ||
        ''
      ).trim();

    if (!title && !content) {
      return '';
    }

    return `
      <div class="fu-post-text">
        ${
          title
            ? `
              <h3 class="fu-post-title">
                ${escapeHTML(title)}
              </h3>
            `
            : ''
        }

        ${
          content
            ? `
              <div class="fu-post-content">
                ${escapeHTML(content)}
              </div>
            `
            : ''
        }
      </div>
    `;
  }

  function renderTags(post) {
    const tags =
      Array.isArray(post.tags)
        ? post.tags
        : [];

    if (!tags.length) return '';

    return `
      <div class="fu-post-tags">
        ${tags.map(tag => `
          <button
            type="button"
            class="fu-tag"
            data-action="hashtag"
            data-tag="${escapeAttribute(tag)}"
          >
            #${escapeHTML(
              String(tag).replace(/^#/, '')
            )}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderRepostContext(feedItem) {
    if (
      feedItem.feedType !== 'repost'
    ) {
      return '';
    }

    const context =
      window.PostsAPI?.getFeedContext?.(
        feedItem.post.id
      );

    if (!context?.repost) {
      return '';
    }

    const first =
      context.repost.items?.[0];

    if (!first) {
      return '';
    }

    const displayName =
      first.user?.display_name ||
      first.user?.username ||
      'Someone';

    const count =
      Number(context.repost.count) || 1;

    return `
      <div class="fu-repost-context">
        <span class="fu-repost-icon">↻</span>

        <span>
          <strong>
            ${escapeHTML(displayName)}
          </strong>

          ${
            count > 1
              ? ` and ${formatNumber(count - 1)} other${count > 2 ? 's' : ''}`
              : ''
          }

          reposted
        </span>
      </div>
    `;
  }

  function renderActions(post) {
    return `
      <div
        class="fu-post-actions"
        role="group"
        aria-label="Post actions"
      >

        <button
          type="button"
          class="fu-action ${post.likedByMe ? 'is-active' : ''}"
          data-action="like"
          data-post-id="${escapeAttribute(post.id)}"
          aria-pressed="${post.likedByMe ? 'true' : 'false'}"
        >
          <span class="fu-action-icon">
            ${post.likedByMe ? '♥' : '♡'}
          </span>

          <span class="fu-action-count">
            ${formatNumber(post.likes)}
          </span>
        </button>

        <button
          type="button"
          class="fu-action"
          data-action="comment"
          data-post-id="${escapeAttribute(post.id)}"
        >
          <span class="fu-action-icon">◯</span>

          <span class="fu-action-count">
            ${formatNumber(post.comments)}
          </span>
        </button>

        <button
          type="button"
          class="fu-action ${post.myRepost ? 'is-active' : ''}"
          data-action="repost"
          data-post-id="${escapeAttribute(post.id)}"
        >
          <span class="fu-action-icon">↻</span>

          <span class="fu-action-count">
            ${formatNumber(post.repostCount)}
          </span>
        </button>

        <button
          type="button"
          class="fu-action"
          data-action="share"
          data-post-id="${escapeAttribute(post.id)}"
        >
          <span class="fu-action-icon">↗</span>

          <span class="fu-action-count">
            ${formatNumber(post.shareCount)}
          </span>
        </button>

        <button
          type="button"
          class="fu-action fu-action-more"
          data-action="more"
          data-post-id="${escapeAttribute(post.id)}"
          aria-label="More"
        >
          ⋯
        </button>

      </div>
    `;
  }

  function renderPost(feedItem) {
    const post = feedItem.post;

    if (!post || post.is_hidden) {
      return '';
    }

    const profile =
      post.profile || {};

    const displayName =
      profile.display_name ||
      profile.username ||
      'Anonymous';

    const username =
      profile.username
        ? `@${profile.username}`
        : '';

    const soundMarkup =
      post.sound_id
        ? `
          <button
            type="button"
            class="fu-sound"
            data-action="sound"
            data-sound-id="${escapeAttribute(post.sound_id)}"
          >
            ♪ Original sound
          </button>
        `
        : '';

    return `
      <article
        class="fu-post-card"
        data-post-id="${escapeAttribute(post.id)}"
        data-feed-type="${escapeAttribute(
          feedItem.feedType || 'post'
        )}"
      >

        ${renderRepostContext(feedItem)}

        <header class="fu-post-header">

          <button
            type="button"
            class="fu-profile-button"
            data-action="profile"
            data-user-id="${escapeAttribute(
              post.user_id || ''
            )}"
          >
            ${profileAvatar(profile)}

            <span class="fu-profile-info">

              <span class="fu-display-name">
                ${escapeHTML(displayName)}
                ${verifiedBadge(profile)}
              </span>

              <span class="fu-username-time">
                ${escapeHTML(username)}

                ${
                  username
                    ? '<span>·</span>'
                    : ''
                }

                ${formatTime(post.timestamp)}
              </span>

            </span>
          </button>

          <button
            type="button"
            class="fu-more-button"
            data-action="more"
            data-post-id="${escapeAttribute(post.id)}"
            aria-label="More options"
          >
            ⋯
          </button>

        </header>

        ${renderText(post)}

        ${renderTags(post)}

        ${renderMedia(post)}

        ${soundMarkup}

        <div class="fu-post-stats">

          <span>
            ${formatNumber(post.views)} views
          </span>

          ${
            post.bookmarkCount
              ? `
                <span>
                  ${formatNumber(post.bookmarkCount)}
                  saves
                </span>
              `
              : ''
          }

        </div>

        ${renderActions(post)}

      </article>
    `;
  }

  // -------------------------------------------------------------
  // Render complete feed
  // -------------------------------------------------------------

  function renderFeed(feedItems = []) {
    if (!state.container) {
      console.warn(
        'IndexRenderer: container not initialized.'
      );
      return;
    }

    state.posts.clear();

    feedItems.forEach(item => {
      if (item?.post?.id) {
        state.posts.set(
          item.post.id,
          item
        );
      }
    });

    state.container.innerHTML =
      feedItems
        .map(renderPost)
        .join('');

    attachMediaObserver();
  }

  // -------------------------------------------------------------
  // Append feed
  // -------------------------------------------------------------

  function appendFeed(feedItems = []) {
    if (!state.container) return;

    feedItems.forEach(item => {
      if (!item?.post?.id) return;

      if (
        state.posts.has(item.post.id)
      ) {
        return;
      }

      state.posts.set(
        item.post.id,
        item
      );

      state.container.insertAdjacentHTML(
        'beforeend',
        renderPost(item)
      );
    });

    attachMediaObserver();
  }

  // -------------------------------------------------------------
  // Update single post
  // -------------------------------------------------------------

  function updatePost(post) {
    if (!post?.id) return;

    const old =
      state.posts.get(post.id);

    if (!old) return;

    const updated = {
      ...old,
      post
    };

    state.posts.set(
      post.id,
      updated
    );

    const element =
      state.container?.querySelector(
        `[data-post-id="${CSS.escape(post.id)}"]`
      );

    if (!element) return;

    const temporary =
      document.createElement('div');

    temporary.innerHTML =
      renderPost(updated);

    const newElement =
      temporary.firstElementChild;

    if (newElement) {
      element.replaceWith(newElement);
    }

    attachMediaObserver();
  }

  // -------------------------------------------------------------
  // Remove post
  // -------------------------------------------------------------

  function removePost(postId) {
    state.posts.delete(postId);

    const element =
      state.container?.querySelector(
        `[data-post-id="${CSS.escape(postId)}"]`
      );

    if (element) {
      element.remove();
    }
  }

  // -------------------------------------------------------------
  // Update counters locally
  // -------------------------------------------------------------

  function updateCounters(postId, changes = {}) {
    const item =
      state.posts.get(postId);

    if (!item) return;

    item.post = {
      ...item.post,
      ...changes
    };

    state.posts.set(
      postId,
      item
    );

    const card =
      state.container?.querySelector(
        `[data-post-id="${CSS.escape(postId)}"]`
      );

    if (!card) return;

    if (
      changes.likes !== undefined ||
      changes.likedByMe !== undefined
    ) {
      const likeButton =
        card.querySelector(
          '[data-action="like"]'
        );

      if (likeButton) {
        likeButton.classList.toggle(
          'is-active',
          !!item.post.likedByMe
        );

        const icon =
          likeButton.querySelector(
            '.fu-action-icon'
          );

        if (icon) {
          icon.textContent =
            item.post.likedByMe
              ? '♥'
              : '♡';
        }

        const count =
          likeButton.querySelector(
            '.fu-action-count'
          );

        if (count) {
          count.textContent =
            formatNumber(item.post.likes);
        }

        likeButton.setAttribute(
          'aria-pressed',
          item.post.likedByMe
            ? 'true'
            : 'false'
        );
      }
    }

    if (
      changes.comments !== undefined
    ) {
      const button =
        card.querySelector(
          '[data-action="comment"] .fu-action-count'
        );

      if (button) {
        button.textContent =
          formatNumber(item.post.comments);
      }
    }

    if (
      changes.repostCount !== undefined
    ) {
      const button =
        card.querySelector(
          '[data-action="repost"] .fu-action-count'
        );

      if (button) {
        button.textContent =
          formatNumber(
            item.post.repostCount
          );
      }
    }

    if (
      changes.shareCount !== undefined
    ) {
      const button =
        card.querySelector(
          '[data-action="share"] .fu-action-count'
        );

      if (button) {
        button.textContent =
          formatNumber(
            item.post.shareCount
          );
      }
    }
  }

  // -------------------------------------------------------------
  // Media observer
  // -------------------------------------------------------------

  let mediaObserver = null;

  function attachMediaObserver() {
    if (!state.container) return;

    if (
      !('IntersectionObserver' in window)
    ) {
      return;
    }

    if (mediaObserver) {
      mediaObserver.disconnect();
    }

    mediaObserver =
      new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) {
              return;
            }

            const card =
              entry.target.closest(
                '[data-post-id]'
              );

            if (!card) return;

            const postId =
              card.dataset.postId;

            const item =
              state.posts.get(postId);

            if (
              item &&
              window.FreeUpperFeed
            ) {
              window.FreeUpperFeed.markSeen(
                postId
              );
            }
          });
        },
        {
          threshold: 0.35
        }
      );

    state.container
      .querySelectorAll(
        '.fu-post-card'
      )
      .forEach(card => {
        mediaObserver.observe(card);
      });
  }

  // -------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------

  function init(container) {
    if (
      typeof container === 'string'
    ) {
      container =
        document.querySelector(container);
    }

    if (!container) {
      console.error(
        'IndexRenderer: feed container not found.'
      );

      return false;
    }

    state.container = container;

    return true;
  }

  // -------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------

  window.IndexRenderer = {
    init,
    renderFeed,
    appendFeed,
    updatePost,
    removePost,
    updateCounters,

    getPost(postId) {
      return state.posts.get(postId) || null;
    },

    getContainer() {
      return state.container;
    }
  };

})();
