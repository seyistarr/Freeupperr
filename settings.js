/* ============================================================
   FreeUpper — settings.js (final)
   Requires auth.js to run first (window.sb + window.AuthUser).
   Uses the 'blocks' table and RPC functions: block_user, unblock_user.
   ============================================================ */
(function () {
  'use strict';

  if (!window.sb) {
    console.error('settings.js: auth.js must load first (window.sb missing).');
    return;
  }
  var sb = window.sb;

  function bindSoundToggle() {
    var toggle = document.getElementById('notificationSoundsToggle');
    var errorLabel = document.getElementById('notificationSoundsError');
    if (!toggle) return;
    var testButton = document.getElementById('notificationTestSound');
    var testResult = document.getElementById('notificationTestResult');
    var diagnosticsLabel = document.getElementById('notificationSoundDiagnostics');
    var preferenceSyncError = false;
    function showDiagnostics() {
      if (diagnosticsLabel && window.FUSound) {
        diagnosticsLabel.textContent = JSON.stringify(window.FUSound.diagnostics(), null, 2);
      }
    }
    function reflect(event) {
      var state = event.detail;
      toggle.checked = state.enabled;
      toggle.disabled = !state.authenticated || !state.ready || state.saving;
      if (testButton) testButton.disabled = !state.authenticated;
      if (window.FUSound?.diagnostics().preferenceStatus === 'error') {
        preferenceSyncError = true;
        errorLabel.textContent = window.fuT('Sound preference could not be synchronized. Automatic sounds are paused. Test sound still checks audio directly.');
      } else if (preferenceSyncError && state.ready) {
        preferenceSyncError = false;
        errorLabel.textContent = '';
      }
      showDiagnostics();
    }
    window.addEventListener('fu-sound-preference', reflect);
    window.addEventListener('fu-sound-diagnostics', showDiagnostics);
    if (window.FreeUpperSounds) reflect({ detail: window.FreeUpperSounds.preferenceState() });
    if (testResult) testResult.textContent = window.FUSound
      ? 'Tap Test sound to check audio independently of notifications.'
      : 'Sound manager did not load. Reopen this page while online.';
    if (testButton) testButton.addEventListener('click', function (event) {
      // Keep this call in the original tap: no settings fetch or Realtime wait.
      var playback = window.FUSound.play('notify', { preview: true, event: event });
      testButton.disabled = true;
      testResult.textContent = 'Testing audio…';
      playback.then(function (scheduled) {
        var status = window.FUSound.diagnostics();
        testResult.textContent = scheduled
          ? 'Sound scheduled. If you heard it, audio works; silent notifications point to the event path. If you heard nothing, check device audio/output. This test does not use Realtime.'
          : 'Test sound was not scheduled: ' + (status.lastPlay?.reason || 'audio unavailable') + '. See the diagnostics below.';
      }).catch(function () {
        testResult.textContent = 'Audio test failed. See the diagnostics below.';
      }).finally(function () {
        testButton.disabled = !window.FreeUpperSounds.preferenceState().authenticated;
        showDiagnostics();
      });
    });
    toggle.addEventListener('change', async function () {
      var previous = window.FUSound.isEnabled();
      toggle.disabled = true;
      errorLabel.textContent = '';
      try {
        await window.FUSound.setEnabled(toggle.checked);
      } catch (_) {
        toggle.checked = previous;
        errorLabel.textContent = window.fuT('Could not save notification sounds. Please try again.');
      } finally {
        // The manager owns availability after sign-out/account changes.
        if (window.FreeUpperSounds) reflect({ detail: window.FreeUpperSounds.preferenceState() });
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindSoundToggle);
  else bindSoundToggle();

  // ─── HELPERS ──────────────────────────────────────────────
  function getCurrentUser() {
    if (window.AuthUser && window.AuthUser.getCurrentUser) {
      return window.AuthUser.getCurrentUser();
    }
    return null;
  }

  function updateLocalCache(updates) {
    var user = getCurrentUser();
    if (!user) return;
    Object.assign(user, updates);
    if (window.AuthUser && window.AuthUser.updateCurrentUser) {
      window.AuthUser.updateCurrentUser(user);
    }
    document.dispatchEvent(new CustomEvent('profileUpdated', { detail: { user: user } }));
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
    if (updates.tags !== undefined) payload.tags = updates.tags;
    if (updates.showInSuggestions !== undefined) payload.show_in_suggestions = updates.showInSuggestions;
    if (updates.hiddenTabs !== undefined) payload.hidden_tabs = updates.hiddenTabs;
    if (updates.tabAudiences !== undefined) payload.tab_audiences = updates.tabAudiences;
    if (updates.city !== undefined) payload.city = updates.city;
    if (updates.hideAllPosts !== undefined) payload.hide_all_posts = updates.hideAllPosts;

    var { data, error } = await sb.from('profiles').update(payload).eq('id', user.id).select('id').single();
    if (error) throw error;
    if (!data || data.id !== user.id) throw new Error('Settings were not saved. Please try again.');

    updateLocalCache(updates);
  }

  // ─── CHANGE PASSWORD ──────────────────────────────────────
  async function changePassword(currentPassword, newPassword) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');

    var { error: signInError } = await sb.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });
    if (signInError) throw new Error('Current password is incorrect');

    var { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  // ─── SAVE PROFILE (used by settings.html) ──────────────────
  async function saveProfile() {
    var dn = document.getElementById('eDN')?.value?.trim();
    var un = document.getElementById('eUN')?.value?.trim();
    var bio = document.getElementById('eBio')?.value?.trim();

    var updates = {
      displayName: dn || 'Guest',
      username: un || 'user',
      bio: bio || '',
      tags: window._pendingPills || [],
      gender: window._selGender || '',
      country: window._selCountry || '',
      dob: window._dobSel && window._dobSel.month && window._dobSel.day && window._dobSel.year
        ? new Date(window._dobSel.year, window._dobSel.month - 1, window._dobSel.day).toISOString()
        : null,
    };

    try {
      await updateFlags(updates);
      if (typeof updateNavAvatar === 'function') updateNavAvatar();
      if (typeof closeFS === 'function') closeFS('editProfileModal');
      if (typeof showToast === 'function') showToast(window.fuT('Profile updated!'), 'g');
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'r');
      else console.error(err);
    }
  }

  // ─── VERIFICATION (SIMPLE ORIGINAL VERSION) ──────────────
  // getAccountTypes has been removed – no longer needed.
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
      .from('blocks')
      .select(`
        blocked_id,
        profiles:blocked_id (
          id,
          display_name,
          username,
          avatar_url,
          verified_status
        )
      `)
      .eq('blocker_id', user.id);

    if (error) throw error;

    return (data || []).map(function(row) {
      var p = row.profiles || {};
      return {
        id: p.id,
        name: p.display_name || 'Unknown',
        username: p.username || '',
        avatar: p.avatar_url || null,
        handle: p.username ? '@' + p.username : '',
        verified_status: p.verified_status || 'none'
      };
    });
  }

  async function blockUser(userId) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');
    if (userId === user.id) throw new Error('You cannot block yourself.');

    var { data, error } = await sb.rpc('block_user', { p_blocked_id: userId });
    if (error) throw error;
    return data;
  }

  async function unblockUser(userId) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) throw new Error('Please sign in.');

    var { data, error } = await sb.rpc('unblock_user', { p_blocked_id: userId });
    if (error) throw error;
    return data;
  }

  async function isBlocked(userId) {
    var user = getCurrentUser();
    if (!user || !user.isLoggedIn) return false;

    var { data, error } = await sb
      .from('blocks')
      .select('blocked_id')
      .eq('blocker_id', user.id)
      .eq('blocked_id', userId)
      .maybeSingle();

    if (error) throw error;
    return !!data;
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

  // ─── SESSIONS (Edge Function) ──────────────────────────────
  async function _extractFunctionError(error, fallback) {
    if (error && error.context && typeof error.context.json === 'function') {
      try {
        var body = await error.context.json();
        if (body && body.error) return body.error;
      } catch (e) { /* ignore */ }
    }
    return (error && error.message) || fallback;
  }

  async function listSessions() {
    var { data, error } = await sb.functions.invoke('manage-sessions', {
      body: { action: 'list' }
    });
    if (error) throw new Error(await _extractFunctionError(error, 'Failed to load sessions'));
    return data.sessions || [];
  }

  async function revokeSession(sessionId) {
    var { data, error } = await sb.functions.invoke('manage-sessions', {
      body: { action: 'revoke', session_id: sessionId }
    });
    if (error) throw new Error(await _extractFunctionError(error, 'Failed to revoke session'));
    return data;
  }

  async function revokeOtherSessions(currentSessionId) {
    if (!currentSessionId) throw new Error('Current session ID is required');
    var { data, error } = await sb.functions.invoke('manage-sessions', {
      body: { action: 'revoke_others', current_session_id: currentSessionId }
    });
    if (error) throw new Error(await _extractFunctionError(error, 'Failed to revoke other sessions'));
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

  // ─── DELETE ACCOUNT ──────────────────────────────────────
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
    updateFlags,
    changePassword,
    saveProfile,

    // Verification (simple version – getAccountTypes removed)
    submitVerification,
    withdrawVerification,
    getVerificationStatus,

    listBlockedUsers,
    unblockUser,
    blockUser,
    isBlocked,

    followUser,
    unfollowUser,
    getFollowCounts,
    isFollowing,

    toggleBookmark,
    getBookmarks,
    toggleShare,
    getShares,

    listSessions,
    revokeSession,
    revokeOtherSessions,
    getCurrentSessionId,

    deleteAccount,
    signOut
  };

  console.log('✅ settings.js loaded');
})();
