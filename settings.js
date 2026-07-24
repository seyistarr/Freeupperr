// =============================================================
// settings.js – Block/Unblock, Privacy, Account management
// =============================================================
(function() {
  'use strict';

  if (!window.sb) {
    console.warn('settings.js: Supabase client not found.');
    return;
  }
  const sb = window.sb;

  // ─── Block a user ──────────────────────────────────────────
  async function blockUser(userId) {
    const { data, error } = await sb.rpc('block_user', { p_blocked_id: userId });
    if (error) throw error;
    return data;
  }

  // ─── Unblock a user ────────────────────────────────────────
  async function unblockUser(userId) {
    const { data, error } = await sb.rpc('unblock_user', { p_blocked_id: userId });
    if (error) throw error;
    return data;
  }

  // ─── List all blocked users ───────────────────────────────
  async function listBlockedUsers() {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) return [];

    const { data, error } = await sb
      .from('blocks')
      .select('blocked_id, profiles:blocked_id(id, username, display_name, avatar_url)')
      .eq('blocker_id', user.id);

    if (error) throw error;
    return (data || []).map(row => row.profiles);
  }

  // ─── Check if a specific user is blocked ──────────────────
  async function isBlocked(userId) {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) return false;

    const { data, error } = await sb
      .from('blocks')
      .select('blocked_id')
      .eq('blocker_id', user.id)
      .eq('blocked_id', userId)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  }

  // ─── Helper: get current user (use global function) ──────
  function getCurrentUser() {
    if (window.AuthUser && typeof window.AuthUser.getCurrentUser === 'function') {
      return window.AuthUser.getCurrentUser();
    }
    if (typeof window.getCurrentUser === 'function') {
      return window.getCurrentUser();
    }
    return null;
  }

  // ─── Expose API ─────────────────────────────────────────────
  window.SettingsAPI = {
    blockUser,
    unblockUser,
    listBlockedUsers,
    isBlocked,
  };

  console.log('✅ settings.js loaded');
})();
