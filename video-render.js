// =====================================================================
// video-render.js – Connects posts to the Sound system
// =====================================================================
//
// Single source of truth for: resolving a post's sound_id, fetching/
// caching sound metadata, rendering the "🎵 title · @creator" pill/disc
// markup used under videos, and handling the tap → sound.html navigation.
//
// Any page rendering video cards (video.html, profile grids, feed cards)
// should call into window.VideoRender instead of re-implementing this.
//
// DEPENDENCIES: sounds.js (window.SoundsAPI) must load before this file.
// =====================================================================

(function() {
    'use strict';

    if (!window.SoundsAPI) {
        console.error('video-render.js: SoundsAPI missing. Ensure sounds.js loads before this file.');
        return;
    }

    // ─── Simple in-memory cache so the same sound isn't re-fetched
    //     for every card in a feed that shares it. ──────────────────
    const _soundCache = new Map(); // soundId -> resolved meta object | Promise

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    function fmtNum(n) {
        n = n || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(n);
    }

    // ─── Resolve the sound_id for a post ────────────────────────────
    // Prefers the real posts.sound_id column. Falls back to the legacy
    // synthetic scheme (sound_<authorId>_<audioKey>) for older posts
    // that predate the sounds table, so nothing already in the feed
    // breaks.
    function resolveSoundId(post) {
        if (!post) return null;
        if (post.sound_id) return post.sound_id;

        const authorId = post.user_id || post.authorId;
        if (!authorId) return null;
        const rawTitle = post.sound_title || post.audio_track || 'original';
        const audioKey = String(rawTitle).toLowerCase().replace(/[^a-z0-9]/g, '') || 'original';
        return 'sound_' + authorId + '_' + audioKey;
    }

    // ─── Fetch (and cache) sound metadata for display ───────────────
    // Returns { id, title, creatorHandle, artUrl } or null if the
    // sound can't be resolved (e.g. legacy synthetic id with no row
    // in the sounds table yet — falls back to post-derived defaults).
    async function getSoundMetaForPost(post) {
        const soundId = resolveSoundId(post);
        if (!soundId) return null;

        if (_soundCache.has(soundId)) {
            return _soundCache.get(soundId);
        }

        const fetchPromise = (async () => {
            try {
                const sound = await SoundsAPI.loadSound(soundId);
                if (sound) {
                    const handle = sound.creator
                        ? '@' + (sound.creator.username || sound.creator.displayName || 'user')
                        : '';
                    const meta = {
                        id: sound.id,
                        title: sound.title || 'Original sound',
                        creatorHandle: handle,
                        artUrl: sound.artUrl || '',
                    };
                    _soundCache.set(soundId, meta);
                    return meta;
                }
            } catch (e) {
                console.warn('getSoundMetaForPost: SoundsAPI.loadSound failed', e);
            }

            // Fallback: no row in sounds table (legacy synthetic id) —
            // derive a reasonable label directly from the post so the
            // UI still shows something clickable and correct-looking.
            const profile = post.profile || {};
            const authorName = profile.display_name || post.creator || 'Unknown';
            const authorHandle = '@' + (profile.username || authorName.toLowerCase().replace(/\s+/g, ''));
            const fallback = {
                id: soundId,
                title: post.sound_title || post.audio_track || ('Original sound · ' + authorName),
                creatorHandle: authorHandle,
                artUrl: post.sound_art || profile.avatar_url || '',
            };
            _soundCache.set(soundId, fallback);
            return fallback;
        })();

        _soundCache.set(soundId, fetchPromise);
        return fetchPromise;
    }

    function clearSoundCache() {
        _soundCache.clear();
    }

    // ─── Navigation ───────────────────────────────────────────────────
    function openSoundPage(soundId) {
        if (!soundId) return;
        if (window.Router && typeof window.Router.openSound === 'function') {
            window.Router.openSound(soundId);
        } else {
            window.location.href = 'sound.html?id=' + encodeURIComponent(soundId);
        }
    }

    async function openSoundPageForPost(post) {
        const meta = await getSoundMetaForPost(post);
        if (meta) openSoundPage(meta.id);
    }

    // ─── Render: sound pill (the "🎵 title · @handle" bar under a video) ──
    // idx is used to build a unique onclick target when rendering into
    // a feed of multiple cards (matches video.html's existing indexing
    // convention).
    function renderSoundPillHTML(meta, idx) {
        if (!meta) return '';
        const label = meta.creatorHandle
            ? `${escapeHtml(meta.title)} · ${escapeHtml(meta.creatorHandle)}`
            : escapeHtml(meta.title);
        return `
            <div class="v-music-tag" onclick="event.stopPropagation(); VideoRender.openSoundPage('${meta.id}')" title="View sound details">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                <span class="sound-label">${label}</span>
            </div>`;
    }

    // ─── Render: sound disc (the small spinning circular art icon) ──────
    function renderSoundDiscHTML(meta, creatorFallbackSeed) {
        const art = (meta && meta.artUrl) || '';
        const seed = encodeURIComponent((meta && meta.title) || creatorFallbackSeed || 'sound');
        const soundId = meta ? meta.id : '';
        return `
            <div class="v-disc-wrap" onclick="event.stopPropagation(); VideoRender.openSoundPage('${soundId}')" title="View sound details">
                <div class="v-disc">
                    <img src="${art}" alt="sound" onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}'">
                </div>
                <div class="v-disc-note">
                    <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
            </div>`;
    }

    // ─── Hydrate: attach a post's resolved sound meta into a card's DOM ──
    // Convenience helper for pages that build cards synchronously (with
    // a placeholder) and want to fill in the real sound title/handle
    // once the async lookup resolves, without re-rendering the whole card.
    async function hydrateSoundLabel(post, labelEl) {
        if (!labelEl) return;
        const meta = await getSoundMetaForPost(post);
        if (!meta) { labelEl.textContent = 'Original sound'; return; }
        labelEl.textContent = meta.creatorHandle
            ? `${meta.title} · ${meta.creatorHandle}`
            : meta.title;
        labelEl.closest('[data-sound-target]')?.setAttribute('data-sound-id', meta.id);
    }

    // ─── EXPOSE PUBLIC API ────────────────────────────────────────────
    window.VideoRender = {
        resolveSoundId,
        getSoundMetaForPost,
        clearSoundCache,
        openSoundPage,
        openSoundPageForPost,
        renderSoundPillHTML,
        renderSoundDiscHTML,
        hydrateSoundLabel,
    };

})();
