(function() {
  'use strict';

  if (!window.sb) {
    console.error('posts.js: Supabase client missing.');
    return;
  }
  const sb = window.sb;

  function getCurrentUser() {
    if (window.AuthUser && typeof window.AuthUser.getCurrentUser === 'function') {
      return window.AuthUser.getCurrentUser();
    }
    const raw = localStorage.getItem('freeupper_user_profile');
    return raw ? JSON.parse(raw) : null;
  }

  // Map post with profile data including verified_status and repost info
  function mapPost(row, userLikes, myRepost) {
    const profile = row.profiles || {};
    let media = row.media;
    if (!media || !Array.isArray(media) || media.length === 0) {
      if (row.media_url) {
        media = [{ url: row.media_url, type: row.media_type || 'image' }];
      } else {
        media = [];
      }
    }
    media = media.map(item => ({ ...item, type: item.type || 'image' }));

    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      description: row.description || '',
      content: row.content || '',
      media: media,
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      category: row.category || 'General',
      tags: row.tags || [],
      timestamp: row.created_at || new Date().toISOString(),
      views: row.views || 0,
      comments: row.comments_count || 0,
      likes: row.likes_count || 0,
      likedByMe: userLikes.has(row.id),
      repostCount: row.repost_count || 0,
      myRepost: !!myRepost,
      myRepostText: myRepost ? (myRepost.comment || '') : '',
      myRepostTime: myRepost ? myRepost.created_at : null,
      // Profile data (single source of truth)
      profile: {
        id: profile.id,
        display_name: profile.display_name || 'Anonymous',
        username: profile.username || '',
        avatar_url: profile.avatar_url || '',
        verified: profile.verified || false,
        verified_status: profile.verified_status || 'none',
        is_private: profile.is_private || false,
      }
    };
  }

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

    const user = getCurrentUser();
    let likedIds = new Set();
    let repostMap = new Map();
    if (user && user.isLoggedIn && rows && rows.length > 0) {
      const postIds = rows.map(r => r.id);
      const [{ data: likes }, { data: reposts }] = await Promise.all([
        sb.from('post_likes').select('post_id').eq('user_id', user.id).in('post_id', postIds),
        sb.from('reposts').select('post_id, comment, created_at').eq('user_id', user.id).in('post_id', postIds),
      ]);
      likedIds = new Set((likes || []).map(l => l.post_id));
      (reposts || []).forEach(r => repostMap.set(r.post_id, r));
    }

    return rows.map(row => mapPost(row, likedIds, repostMap.get(row.id)));
  }

  // ─── LOAD COMMENTS (returns camelCase fields) ───
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

    const user = getCurrentUser();
    let likedIds = new Set();
    if (user && user.isLoggedIn && data && data.length > 0) {
      const commentIds = data.map(r => r.id);
      const { data: likes } = await sb
        .from('comment_likes')
        .select('comment_id')
        .eq('user_id', user.id)
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
    }));
  }

  async function createPost(fields) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in to post.');
    }

    // Only store user_id – NO author/author_avatar
    const payload = {
      user_id: user.id,
      title: fields.title || '',
      description: fields.description || '',
      content: fields.content || '',
      category: fields.category || 'General',
      tags: fields.tags || [],
      media: fields.media || [],
      media_url: fields.mediaUrl || null,
      media_type: fields.mediaType || null,
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
    return mapPost(data, new Set());
  }

  // ─── ADD COMMENT (returns camelCase fields) ───
  async function addComment(postId, parentId, message) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in to comment.');
    }

    const { data, error } = await sb
      .from('comments')
      .insert({
        post_id: postId,
        user_id: user.id,
        parent_id: parentId || null,
        message: message,
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
      profile: data.profiles || {},
    };
  }

  async function toggleLike(postId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in to like.');
    }
    const { data, error } = await sb.rpc('toggle_post_like', { p_post_id: postId });
    if (error) throw error;
    return { liked: data[0].liked, count: data[0].new_count };
  }

  async function toggleCommentLike(commentId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in to like.');
    }
    const { data, error } = await sb.rpc('toggle_comment_like', { p_comment_id: commentId });
    if (error) throw error;
    return { liked: data[0].liked, count: data[0].new_count };
  }

  async function toggleRepostAPI(postId, comment) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in to repost.');
    }
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

  async function deletePost(postId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in.');
    }
    const { error } = await sb.rpc('delete_post', { p_post_id: postId });
    if (error) throw error;
  }

  async function incrementView(postId) {
    try {
      const { error } = await sb.rpc('add_view', {
        p_post_id: postId,
        p_user_id: null,
        p_session_id: localStorage.getItem('freeupper_session_id') || null,
      });
      if (error) console.error('incrementView error:', error);
    } catch (err) {
      console.error('incrementView exception:', err);
    }
  }

  // ─── REPOST FEED HELPERS ──────────────────────────

  async function loadRepostFeedItems(offset = 0, limit = 20) {
    const { data: rows, error } = await sb
      .from('repost_feed_items')
      .select('*')
      .order('repost_created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('loadRepostFeedItems error:', error);
      return [];
    }
    return rows;
  }

  async function loadFeedWithReposts(offset = 0, limit = 20) {
    const [posts, repostItems] = await Promise.all([
      loadAllPosts(offset, limit),
      loadRepostFeedItems(offset, limit),
    ]);

    if (repostItems.length === 0) {
      return posts.map(p => ({ feedType: 'post', sortTime: p.timestamp, post: p }));
    }

    // Fetch the original posts referenced by these reposts (may not be in `posts` page)
    const neededIds = [...new Set(repostItems.map(r => r.post_id))];
    const havePostIds = new Set(posts.map(p => p.id));
    const missingIds = neededIds.filter(id => !havePostIds.has(id));

    let extraPostsById = new Map();
    if (missingIds.length > 0) {
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
        const user = getCurrentUser();
        let likedIds = new Set();
        if (user && user.isLoggedIn && extraRows.length > 0) {
          const { data: likes } = await sb
            .from('post_likes')
            .select('post_id')
            .eq('user_id', user.id)
            .in('post_id', extraRows.map(r => r.id));
          likedIds = new Set((likes || []).map(l => l.post_id));
        }
        extraRows.forEach(row => extraPostsById.set(row.id, mapPost(row, likedIds)));
      }
    }

    const postsById = new Map(posts.map(p => [p.id, p]));

    const repostEntries = repostItems
      .map(r => {
        const originalPost = postsById.get(r.post_id) || extraPostsById.get(r.post_id);
        if (!originalPost) return null;
        return {
          feedType: 'repost',
          sortTime: r.repost_created_at,
          repostId: r.repost_id,
          reposter: {
            id: r.reposter_id,
            display_name: r.reposter_display_name || 'Anonymous',
            username: r.reposter_username || '',
            avatar_url: r.reposter_avatar_url || '',
            verified_status: r.reposter_verified_status || 'none',
          },
          repostComment: r.repost_comment || '',
          post: originalPost,
        };
      })
      .filter(Boolean);

    const postEntries = posts.map(p => ({ feedType: 'post', sortTime: p.timestamp, post: p }));

    return [...postEntries, ...repostEntries].sort(
      (a, b) => new Date(b.sortTime) - new Date(a.sortTime)
    );
  }

  // ─── EXPOSE API ────────────────────────────────────
  window.PostsAPI = {
    loadAllPosts,
    loadRepostFeedItems,
    loadFeedWithReposts,
    loadComments,
    createPost,
    addComment,
    toggleLike,
    toggleCommentLike,
    toggleRepostAPI,
    deletePost,
    incrementView,
  };
})();
