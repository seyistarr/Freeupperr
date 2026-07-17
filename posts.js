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
      author: profile.display_name || 'Anonymous',
      authorId: row.user_id,
      authorAvatar: profile.avatar_url || null,
      authorUsername: profile.username || '',
      verified: profile.verified || false,
      title: row.title,
      description: row.description || '',
      content: row.content || '',
      media: media,
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      category: row.category || 'General',
      tags: row.tags || [],
      date: row.created_at ? row.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
      timestamp: row.created_at || new Date().toISOString(),
      views: row.views || 0,
      reactions: {
        like: row.likes_count || 0
      },
      commentCount: row.comments_count || 0,
      comments: [],
      likedByMe: userLikes.has(row.id)
    };
  }

  async function loadAllPosts() {
    console.log('loadAllPosts called');

    try {
      const { data: rows, error } = await sb
        .from('posts')
        .select(`
          *,
          profiles:user_id (
            id,
            display_name,
            username,
            avatar_url,
            verified
          )
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('loadAllPosts error:', error);
        return [];
      }

      console.log('Found', rows ? rows.length : 0, 'posts');

      const user = getCurrentUser();
      let likedIds = new Set();
      if (user && user.isLoggedIn) {
        const { data: likes } = await sb
          .from('post_likes')
          .select('post_id')
          .eq('user_id', user.id);
        likedIds = new Set((likes || []).map(l => l.post_id));
      }

      const posts = rows ? rows.map(row => mapPost(row, likedIds)) : [];
      console.log('Mapped', posts.length, 'posts');
      return posts;

    } catch (err) {
      console.error('loadAllPosts exception:', err);
      return [];
    }
  }

  async function loadComments(postId) {
    try {
      const { data, error } = await sb
        .from('comments')
        .select(`
          id,
          parent_id,
          message,
          created_at,
          profiles:user_id (
            display_name,
            avatar_url,
            verified
          )
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
        verified: row.profiles?.verified || false,
        message: row.message,
        time: row.created_at,
        parentId: row.parent_id,
        approved: true
      }));
    } catch (err) {
      console.error('loadComments exception:', err);
      return [];
    }
  }

  async function createPost(fields) {
    console.log('createPost called with:', fields);
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      console.error('User not logged in');
      throw new Error('Please sign in to post.');
    }

    const payload = {
      user_id: user.id,
      title: fields.title || '',
      description: fields.description || '',
      content: fields.content || '',
      category: fields.category || 'General',
      tags: fields.tags || [],
      media: fields.media || [],
      media_url: fields.mediaUrl || null,
      media_type: fields.mediaType || null
    };

    if (fields.media && fields.media.length > 0) {
      payload.media_url = fields.media[0].url || null;
      payload.media_type = fields.media[0].type || null;
    }

    console.log('Inserting post with payload:', payload);

    try {
      const { data, error } = await sb
        .from('posts')
        .insert(payload)
        .select('*')
        .single();

      if (error) {
        console.error('Supabase insert error:', error);
        throw error;
      }

      console.log('Post created successfully:', data);
      return mapPost(data, new Set());

    } catch (err) {
      console.error('createPost exception:', err);
      throw err;
    }
  }

  async function addComment(postId, parentId, message) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in to comment.');
    }

    try {
      const { data, error } = await sb
        .from('comments')
        .insert({
          post_id: postId,
          user_id: user.id,
          parent_id: parentId || null,
          message: message
        })
        .select(`
          id,
          parent_id,
          message,
          created_at,
          profiles:user_id (
            display_name,
            avatar_url,
            verified
          )
        `)
        .single();

      if (error) throw error;

      return {
        id: data.id,
        username: data.profiles?.display_name || 'Anonymous',
        avatar: data.profiles?.avatar_url || null,
        verified: data.profiles?.verified || false,
        message: data.message,
        time: data.created_at,
        parentId: data.parent_id,
        approved: true
      };
    } catch (err) {
      console.error('addComment error:', err);
      throw err;
    }
  }

  async function toggleLike(postId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in to like.');
    }

    try {
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
    } catch (err) {
      console.error('toggleLike error:', err);
      throw err;
    }
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
    try {
      const { error } = await sb
        .from('posts')
        .update({ views: sb.raw('views + 1') })
        .eq('id', postId);
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
    incrementView
  };

  console.log('posts.js loaded successfully');
  console.log('PostsAPI:', Object.keys(window.PostsAPI));
})();
