// =====================================================================
// music.js – Controls music.html
// =====================================================================
// Handles: search, tab switching (trending/recommended/originals/saved),
// audio preview, save/unsave, selecting a sound, and routing back into
// studio.html (when opened from the create flow) or sound.html.
//
// Depends entirely on window.SoundsAPI (sounds.js). No direct Supabase
// calls live in this file.
// =====================================================================

(function() {
    'use strict';

    if (!window.SoundsAPI) {
        console.error('music.js: SoundsAPI missing. Ensure sounds.js loads before music.js.');
        return;
    }

    const state = {
        activeTab: 'trending',
        sounds: [],
        savedIds: new Set(),
        searchQuery: '',
        currentPlayingId: null,
        returnMode: null, // 'studio' | null
    };

    let _toastTimer = null;
    let _searchDebounce = null;

    // ─── HELPERS ──────────────────────────────────────────────────────

    function showToast(msg) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    function fmtDuration(dur) {
        if (!dur) return '';
        if (typeof dur === 'string') return dur;
        const m = Math.floor(dur / 60), s = Math.floor(dur % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function getCurrentUser() {
        if (window.AuthUser && typeof window.AuthUser.getCurrentUser === 'function') {
            return window.AuthUser.getCurrentUser();
        }
        return { id: 'guest', isLoggedIn: false };
    }

    function goBack() {
        if (window.Router && typeof window.Router.back === 'function') window.Router.back();
        else if (document.referrer) window.history.back();
        else window.location.href = 'index.html';
    }

    function goToSoundPage(soundId) {
        if (window.Router && typeof window.Router.openSound === 'function') window.Router.openSound(soundId);
        else window.location.href = 'sound.html?id=' + encodeURIComponent(soundId);
    }

    // ─── RENDER SKELETONS ───────────────────────────────────────────

    function renderSkeletons(count = 6) {
        const list = document.getElementById('soundList');
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
                <div class="m-skel">
                    <div class="m-skel-art"></div>
                    <div class="m-skel-lines">
                        <div class="m-skel-line w1"></div>
                        <div class="m-skel-line w2"></div>
                    </div>
                </div>`;
        }
        list.innerHTML = html;
    }

    function renderEmpty(message) {
        const list = document.getElementById('soundList');
        list.innerHTML = `
            <div class="m-empty">
                <svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                <p>${escapeHtml(message)}</p>
            </div>`;
    }

    // ─── RENDER SOUND LIST ──────────────────────────────────────────

    function renderSoundList(sounds) {
        const list = document.getElementById('soundList');
        if (!sounds.length) {
            renderEmpty(
                state.searchQuery
                    ? `No sounds found for "${state.searchQuery}"`
                    : state.activeTab === 'saved'
                        ? "You haven't saved any sounds yet."
                        : 'No sounds available right now.'
            );
            return;
        }

        list.innerHTML = sounds.map(s => {
            const isSaved = state.savedIds.has(s.id);
            const isPlaying = state.currentPlayingId === s.id;
            const creatorHandle = s.creator ? ('@' + (s.creator.username || s.creator.displayName || 'user')) : '';
            const subParts = [creatorHandle, fmtDuration(s.duration)].filter(Boolean);

            return `
                <div class="snd-item ${isPlaying ? 'playing' : ''}" data-id="${s.id}">
                    <button class="snd-art-btn" onclick="event.stopPropagation(); MusicPage.togglePlay('${s.id}')">
                        <img src="${s.artUrl || ''}" alt=""
                             onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(s.title)}'">
                        <div class="snd-play-overlay">
                            <svg viewBox="0 0 24 24">${isPlaying
                                ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
                                : '<polygon points="5 3 19 12 5 21 5 3"/>'}</svg>
                        </div>
                    </button>
                    <div class="snd-info" onclick="MusicPage.openSound('${s.id}')">
                        <div class="snd-title">🎵 ${escapeHtml(s.title)}</div>
                        <div class="snd-sub">${escapeHtml(subParts.join(' · '))}</div>
                    </div>
                    <div class="snd-actions">
                        <button class="snd-save-btn ${isSaved ? 'saved' : ''}" onclick="event.stopPropagation(); MusicPage.toggleSave('${s.id}')">
                            <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                        </button>
                        <button class="snd-use-btn" onclick="event.stopPropagation(); MusicPage.useSound('${s.id}')">Use</button>
                    </div>
                </div>`;
        }).join('');
    }

    // ─── LOAD SAVED IDS (to mark hearts across all tabs) ─────────────

    async function loadSavedIdsSet() {
        const user = getCurrentUser();
        if (!user || !user.isLoggedIn) { state.savedIds = new Set(); return; }
        try {
            const saved = await SoundsAPI.loadSavedSounds();
            state.savedIds = new Set(saved.map(s => s.id));
        } catch (e) {
            console.warn('loadSavedIdsSet error:', e);
        }
    }

    // ─── TAB SWITCHING ────────────────────────────────────────────────

    async function switchTab(tab, el) {
        state.activeTab = tab;
        state.searchQuery = '';
        document.getElementById('searchInput').value = '';
        document.getElementById('searchClear').classList.remove('show');
        document.querySelectorAll('.m-tab').forEach(t => t.classList.toggle('on', t === el));
        await loadActiveTab();
    }

    async function loadActiveTab() {
        renderSkeletons();
        await loadSavedIdsSet();

        try {
            let sounds = [];
            if (state.activeTab === 'trending') sounds = await SoundsAPI.loadTrendingSounds();
            else if (state.activeTab === 'recommended') sounds = await SoundsAPI.loadRecommendedSounds();
            else if (state.activeTab === 'originals') sounds = await SoundsAPI.loadOriginalSounds();
            else if (state.activeTab === 'saved') {
                const user = getCurrentUser();
                if (!user || !user.isLoggedIn) {
                    renderEmpty('Sign in to see your saved sounds.');
                    return;
                }
                sounds = await SoundsAPI.loadSavedSounds();
            }
            state.sounds = sounds;
            renderSoundList(sounds);
        } catch (e) {
            console.error('loadActiveTab error:', e);
            renderEmpty('Could not load sounds. Pull down to retry.');
        }
    }

    // ─── SEARCH ───────────────────────────────────────────────────────

    function onSearchInput(value) {
        state.searchQuery = value.trim();
        document.getElementById('searchClear').classList.toggle('show', !!value);
        clearTimeout(_searchDebounce);

        if (!state.searchQuery) {
            loadActiveTab();
            return;
        }

        _searchDebounce = setTimeout(async () => {
            renderSkeletons();
            await loadSavedIdsSet();
            try {
                const results = await SoundsAPI.searchSounds(state.searchQuery);
                state.sounds = results;
                renderSoundList(results);
            } catch (e) {
                console.error('search error:', e);
                renderEmpty('Search failed. Try again.');
            }
        }, 350);
    }

    function clearSearch() {
        document.getElementById('searchInput').value = '';
        document.getElementById('searchClear').classList.remove('show');
        state.searchQuery = '';
        loadActiveTab();
    }

    // ─── AUDIO PREVIEW ──────────────────────────────────────────────

    const audioEl = document.getElementById('previewAudio');

    function togglePlay(soundId) {
        const sound = state.sounds.find(s => s.id === soundId);
        if (!sound) return;

        if (state.currentPlayingId === soundId) {
            audioEl.pause();
            return;
        }

        if (!sound.audioUrl) {
            showToast('Preview not available for this sound');
            return;
        }

        audioEl.src = sound.audioUrl;
        audioEl.play().catch(() => showToast('Could not play sound'));

        const mpArt = document.getElementById('mpArt');
        const mpTitle = document.getElementById('mpTitle');
        if (mpArt) mpArt.src = sound.artUrl || '';
        if (mpTitle) mpTitle.textContent = sound.title;
    }

    function togglePreviewPlayback() {
        if (!state.currentPlayingId) return;
        if (audioEl.paused) audioEl.play().catch(() => {});
        else audioEl.pause();
    }

    function stopPreview() {
        audioEl.pause();
        audioEl.currentTime = 0;
    }

    audioEl.addEventListener('play', () => {
        // derive which sound is now playing from the current src
        const playing = state.sounds.find(s => s.audioUrl === audioEl.src);
        state.currentPlayingId = playing ? playing.id : state.currentPlayingId;
        document.getElementById('miniPlayer').classList.add('show');
        const icon = document.getElementById('mpToggleIcon');
        if (icon) icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
        document.querySelectorAll('.snd-item').forEach(el => {
            el.classList.toggle('playing', el.dataset.id === state.currentPlayingId);
        });
    });
    audioEl.addEventListener('pause', () => {
        const icon = document.getElementById('mpToggleIcon');
        if (icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    });
    audioEl.addEventListener('ended', () => {
        state.currentPlayingId = null;
        document.getElementById('miniPlayer').classList.remove('show');
        document.querySelectorAll('.snd-item').forEach(el => el.classList.remove('playing'));
    });

    // ─── SAVE / UNSAVE ────────────────────────────────────────────────

    async function toggleSave(soundId) {
        const user = getCurrentUser();
        if (!user || !user.isLoggedIn) { showToast('Please sign in to save sounds'); return; }

        const wasSaved = state.savedIds.has(soundId);
        try {
            if (wasSaved) {
                await SoundsAPI.unsaveSound(soundId);
                state.savedIds.delete(soundId);
                showToast('Removed from saved sounds');
                if (state.activeTab === 'saved') {
                    state.sounds = state.sounds.filter(s => s.id !== soundId);
                }
            } else {
                await SoundsAPI.saveSound(soundId);
                state.savedIds.add(soundId);
                showToast('Sound saved ✓');
            }
            renderSoundList(state.sounds);
        } catch (e) {
            console.error('toggleSave error:', e);
            showToast('Could not update saved sounds');
        }
    }

    // ─── SELECT / USE SOUND ─────────────────────────────────────────

    function openSound(soundId) {
        goToSoundPage(soundId);
    }

    function useSound(soundId) {
        if (state.returnMode === 'studio') {
            window.location.href = 'studio.html?sound=' + encodeURIComponent(soundId);
        } else {
            goToSoundPage(soundId);
        }
    }

    // ─── INIT ─────────────────────────────────────────────────────────

    function init() {
        document.addEventListener('themeChanged', e => {
            document.documentElement.setAttribute('data-theme', e.detail.theme);
        });

        function updateNavAvatar() {
            const user = getCurrentUser();
            document.querySelectorAll('.side-av, .nav-av').forEach(el => {
                el.src = user.avatar || '';
                el.onerror = function() { this.style.display = 'none'; };
            });
        }
        updateNavAvatar();

        const params = new URLSearchParams(window.location.search);
        state.returnMode = params.get('return'); // 'studio' or null

        loadActiveTab();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // ─── EXPOSE FOR INLINE HANDLERS ───────────────────────────────────
    window.MusicPage = { togglePlay, toggleSave, openSound, useSound };
    window.switchTab = switchTab;
    window.onSearchInput = onSearchInput;
    window.clearSearch = clearSearch;
    window.togglePreviewPlayback = togglePreviewPlayback;
    window.stopPreview = stopPreview;
    window.goBack = goBack;

})();
