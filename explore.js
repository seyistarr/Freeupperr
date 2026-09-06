// explore.js — FreeUpper Explore tab module
// Depends on accessor functions exposed by the main script:
// window.getCurrentUser, window.escapeHtml, window.formatCount,
// window.getMediaItems, window.isYouTubeUrl, window.extractYouTubeId,
// window.getAllPosts, window.getHiddenPostsSet, window.getBlockedSet,
// window.getCategoryFilter, window.setCategoryFilter, window.getUiPage,
// window.openExplorePost, window.getVerifiedBadgeHTML, window.FreeUpperAlgorithm,
// window.FreeUpperOnboarding
(function () {
    'use strict';

    // ─── STATE ───────────────────────────────────────────────────────
    let exploreVideoObserver = null;
    let _exploreInterestsCache = null;
    let _shuffleExploreOnce = false;

    function shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ─── ICONS (small, duplicated locally rather than exposed from main) ───
    function svgEye() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19V10"/><path d="M12 19V5"/><path d="M20 19V14"/></svg>'; }
    function svgChevronLeft() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'; }
    function svgChevronRight() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'; }

    // ─── VIDEO AUTOPLAY (explore grid only) ──────────────────────────
    function disconnectExploreVideoObserver() {
        if (exploreVideoObserver) {
            exploreVideoObserver.disconnect();
            exploreVideoObserver = null;
        }
    }

    function setupExploreVideoAutoplay(container) {
        disconnectExploreVideoObserver();
        const videoEls = container.querySelectorAll('video.explore-card-thumb');
        if (!videoEls.length) return;
        exploreVideoObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const vid = entry.target;
                if (entry.isIntersecting && entry.intersectionRatio >= 0.6) vid.play().catch(() => {});
                else vid.pause();
            });
        }, { threshold: [0, 0.6, 1] });
        videoEls.forEach(vid => exploreVideoObserver.observe(vid));
    }

    // ─── SKELETON ────────────────────────────────────────────────────
    function exploreSkeletonGrid() {
        let h = '';
        for (let i = 0; i < 8; i++) h += '<div class="explore-skeleton-card"><div class="explore-skeleton-thumb"></div></div>';
        return h;
    }

    // ─── CATEGORY CHIPS ──────────────────────────────────────────────
    async function ensureExploreInterests() {
        if (_exploreInterestsCache) return _exploreInterestsCache;
        if (window.FreeUpperOnboarding && typeof window.FreeUpperOnboarding.getInterests === 'function') {
            _exploreInterestsCache = await window.FreeUpperOnboarding.getInterests();
        } else {
            _exploreInterestsCache = [];
        }
        return _exploreInterestsCache;
    }

    function buildExploreCategoryChipsHTML(interests) {
        if (!interests || !interests.length) return '';
        const currentFilter = window.getCategoryFilter();
        const escapeHtml = window.escapeHtml;
        const all = `<button class="explore-cat-chip ${!currentFilter ? 'active' : ''}" data-cat="">All</button>`;
        const rest = interests.map(i =>
            `<button class="explore-cat-chip ${currentFilter === i.key ? 'active' : ''}" data-cat="${escapeHtml(i.key)}">${escapeHtml(i.label)}</button>`
        ).join('');
        return `<div class="explore-cat-chips-wrap" id="explore-cat-chips-wrap">
            <button class="explore-chip-arrow left hidden" id="exploreChipsPrev" aria-label="Scroll left">${svgChevronLeft()}</button>
            <div class="explore-cat-chips" id="explore-cat-chips">${all}${rest}</div>
            <button class="explore-chip-arrow right" id="exploreChipsNext" aria-label="Scroll right">${svgChevronRight()}</button>
        </div>`;
    }

    function initExploreChipsArrows() {
        const scroller = document.getElementById('explore-cat-chips');
        const prevBtn = document.getElementById('exploreChipsPrev');
        const nextBtn = document.getElementById('exploreChipsNext');
        if (!scroller || !prevBtn || !nextBtn) return;

        function updateArrows() {
            const maxScroll = scroller.scrollWidth - scroller.clientWidth;
            prevBtn.classList.toggle('hidden', scroller.scrollLeft <= 4);
            nextBtn.classList.toggle('hidden', scroller.scrollLeft >= maxScroll - 4);
        }
        prevBtn.onclick = () => scroller.scrollBy({ left: -260, behavior: 'smooth' });
        nextBtn.onclick = () => scroller.scrollBy({ left: 260, behavior: 'smooth' });
        scroller.addEventListener('scroll', updateArrows, { passive: true });
        updateArrows();
    }

    function applyExploreCategoryFilter(catKey) {
        if (window.innerWidth < 768) return;
        window.setCategoryFilter(catKey || '');
        document.querySelectorAll('.explore-cat-chip').forEach(btn => {
            btn.classList.toggle('active', (btn.dataset.cat || '') === window.getCategoryFilter());
        });
        const gc = document.getElementById('explore-grid-content');
        if (gc) gc.innerHTML = exploreSkeletonGrid();
        setTimeout(() => { renderExploreCardsOnly(); }, 350);
    }

    // ─── FILTERING ───────────────────────────────────────────────────
    function getExplorePostsFiltered() {
        const currentUser = window.getCurrentUser();
        const hiddenPostsSet = window.getHiddenPostsSet();
        const blockedSet = window.getBlockedSet();
        let p = [...window.getAllPosts()]
            .filter(post => !hiddenPostsSet.has(post.id))
            .filter(post => !blockedSet.has(post.user_id))
            .filter(post => {
                if (post.user_id === currentUser.id) return true;
                if (post.is_hidden) return false;
                const profile = post.profile || {};
                return !profile.is_private;
            });
        p.sort((a, b) => ((b.views || 0) + (b.reactions.like || 0)) - ((a.views || 0) + (a.reactions.like || 0)));
        const catFilter = window.getCategoryFilter();
        if (window.FreeUpperAlgorithm && catFilter) {
            p = p.filter(post => window.FreeUpperAlgorithm.getPostTopics(post).includes(catFilter));
        }
        if (_shuffleExploreOnce) { p = shuffleArray(p); _shuffleExploreOnce = false; }
        return p;
    }

    // ─── CARDS ───────────────────────────────────────────────────────
    function buildExploreCards(posts) {
        const escapeHtml = window.escapeHtml;
        const getMediaItems = window.getMediaItems;
        const isYouTubeUrl = window.isYouTubeUrl;
        const extractYouTubeId = window.extractYouTubeId;
        const formatCount = window.formatCount;

        return posts.map(post => {
            const author = window.getAuthorFromProfile(post.profile);
            const av = author.avatar;
            const au = author.name;
            const mediaItems = getMediaItems(post);
            let mh = '';
            if (mediaItems.length > 0) {
                const first = mediaItems[0];
                const url = first.url;
                const isVideo = first.type === 'video' || (url && isYouTubeUrl(url));
                if (url) {
                    if (isVideo && isYouTubeUrl(url)) {
                        const ytId = extractYouTubeId(url);
                        if (ytId) {
                            mh = `<div class="ig-video-wrap" style="width:100%;margin:0;height:100%;position:relative;background:#000;"><div class="yt-wrap" style="padding-bottom:56.25%;height:0;position:relative;width:100%;"><iframe style="pointer-events:none;position:absolute;top:0;left:0;width:100%;height:100%;border:none;" src="https://www.youtube.com/embed/${ytId}?autoplay=0&mute=1&controls=0&modestbranding=1&rel=0&showinfo=0" allow="autoplay; encrypted-media" loading="lazy"></iframe></div></div>`;
                        } else {
                            mh = `<video src="${url}" muted playsinline loop preload="none" class="explore-card-thumb" style="pointer-events:none;" onloadeddata="this.closest('.explore-card').classList.add('loaded')"></video>`;
                        }
                    } else if (isVideo) {
                        mh = `<video src="${url}" muted playsinline loop preload="none" class="explore-card-thumb" style="pointer-events:none;" onloadeddata="this.closest('.explore-card').classList.add('loaded')"></video>`;
                    } else {
                        mh = `<img src="${url}" class="explore-card-thumb" loading="lazy" alt="" onload="this.closest('.explore-card').classList.add('loaded')" onerror="this.closest('.explore-card').classList.add('loaded');this.outerHTML='<div class=\\'explore-card-no-media loaded\\'><div class=\\'explore-card-no-media-text\\'>${escapeHtml(post.title).replace(/'/g, "\\'")}</div></div>'">`;
                    }
                } else {
                    mh = `<div class="explore-card-no-media loaded"><div class="explore-card-no-media-text">${escapeHtml(post.title)}</div></div>`;
                }
            } else {
                mh = `<div class="explore-card-no-media loaded"><div class="explore-card-no-media-text">${escapeHtml(post.title)}</div></div>`;
            }

            const vb = mediaItems.length > 0 && (mediaItems[0].type === 'video' || (mediaItems[0].url && isYouTubeUrl(mediaItems[0].url))) ?
                `<div class="explore-card-badge"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>` : '';

            const ah = av ?
                `<img src="${av}" class="explore-card-avatar" alt="" onerror="this.style.display='none'">` :
                `<div class="explore-card-avatar" style="display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#9CA3AF;">${au.charAt(0).toUpperCase()}</div>`;
            const nl = !post.mediaUrl && mediaItems.length === 0;
            const cc = nl ? 'explore-card loaded' : 'explore-card';

            return `<div class="${cc}" data-post-id="${post.id}" ${mediaItems.length > 0 && mediaItems[0].type === 'video' ? 'data-video-card="true"' : ''}>
                <div class="explore-card-media">${mh}${vb}</div>
                <div class="explore-card-info">
                    <div class="explore-card-title">${escapeHtml(post.title)}</div>
                    <div class="explore-card-bottom">
                        <div class="explore-card-author">${ah}<span>${escapeHtml(au)}</span></div>
                        <div class="explore-card-views">${svgEye()}<span>${formatCount(post.views || 0)}</span></div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    function renderExploreCardsOnly() {
        const gc = document.getElementById('explore-grid-content');
        if (!gc || window.getUiPage() !== 'explore') return;
        const p = getExplorePostsFiltered();
        if (p.length === 0) {
            gc.innerHTML = '<div class="flex flex-col items-center justify-center py-16 text-center" style="grid-column:1/-1;padding:0 12px;"><p class="text-sm" style="color:var(--muted);">No posts yet. Be the first to post!</p></div>';
            return;
        }
        gc.innerHTML = buildExploreCards(p);
        gc.querySelectorAll('.explore-card').forEach(card => {
            card.addEventListener('click', () => {
                const pid = card.dataset.postId;
                if (pid) window.openExplorePost(pid, 'explore');
            });
        });
        setTimeout(() => { setupExploreVideoAutoplay(gc); }, 300);
    }

    // ─── TAB TEMPLATE ────────────────────────────────────────────────
    function renderExploreTab(container) {
        container.innerHTML = `<div class="explore-page-wrap">
                <div id="explore-cat-chips-slot"></div>
                <div class="explore-grid" id="explore-grid-content">${exploreSkeletonGrid()}</div>
              </div>`;

        ensureExploreInterests().then(interests => {
            const slot = document.getElementById('explore-cat-chips-slot');
            if (!slot || window.getUiPage() !== 'explore') return;
            slot.innerHTML = buildExploreCategoryChipsHTML(interests);
            const wrap = document.getElementById('explore-cat-chips-wrap');
            if (wrap) {
                wrap.querySelectorAll('.explore-cat-chip').forEach(btn => {
                    btn.addEventListener('click', () => applyExploreCategoryFilter(btn.dataset.cat));
                });
                initExploreChipsArrows();
            }
        });

        requestAnimationFrame(() => { renderExploreCardsOnly(); });
    }

    function triggerExploreRefresh() {
        _shuffleExploreOnce = true;
    }

    // ─── EXPOSE GLOBALLY ─────────────────────────────────────────────
    window.renderExploreTab = renderExploreTab;
    window.triggerExploreRefresh = triggerExploreRefresh;
    window.disconnectExploreVideoObserver = disconnectExploreVideoObserver;

})();

