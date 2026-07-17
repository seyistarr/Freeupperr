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

  // Map post with profile data including verified_status
  function mapPost(row, userLikes) {
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
    if (user && user.isLoggedIn && rows && rows.length > 0) {
      const postIds = rows.map(r => r.id);
      const { data: likes } = await sb
        .from('post_likes')
        .select('post_id')
        .eq('user_id', user.id)
        .in('post_id', postIds);
      likedIds = new Set((likes || []).map(l => l.post_id));
    }

    return rows.map(row => mapPost(row, likedIds));
  }

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

    return data.map(row => ({
      ...row,
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
      ...data,
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

  window.PostsAPI = {
    loadAllPosts,
    loadComments,
    createPost,
    addComment,
    toggleLike,
    deletePost,
    incrementView,
  };
})();
