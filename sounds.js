// =====================================================================
// sounds.js – FreeUpper Sound System – Core API Layer
// =====================================================================
//
// Central Supabase interface for all sound-related data.
// Uses two-step queries (no joins) to avoid foreign-key name issues.
//
// Tables used:
//   sounds        (id, title, art_url, audio_url, duration, bpm,
//                   created_by, created_at, usage_count)
//   saved_sounds  (id, user_id, sound_id, created_at)
//   posts         (sound_id, user_id, media_url, media_type, views,
//                   like_count, is_pinned, created_at)
//
// DEPENDENCIES: the following SQL must exist in your Supabase schema:
//   increment_sound_usage(text)  – atomic usage counter RPC
//   get_sound_stats(text)        – aggregate stats RPC
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

  // ─── Map sound row (attaches creator profile if provided) ───────────
  function mapSound(row, profile) {
    if (!row) return null;
    const prof = profile || null;
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
      creator: prof ? {
        id: prof.id,
        displayName: prof.display_name || 'Anonymous',
        username: prof.username || '',
        avatarUrl: prof.avatar_url || '',
        verifiedStatus: prof.verified_status || 'none',
      } : null,
    };
  }

  // ─── Helper to fetch a profile by ID ──────────────────────────────
  async function _fetchProfile(userId) {
    if (!userId) return null;
    try {
      const { data, error } = await sb
        .from('profiles')
        .select('id, display_name, username, avatar_url, verified_status')
        .eq('id', userId)
        .maybeSingle();
      if (error || !data) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  // ─── LOAD SINGLE SOUND (two‑step) ──────────────────────────────────
  async function loadSound(soundId) {
    if (!soundId) return null;
    const { data: sound, error } = await sb
      .from('sounds')
      .select('*')
      .eq('id', soundId)
      .maybeSingle();

    if (error || !sound) {
      if (error) console.error('loadSound error:', error);
      return null;
    }

    let profile = null;
    if (sound.created_by) {
      profile = await _fetchProfile(sound.created_by);
    }
    return mapSound(sound, profile);
  }

  // ─── LOAD VIDEOS USING A SOUND (two‑step) ──────────────────────────
  async function loadSoundVideos(soundId, offset = 0, limit = 30) {
    if (!soundId) return [];

    const { data: posts, error } = await sb
      .from('posts')
      .select('id, media_url, media_type, views, like_count, is_pinned, created_at, user_id')
      .eq('sound_id', soundId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error || !posts?.length) {
      if (error) console.error('loadSoundVideos error:', error);
      return [];
    }

    // Fetch profiles for all unique user_ids
    const userIds = [...new Set(posts.map(p => p.user_id).filter(Boolean))];
    let profiles = {};
    if (userIds.length) {
      const { data: profData } = await sb
        .from('profiles')
        .select('id, display_name, username, avatar_url')
        .in('id', userIds);
      if (profData) {
        profiles = Object.fromEntries(profData.map(p => [p.id, p]));
      }
    }

    return posts.map(row => ({
      id: row.id,
      mediaUrl: row.media_url || '',
      mediaType: row.media_type || 'video',
      views: row.views || 0,
      likes: row.like_count || 0,
      pinned: !!row.is_pinned,
      timestamp: row.created_at,
      creator: row.user_id && profiles[row.user_id] ? {
        id: profiles[row.user_id].id,
        displayName: profiles[row.user_id].display_name || 'Anonymous',
        username: profiles[row.user_id].username || '',
        avatarUrl: profiles[row.user_id].avatar_url || '',
      } : null,
    }));
  }

  // ─── SEARCH SOUNDS (two‑step) ──────────────────────────────────────
  async function searchSounds(query, limit = 25) {
    const q = (query || '').trim();
    if (!q) return [];

    const { data: sounds, error } = await sb
      .from('sounds')
      .select('*')
      .ilike('title', `%${q}%`)
      .order('usage_count', { ascending: false })
      .limit(limit);

    if (error || !sounds?.length) {
      if (error) console.error('searchSounds error:', error);
      return [];
    }

    // Fetch all creators' profiles
    const creatorIds = [...new Set(sounds.map(s => s.created_by).filter(Boolean))];
    let profiles = {};
    if (creatorIds.length) {
      const { data: profData } = await sb
        .from('profiles')
        .select('id, display_name, username, avatar_url, verified_status')
        .in('id', creatorIds);
      if (profData) {
        profiles = Object.fromEntries(profData.map(p => [p.id, p]));
      }
    }

    return sounds.map(s => mapSound(s, profiles[s.created_by] || null));
  }

  // ─── TRENDING SOUNDS ──────────────────────────────────────────────
  async function loadTrendingSounds(offset = 0, limit = 25) {
    const { data: sounds, error } = await sb
      .from('sounds')
      .select('*')
      .order('usage_count', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error || !sounds?.length) {
      if (error) console.error('loadTrendingSounds error:', error);
      return [];
    }

    const creatorIds = [...new Set(sounds.map(s => s.created_by).filter(Boolean))];
    let profiles = {};
    if (creatorIds.length) {
      const { data: profData } = await sb
        .from('profiles')
        .select('id, display_name, username, avatar_url, verified_status')
        .in('id', creatorIds);
      if (profData) {
        profiles = Object.fromEntries(profData.map(p => [p.id, p]));
      }
    }

    return sounds.map(s => mapSound(s, profiles[s.created_by] || null));
  }

  // ─── RECOMMENDED SOUNDS ────────────────────────────────────────────
  async function loadRecommendedSounds(limit = 25) {
    const userId = await _getCurrentUserIdSafe();
    let query = sb
      .from('sounds')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (userId) {
      query = query.neq('created_by', userId);
    }

    const { data: sounds, error } = await query;
    if (error || !sounds?.length) {
      if (error) console.error('loadRecommendedSounds error:', error);
      return [];
    }

    const creatorIds = [...new Set(sounds.map(s => s.created_by).filter(Boolean))];
    let profiles = {};
    if (creatorIds.length) {
      const { data: profData } = await sb
        .from('profiles')
        .select('id, display_name, username, avatar_url, verified_status')
        .in('id', creatorIds);
      if (profData) {
        profiles = Object.fromEntries(profData.map(p => [p.id, p]));
      }
    }

    return sounds.map(s => mapSound(s, profiles[s.created_by] || null));
  }

  // ─── ORIGINAL SOUNDS (created by real users) ──────────────────────
  async function loadOriginalSounds(offset = 0, limit = 25) {
    const { data: sounds, error } = await sb
      .from('sounds')
      .select('*')
      .not('created_by', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error || !sounds?.length) {
      if (error) console.error('loadOriginalSounds error:', error);
      return [];
    }

    const creatorIds = [...new Set(sounds.map(s => s.created_by).filter(Boolean))];
    let profiles = {};
    if (creatorIds.length) {
      const { data: profData } = await sb
        .from('profiles')
        .select('id, display_name, username, avatar_url, verified_status')
        .in('id', creatorIds);
      if (profData) {
        profiles = Object.fromEntries(profData.map(p => [p.id, p]));
      }
    }

    return sounds.map(s => mapSound(s, profiles[s.created_by] || null));
  }

  // ─── CREATE SOUND ──────────────────────────────────────────────────
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

    const { data: sound, error } = await sb
      .from('sounds')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;
    // Fetch the creator's profile to return a fully mapped object
    const profile = await _fetchProfile(userId);
    return mapSound(sound, profile);
  }

  // ─── UPDATE SOUND ──────────────────────────────────────────────────
  async function updateSound(soundId, fields) {
    const userId = await _getUserId();
    const payload = {};
    if (fields.title !== undefined) payload.title = fields.title;
    if (fields.artUrl !== undefined) payload.art_url = fields.artUrl;
    if (fields.audioUrl !== undefined) payload.audio_url = fields.audioUrl;
    if (fields.duration !== undefined) payload.duration = fields.duration;
    if (fields.bpm !== undefined) payload.bpm = fields.bpm;

    const { data: sound, error } = await sb
      .from('sounds')
      .update(payload)
      .eq('id', soundId)
      .eq('created_by', userId) // security: only owner can update
      .select('*')
      .single();

    if (error) throw error;
    const profile = await _fetchProfile(userId);
    return mapSound(sound, profile);
  }

  // ─── SAVE / UNSAVE ──────────────────────────────────────────────────
  async function saveSound(soundId) {
    const userId = await _getUserId();
    const { error } = await sb
      .from('saved_sounds')
      .insert({ user_id: userId, sound_id: soundId });

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

  // ─── LOAD SAVED SOUNDS (two‑step) ──────────────────────────────────
  async function loadSavedSounds(offset = 0, limit = 50) {
    const userId = await _getUserId();
    const { data: saved, error } = await sb
      .from('saved_sounds')
      .select('sound_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error || !saved?.length) {
      if (error) console.error('loadSavedSounds error:', error);
      return [];
    }

    const soundIds = saved.map(s => s.sound_id);
    const { data: sounds } = await sb
      .from('sounds')
      .select('*')
      .in('id', soundIds);

    if (!sounds?.length) return [];

    // Fetch profiles for creators
    const creatorIds = [...new Set(sounds.map(s => s.created_by).filter(Boolean))];
    let profiles = {};
    if (creatorIds.length) {
      const { data: profData } = await sb
        .from('profiles')
        .select('id, display_name, username, avatar_url, verified_status')
        .in('id', creatorIds);
      if (profData) {
        profiles = Object.fromEntries(profData.map(p => [p.id, p]));
      }
    }

    // Map sounds and attach the savedAt timestamp
    return saved.map(item => {
      const sound = sounds.find(s => s.id === item.sound_id);
      if (!sound) return null;
      return {
        ...mapSound(sound, profiles[sound.created_by] || null),
        savedAt: item.created_at,
      };
    }).filter(Boolean);
  }

  // ─── INCREMENT USAGE ──────────────────────────────────────────────
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

  // ─── AGGREGATE STATS ──────────────────────────────────────────────
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
