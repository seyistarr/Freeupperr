/* ============================================================
   FreeUpper — posts.js
   Requires auth.js to run first (uses window.sb + window.AuthUser).
   ============================================================ */
(function () {
  'use strict';

  if (!window.sb) {
    console.error('posts.js: auth.js must load first (window.sb missing).');
    return;
  }
  const sb = window.sb;

  function mapPost(row, likedSet) {
    return {
      id: row.id,
      author: row.profiles?.display_name || 'Anonymous',
      authorId: row.author_id,
      authorAvatar: row.profiles?.avatar_url || null,
      title: row.title,
      description: row.description || '',
      content: row.content,
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      category: row.category || 'General',
      tags: row.tags || [],
      date: (row.created_at || '').split('T')[0],
      timestamp: row.created_at,
      views: row.views || 0,
      reactions: { like: (row.post_likes && row.post_likes[0] && row.post_likes[0].count) || 0 },
      commentCount: (row.comments && row.comments[0] && row.comments[0].count) || 0,
      comments: [],
      likedByMe: likedSet ? likedSet.has(row.id) : false
    };
  }

  function mapComment(row, fallbackUser) {
    return {
      id: row.id,
      username: row.profiles?.display_name || (fallbackUser && fallbackUser.displayName) || 'Anonymous',
      avatar: row.profiles?.avatar_url || (fallbackUser && fallbackUser.avatar) || null,
      message: row.message,
      time: row.created_at,
      approved: true,
      parentId: row.parent_id
    };
  }

  async function loadAllPosts() {
    const { data: rows, error } = await sb
      .from('posts')
      .select('*, profiles(display_name, avatar_url), post_likes(count), comments(count)')
      .order('created_at', { ascending: false });

    if (error) { console.error('loadAllPosts:', error); return []; }

    let likedIds = new Set();
    const user = window.AuthUser.getCurrentUser();
    if (user.isLoggedIn) {
      const { data: likes } = await sb.from('post_likes').select('post_id').eq('user_id', user.id);
      likedIds = new Set((likes || []).map(l => l.post_id));
    }

    return (rows || []).map(r => mapPost(r, likedIds));
  }

  async function loadComments(postId) {
    const { data: rows, error } = await sb
      .from('comments')
      .select('*, profiles(display_name, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) { console.error('loadComments:', error); return []; }
    return rows.map(r => mapComment(r));
  }

  async function createPost(fields) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in to post.');

    const { data, error } = await sb
      .from('posts')
      .insert({
        author_id: user.id,
        title: fields.title,
        description: fields.description || '',
        content: fields.content,
        media_url: fields.mediaUrl || null,
        media_type: fields.mediaType || null,
        category: fields.category || 'General',
        tags: fields.tags || []
      })
      .select('*, profiles(display_name, avatar_url)')
      .single();

    if (error) throw error;
    return mapPost({ ...data, post_likes: [{ count: 0 }], comments: [{ count: 0 }] }, new Set());
  }

  async function addComment(postId, parentId, message) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in to comment.');

    const { data, error } = await sb
      .from('comments')
      .insert({ post_id: postId, author_id: user.id, parent_id: parentId || null, message })
      .select('*, profiles(display_name, avatar_url)')
      .single();

    if (error) throw error;
    return mapComment(data, user);
  }

  async function toggleLike(postId) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in to like posts.');

    const { data: existing } = await sb
      .from('post_likes')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      await sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', user.id);
    } else {
      await sb.from('post_likes').insert({ post_id: postId, user_id: user.id });
    }

    const { count } = await sb
      .from('post_likes')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId);

    return { liked: !existing, count: count || 0 };
  }

  async function deletePost(postId) {
    const { error } = await sb.from('posts').delete().eq('id', postId);
    if (error) throw error;
  }

  async function incrementView(postId) {
    const { data } = await sb.from('posts').select('views').eq('id', postId).single();
    if (data) await sb.from('posts').update({ views: (data.views || 0) + 1 }).eq('id', postId);
  }

  window.PostsAPI = {
    loadAllPosts, loadComments, createPost, addComment, toggleLike, deletePost, incrementView
  };
})();