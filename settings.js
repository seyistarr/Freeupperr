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

  // ─── HELPERS ──────────────────────────────────────────────
  function getCurrentUser() {
    if (window.AuthUser && window.AuthUser.getCurrentUser) {
      return window.AuthUser.getCurrentUser();
    }
    return null;
  }

  function updateLocalCache(updates) {
    const user = getCurrentUser();
    if (!user) return;
    Object.assign(user, updates);
    if (window.AuthUser && window.AuthUser.updateCurrentUser) {
      window.AuthUser.updateCurrentUser(user);
    }
    document.dispatchEvent(new CustomEvent('profileUpdated', { detail: { user: user } }));
  }

  // ─── UPDATE PROFILE FLAGS ──────────────────────────────────
  async function updateFlags(updates) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in to update settings.');

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
    if (updates.avatar !== undefined) payload.avatar_url = updates.avatar;

    const { error } = await sb.from('profiles').update(payload).eq('id', user.id);
    if (error) throw error;

    // Update local cache via AuthUser
    updateLocalCache(updates);
  }

  // ─── CHANGE PASSWORD ──────────────────────────────────────
  async function changePassword(currentPassword, newPassword) {
    // First verify current password
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');

    const { error: signInError } = await sb.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });

    if (signInError) throw new Error('Current password is incorrect');

    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  // ─── VERIFICATION ──────────────────────────────────────────
  async function submitVerification({ category, reason, link }) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in to request verification.');

    // Check if already pending
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

    // Update local cache
    updateLocalCache({ verificationStatus: 'pending' });

    return data;
  }

  async function withdrawVerification() {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');

    const { error } = await sb
      .from('verification_requests')
      .delete()
      .eq('user_id', user.id)
      .eq('status', 'pending');

    if (error) throw error;

    updateLocalCache({ verificationStatus: 'none' });
  }

  async function getVerificationStatus() {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) return { status: 'none' };

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
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) return [];

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
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');

    const { error } = await sb
      .from('blocked_users')
      .delete()
      .eq('blocker_id', user.id)
      .eq('blocked_id', userId);

    if (error) throw error;
  }

  async function blockUser(userId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');
    if (userId === user.id) throw new Error('You cannot block yourself.');

    const { error } = await sb
      .from('blocked_users')
      .insert({ blocker_id: user.id, blocked_id: userId });

    if (error) throw error;
  }

  // ─── FOLLOWS ──────────────────────────────────────────────
  async function followUser(userId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in to follow.');
    if (userId === user.id) throw new Error('You cannot follow yourself.');

    const { error } = await sb
      .from('follows')
      .insert({ follower_id: user.id, following_id: userId });

    if (error) throw error;
  }

  async function unfollowUser(userId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');

    const { error } = await sb
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', userId);

    if (error) throw error;
  }

  async function getFollowCounts(userId) {
    const { count: followers } = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', userId);

    const { count: following } = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId);

    return { followers: followers || 0, following: following || 0 };
  }

  async function isFollowing(userId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) return false;

    const { count } = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', user.id)
      .eq('following_id', userId);

    return count > 0;
  }

  // ─── BOOKMARKS ─────────────────────────────────────────────
  async function toggleBookmark(postId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in to bookmark.');

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
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) return [];

    const { data, error } = await sb
      .from('bookmarks')
      .select('post_id')
      .eq('user_id', user.id);

    if (error) throw error;
    return (data || []).map(b => b.post_id);
  }

  // ─── SHARES ────────────────────────────────────────────────
  async function toggleShare(postId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in to share.');

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
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) return [];

    const { data, error } = await sb
      .from('shares')
      .select('post_id')
      .eq('user_id', user.id);

    if (error) throw error;
    return (data || []).map(s => s.post_id);
  }

  // ─── ACTIVE SESSIONS (Edge Function) ──────────────────────
  async function listSessions() {
    const { data, error } = await window.supabase.functions.invoke('manage-sessions', {
      body: { action: 'list' }
    });
    if (error) throw new Error(error.message || 'Failed to load sessions');
    return data.sessions || [];
  }

  async function revokeSession(sessionId) {
    const { data, error } = await window.supabase.functions.invoke('manage-sessions', {
      body: { action: 'revoke', session_id: sessionId }
    });
    if (error) throw new Error(error.message || 'Failed to revoke session');
    return data;
  }

  async function revokeOtherSessions(currentSessionId) {
    if (!currentSessionId) throw new Error('Current session ID is required');
    const { data, error } = await window.supabase.functions.invoke('manage-sessions', {
      body: { action: 'revoke_others', current_session_id: currentSessionId }
    });
    if (error) throw new Error(error.message || 'Failed to revoke other sessions');
    return data;
  }

  async function getCurrentSessionId() {
    const { data } = await window.supabase.auth.getSession();
    if (data && data.session) {
      try {
        const payload = JSON.parse(atob(data.session.access_token.split('.')[1]));
        return payload.session_id || null;
      } catch (e) {
        console.warn('Could not decode session_id', e);
        return null;
      }
    }
    return null;
  }

  // ─── DELETE ACCOUNT (Edge Function) ──────────────────────
  async function deleteAccount() {
    const { data, error } = await window.supabase.functions.invoke('delete-account', {
      method: 'POST',
      body: {}
    });
    if (error) throw new Error(error.message || 'Failed to delete account');
    return data;
  }

  // ─── SIGN OUT ─────────────────────────────────────────────
  async function signOut() {
    await sb.auth.signOut();
  }

  // ─── EXPOSE ───────────────────────────────────────────────
  window.SettingsAPI = {
    // Profile & flags
    updateFlags,
    changePassword,

    // Verification
    submitVerification,
    withdrawVerification,
    getVerificationStatus,

    // Blocked users
    listBlockedUsers,
    unblockUser,
    blockUser,

    // Follows
    followUser,
    unfollowUser,
    getFollowCounts,
    isFollowing,

    // Bookmarks & Shares
    toggleBookmark,
    getBookmarks,
    toggleShare,
    getShares,

    // Sessions (Edge Function)
    listSessions,
    revokeSession,
    revokeOtherSessions,
    getCurrentSessionId,

    // Account deletion (Edge Function)
    deleteAccount,

    // Sign out
    signOut
  };

})();
