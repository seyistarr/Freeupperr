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
  var sb = window.sb;

  // ─── HELPERS ──────────────────────────────────────────────
  function getCurrentUser() {
    if (window.AuthUser && window.AuthUser.getCurrentUser) {
      return window.AuthUser.getCurrentUser();
    }
    return null;
  }

  function saveCurrentUser(user) {
    if (window.AuthUser && window.AuthUser.updateCurrentUser) {
      window.AuthUser.updateCurrentUser(user);
    }
    document.dispatchEvent(new CustomEvent('profileUpdated', { detail: { user: user } }));
  }

  function updateLocalCache(updates) {
    var user = getCurrentUser();
    if (!user) return;
    Object.assign(user, updates);
    saveCurrentUser(user);
  }

  // ─── UPDATE PROFILE FLAGS ──────────────────────────────────
  async function updateFlags(updates) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in to update settings.');

    var payload = {};
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

    var { error } = await sb.from('profiles').update(payload).eq('id', user.id);
    if (error) throw error;

    updateLocalCache(updates);
  }

  // ─── SAVE PROFILE (edit profile modal) ─────────────────────
  // Reads directly from the edit-profile modal fields and window._pending*
  // state (tags, gender, country, dob) set up by settings.html, and writes
  // straight to the profiles table — profiles is the single source of truth.
  async function saveProfile() {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) {
      if (typeof showToast === 'function') showToast('Please sign in to update your profile', 'o');
      throw new Error('Please sign in.');
    }

    var dnEl = document.getElementById('eDN');
    var unEl = document.getElementById('eUN');
    var bioEl = document.getElementById('eBio');

    var dn = dnEl ? dnEl.value.trim() : '';
    var un = unEl ? unEl.value.trim() : '';
    var bio = bioEl ? bioEl.value.trim() : '';

    var dob = null;
    if (window._dobSel && window._dobSel.month && window._dobSel.day && window._dobSel.year) {
      dob = new Date(window._dobSel.year, window._dobSel.month - 1, window._dobSel.day).toISOString();
    }

    var updates = {
      display_name: dn || 'Guest',
      username: un || 'user',
      bio: bio,
      tags: window._pendingPills || [],
      gender: window._selGender || '',
      country: window._selCountry || '',
      dob: dob
    };

    try {
      var { error } = await sb.from('profiles').update(updates).eq('id', user.id);
      if (error) throw error;

      // Update local user cache (for navbar, etc.)
      Object.assign(user, {
        displayName: updates.display_name,
        username: updates.username,
        bio: updates.bio,
        tags: updates.tags,
        gender: updates.gender,
        country: updates.country,
        dob: updates.dob
      });
      saveCurrentUser(user);

      if (typeof updateNavAvatar === 'function') updateNavAvatar();
      if (typeof closeFS === 'function') closeFS('editProfileModal');
      if (typeof showToast === 'function') showToast('Profile updated!', 'g');
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'r');
      throw err;
    }
  }

  // ─── CHANGE PASSWORD ──────────────────────────────────────
  async function changePassword(currentPassword, newPassword) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');

    // Verify current password
    var { error: signInError } = await sb.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });

    if (signInError) throw new Error('Current password is incorrect');

    var { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  // ─── VERIFICATION ──────────────────────────────────────────
  async function submitVerification({ category, reason, link }) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in to request verification.');

    var { data: existing } = await sb
      .from('verification_requests')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) throw new Error('You already have a pending request');

    var { data, error } = await sb
      .from('verification_requests')
      .insert({ user_id: user.id, category: category, reason: reason, link: link || '' })
      .select()
      .single();

    if (error) throw error;

    updateLocalCache({ verificationStatus: 'pending' });
    return data;
  }

  async function withdrawVerification() {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');

    var { error } = await sb
      .from('verification_requests')
      .delete()
      .eq('user_id', user.id)
      .eq('status', 'pending');

    if (error) throw error;
    updateLocalCache({ verificationStatus: 'none' });
  }

  async function getVerificationStatus() {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) return { status: 'none' };

    var { data, error } = await sb
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
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) return [];

    var { data, error } = await sb
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

    return (data || []).map(function(row) {
      return {
        id: row.blocked_id,
        name: row.profiles?.display_name || 'Unknown',
        username: row.profiles?.username || '',
        avatar: row.profiles?.avatar_url || null,
        handle: row.profiles?.username ? '@' + row.profiles.username : ''
      };
    });
  }

  async function unblockUser(userId) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');

    var { error } = await sb
      .from('blocked_users')
      .delete()
      .eq('blocker_id', user.id)
      .eq('blocked_id', userId);

    if (error) throw error;
  }

  async function blockUser(userId) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');
    if (userId === user.id) throw new Error('You cannot block yourself.');

    var { error } = await sb
      .from('blocked_users')
      .insert({ blocker_id: user.id, blocked_id: userId });

    if (error) throw error;
  }

  // ─── FOLLOWS ──────────────────────────────────────────────
  async function followUser(userId) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in to follow.');
    if (userId === user.id) throw new Error('You cannot follow yourself.');

    var { error } = await sb
      .from('follows')
      .insert({ follower_id: user.id, following_id: userId });

    if (error) throw error;
  }

  async function unfollowUser(userId) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');

    var { error } = await sb
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', userId);

    if (error) throw error;
  }

  async function getFollowCounts(userId) {
    var { count: followers } = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', userId);

    var { count: following } = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId);

    return { followers: followers || 0, following: following || 0 };
  }

  async function isFollowing(userId) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) return false;

    var { count } = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', user.id)
      .eq('following_id', userId);

    return count > 0;
  }

  // ─── BOOKMARKS ─────────────────────────────────────────────
  async function toggleBookmark(postId) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in to bookmark.');

    var { data: existing } = await sb
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
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) return [];

    var { data, error } = await sb
      .from('bookmarks')
      .select('post_id')
      .eq('user_id', user.id);

    if (error) throw error;
    return (data || []).map(function(b) { return b.post_id; });
  }

  // ─── SHARES ────────────────────────────────────────────────
  async function toggleShare(postId) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in to share.');

    var { data: existing } = await sb
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
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) return [];

    var { data, error } = await sb
      .from('shares')
      .select('post_id')
      .eq('user_id', user.id);

    if (error) throw error;
    return (data || []).map(function(s) { return s.post_id; });
  }

  // ─── ACTIVE SESSIONS (Edge Function) ──────────────────────
  async function listSessions() {
    var { data, error } = await sb.functions.invoke('manage-sessions', {
      body: { action: 'list' }
    });
    if (error) throw new Error(error.message || 'Failed to load sessions');
    return data.sessions || [];
  }

  async function revokeSession(sessionId) {
    var { data, error } = await sb.functions.invoke('manage-sessions', {
      body: { action: 'revoke', session_id: sessionId }
    });
    if (error) throw new Error(error.message || 'Failed to revoke session');
    return data;
  }

  async function revokeOtherSessions(currentSessionId) {
    if (!currentSessionId) throw new Error('Current session ID is required');
    var { data, error } = await sb.functions.invoke('manage-sessions', {
      body: { action: 'revoke_others', current_session_id: currentSessionId }
    });
    if (error) throw new Error(error.message || 'Failed to revoke other sessions');
    return data;
  }

  async function getCurrentSessionId() {
    var { data } = await sb.auth.getSession();
    if (data && data.session) {
      try {
        var payload = JSON.parse(atob(data.session.access_token.split('.')[1]));
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
    var { data, error } = await sb.functions.invoke('delete-account', {
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
    updateFlags: updateFlags,
    saveProfile: saveProfile,
    changePassword: changePassword,

    // Verification
    submitVerification: submitVerification,
    withdrawVerification: withdrawVerification,
    getVerificationStatus: getVerificationStatus,

    // Blocked users
    listBlockedUsers: listBlockedUsers,
    unblockUser: unblockUser,
    blockUser: blockUser,

    // Follows
    followUser: followUser,
    unfollowUser: unfollowUser,
    getFollowCounts: getFollowCounts,
    isFollowing: isFollowing,

    // Bookmarks & Shares
    toggleBookmark: toggleBookmark,
    getBookmarks: getBookmarks,
    toggleShare: toggleShare,
    getShares: getShares,

    // Sessions (Edge Function)
    listSessions: listSessions,
    revokeSession: revokeSession,
    revokeOtherSessions: revokeOtherSessions,
    getCurrentSessionId: getCurrentSessionId,

    // Account deletion (Edge Function)
    deleteAccount: deleteAccount,

    // Sign out
    signOut: signOut
  };

})();
