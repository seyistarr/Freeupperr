// =====================================================================
// posts.js – FreeUpper v1.3 Multi‑Context Feed
// =====================================================================
//
// feedContextMap[postId] = {
//   repost: { items: [...], latestTime, count },
//   friendsLiked: { ... },
//   featured: { ... },
//   ...
// }
//
// All context mutations go through setFeedContext(postId, type, context)
// Sorting is centralised via getFeedSortTime(post) (private)
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

  // Public getter
  function getFeedContext(postId) {
    return feedContextMap.get(postId) || null;
  }

  function clearFeedContext() {
    feedContextMap.clear();
  }

  // ─── Private helper to set a single context type ──────────────────
  function setFeedContext(postId, type, context) {
    const existing = feedContextMap.get(postId) || {};
    existing[type] = context;
    feedContextMap.set(postId, existing);
  }

  // ─── Private centralised sort-time extraction ────────────────────
  function getFeedSortTime(post) {
    const ctx = getFeedContext(post.id);
    // Priority: repost -> friendsLiked -> featured -> ... (add as needed)
    if (ctx?.repost) return ctx.repost.latestTime;
    // Future: if (ctx?.friendsLiked) return ctx.friendsLiked.latestTime;
    // Future: if (ctx?.featured) return ctx.featured.since;
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

  // ─── NEW: LOAD POSTS BY USER ID ─────────────────────────────────────
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

  // ─── NEW: LOAD SINGLE POST BY ID (for repost fallback) ────────────
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

  // ─── LOAD REPOST FEED ITEMS ────────────────────────────────────────
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

    // Build feedContextMap using setFeedContext
    feedContextMap.clear();
    const seenPostIds = new Set();
    const feedItems = [];

    repostGroups.forEach((users, postId) => {
      const originalPost = postsById.get(postId) || extraPostsById.get(postId);
      if (!originalPost) return;
      seenPostIds.add(postId);
      const sorted = [...users].sort((a, b) => new Date(b.time) - new Date(a.time));

      // Store repost context
      setFeedContext(postId, 'repost', {
        items: sorted,
        latestTime: sorted[0].time,
        count: sorted.length,
      });

      feedItems.push(originalPost);
    });

    // Add remaining posts
    posts.forEach(p => {
      if (!seenPostIds.has(p.id)) {
        feedItems.push(p);
      }
    });

    // Sort using centralised getFeedSortTime (private)
    feedItems.sort((a, b) => {
      const timeA = getFeedSortTime(a);
      const timeB = getFeedSortTime(b);
      return new Date(timeB) - new Date(timeA);
    });

    // Return feed items as { feedType, sortTime, post }
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

  // ─── POST OPERATIONS ──────────────────────────────────────────────
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

  // ─── LIKES ─────────────────────────────────────────────────────────
  async function toggleLike(postId) {
    const { data, error } = await sb.rpc('toggle_post_like', { p_post_id: postId });
    if (error) throw error;
    return { liked: data[0].liked, count: data[0].new_count };
  }

  async function toggleCommentLike(commentId) {
    const { data, error } = await sb.rpc('toggle_comment_like', { p_comment_id: commentId });
    if (error) throw error;
    return { liked: data[0].liked, count: data[0].new_count };
  }

  // ─── REPOSTS ──────────────────────────────────────────────────────
  async function toggleRepostAPI(postId, comment = '') {
    const { data, error } = await sb.rpc('toggle_repost', {
      p_post_id: postId,
      p_comment: comment || '',
    });
    if (error) throw error;
    return {
      reposted: data[0].reposted,
      count: data[0].new_count,
      comment: data[0].repost_comment,
      time: data[0].reposted_at,
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

    return {
      reposted: true,
      count: post?.repost_count || 0,
      comment: data.comment,
      time: data.created_at,
    };
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

    // Posts by user (NEW)
    loadPostsByUserId,
    loadPostById,           // NEW: single post fetch

    // Comments
    loadComments,
    addComment,

    // Posts
    createPost,
    deletePost,

    // Interactions
    toggleLike,
    toggleCommentLike,
    toggleRepostAPI,
    updateRepostComment,
    incrementView,
    loadPostPreview,
    reportPost,

    // Realtime
    subscribe,
    unsubscribe,
  };

})();
