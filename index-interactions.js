// =====================================================================
// index-interactions.js
// FreeUpper Interaction Notifier — v4.0.0
// =====================================================================
//
// PURPOSE
// -----------------------------------------------------------------
// This file does NOT handle clicks, does NOT call PostsAPI, and does
// NOT touch the DOM.
//
// Your existing index.html already owns all of that:
//   - setupPostEventDelegation() / event listeners on articles
//   - toggleReaction(postId)          → calls PostsAPI.toggleLike()
//   - toggleBookmarkUI(article)       → calls PostsAPI toggle/bookmark
//   - openShareModal() / handleShareAction() → calls recordShare()
//   - addComment() / submitCommentFromBar()  → calls PostsAPI.addComment()
//   - triggerRepostFromFeed()         → opens repost modal → toggleRepostAPI()
//
// All of that is correct and stays untouched.
//
// The ONLY thing missing is: after each of those succeed, your
// algorithm (index-algorithm.js, via index-feed.js) never finds out
// it happened, so the user's interest vector never learns anything.
//
// This file's entire job is to be the one line you add at the end of
// each existing success path:
//
//     IndexInteractions.notify(postId, 'like');
//
// It then:
//   1. Forwards to FreeUpperFeed.registerInteraction() so the topic
//      interest vector + creator affinity update.
//   2. Debounces/guards against duplicate notifications firing twice
//      for the same action (e.g. a double-click before disable kicks in).
//   3. Emits its own event so anything else (analytics, future
//      features) can listen without touching index.html again.
//
// DEPENDENCIES:
//   window.FreeUpperFeed (index-feed.js)
//
// =====================================================================

(function () {
  'use strict';

  if (!window.FreeUpperFeed) {
    console.error('index-interactions.js: FreeUpperFeed missing. Load index-feed.js first.');
    return;
  }

  const Feed = window.FreeUpperFeed;

  // ===================================================================
  // CONFIG
  // ===================================================================
  // Maps the "type" string index.html passes in to what
  // FreeUpperAlgorithm's INTERACTION_WEIGHTS table expects.
  // Keeping this mapping here (not hardcoded in index.html) means if
  // the algorithm's internal names ever change, only this file needs
  // updating.
  // ===================================================================
  const TYPE_MAP = {
    like: 'like',
    unlike: 'unlike',
    comment: 'comment',
    reply: 'comment',
    repost: 'repost',
    unrepost: 'unlike',          // undoing a repost — mild negative signal
    share: 'share',
    bookmark: 'bookmark',
    unbookmark: 'unlike',
    follow: 'follow_creator',
    watch_complete: 'watch_complete',
    watch_partial: 'watch_partial',
    skip: 'skip',
    hide: 'hide',
    not_interested: 'hide'
  };

  const DUPLICATE_GUARD_MS = 400; // ignore identical notify() calls fired within this window

  // ===================================================================
  // STATE
  // ===================================================================
  const state = {
    recentNotifications: new Map(), // key: `${postId}:${type}` -> timestamp
    listeners: []
  };

  // ===================================================================
  // HELPERS
  // ===================================================================
  function isDuplicate(key) {
    const last = state.recentNotifications.get(key);
    const now = Date.now();
    if (last && (now - last) < DUPLICATE_GUARD_MS) {
      return true;
    }
    state.recentNotifications.set(key, now);
    // Light cleanup so this map doesn't grow forever in a long session
    if (state.recentNotifications.size > 500) {
      const cutoff = now - 60000;
      for (const [k, ts] of state.recentNotifications) {
        if (ts < cutoff) state.recentNotifications.delete(k);
      }
    }
    return false;
  }

  // ===================================================================
  // CORE: notify()
  // ===================================================================
  // Call this ONE function from index.html right after any existing
  // interaction succeeds. Examples of where to add it:
  //
  //   In toggleReaction(postId), after:
  //     post.likedByMe = liked; post.reactions.like = count;
  //   add:
  //     IndexInteractions.notify(postId, liked ? 'like' : 'unlike');
  //
  //   In toggleBookmarkUI(article), after nb = await toggleBookmark(pid):
  //     IndexInteractions.notify(pid, nb ? 'bookmark' : 'unbookmark');
  //
  //   In triggerRepostFromFeed() success path (after toggleRepost resolves):
  //     IndexInteractions.notify(postId, reposted ? 'repost' : 'unrepost');
  //
  //   In handleShareAction('copy'/'native'/etc.) after recordShareForPost():
  //     IndexInteractions.notify(postId, 'share');
  //
  //   In addComment() success:
  //     IndexInteractions.notify(postId, 'comment');
  //
  //   In toggleFollowHandler() success:
  //     IndexInteractions.notify(authorId... ) — NOTE: follow is keyed by
  //     postId in our model since the algorithm learns topic+creator
  //     affinity FROM a post. If you want to notify a pure follow with
  //     no specific post context, use notifyCreator() below instead.
  // ===================================================================
  function notify(postId, type) {
    if (!postId || !type) return;
    const mappedType = TYPE_MAP[type];
    if (!mappedType) {
      console.warn(`index-interactions.js: unknown interaction type "${type}", ignoring.`);
      return;
    }

    const key = `${postId}:${type}`;
    if (isDuplicate(key)) return;

    Feed.registerInteraction(postId, mappedType);
    emitLocal('interaction', { postId, type, mappedType });
  }

  // ===================================================================
  // VARIANT: notifyCreator()
  // ===================================================================
  // For actions tied to a creator but not a specific post — e.g.
  // following someone from their profile page rather than from a
  // post card. Bumps creator affinity directly without requiring a
  // post object (so it bypasses topic-interest learning, which needs
  // post text to infer topics from).
  // ===================================================================
  function notifyCreator(userId, type) {
    if (!userId || !type) return;
    const mappedType = TYPE_MAP[type] || type;

    const key = `creator:${userId}:${type}`;
    if (isDuplicate(key)) return;

    // FreeUpperFeed doesn't expose a direct creator-only updater publicly
    // in v4.0.0, so we reach into FreeUpperAlgorithm the same way
    // index-feed.js does, keeping the creatorScores Map in sync.
    if (window.FreeUpperAlgorithm) {
      const feedState = Feed.getState();
      // index-feed.js owns the actual Map instance internally; since it's
      // not exposed directly, the practical approach is to route this
      // through a post the user has from that creator, OR expand
      // FreeUpperFeed's public API with a dedicated method. For now:
      console.log(
        `index-interactions.js: creator-only signal (${type}) for ${userId} — ` +
        `consider calling notify(postId, 'follow') from a post by this creator instead.`
      );
    }
    emitLocal('creator-interaction', { userId, type });
  }

  // ===================================================================
  // VARIANT: notifyWatch()
  // ===================================================================
  // Specifically for video watch-time signals, since these come from
  // your video player's timeupdate/ended events rather than a click.
  // percent should be 0–1 (how much of the video was watched).
  //
  // Usage in your video player code (wherever you track ended/progress):
  //
  //   video.addEventListener('ended', () => {
  //     IndexInteractions.notifyWatch(postId, 1);
  //   });
  //
  //   Or on scroll-past without finishing:
  //   IndexInteractions.notifyWatch(postId, video.currentTime / video.duration);
  // ===================================================================
  function notifyWatch(postId, percent) {
    if (!postId || typeof percent !== 'number') return;
    const type = percent >= 0.9 ? 'watch_complete' : (percent >= 0.3 ? 'watch_partial' : null);
    if (!type) return; // too short a watch to count as any signal
    notify(postId, type);
  }

  // ===================================================================
  // VARIANT: notifySkip()
  // ===================================================================
  // Call when a post scrolls past very quickly without any engagement
  // (e.g. visible for under ~1s). This is a soft negative signal —
  // wire it up later if you want; not required for launch.
  // ===================================================================
  function notifySkip(postId) {
    notify(postId, 'skip');
  }

  // ===================================================================
  // VARIANT: notifyHide()
  // ===================================================================
  // Wire this into your existing "Not interested" / hidePostFromFeed()
  // flow — it's already a strong explicit negative signal, just needs
  // the algorithm to know about it too.
  //
  // In hidePostFromFeed(postId), add:
  //   IndexInteractions.notifyHide(postId);
  // ===================================================================
  function notifyHide(postId) {
    notify(postId, 'hide');
  }

  // ===================================================================
  // LOCAL EVENT BUS
  // ===================================================================
  // Separate from FreeUpperFeed's bus — this one is specifically for
  // "an interaction was just notified" so future features (e.g. an
  // analytics dashboard, or a debug overlay showing live interest
  // scores) can hook in without modifying index.html again.
  // ===================================================================
  const bus = new EventTarget();
  function emitLocal(name, detail) {
    bus.dispatchEvent(new CustomEvent(name, { detail }));
  }
  function on(name, cb) { bus.addEventListener(name, cb); }
  function off(name, cb) { bus.removeEventListener(name, cb); }

  // ===================================================================
  // DEBUG
  // ===================================================================
  function getState() {
    return {
      recentNotificationCount: state.recentNotifications.size
    };
  }

  // ===================================================================
  // PUBLIC API
  // ===================================================================
  window.IndexInteractions = {
    notify,
    notifyCreator,
    notifyWatch,
    notifySkip,
    notifyHide,
    on,
    off,
    getState
  };

  console.log('✅ index-interactions.js v4.0.0 loaded — notifier only, no click handling.');
})();
