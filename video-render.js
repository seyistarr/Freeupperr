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
    // NOW: ONLY returns a real sound_id from the posts table.
    // No fallback/synthetic IDs are invented. If there's no sound_id,
    // returns null.
    function resolveSoundId(post) {
        if (!post) return null;
        return post.sound_id || null;
    }

    // ─── Fetch (and cache) sound metadata for display ───────────────
    // Returns { id, title, creatorHandle, artUrl } or null if the
    // sound can't be resolved (no sound_id in the post, or no row in
    // the sounds table).
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
            // Sound not found – cache null so we don't retry
            _soundCache.set(soundId, null);
            return null;
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
        if (!meta) return '';
        const art = meta.artUrl || '';
        const seed = encodeURIComponent(meta.title || creatorFallbackSeed || 'sound');
        return `
            <div class="v-disc-wrap" onclick="event.stopPropagation(); VideoRender.openSoundPage('${meta.id}')" title="View sound details">
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
        if (!meta) {
            labelEl.textContent = 'Original sound';
            return;
        }
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
