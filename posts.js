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

  // ─── HELPER: Get current user safely ──────────────────────
  function getCurrentUserSafe() {
    if (window.AuthUser && typeof window.AuthUser.getCurrentUser === 'function') {
      return window.AuthUser.getCurrentUser();
    }
    if (typeof window.getCurrentUser === 'function') {
      return window.getCurrentUser();
    }
    try {
      const raw = localStorage.getItem('freeupper_user_profile');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      id: 'GUEST-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      username: '',
      displayName: 'Guest',
      bio: '',
      avatar: 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#E5E7EB"/><circle cx="50" cy="38" r="16" fill="#9CA3AF"/><ellipse cx="50" cy="75" rx="30" ry="22" fill="#9CA3AF"/></svg>'
      ),
      isLoggedIn: false,
      verified: false,
      verificationStatus: 'none'
    };
  }

  function mapPost(row, likedSet) {
    // Get profile data from the joined profiles table
    const profile = row.profiles || {};
    return {
      id: row.id,
      author: profile.display_name || 'Anonymous',
      authorId: row.author_id,
      authorAvatar: profile.avatar_url || null,
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
      reactions: { 
        like: (row.post_likes && row.post_likes.length > 0) ? row.post_likes[0].count || 0 : 0 
      },
      commentCount: (row.comments && row.comments.length > 0) ? row.comments[0].count || 0 : 0,
      comments: [],
      likedByMe: likedSet ? likedSet.has(row.id) : false
    };
  }

  function mapComment(row, fallbackUser) {
    const profile = row.profiles || {};
    return {
      id: row.id,
      username: profile.display_name || (fallbackUser && fallbackUser.displayName) || 'Anonymous',
      avatar: profile.avatar_url || (fallbackUser && fallbackUser.avatar) || null,
      message: row.message,
      time: row.created_at,
      approved: true,
      parentId: row.parent_id
    };
  }

  async function loadAllPosts() {
    try {
      // ✅ Use a simpler query without joins first to test
      const { data: rows, error } = await sb
        .from('posts')
        .select(`
          *,
          profiles:author_id (
            display_name,
            avatar_url
          ),
          post_likes:post_likes (count),
          comments:comments (count)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('loadAllPosts error:', error);
        // If the join fails, try without it
        return await loadAllPostsSimple();
      }

      let likedIds = new Set();
      const user = getCurrentUserSafe();
      if (user && user.isLoggedIn) {
        try {
          const { data: likes } = await sb.from('post_likes').select('post_id').eq('user_id', user.id);
          likedIds = new Set((likes || []).map(l => l.post_id));
        } catch (e) {
          console.warn('Could not fetch liked posts:', e);
        }
      }

      return (rows || []).map(r => mapPost(r, likedIds));
    } catch (err) {
      console.error('loadAllPosts error:', err);
      // Fallback: try without joins
      return await loadAllPostsSimple();
    }
  }

  // ─── FALLBACK: Load posts without joins ──────────────────
  async function loadAllPostsSimple() {
    console.warn('Using fallback: loading posts without joins');
    const { data: rows, error } = await sb
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('loadAllPostsSimple error:', error);
      return [];
    }

    // Get user info from profiles separately
    const user = getCurrentUserSafe();
    let likedIds = new Set();
    if (user && user.isLoggedIn) {
      try {
        const { data: likes } = await sb.from('post_likes').select('post_id').eq('user_id', user.id);
        likedIds = new Set((likes || []).map(l => l.post_id));
      } catch (e) {}
    }

    // Get author names and avatars for each post
    const postsWithAuthors = await Promise.all((rows || []).map(async (row) => {
      let profile = {};
      if (row.author_id) {
        try {
          const { data: profileData } = await sb
            .from('profiles')
            .select('display_name, avatar_url')
            .eq('id', row.author_id)
            .maybeSingle();
          if (profileData) profile = profileData;
        } catch (e) {}
      }
      return {
        ...row,
        profiles: profile,
        post_likes: [{ count: 0 }],
        comments: [{ count: 0 }]
      };
    }));

    return postsWithAuthors.map(r => mapPost(r, likedIds));
  }

  async function loadComments(postId) {
    try {
      const { data: rows, error } = await sb
        .from('comments')
        .select(`
          *,
          profiles:author_id (
            display_name,
            avatar_url
          )
        `)
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('loadComments error:', error);
        // Fallback: load without join
        return await loadCommentsSimple(postId);
      }
      return rows.map(r => mapComment(r));
    } catch (err) {
      console.error('loadComments error:', err);
      return await loadCommentsSimple(postId);
    }
  }

  // ─── FALLBACK: Load comments without joins ──────────────
  async function loadCommentsSimple(postId) {
    console.warn('Using fallback: loading comments without joins');
    const { data: rows, error } = await sb
      .from('comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('loadCommentsSimple error:', error);
      return [];
    }

    // Get author info for each comment
    const commentsWithAuthors = await Promise.all((rows || []).map(async (row) => {
      let profile = {};
      if (row.author_id) {
        try {
          const { data: profileData } = await sb
            .from('profiles')
            .select('display_name, avatar_url')
            .eq('id', row.author_id)
            .maybeSingle();
          if (profileData) profile = profileData;
        } catch (e) {}
      }
      return {
        ...row,
        profiles: profile
      };
    }));

    return commentsWithAuthors.map(r => mapComment(r));
  }

  async function createPost(fields) {
    const user = getCurrentUserSafe();
    if (!user || !user.isLoggedIn) {
      if (window.AuthUser && typeof window.AuthUser.openModal === 'function') {
        return new Promise((resolve, reject) => {
          window.AuthUser.openModal('signup', async function() {
            try {
              const result = await createPost(fields);
              resolve(result);
            } catch (err) {
              reject(err);
            }
          });
        });
      }
      throw new Error('Please sign in to post.');
    }

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
      .select(`
        *,
        profiles:author_id (
          display_name,
          avatar_url
        )
      `)
      .single();

    if (error) throw error;
    return mapPost({ ...data, post_likes: [{ count: 0 }], comments: [{ count: 0 }] }, new Set());
  }

  async function addComment(postId, parentId, message) {
    const user = getCurrentUserSafe();
    if (!user || !user.isLoggedIn) {
      if (window.AuthUser && typeof window.AuthUser.openModal === 'function') {
        return new Promise((resolve, reject) => {
          window.AuthUser.openModal('signup', async function() {
            try {
              const result = await addComment(postId, parentId, message);
              resolve(result);
            } catch (err) {
              reject(err);
            }
          });
        });
      }
      throw new Error('Please sign in to comment.');
    }

    const { data, error } = await sb
      .from('comments')
      .insert({ post_id: postId, author_id: user.id, parent_id: parentId || null, message })
      .select(`
        *,
        profiles:author_id (
          display_name,
          avatar_url
        )
      `)
      .single();

    if (error) throw error;
    return mapComment(data, user);
  }

  async function toggleLike(postId) {
    const user = getCurrentUserSafe();
    if (!user || !user.isLoggedIn) {
      if (window.AuthUser && typeof window.AuthUser.openModal === 'function') {
        return new Promise((resolve, reject) => {
          window.AuthUser.openModal('signup', async function() {
            try {
              const result = await toggleLike(postId);
              resolve(result);
            } catch (err) {
              reject(err);
            }
          });
        });
      }
      throw new Error('Please sign in to like posts.');
    }

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
    const user = getCurrentUserSafe();
    if (!user || !user.isLoggedIn) {
      throw new Error('Please sign in to delete posts.');
    }
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