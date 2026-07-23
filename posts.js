// =====================================================================
// posts.js – FreeUpper v2.0 – Full Database-Backed Feed
// =====================================================================
//
// This module provides a unified API for posts, comments, likes,
// reposts, bookmarks, and shares. All data is persisted in Supabase.
//
// Features:
//   - Load feed with repost contexts (feedContextMap)
//   - Create, delete posts
//   - Add comments (with nested replies via parent_id)
//   - Toggle post likes, comment likes
//   - Toggle reposts (with optional comment)
//   - Increment views
//   - Load posts by user ID, single post preview
//   - Realtime subscriptions for reposts
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
      views: row.views || 0,
      comments: row.comment_count || 0,
      likes: row.like_count || 0,
      likedByMe: userLikes.has(row.id),
      repostCount: row.repost_count || 0,
      bookmarkCount: row.bookmark_count || 0,
      myRepost: !!myRepost,
      myRepostText: myRepost ? (myRepost.comment || '') : '',
      myRepostTime: myRepost ? myRepost.created_at : null,
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
  const feedContextMap = new Map(); // postId -> { repost: {...}, friendsLiked: {...}, ... }

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
  async function loadAllPosts(offset = 0, limit = 20) {
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
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

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
  async function loadFeedWithReposts(offset = 0, limit = 20) {
    const [posts, repostItems] = await Promise.all([
      loadAllPosts(offset, limit),
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

    const { data, error } = await sb
      .from('comments')
      .insert({
        post_id: postId,
        user_id: userId,
        parent_id: parentId || null,
        message: message,
        mentions: mentions || [],
        like_count: 0, // default
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

    // Increment comment_count on posts
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

  // ─── POST LIKES (Love reactions) ──────────────────────────────────
  async function toggleLike(postId) {
    const userId = await _getUserId();

    // Check if already liked
    const { data: existing } = await sb
      .from('post_likes')
      .select('*')
      .eq('user_id', userId)
      .eq('post_id', postId)
      .maybeSingle();

    let liked = false;
    if (existing) {
      // Unlike
      await sb
        .from('post_likes')
        .delete()
        .eq('user_id', userId)
        .eq('post_id', postId);
      liked = false;
    } else {
      // Like
      await sb
        .from('post_likes')
        .insert({ user_id: userId, post_id: postId });
      liked = true;
    }

    // Update like_count on posts
    const { data: post } = await sb
      .from('posts')
      .select('like_count')
      .eq('id', postId)
      .single();

    const newCount = Math.max(0, (post?.like_count || 0) + (liked ? 1 : -1));
    await sb
      .from('posts')
      .update({ like_count: newCount })
      .eq('id', postId);

    return { liked, count: newCount };
  }

  // ─── COMMENT LIKES (Nested replies & top-level) ──────────────────
  async function toggleCommentLike(commentId) {
    const userId = await _getUserId();

    // Check if already liked
    const { data: existing } = await sb
      .from('comment_likes')
      .select('*')
      .eq('user_id', userId)
      .eq('comment_id', commentId)
      .maybeSingle();

    let liked = false;
    if (existing) {
      await sb
        .from('comment_likes')
        .delete()
        .eq('user_id', userId)
        .eq('comment_id', commentId);
      liked = false;
    } else {
      await sb
        .from('comment_likes')
        .insert({ user_id: userId, comment_id: commentId });
      liked = true;
    }

    // Update like_count on comments
    const { data: comment } = await sb
      .from('comments')
      .select('like_count')
      .eq('id', commentId)
      .single();

    const newCount = Math.max(0, (comment?.like_count || 0) + (liked ? 1 : -1));
    await sb
      .from('comments')
      .update({ like_count: newCount })
      .eq('id', commentId);

    return { liked, count: newCount };
  }

  // ─── REPOSTS ──────────────────────────────────────────────────────
  async function toggleRepostAPI(postId, comment = '') {
    const userId = await _getUserId();

    // Check if already reposted
    const { data: existing } = await sb
      .from('reposts')
      .select('*')
      .eq('user_id', userId)
      .eq('post_id', postId)
      .maybeSingle();

    let reposted = false;
    if (existing) {
      // Remove repost
      await sb
        .from('reposts')
        .delete()
        .eq('user_id', userId)
        .eq('post_id', postId);
      reposted = false;
    } else {
      // Add repost
      await sb
        .from('reposts')
        .insert({ user_id: userId, post_id: postId, comment: comment || '' });
      reposted = true;
    }

    // Update repost_count on posts
    const { data: post } = await sb
      .from('posts')
      .select('repost_count')
      .eq('id', postId)
      .single();

    const newCount = Math.max(0, (post?.repost_count || 0) + (reposted ? 1 : -1));
    await sb
      .from('posts')
      .update({ repost_count: newCount })
      .eq('id', postId);

    // Clear feed context so next load re-fetches
    clearFeedContext();

    return {
      reposted,
      count: newCount,
      comment: comment || '',
      time: new Date().toISOString(),
    };
  }

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

  // ─── BOOKMARKS (if you need them) ────────────────────────────────
  async function toggleBookmark(postId) {
    const userId = await _getUserId();

    const { data: existing } = await sb
      .from('bookmarks')
      .select('*')
      .eq('user_id', userId)
      .eq('post_id', postId)
      .maybeSingle();

    let bookmarked = false;
    if (existing) {
      await sb
        .from('bookmarks')
        .delete()
        .eq('user_id', userId)
        .eq('post_id', postId);
      bookmarked = false;
    } else {
      await sb
        .from('bookmarks')
        .insert({ user_id: userId, post_id: postId });
      bookmarked = true;
    }

    const { data: post } = await sb
      .from('posts')
      .select('bookmark_count')
      .eq('id', postId)
      .single();

    const newCount = Math.max(0, (post?.bookmark_count || 0) + (bookmarked ? 1 : -1));
    await sb
      .from('posts')
      .update({ bookmark_count: newCount })
      .eq('id', postId);

    return { bookmarked, count: newCount };
  }

  // ─── SHARES (if you need them) ──────────────────────────────────
  async function toggleShare(postId) {
    const userId = await _getUserId();

    const { data: existing } = await sb
      .from('shares')
      .select('*')
      .eq('user_id', userId)
      .eq('post_id', postId)
      .maybeSingle();

    let shared = false;
    if (existing) {
      await sb
        .from('shares')
        .delete()
        .eq('user_id', userId)
        .eq('post_id', postId);
      shared = false;
    } else {
      await sb
        .from('shares')
        .insert({ user_id: userId, post_id: postId });
      shared = true;
    }

    const { data: post } = await sb
      .from('posts')
      .select('share_count')
      .eq('id', postId)
      .single();

    const newCount = Math.max(0, (post?.share_count || 0) + (shared ? 1 : -1));
    await sb
      .from('posts')
      .update({ share_count: newCount })
      .eq('id', postId);

    return { shared, count: newCount };
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
      username: data.profiles?.username || '',
      displayName: data.profiles?.display_name || 'Anonymous',
      avatarUrl: data.profiles?.avatar_url || '',
      verifiedStatus: data.profiles?.verified_status || 'none',
    };
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

  // ─── REALTIME SUBSCRIPTIONS ──────────────────────────────────────
  let _realtimeChannel = null;
  let _realtimeCallbacks = [];

  function subscribe(callback) {
    if (typeof callback === 'function') {
      _realtimeCallbacks.push(callback);
    }
    if (_realtimeChannel) return;

    _realtimeChannel = sb
      .channel('posts_reposts_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reposts'
        },
        async () => {
          clearFeedContext();
          _realtimeCallbacks.forEach(fn => {
            try { fn(); } catch (e) { console.warn('Realtime callback error:', e); }
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Subscribed to reposts realtime');
        }
      });
  }

  function unsubscribe() {
    if (_realtimeChannel) {
      sb.removeChannel(_realtimeChannel);
      _realtimeChannel = null;
      _realtimeCallbacks = [];
    }
  }

  // ─── EXPOSE PUBLIC API ────────────────────────────────────────────
  window.PostsAPI = {
    // Feed & context
    loadFeedWithReposts,
    getFeedContext,
    clearFeedContext,

    // Posts by user / single
    loadPostsByUserId,
    loadPostById,
    loadPostPreview,

    // Comments
    loadComments,
    addComment,

    // Posts
    createPost,
    deletePost,

    // Interactions – ALL use the database now
    toggleLike,
    toggleCommentLike,   // <-- Fully database-backed
    toggleRepostAPI,
    updateRepostComment,
    toggleBookmark,
    toggleShare,
    incrementView,
    reportPost,

    // Realtime
    subscribe,
    unsubscribe,
  };

})();
