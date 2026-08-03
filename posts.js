// =====================================================================
// posts.js – FreeUpper v2.3.3 – Fully Atomic Social Feed
// =====================================================================
//
// This module provides a unified API for all social interactions.
// It uses Supabase Realtime to push live updates to all clients.
//
// Features:
//   - Feed with repost contexts (feedContextMap)
//   - CRUD for posts, comments (with nested replies via parent_id)
//   - Post likes, comment likes (including replies)
//   - Reposts (with optional comment)
//   - Bookmarks, Shares (insert‑only, never decrements)
//   - View counter
//   - Real‑time subscription for ALL tables (posts, comments, post_likes,
//     comment_likes, reposts, bookmarks, shares)
//
// All counters are denormalised and updated via **atomic RPC functions**
// that do the insert/delete and count update in a single database transaction.
// Unique constraints on junction tables prevent duplicate rows.
//
// DEPENDENCIES: The following SQL functions must exist in your Supabase schema:
//   toggle_post_like(uuid, uuid)
//   toggle_comment_like(uuid, uuid)
//   toggle_repost(uuid, uuid, text)
//   toggle_bookmark(uuid, uuid)
//   record_share(uuid, uuid)
//   increment_comment_count(uuid)  – already used in addComment
//
// NEW in v2.3.1:
//   - Added `is_hidden` column to posts (boolean, default false)
//   - Mapped in mapPost() so it's available in all post objects
//   - Added toggleHidePost() method to update the column
//   - This supports the "Hide Post" feature in the share modal (owner-only)
//   - REQUIRED DATABASE MIGRATION:
//       ALTER TABLE posts ADD COLUMN is_hidden BOOLEAN DEFAULT false;
//
// NEW in v2.3.2:
//   - Added `comments_hidden` column to posts (boolean, default false)
//   - Mapped in mapPost() as `commentsHidden`
//   - Added toggleCommentsHidden() method (owner-only)
//   - Added server‑side safety net in addComment() to block comments
//     when comments_hidden = true (except for the owner)
//   - REQUIRED DATABASE MIGRATION:
//       ALTER TABLE posts ADD COLUMN comments_hidden BOOLEAN DEFAULT false;
//
// NEW in v2.3.3 (SOUND INTEGRATION):
//   - Added `sound_id` to the mapped post object (from the posts table)
//   - This allows video.html and video-render.js to fetch sound metadata
//     from the sounds table using SoundsAPI.
//   - No new SQL migration needed; sound_id already exists in posts table.
//
// NEW in v2.4.0 (SOURCE & TEXT TEMPLATE):
//   - Added `source` column (composer / studio) – filtered in feed
//   - Added `text_template_id` column – persisted for text cards
//   - loadAllPosts() accepts a `source` filter
//   - loadFeedWithReposts() passes source through and excludes
//     cross‑source reposts
//   - createPost() writes source and textTemplateId
//   - REQUIRED DATABASE MIGRATIONS:
//       ALTER TABLE posts ADD COLUMN source TEXT NOT NULL DEFAULT 'composer';
//       ALTER TABLE posts ADD CONSTRAINT posts_source_check
//           CHECK (source IN ('composer','studio'));
//       ALTER TABLE posts ADD COLUMN text_template_id TEXT;
// =====================================================================

(function() {
  'use strict';

  if (!window.sb) {
    console.error('posts.js: Supabase client missing.');
    return;
  }
  const sb = window.sb;

  // ─── Internal auth helper ───────────────────────────────────────────
  async function _getUserId() {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) throw new Error('You must be logged in to perform this action.');
    return user.id;
  }

  // ─── Map post row ────────────────────────────────────────────────────
  function mapPost(row, userLikes = new Set(), myRepost = null) {
    const profile = row.profiles || null;
    let media = row.media;
    if (typeof media === 'string') {
      try { media = JSON.parse(media); } catch (e) { media = []; }
    }
    if (!Array.isArray(media) || media.length === 0) {
      if (row.media_url) {
        media = [{ url: row.media_url, type: row.media_type || 'image' }];
      } else {
        media = [];
      }
    }
    media = media.map(item => ({
      ...item,
      type: item.type || 'image',
    }));

    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title || '',
      description: row.description || '',
      content: row.content || '',
      media,
      mediaUrl: row.media_url || (media.length ? media[0].url : ''),
      mediaType: row.media_type || (media.length ? media[0].type : 'image'),
      category: row.category || 'General',
      tags: row.tags || [],
      mentions: row.mentions || [],
      timestamp: row.created_at || new Date().toISOString(),
      // ─── SOUND INTEGRATION ──────────────────────────
      sound_id: row.sound_id || null,
      // ─── SOURCE & TEXT TEMPLATE ─────────────────────
      source: row.source || 'composer',
      textTemplateId: row.text_template_id || null,
      // ────────────────────────────────────────────────
      views: row.views || 0,
      comments: row.comment_count || 0,
      likes: row.like_count || 0,
      likedByMe: userLikes.has(row.id),
      repostCount: row.repost_count || 0,
      bookmarkCount: row.bookmark_count || 0,
      shareCount: row.share_count || 0,
      myRepost: !!myRepost,
      myRepostText: myRepost ? (myRepost.comment || '') : '',
      myRepostTime: myRepost ? myRepost.created_at : null,
      is_hidden: row.is_hidden || false,
      commentsHidden: row.comments_hidden || false,
      profile: profile ? {
        id: profile.id,
        display_name: profile.display_name || 'Anonymous',
        username: profile.username || '',
        avatar_url: profile.avatar_url || '',
        verified: profile.verified || false,
        verified_status: profile.verified_status || 'none',
        is_private: profile.is_private || false,
      } : null,
    };
  }

  // ─── FeedContextMap ────────────────────────────────────────────────
  const feedContextMap = new Map(); // postId -> { repost: {...}, friendsLiked: {...} }

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
    const ctx = getFeedContext(post.id);
    if (ctx?.repost) return ctx.repost.latestTime;
    return post.timestamp;
  }

  // ─── LOAD POSTS ──────────────────────────────────────────────────────
  async function loadAllPosts(offset = 0, limit = 20, source = null) {
    let q = sb
      .from('posts')
      .select(`
        *,
        profiles:user_id (
          id,
          display_name,
          username,
          avatar_url,
          verified,
          verified_status,
          is_private
        )
      `)
      .order('created_at', { ascending: false });

    if (source) q = q.eq('source', source);

    const { data: rows, error } = await q.range(offset, offset + limit - 1);

    if (error) {
      console.error('loadAllPosts error:', error);
      return [];
    }

    let userId = null;
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (user) userId = user.id;
    } catch (_) {}

    let likedIds = new Set();
    let repostMap = new Map();

    if (userId && rows && rows.length > 0) {
      const postIds = rows.map(r => r.id);
      const [{ data: likes }, { data: reposts }] = await Promise.all([
        sb.from('post_likes').select('post_id').eq('user_id', userId).in('post_id', postIds),
        sb.from('reposts').select('post_id, comment, created_at').eq('user_id', userId).in('post_id', postIds),
      ]);
      likedIds = new Set((likes || []).map(l => l.post_id));
      (reposts || []).forEach(r => repostMap.set(r.post_id, r));
    }

    return rows.map(row => mapPost(row, likedIds, repostMap.get(row.id)));
  }

  // ─── LOAD POSTS BY USER ID ──────────────────────────────────────────
  async function loadPostsByUserId(userId, offset = 0, limit = 200) {
    const { data: rows, error } = await sb
      .from('posts')
      .select(`
        *,
        profiles:user_id (
          id,
          display_name,
          username,
          avatar_url,
          verified,
          verified_status,
          is_private
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('loadPostsByUserId error:', error);
      return [];
    }

    let currentUserId = null;
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (user) currentUserId = user.id;
    } catch (_) {}

    let likedIds = new Set();
    let repostMap = new Map();

    if (currentUserId && rows && rows.length > 0) {
      const postIds = rows.map(r => r.id);
      const [{ data: likes }, { data: reposts }] = await Promise.all([
        sb.from('post_likes').select('post_id').eq('user_id', currentUserId).in('post_id', postIds),
        sb.from('reposts').select('post_id, comment, created_at').eq('user_id', currentUserId).in('post_id', postIds),
      ]);
      likedIds = new Set((likes || []).map(l => l.post_id));
      (reposts || []).forEach(r => repostMap.set(r.post_id, r));
    }

    return rows.map(row => mapPost(row, likedIds, repostMap.get(row.id)));
  }

  // ─── LOAD SINGLE POST BY ID ─────────────────────────────────────────
  async function loadPostById(postId) {
    const { data: row, error } = await sb
      .from('posts')
      .select(`
        *,
        profiles:user_id (
          id,
          display_name,
          username,
          avatar_url,
          verified,
          verified_status,
          is_private
        )
      `)
      .eq('id', postId)
      .single();

    if (error || !row) {
      console.warn('loadPostById: post not found', postId);
      return null;
    }

    let userId = null;
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (user) userId = user.id;
    } catch (_) {}

    let likedIds = new Set();
    let myRepost = null;
    if (userId) {
      const [{ data: likes }, { data: reposts }] = await Promise.all([
        sb.from('post_likes').select('post_id').eq('user_id', userId).eq('post_id', postId),
        sb.from('reposts').select('post_id, comment, created_at').eq('user_id', userId).eq('post_id', postId),
      ]);
      if (likes && likes.length) likedIds.add(postId);
      if (reposts && reposts.length) myRepost = reposts[0];
    }
    return mapPost(row, likedIds, myRepost);
  }

  // ─── LOAD REPOST FEED ITEMS ─────────────────────────────────────────
  async function loadRepostFeedItems(offset = 0, limit = 20) {
    const { data, error } = await sb
      .from('repost_feed_items')
      .select('*')
      .order('repost_created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('loadRepostFeedItems error:', error);
      return [];
    }
    return data;
  }

  // ─── LOAD FEED WITH CONTEXTS ──────────────────────────────────────
  async function loadFeedWithReposts(offset = 0, limit = 20, source = null) {
    const [posts, repostItems] = await Promise.all([
      loadAllPosts(offset, limit, source),
      loadRepostFeedItems(offset, limit),
    ]);

    const postsById = new Map(posts.map(p => [p.id, p]));

    // Fetch missing original posts
    const neededIds = [...new Set(repostItems.map(r => r.post_id))];
    const missingIds = neededIds.filter(id => !postsById.has(id));
    let extraPostsById = new Map();

    if (missingIds.length > 0) {
      let userId = null;
      try {
        const { data: { user } } = await sb.auth.getUser();
        if (user) userId = user.id;
      } catch (_) {}
      let likedIds = new Set();

      const { data: extraRows, error } = await sb
        .from('posts')
        .select(`
          *,
          profiles:user_id (
            id, display_name, username, avatar_url, verified, verified_status, is_private
          )
        `)
        .in('id', missingIds);

      if (!error && extraRows) {
        if (userId && extraRows.length > 0) {
          const { data: likes } = await sb
            .from('post_likes')
            .select('post_id')
            .eq('user_id', userId)
            .in('post_id', extraRows.map(r => r.id));
          likedIds = new Set((likes || []).map(l => l.post_id));
        }
        extraRows.forEach(row => extraPostsById.set(row.id, mapPost(row, likedIds)));
      }
    }

    // Group reposts by post_id
    const repostGroups = new Map();
    repostItems.forEach(r => {
      if (!repostGroups.has(r.post_id)) repostGroups.set(r.post_id, []);
      repostGroups.get(r.post_id).push({
        id: r.repost_id,
        user: {
          id: r.reposter_id,
          display_name: r.reposter_display_name || 'Anonymous',
          username: r.reposter_username || '',
          avatar_url: r.reposter_avatar_url || '',
          verified_status: r.reposter_verified_status || 'none',
        },
        comment: r.repost_comment || '',
        time: r.repost_created_at,
      });
    });

    feedContextMap.clear();
    const seenPostIds = new Set();
    const feedItems = [];

    repostGroups.forEach((users, postId) => {
      const originalPost = postsById.get(postId) || extraPostsById.get(postId);
      if (!originalPost) return;
      // Exclude reposts when source filter is active and the original post
      // does not match that source (cross‑source reposts are dropped).
      if (source && originalPost.source !== source) return;
      seenPostIds.add(postId);
      const sorted = [...users].sort((a, b) => new Date(b.time) - new Date(a.time));

      setFeedContext(postId, 'repost', {
        items: sorted,
        latestTime: sorted[0].time,
        count: sorted.length,
      });

      feedItems.push(originalPost);
    });

    posts.forEach(p => {
      if (!seenPostIds.has(p.id)) {
        feedItems.push(p);
      }
    });

    feedItems.sort((a, b) => {
      const timeA = getFeedSortTime(a);
      const timeB = getFeedSortTime(b);
      return new Date(timeB) - new Date(timeA);
    });

    return feedItems.map(p => ({
      feedType: feedContextMap.has(p.id) ? 'repost' : 'post',
      sortTime: getFeedSortTime(p),
      post: p,
    }));
  }

  // ─── COMMENTS ──────────────────────────────────────────────────────
  async function loadComments(postId) {
    const { data, error } = await sb
      .from('comments')
      .select(`
        *,
        profiles:user_id (
          id,
          display_name,
          username,
          avatar_url,
          verified,
          verified_status
        )
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('loadComments error:', error);
      return [];
    }

    let userId = null;
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (user) userId = user.id;
    } catch (_) {}

    let likedIds = new Set();
    if (userId && data && data.length > 0) {
      const commentIds = data.map(r => r.id);
      const { data: likes } = await sb
        .from('comment_likes')
        .select('comment_id')
        .eq('user_id', userId)
        .in('comment_id', commentIds);
      likedIds = new Set((likes || []).map(l => l.comment_id));
    }

    return data.map(row => ({
      id: row.id,
      message: row.message,
      parentId: row.parent_id,
      userId: row.user_id,
      time: row.created_at,
      approved: row.approved,
      likeCount: row.like_count || 0,
      likedByMe: likedIds.has(row.id),
      profile: row.profiles || {},
      mentions: row.mentions || [],
    }));
  }

  async function addComment(postId, parentId, message, mentions = []) {
    const userId = await _getUserId();

    // ─── Safety net: reject if comments are turned off (unless owner) ──
    const { data: postRow, error: postErr } = await sb
      .from('posts')
      .select('comments_hidden, user_id')
      .eq('id', postId)
      .single();
    if (!postErr && postRow && postRow.comments_hidden && postRow.user_id !== userId) {
      throw new Error('Comments are turned off for this post.');
    }

    const { data, error } = await sb
      .from('comments')
      .insert({
        post_id: postId,
        user_id: userId,
        parent_id: parentId || null,
        message: message,
        mentions: mentions || [],
        like_count: 0,
      })
      .select(`
        *,
        profiles:user_id (
          id,
          display_name,
          username,
          avatar_url,
          verified,
          verified_status
        )
      `)
      .single();

    if (error) throw error;

    // Increment comment_count on posts – atomic RPC
    await sb.rpc('increment_comment_count', { p_post_id: postId })
      .catch(err => console.warn('Could not increment comment count:', err));

    return {
      id: data.id,
      message: data.message,
      parentId: data.parent_id,
      userId: data.user_id,
      time: data.created_at,
      approved: data.approved,
      likeCount: 0,
      likedByMe: false,
      profile: data.profiles || {},
      mentions: data.mentions || [],
    };
  }

  // ─── POST LIKES – ATOMIC SINGLE RPC ──────────────────────────────────
  async function toggleLike(postId) {
    const userId = await _getUserId();
    const { data, error } = await sb.rpc('toggle_post_like', {
      p_post_id: postId,
      p_user_id: userId,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { liked: row.liked, count: row.count };
  }

  // ─── COMMENT LIKES – ATOMIC SINGLE RPC ─────────────────────────────
  async function toggleCommentLike(commentId) {
    const userId = await _getUserId();
    const { data, error } = await sb.rpc('toggle_comment_like', {
      p_comment_id: commentId,
      p_user_id: userId,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { liked: row.liked, count: row.count };
  }

  // ─── REPOSTS – ATOMIC SINGLE RPC ──────────────────────────────────
  async function toggleRepostAPI(postId, comment = '') {
    const userId = await _getUserId();
    const { data, error } = await sb.rpc('toggle_repost', {
      p_post_id: postId,
      p_user_id: userId,
      p_comment: comment || '',
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;

    clearFeedContext();
    return {
      reposted: row.reposted,
      count: row.count,
      comment: row.out_comment || '',
      time: row.out_time,
    };
  }

  // ─── UPDATE REPOST COMMENT (no count change) ──────────────────────
  async function updateRepostComment(postId, comment) {
    const userId = await _getUserId();
    const { data, error } = await sb
      .from('reposts')
      .update({ comment: comment || '' })
      .eq('user_id', userId)
      .eq('post_id', postId)
      .select('comment, created_at')
      .single();

    if (error) throw error;

    // We don't change the count, just fetch current for return value
    const { data: post } = await sb
      .from('posts')
      .select('repost_count')
      .eq('id', postId)
      .single();

    clearFeedContext();
    return {
      reposted: true,
      count: post?.repost_count || 0,
      comment: data.comment,
      time: data.created_at,
    };
  }

  // ─── BOOKMARKS – ATOMIC SINGLE RPC ──────────────────────────────────
  async function toggleBookmark(postId) {
    const userId = await _getUserId();
    const { data, error } = await sb.rpc('toggle_bookmark', {
      p_post_id: postId,
      p_user_id: userId,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { bookmarked: row.bookmarked, count: row.count };
  }

  // ─── SHARES – INSERT‑ONLY (never decrements) ──────────────────────
  async function recordShare(postId) {
    const userId = await _getUserId();
    const { data, error } = await sb.rpc('record_share', {
      p_post_id: postId,
      p_user_id: userId,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { alreadyShared: row.already_shared, count: row.count };
  }

  // ─── VIEWS ─────────────────────────────────────────────────────────
  async function incrementView(postId) {
    try {
      const sessionId = localStorage.getItem('freeupper_session_id') || null;
      const { error } = await sb.rpc('add_view', {
        p_post_id: postId,
        p_user_id: null,
        p_session_id: sessionId,
      });
      if (error) console.error('incrementView error:', error);
    } catch (err) {
      console.error('incrementView exception:', err);
    }
  }

  // ─── TOGGLE HIDE POST ─────────────────────────────────────────────
  async function toggleHidePost(postId, hidden) {
    const userId = await _getUserId(); // ensures authenticated
    const { data, error } = await sb
      .from('posts')
      .update({ is_hidden: hidden })
      .eq('id', postId)
      .eq('user_id', userId) // security: only owner can toggle
      .select('is_hidden')
      .single();

    if (error) throw error;
    return { is_hidden: data.is_hidden };
  }

  // ─── TOGGLE COMMENTS HIDDEN (owner-only) ───────────────────────────
  async function toggleCommentsHidden(postId, hidden) {
    const userId = await _getUserId(); // ensures authenticated
    const { data, error } = await sb
      .from('posts')
      .update({ comments_hidden: hidden })
      .eq('id', postId)
      .eq('user_id', userId) // security: only owner can toggle
      .select('comments_hidden')
      .single();

    if (error) throw error;
    return { commentsHidden: data.comments_hidden };
  }

  // ─── POST PREVIEW ──────────────────────────────────────────────────
  async function loadPostPreview(postId) {
    const { data, error } = await sb
      .from('posts')
      .select(`
        id,
        title,
        description,
        media_type,
        thumbnail_url,
        media_url,
        sound_id,
        profiles:user_id ( username, display_name, avatar_url, verified_status )
      `)
      .eq('id', postId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      title: data.title || '',
      description: data.description || '',
      mediaType: data.media_type,
      thumbnailUrl: data.thumbnail_url || data.media_url || '',
      sound_id: data.sound_id || null,
      username: data.profiles?.username || '',
      displayName: data.profiles?.display_name || 'Anonymous',
      avatarUrl: data.profiles?.avatar_url || '',
      verifiedStatus: data.profiles?.verified_status || 'none',
    };
  }

  // ─── CREATE POST ──────────────────────────────────────────────────
  async function createPost(fields) {
    const userId = await _getUserId();

    const payload = {
      user_id: userId,
      title: fields.title || '',
      description: fields.description || '',
      content: fields.content || '',
      category: fields.category || 'General',
      tags: fields.tags || [],
      media: fields.media || [],
      media_url: fields.mediaUrl || null,
      media_type: fields.mediaType || null,
      mentions: fields.mentions || [],
      comments_hidden: !!fields.commentsHidden,
      // is_hidden defaults to false; no need to set explicitly
      sound_id: fields.sound_id || null,
      // ─── SOURCE & TEXT TEMPLATE ─────────────────────
      source: fields.source || 'composer',
      text_template_id: fields.textTemplateId || null,
    };

    if (fields.media && fields.media.length > 0) {
      payload.media_url = fields.media[0].url || null;
      payload.media_type = fields.media[0].type || null;
    }

    const { data, error } = await sb
      .from('posts')
      .insert(payload)
      .select(`
        *,
        profiles:user_id (
          id,
          display_name,
          username,
          avatar_url,
          verified,
          verified_status
        )
      `)
      .single();

    if (error) throw error;

    return mapPost(data, new Set(), null);
  }

  async function deletePost(postId) {
    const { error } = await sb.rpc('delete_post', { p_post_id: postId });
    if (error) throw error;
  }

  // ─── REPORT ────────────────────────────────────────────────────────
  async function reportPost(postId, reason) {
    const userId = await _getUserId();
    const { data, error } = await sb
      .from('reports')
      .insert({
        reporter_id: userId,
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

  // ─── REAL‑TIME SUBSCRIPTION FOR ALL TABLES ──────────────────────
  let _allChannel = null;
  let _allCallbacks = [];

  /**
   * Subscribe to all tables that affect the feed and interactions.
   * The callback receives: { table, event, payload, old }
   */
  function subscribeToAll(callback) {
    if (typeof callback === 'function') {
      _allCallbacks.push(callback);
    }
    if (_allChannel) return;

    const tables = ['posts', 'comments', 'post_likes', 'comment_likes', 'reposts', 'bookmarks', 'shares'];
    _allChannel = sb.channel('freeupper-live');

    tables.forEach(table => {
      _allChannel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: table },
        (payload) => {
          _allCallbacks.forEach(fn => {
            try {
              fn({
                table,
                event: payload.eventType,
                payload: payload.new || payload.old,
                old: payload.old,
              });
            } catch (e) {
              console.warn('Realtime callback error:', e);
            }
          });
        }
      );
    });

    _allChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ FreeUpper: Live updates active for all tables.');
      }
    });
  }

  // ─── LEGACY SUBSCRIBE (repost‑only, kept for backward compatibility) ──
  let _repostChannel = null;
  let _repostCallbacks = [];

  function subscribe(callback) {
    if (typeof callback === 'function') {
      _repostCallbacks.push(callback);
    }
    if (_repostChannel) return;

    _repostChannel = sb
      .channel('posts_reposts_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reposts' },
        async () => {
          clearFeedContext();
          _repostCallbacks.forEach(fn => {
            try { fn(); } catch (e) { console.warn('Realtime callback error:', e); }
          });
        }
      )
      .subscribe();
  }

  function unsubscribe() {
    if (_repostChannel) {
      sb.removeChannel(_repostChannel);
      _repostChannel = null;
      _repostCallbacks = [];
    }
    if (_allChannel) {
      sb.removeChannel(_allChannel);
      _allChannel = null;
      _allCallbacks = [];
    }
  }

  // ─── EXPOSE PUBLIC API ────────────────────────────────────────────
  window.PostsAPI = {
    // Feed & context
    loadFeedWithReposts,
    getFeedContext,
    clearFeedContext,

    // Posts (by user / single / preview)
    loadPostsByUserId,
    loadPostById,
    loadPostPreview,

    // Comments
    loadComments,
    addComment,

    // Post CRUD
    createPost,
    deletePost,

    // Interactions – all database‑backed
    toggleLike,
    toggleCommentLike,
    toggleRepostAPI,
    updateRepostComment,
    toggleBookmark,
    recordShare,
    incrementView,
    reportPost,

    // ─── hide/unhide post ──────────────────────────────────────
    toggleHidePost,

    // ─── turn comments on/off ─────────────────────────────────
    toggleCommentsHidden,

    // Real‑time
    subscribe,
    subscribeToAll,
    unsubscribe,
  };

})();
