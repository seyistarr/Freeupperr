// =====================================================================
// posts.js
// FreeUpper Data/API Layer — v4.1.1 (FIXED repost subscription)
// =====================================================================
//
// PURPOSE
// -----------------------------------------------------------------
// This is the ONLY file that talks to Supabase for post + comment data.
//
//   index-algorithm.js   → never queries Supabase, only scores objects
//   index-feed.js        → calls THIS file's functions, never sb directly
//                            (except profiles.interests — owned elsewhere)
//   index-render.js      → never queries anything, pure coordinator
//   index-interactions.js→ never queries anything, pure notifier
//   index.html           → calls index-feed.js, which calls this file
//
// FEATURE CHECKLIST (everything discussed, confirmed present below):
// -----------------------------------------------------------------
//   ✅ Feed loading (candidates, with repost context, pagination)
//   ✅ Single post load / preview
//   ✅ Create / delete post
//   ✅ Comments: load, add (with parent_id for replies)
//   ✅ Comments: reply_count tracked on parent
//   ✅ Comments: edit (ownership-checked via edit_comment RPC)
//   ✅ Comments: delete (ownership-checked via delete_comment RPC —
//                author OR post-owner may delete)
//   ✅ Comments: like/unlike
//   ✅ Comments: report (shared reports table, target_type: 'comment')
//   ✅ Comments: pin/unpin (post-owner only, one pinned per post)
//   ✅ Post like/unlike, bookmark, repost (+ comment), share, view
//   ✅ Post hide/unhide, comments on/off, report, delete
//   ✅ Realtime subscriptions (full table set + legacy repost-only)
//
// DEPENDENCIES: window.sb (Supabase client) must be loaded first.
//
// =====================================================================

(function () {
  'use strict';

  // ===================================================================
  // SUPABASE
  // ===================================================================
  if (!window.sb) {
    console.error('posts.js: Supabase client missing. Load your Supabase client first.');
    return;
  }
  const sb = window.sb;

  // ===================================================================
  // CONFIG
  // ===================================================================
  const CONFIG = {
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 150,
    DEFAULT_CATEGORY: 'General',
    DEFAULT_SOURCE: 'composer',
    REALTIME_TABLES: [
      'posts',
      'comments',
      'post_likes',
      'comment_likes',
      'reposts',
      'bookmarks',
      'shares'
    ]
  };

  // ===================================================================
  // AUTH HELPERS
  // ===================================================================
  async function getCurrentUser() {
    try {
      const { data: { user }, error } = await sb.auth.getUser();
      if (error) {
        console.warn('getCurrentUser:', error);
        return null;
      }
      return user || null;
    } catch (error) {
      console.warn('getCurrentUser exception:', error);
      return null;
    }
  }

  async function requireUser() {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('You must be logged in to perform this action.');
    }
    return user;
  }

  // ===================================================================
  // GENERAL HELPERS
  // ===================================================================
  function normalizeLimit(limit) {
    const value = Number(limit);
    if (!Number.isFinite(value)) return CONFIG.DEFAULT_LIMIT;
    return Math.min(Math.max(Math.floor(value), 1), CONFIG.MAX_LIMIT);
  }

  function normalizeOffset(offset) {
    const value = Number(offset);
    if (!Number.isFinite(value)) return 0;
    return Math.max(Math.floor(value), 0);
  }

  function safeArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function safeDate(value) {
    if (!value) return new Date().toISOString();
    return value;
  }

  // ===================================================================
  // MEDIA NORMALIZATION
  // ===================================================================
  function normalizeMedia(row) {
    let media = safeArray(row.media);

    if (!media.length && row.media_url) {
      media = [{
        url: row.media_url,
        type: row.media_type || 'image',
        thumbnailUrl: row.thumbnail_url || ''
      }];
    }

    return media
      .filter(Boolean)
      .map((item) => {
        if (typeof item === 'string') {
          return { url: item, type: 'image', thumbnailUrl: '' };
        }
        return {
          ...item,
          url: item.url || '',
          type: item.type || item.media_type || 'image',
          thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || ''
        };
      })
      .filter(item => !!item.url);
  }

  // ===================================================================
  // PROFILE NORMALIZATION
  // ===================================================================
  function normalizeProfile(profile) {
    if (!profile) return null;
    return {
      id: profile.id || null,
      display_name: profile.display_name || 'Anonymous',
      username: profile.username || '',
      display_username: profile.display_username || profile.username || '',
      avatar_url: profile.avatar_url || '',
      verified: !!profile.verified,
      verified_status: profile.verified_status || 'none',
      is_private: !!profile.is_private
    };
  }

  // ===================================================================
  // MAP DATABASE POST → FREEUPPER POST
  // -------------------------------------------------------------
  // This exact shape is the contract index-algorithm.js and
  // index-feed.js were written against. Do not rename fields here
  // without updating both of those files.
  // ===================================================================
  function mapPost(row, interactionState = {}) {
    if (!row) return null;

    const media = normalizeMedia(row);
    const profile = normalizeProfile(row.profiles);

    return {
      // Identity
      id: row.id,
      user_id: row.user_id,

      // Author
      profile,

      // Content
      title: row.title || '',
      description: row.description || '',
      content: row.content || '',
      category: row.category || CONFIG.DEFAULT_CATEGORY, // legacy fallback only
      tags: safeArray(row.tags),
      mentions: safeArray(row.mentions),

      // Media
      media,
      mediaUrl: row.media_url || media[0]?.url || '',
      mediaType: row.media_type || media[0]?.type || null,
      thumbnailUrl: row.thumbnail_url || media[0]?.thumbnailUrl || row.media_url || media[0]?.url || '',

      // Sound
      sound_id: row.sound_id || null,

      // Source / text template
      source: row.source || CONFIG.DEFAULT_SOURCE,
      textTemplateId: row.text_template_id || null,

      // Timestamps
      timestamp: safeDate(row.created_at),
      createdAt: safeDate(row.created_at),
      date: safeDate(row.created_at), // alias used in places index.html reads post.date

      // Counters
      views: safeNumber(row.views),
      comments: safeNumber(row.comment_count),
      likes: safeNumber(row.like_count),
      repostCount: safeNumber(row.repost_count),
      bookmarkCount: safeNumber(row.bookmark_count),
      shareCount: safeNumber(row.share_count),

      // Current user's interaction state
      likedByMe: !!interactionState.likedByMe,
      bookmarkedByMe: !!interactionState.bookmarkedByMe,
      myRepost: !!interactionState.myRepost,
      myRepostText: interactionState.myRepost ? (interactionState.myRepost.comment || '') : '',
      myRepostTime: interactionState.myRepost ? (interactionState.myRepost.created_at || null) : null,

      // Moderation
      is_hidden: !!row.is_hidden,
      commentsHidden: !!row.comments_hidden,

      // Algorithm metadata — reserved, populated by index-algorithm.js only.
      // posts.js deliberately never writes to these.
      algorithmScore: null,
      recommendationReason: null,
      rankingSignals: null,

      // Internal cache slot used by index-algorithm.js's getPostTopics().
      // posts.js never sets this — documented here so it's not
      // accidentally stripped by a future refactor.
      _topics: undefined
    };
  }

  // ===================================================================
  // MAP DATABASE COMMENT → FREEUPPER COMMENT
  // -------------------------------------------------------------
  // Shared shape for both top-level comments and replies — a reply is
  // just a comment row with parent_id set. Includes pinned/edited state.
  // ===================================================================
  function mapComment(row, likedByMe = false) {
    if (!row) return null;
    return {
      id: row.id,
      postId: row.post_id,
      message: row.message || '',
      parentId: row.parent_id || null,
      userId: row.user_id,
      time: safeDate(row.created_at),
      updatedAt: row.updated_at || null,
      edited: !!row.edited,
      pinned: !!row.pinned,
      approved: row.approved,
      likeCount: safeNumber(row.like_count),
      replyCount: safeNumber(row.reply_count),
      likedByMe: !!likedByMe,
      profile: normalizeProfile(row.profiles) || {},
      mentions: safeArray(row.mentions)
    };
  }

  // ===================================================================
  // SELECT STRINGS
  // ===================================================================
  const POST_PROFILE_SELECT = `
    id,
    display_name,
    username,
    display_username,
    avatar_url,
    verified,
    verified_status,
    is_private
  `;

  const POST_SELECT = `
    *,
    profiles:user_id (
      ${POST_PROFILE_SELECT}
    )
  `;

  const COMMENT_SELECT = `
    *,
    profiles:user_id (
      id, display_name, username, display_username, avatar_url, verified, verified_status
    )
  `;

  // ===================================================================
  // LOAD CURRENT USER INTERACTIONS (posts)
  // ===================================================================
  async function loadInteractionState(postIds, userId = null) {
    const ids = [...new Set((postIds || []).filter(Boolean).map(String))];

    if (!ids.length || !userId) {
      return { likedIds: new Set(), bookmarkedIds: new Set(), repostMap: new Map() };
    }

    const [likesResult, bookmarksResult, repostsResult] = await Promise.all([
      sb.from('post_likes').select('post_id').eq('user_id', userId).in('post_id', ids),
      sb.from('bookmarks').select('post_id').eq('user_id', userId).in('post_id', ids),
      sb.from('reposts').select('post_id, comment, created_at').eq('user_id', userId).in('post_id', ids)
    ]);

    if (likesResult.error) console.warn('loadInteractionState likes:', likesResult.error);
    if (bookmarksResult.error) console.warn('loadInteractionState bookmarks:', bookmarksResult.error);
    if (repostsResult.error) console.warn('loadInteractionState reposts:', repostsResult.error);

    return {
      likedIds: new Set((likesResult.data || []).map(row => row.post_id)),
      bookmarkedIds: new Set((bookmarksResult.data || []).map(row => row.post_id)),
      repostMap: new Map((repostsResult.data || []).map(row => [row.post_id, row]))
    };
  }

  // ===================================================================
  // MAP MANY POSTS WITH USER STATE
  // ===================================================================
  async function mapPostsWithInteractionState(rows) {
    if (!rows || !rows.length) return [];

    const user = await getCurrentUser();
    const postIds = rows.map(row => row.id);
    const interaction = await loadInteractionState(postIds, user?.id || null);

    return rows
      .map(row => {
        const myRepost = interaction.repostMap.get(row.id) || null;
        return mapPost(row, {
          likedByMe: interaction.likedIds.has(row.id),
          bookmarkedByMe: interaction.bookmarkedIds.has(row.id),
          myRepost
        });
      })
      .filter(Boolean);
  }

  // ===================================================================
  // LOAD ALL POSTS / FEED CANDIDATES
  // ===================================================================
  async function loadAllPosts(offset = 0, limit = CONFIG.DEFAULT_LIMIT, source = null) {
    offset = normalizeOffset(offset);
    limit = normalizeLimit(limit);

    let query = sb
      .from('posts')
      .select(POST_SELECT)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (source) {
      query = query.eq('source', source);
    }

    const { data, error } = await query;

    if (error) {
      console.error('loadAllPosts error:', error);
      return [];
    }

    return mapPostsWithInteractionState(data || []);
  }

  // ===================================================================
  // LOAD FEED CANDIDATES (explicit name for clarity in the architecture)
  // ===================================================================
  async function loadFeedCandidates(options = {}) {
    const { offset = 0, limit = CONFIG.DEFAULT_LIMIT, source = null } = options;
    return loadAllPosts(offset, limit, source);
  }

  // ===================================================================
  // LOAD POSTS BY USER
  // ===================================================================
  async function loadPostsByUserId(userId, offset = 0, limit = 200) {
    if (!userId) return [];

    offset = normalizeOffset(offset);
    limit = normalizeLimit(limit);

    const { data, error } = await sb
      .from('posts')
      .select(POST_SELECT)
      .eq('user_id', userId)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('loadPostsByUserId error:', error);
      return [];
    }

    return mapPostsWithInteractionState(data || []);
  }

  // ===================================================================
  // LOAD SINGLE POST
  // ===================================================================
  async function loadPostById(postId) {
    if (!postId) return null;

    const { data, error } = await sb
      .from('posts')
      .select(POST_SELECT)
      .eq('id', postId)
      .single();

    if (error || !data) {
      console.warn('loadPostById: post not found', postId);
      return null;
    }

    const mapped = await mapPostsWithInteractionState([data]);
    return mapped[0] || null;
  }

  // ===================================================================
  // LOAD POST PREVIEW (lightweight, for share cards / link previews)
  // ===================================================================
  async function loadPostPreview(postId) {
    if (!postId) return null;

    const { data, error } = await sb
      .from('posts')
      .select(`
        id, title, description, content, media, media_type, thumbnail_url,
        media_url, sound_id, source, text_template_id, created_at,
        profiles:user_id ( username, display_username, display_name, avatar_url, verified, verified_status )
      `)
      .eq('id', postId)
      .single();

    if (error || !data) return null;

    const media = normalizeMedia(data);

    return {
      id: data.id,
      title: data.title || '',
      description: data.description || '',
      content: data.content || '',
      media,
      mediaType: data.media_type || media[0]?.type || null,
      thumbnailUrl: data.thumbnail_url || media[0]?.thumbnailUrl || data.media_url || media[0]?.url || '',
      mediaUrl: data.media_url || media[0]?.url || '',
      sound_id: data.sound_id || null,
      source: data.source || CONFIG.DEFAULT_SOURCE,
      textTemplateId: data.text_template_id || null,
      timestamp: safeDate(data.created_at),
      username: data.profiles?.username || '',
      displayName: data.profiles?.display_name || 'Anonymous',
      avatarUrl: data.profiles?.avatar_url || '',
      verified: !!data.profiles?.verified,
      verifiedStatus: data.profiles?.verified_status || 'none'
    };
  }

  // ===================================================================
  // REPOST FEED ITEMS
  // ===================================================================
  async function loadRepostFeedItems(offset = 0, limit = CONFIG.DEFAULT_LIMIT) {
    offset = normalizeOffset(offset);
    limit = normalizeLimit(limit);

    const { data, error } = await sb
      .from('repost_feed_items')
      .select('*')
      .order('repost_created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('loadRepostFeedItems error:', error);
      return [];
    }

    return data || [];
  }

  // ===================================================================
  // FEED CONTEXT MAP
  // ===================================================================
  const feedContextMap = new Map();

  function getFeedContext(postId) {
    return feedContextMap.get(postId) || null;
  }

  function clearFeedContext() {
    feedContextMap.clear();
  }

  function setFeedContext(postId, type, context) {
    const existing = feedContextMap.get(postId) || {};
    existing[type] = context;
    feedContextMap.set(postId, existing);
  }

  function getFeedSortTime(post) {
    const context = getFeedContext(post.id);
    if (context?.repost?.latestTime) {
      return context.repost.latestTime;
    }
    return post.timestamp;
  }

  // ===================================================================
  // LOAD FEED WITH REPOST CONTEXT
  // -------------------------------------------------------------
  // THIS IS THE FUNCTION index-feed.js CALLS DIRECTLY:
  //   API.loadFeedWithReposts(offset, limit, source)
  // returning [{ feedType, sortTime, context, post }, ...]
  // index-feed.js then does: items.map(item => item.post)
  // to build its rawPosts pool. Do not change this return shape.
  // ===================================================================
  async function loadFeedWithReposts(offset = 0, limit = CONFIG.DEFAULT_LIMIT, source = null) {
    const [posts, repostItems] = await Promise.all([
      loadAllPosts(offset, limit, source),
      loadRepostFeedItems(offset, limit)
    ]);

    const postsById = new Map(posts.map(post => [post.id, post]));

    const neededIds = [...new Set(repostItems.map(item => item.post_id).filter(Boolean))];
    const missingIds = neededIds.filter(id => !postsById.has(id));

    let extraPosts = [];
    if (missingIds.length) {
      let query = sb
        .from('posts')
        .select(POST_SELECT)
        .in('id', missingIds)
        .eq('is_hidden', false);

      if (source) {
        query = query.eq('source', source);
      }

      const { data, error } = await query;
      if (!error && data) {
        extraPosts = await mapPostsWithInteractionState(data);
      }
    }

    const allPostsById = new Map([...posts, ...extraPosts].map(post => [post.id, post]));

    const repostGroups = new Map();
    repostItems.forEach(item => {
      const original = allPostsById.get(item.post_id);
      if (!original) return;
      if (source && original.source !== source) return;

      if (!repostGroups.has(item.post_id)) {
        repostGroups.set(item.post_id, []);
      }
      repostGroups.get(item.post_id).push({
        id: item.repost_id,
        user: {
          id: item.reposter_id,
          display_name: item.reposter_display_name || 'Anonymous',
          username: item.reposter_username || '',
          avatar_url: item.reposter_avatar_url || '',
          verified_status: item.reposter_verified_status || 'none'
        },
        comment: item.repost_comment || '',
        time: item.repost_created_at
      });
    });

    clearFeedContext();
    const seenPostIds = new Set();
    const feedItems = [];

    repostGroups.forEach((users, postId) => {
      const originalPost = allPostsById.get(postId);
      if (!originalPost) return;

      const sorted = [...users].sort((a, b) => new Date(b.time) - new Date(a.time));
      if (!sorted.length) return;

      setFeedContext(postId, 'repost', {
        items: sorted,
        latestTime: sorted[0].time,
        count: sorted.length
      });

      seenPostIds.add(postId);
      feedItems.push(originalPost);
    });

    posts.forEach(post => {
      if (!seenPostIds.has(post.id)) {
        feedItems.push(post);
      }
    });

    // Base chronological order only — index-algorithm.js re-ranks this
    // entirely once index-feed.js hands it over. This sort is just a
    // sane default before ranking happens.
    feedItems.sort((a, b) => new Date(getFeedSortTime(b)) - new Date(getFeedSortTime(a)));

    return feedItems.map(post => ({
      feedType: feedContextMap.has(post.id) ? 'repost' : 'post',
      sortTime: getFeedSortTime(post),
      context: getFeedContext(post.id),
      post
    }));
  }

  // ===================================================================
  // COMMENTS — LOAD
  // -------------------------------------------------------------
  // Returns BOTH top-level comments and replies flat in one array,
  // differentiated by parentId (null = top-level, set = reply).
  // includes replyCount, pinned, edited, updatedAt on every row.
  // ===================================================================
  async function loadComments(postId) {
    if (!postId) return [];

    const { data, error } = await sb
      .from('comments')
      .select(COMMENT_SELECT)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('loadComments error:', error);
      return [];
    }

    const user = await getCurrentUser();
    let likedIds = new Set();

    if (user && data && data.length) {
      const commentIds = data.map(row => row.id);
      const { data: likes, error: likeError } = await sb
        .from('comment_likes')
        .select('comment_id')
        .eq('user_id', user.id)
        .in('comment_id', commentIds);

      if (likeError) {
        console.warn('loadComments likes:', likeError);
      } else {
        likedIds = new Set((likes || []).map(row => row.comment_id));
      }
    }

    return (data || []).map(row => mapComment(row, likedIds.has(row.id)));
  }

  // ===================================================================
  // COMMENTS — ADD (handles both top-level comments and replies)
  // -------------------------------------------------------------
  // parentId null      → top-level comment on the post
  // parentId <comment> → reply to that comment
  //
  // increment_comment_count bumps post.comment_count AND, when this
  // is a reply, the parent comment's reply_count in one atomic RPC call.
  // ===================================================================
  async function addComment(postId, parentId, message, mentions = []) {
    const user = await requireUser();
    const text = String(message || '').trim();

    if (!text) {
      throw new Error('Comment cannot be empty.');
    }

    const { data: post, error: postError } = await sb
      .from('posts')
      .select('comments_hidden, user_id')
      .eq('id', postId)
      .single();

    if (!postError && post && post.comments_hidden && post.user_id !== user.id) {
      throw new Error('Comments are turned off for this post.');
    }

    const { data, error } = await sb
      .from('comments')
      .insert({
        post_id: postId,
        user_id: user.id,
        parent_id: parentId || null,
        message: text,
        mentions: safeArray(mentions),
        like_count: 0,
        reply_count: 0
      })
      .select(COMMENT_SELECT)
      .single();

    if (error) throw error;

    const { error: countError } = await sb.rpc('increment_comment_count', {
      p_post_id: postId,
      p_parent_id: parentId || null
    });

    if (countError) {
      console.warn('Could not increment comment count:', countError);
    }

    return mapComment(data, false);
  }

  // ===================================================================
  // COMMENTS — EDIT
  // -------------------------------------------------------------
  // Ownership is enforced inside the edit_comment() SQL function —
  // only the comment's author may edit it. Returns only the changed
  // fields (id, message, updatedAt, edited); merge into your existing
  // rendered comment object rather than expecting a full mapComment
  // shape, since the RPC doesn't re-fetch the joined profile data.
  // ===================================================================
  async function editComment(commentId, message) {
    const user = await requireUser();
    const text = String(message || '').trim();

    if (!text) {
      throw new Error('Comment cannot be empty.');
    }

    const { data, error } = await sb.rpc('edit_comment', {
      p_comment_id: commentId,
      p_user_id: user.id,
      p_message: text
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;

    return {
      id: row.id,
      message: row.message,
      updatedAt: row.updated_at,
      edited: !!row.edited
    };
  }

  // ===================================================================
  // COMMENTS — DELETE (works for a top-level comment OR a reply)
  // -------------------------------------------------------------
  // A reply is just a comment row with parent_id set, so the same
  // function handles both. Ownership is enforced inside delete_comment()
  // — the comment's author OR the post's owner may delete it.
  // ===================================================================
  async function deleteComment(commentId) {
    const user = await requireUser();

    if (!commentId) {
      throw new Error('No comment specified.');
    }

    const { error } = await sb.rpc('delete_comment', {
      p_comment_id: commentId,
      p_user_id: user.id
    });

    if (error) throw error;

    return true;
  }

  // ===================================================================
  // COMMENTS — LIKE
  // ===================================================================
  async function toggleCommentLike(commentId) {
    const user = await requireUser();

    const { data, error } = await sb.rpc('toggle_comment_like', {
      p_comment_id: commentId,
      p_user_id: user.id
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return { liked: !!row?.liked, count: safeNumber(row?.count) };
  }

  // ===================================================================
  // COMMENTS — PIN / UNPIN (post owner only, one pinned per post)
  // -------------------------------------------------------------
  // Ownership (of the POST, not the comment) is enforced inside
  // toggle_pin_comment(). Pinning a new comment automatically unpins
  // any previously pinned comment on that same post.
  // ===================================================================
  async function togglePinComment(commentId) {
    const user = await requireUser();

    const { data, error } = await sb.rpc('toggle_pin_comment', {
      p_comment_id: commentId,
      p_user_id: user.id
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return { pinned: !!row?.pinned };
  }

  // ===================================================================
  // COMMENTS — REPORT (works for a top-level comment OR a reply)
  // -------------------------------------------------------------
  // Reuses the same `reports` table as reportPost(), with
  // target_type: 'comment'. No separate table needed — a reply is
  // stored identically to a comment.
  // ===================================================================
  async function reportComment(commentId, reason) {
    const user = await requireUser();

    if (!commentId) {
      throw new Error('No comment specified.');
    }

    const { data, error } = await sb
      .from('reports')
      .insert({
        reporter_id: user.id,
        target_type: 'comment',
        target_id: commentId,
        reason: reason || 'Inappropriate content',
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  // ===================================================================
  // LIKE POST
  // ===================================================================
  async function toggleLike(postId) {
    const user = await requireUser();

    const { data, error } = await sb.rpc('toggle_post_like', {
      p_post_id: postId,
      p_user_id: user.id
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return { liked: !!row?.liked, count: safeNumber(row?.count) };
  }

  // ===================================================================
  // REPOST
  // ===================================================================
  async function toggleRepostAPI(postId, comment = '') {
    const user = await requireUser();

    const { data, error } = await sb.rpc('toggle_repost', {
      p_post_id: postId,
      p_user_id: user.id,
      p_comment: comment || ''
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    clearFeedContext();

    return {
      reposted: !!row?.reposted,
      count: safeNumber(row?.count),
      comment: row?.out_comment || '',
      time: row?.out_time || null
    };
  }

  // ===================================================================
  // UPDATE REPOST COMMENT
  // ===================================================================
  async function updateRepostComment(postId, comment) {
    const user = await requireUser();

    const { data, error } = await sb
      .from('reposts')
      .update({ comment: comment || '' })
      .eq('user_id', user.id)
      .eq('post_id', postId)
      .select('comment, created_at')
      .single();

    if (error) throw error;

    const { data: post } = await sb
      .from('posts')
      .select('repost_count')
      .eq('id', postId)
      .single();

    clearFeedContext();

    return {
      reposted: true,
      count: safeNumber(post?.repost_count),
      comment: data.comment || '',
      time: data.created_at
    };
  }

  // ===================================================================
  // BOOKMARK
  // ===================================================================
  async function toggleBookmark(postId) {
    const user = await requireUser();

    const { data, error } = await sb.rpc('toggle_bookmark', {
      p_post_id: postId,
      p_user_id: user.id
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return { bookmarked: !!row?.bookmarked, count: safeNumber(row?.count) };
  }

  // ===================================================================
  // SHARE
  // ===================================================================
  async function recordShare(postId) {
    const user = await requireUser();

    const { data, error } = await sb.rpc('record_share', {
      p_post_id: postId,
      p_user_id: user.id
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return { alreadyShared: !!row?.already_shared, count: safeNumber(row?.count) };
  }

  // ===================================================================
  // VIEW — index-render.js calls this from its visibility observer
  // ===================================================================
  async function incrementView(postId) {
    try {
      const sessionId = localStorage.getItem('freeupper_session_id') || null;

      const { error } = await sb.rpc('add_view', {
        p_post_id: postId,
        p_user_id: null, // supports guest view tracking
        p_session_id: sessionId
      });

      if (error) {
        console.error('incrementView error:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('incrementView exception:', error);
      return false;
    }
  }

  // ===================================================================
  // HIDE / UNHIDE POST
  // ===================================================================
  async function toggleHidePost(postId, hidden) {
    const user = await requireUser();

    const { data, error } = await sb
      .from('posts')
      .update({ is_hidden: !!hidden })
      .eq('id', postId)
      .eq('user_id', user.id)
      .select('is_hidden')
      .single();

    if (error) throw error;

    return { is_hidden: !!data.is_hidden };
  }

  // ===================================================================
  // COMMENTS ON / OFF (for a post)
  // ===================================================================
  async function toggleCommentsHidden(postId, hidden) {
    const user = await requireUser();

    const { data, error } = await sb
      .from('posts')
      .update({ comments_hidden: !!hidden })
      .eq('id', postId)
      .eq('user_id', user.id)
      .select('comments_hidden')
      .single();

    if (error) throw error;

    return { commentsHidden: !!data.comments_hidden };
  }

  // ===================================================================
  // CREATE POST
  // -------------------------------------------------------------
  // Does not run keyword topic-tagging at write time — that happens
  // client-side on read via index-algorithm.js's getPostTopics(),
  // cached on the post object. No server-side processing needed for
  // the algorithm to work.
  // ===================================================================
  async function createPost(fields = {}) {
    const user = await requireUser();

    const media = safeArray(fields.media);
    const firstMedia = media[0] || null;

    const payload = {
      user_id: user.id,
      title: fields.title || '',
      description: fields.description || '',
      content: fields.content || '',
      category: fields.category || CONFIG.DEFAULT_CATEGORY,
      tags: safeArray(fields.tags),
      media,
      media_url: fields.mediaUrl || firstMedia?.url || null,
      media_type: fields.mediaType || firstMedia?.type || null,
      mentions: safeArray(fields.mentions),
      comments_hidden: !!fields.commentsHidden,
      sound_id: fields.sound_id || null,
      source: fields.source || CONFIG.DEFAULT_SOURCE,
      text_template_id: fields.textTemplateId || null,
      image_embedding: fields.imageEmbedding || null  // ← NEW: store embedding
    };

    const { data, error } = await sb
      .from('posts')
      .insert(payload)
      .select(POST_SELECT)
      .single();

    if (error) throw error;

    return mapPost(data, { likedByMe: false, bookmarkedByMe: false, myRepost: null });
  }

  // ===================================================================
  // NEW: find visually similar posts to a given post
  // ===================================================================
  async function findSimilarPosts(postId, limit = 10) {
    const { data, error } = await sb.rpc('find_similar_posts', {
      p_post_id: postId,
      p_limit: limit
    });

    if (error) {
      console.error('findSimilarPosts error:', error);
      return [];
    }

    if (!data || !data.length) return [];

    const ids = data.map(row => row.id);
    const { data: posts, error: postsError } = await sb
      .from('posts')
      .select(POST_SELECT)
      .in('id', ids)
      .eq('is_hidden', false);

    if (postsError) {
      console.error('findSimilarPosts postgres error:', postsError);
      return [];
    }

    const mapped = await mapPostsWithInteractionState(posts || []);
    const similarityById = new Map(data.map(row => [row.id, row.similarity]));

    // Preserve the similarity-ranked order from the RPC, not Supabase's
    // arbitrary .in() ordering.
    return mapped
      .map(post => ({ ...post, similarityScore: similarityById.get(post.id) || 0 }))
      .sort((a, b) => b.similarityScore - a.similarityScore);
  }

  // ===================================================================
  // DELETE POST
  // ===================================================================
  async function deletePost(postId) {
    await requireUser();

    const { error } = await sb.rpc('delete_post', { p_post_id: postId });

    if (error) throw error;

    clearFeedContext();
    return true;
  }

  // ===================================================================
  // REPORT POST
  // ===================================================================
  async function reportPost(postId, reason) {
    const user = await requireUser();

    const { data, error } = await sb
      .from('reports')
      .insert({
        reporter_id: user.id,
        target_type: 'post',
        target_id: postId,
        reason: reason || 'Inappropriate content',
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  // ===================================================================
  // REALTIME — full table set
  // ===================================================================
  let allChannel = null;
  let allCallbacks = [];

  function subscribeToAll(callback) {
    if (typeof callback === 'function') {
      allCallbacks.push(callback);
    }
    if (allChannel) return;

    allChannel = sb.channel('freeupper-live');

    CONFIG.REALTIME_TABLES.forEach(table => {
      allChannel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        payload => {
          const event = {
            table,
            event: payload.eventType,
            payload: payload.new || payload.old || null,
            old: payload.old || null,
            new: payload.new || null
          };
          allCallbacks.forEach(fn => {
            try {
              fn(event);
            } catch (error) {
              console.warn('Realtime callback error:', error);
            }
          });
        }
      );
    });

    allChannel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ FreeUpper realtime active.');
      }
    });
  }

  // ===================================================================
  // LEGACY REPOST-ONLY SUBSCRIPTION (FIXED: payload is now passed)
  // ===================================================================
  let repostChannel = null;
  let repostCallbacks = [];

  function subscribe(callback) {
    if (typeof callback === 'function') {
      repostCallbacks.push(callback);
    }
    if (repostChannel) return;

    repostChannel = sb
      .channel('posts_reposts_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reposts' }, payload => {
        clearFeedContext();
        repostCallbacks.forEach(fn => {
          try {
            fn({
              eventType: payload.eventType,
              new: payload.new || null,
              old: payload.old || null
            });
          } catch (error) {
            console.warn('Repost callback error:', error);
          }
        });
      })
      .subscribe();
  }

  // ===================================================================
  // UNSUBSCRIBE
  // ===================================================================
  function unsubscribe() {
    if (repostChannel) {
      sb.removeChannel(repostChannel);
      repostChannel = null;
      repostCallbacks = [];
    }
    if (allChannel) {
      sb.removeChannel(allChannel);
      allChannel = null;
      allCallbacks = [];
    }
  }

  // ===================================================================
  // PUBLIC API
  // ===================================================================
  window.PostsAPI = {
    // Feed data
    loadAllPosts,
    loadFeedCandidates,
    loadFeedWithReposts,
    loadRepostFeedItems,

    // Feed context
    getFeedContext,
    clearFeedContext,

    // Posts
    loadPostsByUserId,
    loadPostById,
    loadPostPreview,
    createPost,
    deletePost,

    // Comments (+ replies — same functions handle both)
    loadComments,
    addComment,
    editComment,
    deleteComment,
    toggleCommentLike,
    togglePinComment,
    reportComment,

    // Interactions
    toggleLike,
    toggleRepostAPI,
    updateRepostComment,
    toggleBookmark,
    recordShare,
    incrementView,

    // Moderation
    toggleHidePost,
    toggleCommentsHidden,
    reportPost,

    // Realtime
    subscribe,
    subscribeToAll,
    unsubscribe,

    // NEW: visual similarity
    findSimilarPosts
  };

  console.log('✅ FreeUpper PostsAPI v4.1.1 loaded — repost subscription now passes payload.');
})();
