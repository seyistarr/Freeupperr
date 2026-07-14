(function () {
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

  function mapPost(row, userLikes) {
    return {
      id: row.id,
      author: row.author || 'Anonymous',
      authorId: row.user_id,
      authorAvatar: row.author_avatar,
      title: row.title,
      description: row.description || '',
      content: row.content || '',
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      category: row.category || 'General',
      tags: row.tags || [],
      date: row.created_at.split('T')[0],
      timestamp: row.created_at,
      views: row.views || 0,
      reactions: { like: row.likes_count || 0 },
      commentCount: row.comments_count || 0,
      comments: [],
      likedByMe: userLikes.has(row.id)
    };
  }

  async function loadAllPosts() {
    const { data: rows, error } = await sb
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('loadAllPosts error:', error);
      return [];
    }

    const user = getCurrentUser();
    let likedIds = new Set();
    if (user && user.isLoggedIn) {
      const { data: likes } = await sb
        .from('post_likes')
        .select('post_id')
        .eq('user_id', user.id);
      likedIds = new Set((likes || []).map(l => l.post_id));
    }

    return rows.map(row => mapPost(row, likedIds));
  }

  async function loadComments(postId) {
    const { data, error } = await sb
      .from('comments')
      .select(`
        id, parent_id, message, created_at,
        profiles:user_id (display_name, avatar_url)
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('loadComments error:', error);
      return [];
    }

    return data.map(row => ({
      id: row.id,
      username: row.profiles?.display_name || 'Anonymous',
      avatar: row.profiles?.avatar_url || null,
      message: row.message,
      time: row.created_at,
      parentId: row.parent_id,
      approved: true
    }));
  }

  async function createPost(fields) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in to post.');
    }

    const { data, error } = await sb
      .from('posts')
      .insert({
        user_id: user.id,
        title: fields.title,
        description: fields.description || '',
        content: fields.content,
        media_url: fields.mediaUrl || null,
        media_type: fields.mediaType || null,
        category: fields.category || 'General',
        tags: fields.tags || [],
        author: user.displayName || 'User',
        author_avatar: user.avatar || null
      })
      .select('*')
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
        message: message
      })
      .select(`
        id, parent_id, message, created_at,
        profiles:user_id (display_name, avatar_url)
      `)
      .single();

    if (error) throw error;

    return {
      id: data.id,
      username: data.profiles?.display_name || 'Anonymous',
      avatar: data.profiles?.avatar_url || null,
      message: data.message,
      time: data.created_at,
      parentId: data.parent_id,
      approved: true
    };
  }

  async function toggleLike(postId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in to like.');
    }

    const { data: existing } = await sb
      .from('post_likes')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      await sb
        .from('post_likes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', user.id);
    } else {
      await sb
        .from('post_likes')
        .insert({ post_id: postId, user_id: user.id });
    }

    const { count } = await sb
      .from('post_likes')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId);

    return { liked: !existing, count: count || 0 };
  }

  async function deletePost(postId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in.');
    }
    const { error } = await sb
      .from('posts')
      .delete()
      .eq('id', postId);
    if (error) throw error;
  }

  async function incrementView(postId) {
    // Simple update – you can also use an RPC function
    const { error } = await sb
      .from('posts')
      .update({ views: sb.raw('views + 1') })
      .eq('id', postId);
    if (error) console.error('incrementView error:', error);
  }

  window.PostsAPI = {
    loadAllPosts,
    loadComments,
    createPost,
    addComment,
    toggleLike,
    deletePost,
    incrementView
  };

})();