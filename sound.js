// =====================================================================
// sounds.js – FreeUpper Sound System – Core API Layer
// =====================================================================
//
// Central Supabase interface for all sound-related data. Every sound
// page (music.html, sound.html, saved-sounds.html, studio.html) should
// call into window.SoundsAPI rather than querying Supabase directly.
//
// Tables used:
//   sounds        (id, title, art_url, audio_url, duration, bpm,
//                   created_by, created_at, usage_count)
//   saved_sounds  (id, user_id, sound_id, created_at)
//   posts         (sound_id references sounds.id)
//
// DEPENDENCIES: the following SQL must exist in your Supabase schema:
//   increment_sound_usage(text)  – atomic usage counter RPC
// =====================================================================

(function() {
  'use strict';

  if (!window.sb) {
    console.error('sounds.js: Supabase client missing.');
    return;
  }
  const sb = window.sb;

  // ─── Internal auth helper ───────────────────────────────────────────
  async function _getUserId() {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) throw new Error('You must be logged in to perform this action.');
    return user.id;
  }

  async function _getCurrentUserIdSafe() {
    try {
      const { data: { user } } = await sb.auth.getUser();
      return user ? user.id : null;
    } catch (e) {
      return null;
    }
  }

  // ─── Map sound row (attaches creator profile if joined) ─────────────
  function mapSound(row) {
    if (!row) return null;
    const profile = row.profile || row.profiles || null;
    return {
      id: row.id,
      title: row.title || 'Original sound',
      artUrl: row.art_url || '',
      audioUrl: row.audio_url || '',
      duration: row.duration || null,
      bpm: row.bpm || null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      usageCount: row.usage_count || 0,
      creator: profile ? {
        id: profile.id,
        displayName: profile.display_name || 'Anonymous',
        username: profile.username || '',
        avatarUrl: profile.avatar_url || '',
        verifiedStatus: profile.verified_status || 'none',
      } : null,
    };
  }

  const PROFILE_SELECT = `
    id,
    display_name,
    username,
    avatar_url,
    verified,
    verified_status
  `;

  // ─── LOAD SINGLE SOUND ────────────────────────────────────────────
  async function loadSound(soundId) {
    if (!soundId) return null;
    const { data, error } = await sb
      .from('sounds')
      .select(`*, profile:profiles!sounds_created_by_fkey(${PROFILE_SELECT})`)
      .eq('id', soundId)
      .maybeSingle();

    if (error) {
      console.error('loadSound error:', error);
      return null;
    }
    return mapSound(data);
  }

  // ─── LOAD VIDEOS USING A SOUND ────────────────────────────────────
  async function loadSoundVideos(soundId, offset = 0, limit = 30) {
    if (!soundId) return [];
    const { data, error } = await sb
      .from('posts')
      .select(`
        id, media_url, media_type, views, like_count, is_pinned, created_at,
        profile:profiles!posts_user_id_fkey(${PROFILE_SELECT})
      `)
      .eq('sound_id', soundId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('loadSoundVideos error:', error);
      return [];
    }

    return (data || []).map(row => ({
      id: row.id,
      mediaUrl: row.media_url || '',
      mediaType: row.media_type || 'video',
      views: row.views || 0,
      likes: row.like_count || 0,
      pinned: !!row.is_pinned,
      timestamp: row.created_at,
      creator: row.profile ? {
        id: row.profile.id,
        displayName: row.profile.display_name || 'Anonymous',
        username: row.profile.username || '',
        avatarUrl: row.profile.avatar_url || '',
      } : null,
    }));
  }

  // ─── SEARCH SOUNDS ─────────────────────────────────────────────────
  async function searchSounds(query, limit = 25) {
    const q = (query || '').trim();
    if (!q) return [];
    const { data, error } = await sb
      .from('sounds')
      .select(`*, profile:profiles!sounds_created_by_fkey(${PROFILE_SELECT})`)
      .ilike('title', `%${q}%`)
      .order('usage_count', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('searchSounds error:', error);
      return [];
    }
    return (data || []).map(mapSound);
  }

  // ─── TRENDING SOUNDS (by usage_count) ─────────────────────────────
  async function loadTrendingSounds(offset = 0, limit = 25) {
    const { data, error } = await sb
      .from('sounds')
      .select(`*, profile:profiles!sounds_created_by_fkey(${PROFILE_SELECT})`)
      .order('usage_count', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('loadTrendingSounds error:', error);
      return [];
    }
    return (data || []).map(mapSound);
  }

  // ─── RECOMMENDED SOUNDS ────────────────────────────────────────────
  // Simple heuristic for now: recent + moderately used sounds, excluding
  // the user's own uploads. Can be swapped for a real recommendation
  // RPC later without changing the public API surface.
  async function loadRecommendedSounds(limit = 25) {
    const userId = await _getCurrentUserIdSafe();
    let q = sb
      .from('sounds')
      .select(`*, profile:profiles!sounds_created_by_fkey(${PROFILE_SELECT})`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (userId) q = q.neq('created_by', userId);

    const { data, error } = await q;
    if (error) {
      console.error('loadRecommendedSounds error:', error);
      return [];
    }
    return (data || []).map(mapSound);
  }

  // ─── ORIGINAL SOUNDS (created by real users, not synthetic) ───────
  async function loadOriginalSounds(offset = 0, limit = 25) {
    const { data, error } = await sb
      .from('sounds')
      .select(`*, profile:profiles!sounds_created_by_fkey(${PROFILE_SELECT})`)
      .not('created_by', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('loadOriginalSounds error:', error);
      return [];
    }
    return (data || []).map(mapSound);
  }

  // ─── CREATE SOUND (from studio.html "Save Original Sound") ───────
  async function createSound(fields) {
    const userId = await _getUserId();
    const payload = {
      id: fields.id || ('sound_' + userId + '_' + Date.now()),
      title: fields.title || 'Original sound',
      art_url: fields.artUrl || null,
      audio_url: fields.audioUrl || null,
      duration: fields.duration || null,
      bpm: fields.bpm || null,
      created_by: userId,
    };

    const { data, error } = await sb
      .from('sounds')
      .insert(payload)
      .select(`*, profile:profiles!sounds_created_by_fkey(${PROFILE_SELECT})`)
      .single();

    if (error) throw error;
    return mapSound(data);
  }

  // ─── UPDATE SOUND (owner-only) ─────────────────────────────────────
  async function updateSound(soundId, fields) {
    const userId = await _getUserId();
    const payload = {};
    if (fields.title !== undefined) payload.title = fields.title;
    if (fields.artUrl !== undefined) payload.art_url = fields.artUrl;
    if (fields.audioUrl !== undefined) payload.audio_url = fields.audioUrl;
    if (fields.duration !== undefined) payload.duration = fields.duration;
    if (fields.bpm !== undefined) payload.bpm = fields.bpm;

    const { data, error } = await sb
      .from('sounds')
      .update(payload)
      .eq('id', soundId)
      .eq('created_by', userId) // security: only owner can update
      .select(`*, profile:profiles!sounds_created_by_fkey(${PROFILE_SELECT})`)
      .single();

    if (error) throw error;
    return mapSound(data);
  }

  // ─── SAVE / UNSAVE SOUND ───────────────────────────────────────────
  async function saveSound(soundId) {
    const userId = await _getUserId();
    const { error } = await sb
      .from('saved_sounds')
      .insert({ user_id: userId, sound_id: soundId });

    // Unique constraint violation just means it's already saved — treat as success.
    if (error && error.code !== '23505') throw error;
    return { saved: true };
  }

  async function unsaveSound(soundId) {
    const userId = await _getUserId();
    const { error } = await sb
      .from('saved_sounds')
      .delete()
      .eq('user_id', userId)
      .eq('sound_id', soundId);

    if (error) throw error;
    return { saved: false };
  }

  async function isSoundSaved(soundId) {
    const userId = await _getCurrentUserIdSafe();
    if (!userId) return false;
    const { data, error } = await sb
      .from('saved_sounds')
      .select('id')
      .eq('user_id', userId)
      .eq('sound_id', soundId)
      .maybeSingle();

    if (error) {
      console.warn('isSoundSaved error:', error);
      return false;
    }
    return !!data;
  }

  // ─── LOAD USER'S SAVED SOUNDS ──────────────────────────────────────
  async function loadSavedSounds(offset = 0, limit = 50) {
    const userId = await _getUserId();
    const { data, error } = await sb
      .from('saved_sounds')
      .select(`
        sound_id,
        created_at,
        sound:sounds!saved_sounds_sound_id_fkey(*, profile:profiles!sounds_created_by_fkey(${PROFILE_SELECT}))
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('loadSavedSounds error:', error);
      return [];
    }

    return (data || [])
      .filter(row => row.sound)
      .map(row => ({ ...mapSound(row.sound), savedAt: row.created_at }));
  }

  // ─── INCREMENT SOUND USAGE (atomic, called when a post is published) ─
  async function incrementSoundUsage(soundId) {
    if (!soundId) return { usageCount: 0 };
    try {
      const { data, error } = await sb.rpc('increment_sound_usage', { p_sound_id: soundId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return { usageCount: row ? row.usage_count : 0 };
    } catch (err) {
      console.warn('incrementSoundUsage error:', err);
      return { usageCount: 0 };
    }
  }

  // ─── AGGREGATE STATS (video count, likes, shares — via RPC) ───────
  async function loadSoundStats(soundId) {
    try {
      const { data, error } = await sb.rpc('get_sound_stats', { p_sound_id: soundId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        videoCount: row?.video_count || 0,
        totalUses: row?.total_uses || 0,
        totalLikes: row?.total_likes || 0,
        totalShares: row?.total_shares || 0,
      };
    } catch (err) {
      console.warn('loadSoundStats error:', err);
      return { videoCount: 0, totalUses: 0, totalLikes: 0, totalShares: 0 };
    }
  }

  // ─── EXPOSE PUBLIC API ────────────────────────────────────────────
  window.SoundsAPI = {
    loadSound,
    loadSoundVideos,
    searchSounds,
    loadTrendingSounds,
    loadRecommendedSounds,
    loadOriginalSounds,
    createSound,
    updateSound,
    saveSound,
    unsaveSound,
    isSoundSaved,
    loadSavedSounds,
    incrementSoundUsage,
    loadSoundStats,
  };

})();
