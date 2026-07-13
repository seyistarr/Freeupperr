/* ============================================================
   FreeUpper — settings.js
   Requires auth.js to run first (uses window.sb + window.AuthUser).
   ============================================================ */
(function () {
  'use strict';

  if (!window.sb) {
    console.error('settings.js: auth.js must load first (window.sb missing).');
    return;
  }
  const sb = window.sb;

  // ─── UPDATE PROFILE FLAGS ──────────────────────────────────
  async function updateFlags(updates) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in to update settings.');

    const payload = {};
    if (updates.isPrivate !== undefined) payload.is_private = updates.isPrivate;
    if (updates.hideFollowerCount !== undefined) payload.hide_follower_count = updates.hideFollowerCount;
    if (updates.activityStatus !== undefined) payload.activity_status = updates.activityStatus;
    if (updates.phone !== undefined) payload.phone = updates.phone;
    if (updates.displayName !== undefined) payload.display_name = updates.displayName;
    if (updates.username !== undefined) payload.username = updates.username;
    if (updates.bio !== undefined) payload.bio = updates.bio;
    if (updates.website !== undefined) payload.website = updates.website;
    if (updates.gender !== undefined) payload.gender = updates.gender;
    if (updates.country !== undefined) payload.country = updates.country;
    if (updates.dob !== undefined) payload.dob = updates.dob;

    const { error } = await sb.from('profiles').update(payload).eq('id', user.id);
    if (error) throw error;

    // Update local cache
    const localUser = window.AuthUser.getCurrentUser();
    Object.assign(localUser, updates);
    localStorage.setItem('freeupper_user_profile', JSON.stringify(localUser));

    document.dispatchEvent(new CustomEvent('profileUpdated', { detail: { user: localUser } }));
  }

  // ─── CHANGE PASSWORD ──────────────────────────────────────
  async function changePassword(currentPassword, newPassword) {
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  // ─── VERIFICATION ──────────────────────────────────────────
  async function submitVerification({ category, reason, link }) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in to request verification.');

    const { data: existing } = await sb
      .from('verification_requests')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) throw new Error('You already have a pending request');

    const { data, error } = await sb
      .from('verification_requests')
      .insert({ user_id: user.id, category, reason, link: link || '' })
      .select()
      .single();

    if (error) throw error;

    const localUser = window.AuthUser.getCurrentUser();
    localUser.verificationStatus = 'pending';
    localStorage.setItem('freeupper_user_profile', JSON.stringify(localUser));

    return data;
  }

  async function withdrawVerification() {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in.');

    const { error } = await sb
      .from('verification_requests')
      .delete()
      .eq('user_id', user.id)
      .eq('status', 'pending');

    if (error) throw error;

    const localUser = window.AuthUser.getCurrentUser();
    localUser.verificationStatus = 'none';
    localStorage.setItem('freeupper_user_profile', JSON.stringify(localUser));
  }

  async function getVerificationStatus() {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) return { status: 'none' };

    const { data, error } = await sb
      .from('verification_requests')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return { status: 'none' };
    return data[0];
  }

  // ─── BLOCKED USERS ────────────────────────────────────────
  async function listBlockedUsers() {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) return [];

    const { data, error } = await sb
      .from('blocked_users')
      .select(`
        blocked_id,
        profiles:blocked_id (
          id,
          display_name,
          username,
          avatar_url
        )
      `)
      .eq('blocker_id', user.id);

    if (error) throw error;

    return (data || []).map(row => ({
      id: row.blocked_id,
      name: row.profiles?.display_name || 'Unknown',
      username: row.profiles?.username || '',
      avatar: row.profiles?.avatar_url || null,
      handle: row.profiles?.username ? '@' + row.profiles.username : ''
    }));
  }

  async function unblockUser(userId) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in.');

    const { error } = await sb
      .from('blocked_users')
      .delete()
      .eq('blocker_id', user.id)
      .eq('blocked_id', userId);

    if (error) throw error;
  }

  async function blockUser(userId) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in.');
    if (userId === user.id) throw new Error('You cannot block yourself.');

    const { error } = await sb
      .from('blocked_users')
      .insert({ blocker_id: user.id, blocked_id: userId });

    if (error) throw error;
  }

  // ─── FOLLOWS ──────────────────────────────────────────────
  async function followUser(userId) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in to follow.');
    if (userId === user.id) throw new Error('You cannot follow yourself.');

    const { error } = await sb
      .from('follows')
      .insert({ follower_id: user.id, followed_id: userId });

    if (error) throw error;
  }

  async function unfollowUser(userId) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in.');

    const { error } = await sb
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('followed_id', userId);

    if (error) throw error;
  }

  async function getFollowCounts(userId) {
    const { count: followers } = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('followed_id', userId);

    const { count: following } = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId);

    return { followers: followers || 0, following: following || 0 };
  }

  async function isFollowing(userId) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) return false;

    const { count } = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', user.id)
      .eq('followed_id', userId);

    return count > 0;
  }

  // ─── BOOKMARKS ─────────────────────────────────────────────
  async function toggleBookmark(postId) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in to bookmark.');

    const { data: existing } = await sb
      .from('bookmarks')
      .select('*')
      .eq('user_id', user.id)
      .eq('post_id', postId)
      .maybeSingle();

    if (existing) {
      await sb.from('bookmarks').delete().eq('user_id', user.id).eq('post_id', postId);
      return false;
    } else {
      await sb.from('bookmarks').insert({ user_id: user.id, post_id: postId });
      return true;
    }
  }

  async function getBookmarks() {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) return [];

    const { data, error } = await sb
      .from('bookmarks')
      .select('post_id')
      .eq('user_id', user.id);

    if (error) throw error;
    return (data || []).map(b => b.post_id);
  }

  // ─── SHARES ────────────────────────────────────────────────
  async function toggleShare(postId) {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) throw new Error('Please sign in to share.');

    const { data: existing } = await sb
      .from('shares')
      .select('*')
      .eq('user_id', user.id)
      .eq('post_id', postId)
      .maybeSingle();

    if (existing) {
      await sb.from('shares').delete().eq('user_id', user.id).eq('post_id', postId);
      return false;
    } else {
      await sb.from('shares').insert({ user_id: user.id, post_id: postId });
      return true;
    }
  }

  async function getShares() {
    const user = window.AuthUser.getCurrentUser();
    if (!user.isLoggedIn) return [];

    const { data, error } = await sb
      .from('shares')
      .select('post_id')
      .eq('user_id', user.id);

    if (error) throw error;
    return (data || []).map(s => s.post_id);
  }

  // ─── SIGN OUT ─────────────────────────────────────────────
  async function signOut() {
    await sb.auth.signOut();
  }

  // ─── EXPOSE ───────────────────────────────────────────────
  window.SettingsAPI = {
    updateFlags,
    changePassword,
    submitVerification,
    withdrawVerification,
    getVerificationStatus,
    listBlockedUsers,
    unblockUser,
    blockUser,
    followUser,
    unfollowUser,
    getFollowCounts,
    isFollowing,
    toggleBookmark,
    getBookmarks,
    toggleShare,
    getShares,
    signOut
  };

})();