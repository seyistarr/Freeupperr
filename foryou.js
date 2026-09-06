// foryou.js — FreeUpper "For You" feed tab module
// Depends on accessor functions exposed by the main script:
// window.getCurrentUser, window.escapeHtml, window.getAllPosts,
// window.getHiddenPostsSet, window.getBlockedSet, window.getCategoryFilter,
// window.getSortMethod, window.getSearchQuery, window.shouldShuffleHomeOnce,
// window.getFeedShuffleSeed, window.getFollowingSet, window.toggleFollowUser,
// window.getRelationshipState, window.relLabel, window.getMediaItems,
// window.buildRepostBanner, window.buildMediaHTML, window.buildFollowButton,
// window.buildFollowPlusButton, window.renderPostTitle, window.buildContentBlockHTML,
// window.buildActionsRow, window.truncateName, window.formatRelativeTime,
// window.formatCount, window.initPlayers, window.toggleReaction, window.toggleBookmarkUI,
// window.openShareModal, window.triggerRepostFromFeed, window.openRepostersSheet,
// window.openExplorePost, window.openGalleryLightbox, window.openInAppWebView,
// window.spawnRipple, window.haptic, window.showToast, window.getVerifiedBadgeHTML,
// window.getAuthorFromProfile, window.Router, window.FreeUpperAlgorithm, window.FreeUpperFeed
(function () {
    'use strict';

    const UCK = 'freeupper_user_categories';
    const PAGE_SIZE = 5;

    // ─── LOCAL STATE ──────────────────────────────────────────────
    let feedPage = 1;
    let observer = null, sentinel = null, loader = null;
    let isTogglingContent = false;
    let isLoadingMore = false;
    let lastDoubleTapTime = 0;
    let openPostTimer = null;

    function shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function hashStr(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        return Math.abs(h);
    }

    function getUserCategories() {
        const r = localStorage.getItem(UCK);
        return r ? JSON.parse(r) : [];
    }

    // ─── FILTER / SORT ───────────────────────────────────────────────
    function getFilteredSortedPosts() {
        const currentUser = window.getCurrentUser();
        const hiddenPostsSet = window.getHiddenPostsSet();
        const blockedSet = window.getBlockedSet();
        const currentCategoryFilter = window.getCategoryFilter();
        const searchQuery = window.getSearchQuery();
        const currentSortMethod = window.getSortMethod();

        let p = [...window.getAllPosts()];
        p = p.filter(post => !hiddenPostsSet.has(post.id));
        p = p.filter(post => !blockedSet.has(post.user_id));
        p = p.filter(post => {
            if (post.user_id === currentUser.id) return true;
            if (post.is_hidden) return false;
            const profile = post.profile || {};
            return !profile.is_private;
        });
        if (currentCategoryFilter) p = p.filter(p => p.category === currentCategoryFilter);
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            p = p.filter(p => p.title.toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q) ||
                (p.description || '').toLowerCase().includes(q) || (p.tags && p.tags.some(t => t.toLowerCase().includes(q))));
        }
        if (currentSortMethod === 'trending') p.sort((a, b) => (b.views || 0) - (a.views || 0));
        else if (currentSortMethod === 'foryou') {
            if (window.shouldShuffleHomeOnce()) {
                p = shuffleArray(p);
            } else if (window.FreeUpperAlgorithm && window.FreeUpperFeed) {
                const profile = window.FreeUpperFeed.getProfile();
                const creatorScores = window.FreeUpperFeed.getCreatorScores ? window.FreeUpperFeed.getCreatorScores() : new Map();
                p = window.FreeUpperAlgorithm.rank(p, profile, creatorScores);
            } else {
                const uc = getUserCategories();
                const seed = window.getFeedShuffleSeed();
                const jitter = new Map(p.map(post => [post.id, ((hashStr(post.id + seed) % 1000) / 1000) * 0.25]));
                p.sort((a, b) => {
                    const score = p => {
                        const ah = (Date.now() - new Date(p.timestamp || p.date)) / 36e5;
                        const commentCount = Array.isArray(p.comments) ? p.comments.filter(c => c.approved !== false).length : (p.comments || 0);
                        const eg = (p.views || 0) + ((p.reactions.like || 0) * 2) + (commentCount * 2);
                        return (eg / Math.pow(ah + 2, 1.5)) * (1 + (jitter.get(p.id) || 0));
                    };
                    return (score(b) * (uc.includes(b.category) ? 1.4 : 1)) - (score(a) * (uc.includes(a.category) ? 1.4 : 1));
                });
            }
        } else p.sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
        return p;
    }

    // ─── RENDER ──────────────────────────────────────────────────────
    function renderFeedContainer() {
        const ps = getFilteredSortedPosts();
        const searchQuery = window.getSearchQuery();
        const currentCategoryFilter = window.getCategoryFilter();
        const hf = searchQuery || currentCategoryFilter;
        const hh = hf ?
            `<div class="mb-4 px-4 pt-3"><h1 class="text-xl font-heading font-bold" style="color:var(--text);">${searchQuery ? 'Search results' : currentCategoryFilter}</h1><p class="text-sm" style="color:var(--muted);">${ps.length} post(s)</p></div>` :
            '';
        return `<div class="max-w-2xl mx-auto"><div>${hh}</div><div id="feed-container" class="px-0"></div></div>`;
    }

    function renderSkeletons(c = 3) {
        let h = '';
        for (let i = 0; i < c; i++) h +=
            `<div class="skeleton-post"><div class="flex gap-3" style="padding:0 16px;align-items:flex-start;">
                <div class="skeleton skeleton-avatar"></div>
                <div style="flex:1;min-width:0;">
                    <div class="skeleton skeleton-line" style="width:35%;height:10px"></div>
                    <div class="skeleton skeleton-title"></div>
                    ${i === 0 ? '<div class="skeleton skeleton-image"></div>' : ''}
                    <div class="skeleton skeleton-line" style="width:100%"></div>
                    <div class="skeleton skeleton-line" style="width:60%;margin-bottom:0"></div>
                    <div class="skeleton skeleton-reactions"></div>
                </div>
            </div></div>`;
        return h;
    }

    function getSentinel() {
        if (!sentinel) { sentinel = document.createElement('div'); sentinel.id = 'sentinel'; sentinel.style.height = '1px'; }
        return sentinel;
    }

    function getLoader() {
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'feed-loader';
            loader.className = 'hidden';
            loader.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner" style="margin:0 auto;"></div></div>';
        }
        return loader;
    }

    function setupSentinel() {
        const co = document.getElementById('feed-container');
        if (co && !co.contains(getSentinel())) co.appendChild(getSentinel());
        const l = getLoader();
        if (co && !co.contains(l)) co.insertBefore(l, getSentinel());
    }

    function setupInfiniteScroll() {
        if (observer) observer.disconnect();
        observer = new IntersectionObserver(es => {
            if (isTogglingContent || isLoadingMore) return;
            if (es[0].isIntersecting) loadMorePosts();
        }, { root: null, rootMargin: '200px', threshold: 0 });
        observer.observe(getSentinel());
    }

    // ─── POST HTML ───────────────────────────────────────────────────
    function buildPostHTML(p, index) {
        const escapeHtml = window.escapeHtml;
        const author = window.getAuthorFromProfile(p.profile);
        const da = window.truncateName(author.name, 22);
        const aa = author.avatar;
        const verifiedStatus = author.verified_status;

        const repostBanner = window.buildRepostBanner(p);

        const hd = p.description && p.description.trim().length > 0;
        const rawContent = p.content || '';
        const hasMedia = window.getMediaItems(p).length > 0;
        const th = p.tags && p.tags.length > 0 ?
            `<div class="flex flex-wrap gap-1 mt-2">${p.tags.map(t =>
                `<span class="tag-badge" style="display:inline-block;padding:3px 9px;border-radius:20px;font-size:.7rem;font-weight:600;background:rgba(124,58,237,.08);color:#7C3AED;cursor:pointer;" onclick="event.stopPropagation();window.Router.openHashtag('${escapeHtml(t)}')">#${escapeHtml(t)}</span>`
            ).join('')}</div>` :
            '';
        const mh = window.buildMediaHTML(p, index);
        window.buildFollowButton(p.user_id, da);
        const badgeHtml = window.getVerifiedBadgeHTML ? window.getVerifiedBadgeHTML(verifiedStatus) : '';

        const cuForLock = window.getCurrentUser();
        const lockPill = (p.is_hidden && p.user_id === cuForLock.id)
            ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:.68rem;font-weight:700;color:#7C3AED;background:rgba(124,58,237,.1);padding:2px 8px;border-radius:20px;margin-left:4px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Only you</span>'
            : '';

        const isRepostClass = repostBanner ? 'is-repost' : '';

        return `<article class="feed-post ${isRepostClass}" data-post-id="${p.id}" data-author-id="${author.id}">
                ${repostBanner}
                <div class="flex items-start gap-3" style="padding:0 16px;">
                  <div class="avatar-plus-wrap">
                    <img data-author-avatar src="${aa}" class="user-mini-avatar" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover;cursor:pointer;flex-shrink:0;">
                    ${window.buildFollowPlusButton(p.user_id)}
                  </div>
                  <div style="min-width:0;flex:1;">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span data-author-name class="font-bold text-sm cursor-pointer hover:underline" style="color:var(--text);">${escapeHtml(da)}</span>
                      <span data-author-badge-wrapper>${badgeHtml}</span>
                      <span class="text-xs" style="color:var(--muted);">· ${window.formatRelativeTime(p.timestamp || p.date)}</span>
                      ${lockPill}
                    </div>
                    <div class="cursor-pointer mt-0.5">${window.renderPostTitle(p.title, { hasMedia, mentions: p.mentions })}</div>
                    ${hd ? `<p class="text-sm mt-1 leading-relaxed" style="white-space:pre-wrap;color:var(--muted);">${escapeHtml(p.description)}</p>` : ''}
                    <div class="mt-1" id="post-content-${p.id}">
                      ${window.buildContentBlockHTML(p.id, rawContent, hasMedia, { mentions: p.mentions })}
                    </div>
                  </div>
                </div>
                ${mh}
                <div style="padding:0 16px;">
                  ${th}
                  <div class="post-actions-row" style="position:relative;">
                    ${window.buildActionsRow(p)}
                  </div>
                </div>
              </article>`;
    }

    // ─── FEED LOAD / PAGINATE ────────────────────────────────────────
    function loadInitialFeed() {
        feedPage = 1;
        isLoadingMore = false;
        if (observer) observer.disconnect();
        const co = document.getElementById('feed-container');
        if (!co) return;
        co.innerHTML = renderSkeletons(3);
        requestAnimationFrame(() => {
            const ps = getFilteredSortedPosts();
            co.innerHTML = '';
            if (ps.length === 0) {
                co.innerHTML = '<div class="flex flex-col items-center justify-center py-20 text-center"><p class="text-sm" style="color:var(--muted);">No posts yet. Create your first post!</p></div>';
                return;
            }
            const fb = ps.slice(0, PAGE_SIZE);
            const postsHtml = fb.map((p, i) => buildPostHTML(p, i));
            postsHtml.splice(2, 0, '<div id="suggested-people-slot"></div>');
            co.innerHTML = postsHtml.join('');
            requestAnimationFrame(() => {
                window.initPlayers(co);
                setupSentinel();
                setupInfiniteScroll();
                setupPostEventDelegation(co);
                window._currentFeedPosts = ps;
                window.IndexRender?.rescan();
            });
        });
    }

    function loadMorePosts() {
        if (isLoadingMore) return;
        const ps = window._currentFeedPosts || getFilteredSortedPosts();
        const start = feedPage * PAGE_SIZE, nb = ps.slice(start, start + PAGE_SIZE);
        if (nb.length === 0) { if (observer && sentinel) observer.unobserve(sentinel); return; }
        isLoadingMore = true;
        const co = document.getElementById('feed-container'), s = getSentinel();
        const t = document.createElement('div');
        t.innerHTML = nb.map((p, i) => buildPostHTML(p, start + i)).join('');
        while (t.firstChild) co.insertBefore(t.firstChild, s);
        requestAnimationFrame(() => {
            window.initPlayers(co);
            feedPage++;
            isLoadingMore = false;
            window.IndexRender?.rescan();
        });
    }

    // ─── EVENT DELEGATION (single listener on #feed-container) ──────
    function setupPostEventDelegation(container) {
        container.removeEventListener('click', handlePostClick);
        container.addEventListener('click', handlePostClick);
    }

    function handlePostClick(e) {
        const t = e.target;
        const article = t.closest('.feed-post');
        if (!article) return;
        const pid = article.dataset.postId;
        if (!pid) return;

        if (openPostTimer) { clearTimeout(openPostTimer); openPostTimer = null; }

        if (t.closest('.plyr__controls') || t.closest('.plyr__control--overlaid')) return;

        const actionEl = t.closest('.post-actions-row > *');
        if (actionEl) window.spawnRipple(actionEl, e);

        if (t.classList.contains('read-more-btn')) { e.stopPropagation(); toggleReadMore(article); return; }
        if (t.closest('.reaction-btn')) { e.stopPropagation(); window.toggleReaction(pid); return; }
        if (t.closest('.bookmark-badge')) { e.stopPropagation(); window.toggleBookmarkUI(article); return; }
        if (t.closest('.share-btn')) {
            e.stopPropagation();
            const btn = t.closest('.share-btn');
            const postId = btn.dataset.sharePost || pid;
            btn.classList.add('share-bounce');
            setTimeout(() => btn.classList.remove('share-bounce'), 450);
            window.haptic(6);
            window.openShareModal(postId);
            return;
        }
        if (t.closest('[data-repost-btn]')) {
            e.stopPropagation();
            const btn = t.closest('[data-repost-btn]');
            window.triggerRepostFromFeed(btn, btn.dataset.repostBtn);
            return;
        }
        if (t.closest('.comment-btn')) {
            e.stopPropagation();
            const btn = t.closest('.comment-btn');
            btn.classList.add('comment-pop');
            setTimeout(() => btn.classList.remove('comment-pop'), 260);
            window.haptic(6);
            const p = window.getAllPosts().find(x => x.id === pid);
            window.openExplorePost(pid, 'home', !(p && p.commentsHidden));
            return;
        }
        if (t.closest('.mention-link')) {
            e.stopPropagation();
            const uid = t.closest('.mention-link').dataset.userid;
            if (uid) window.Router.openProfile(uid);
            return;
        }
        if (t.closest('.user-mini-avatar') || t.closest('.font-bold.text-sm')) {
            e.stopPropagation();
            const p = window.getAllPosts().find(p => p.id === pid);
            if (p && p.user_id) window.Router.openProfile(p.user_id);
            return;
        }
        if (t.closest('[data-gallery-post]')) {
            e.stopPropagation();
            const el = t.closest('[data-gallery-post]');
            const post = window.getAllPosts().find(x => x.id === el.dataset.galleryPost);
            if (post) window.openGalleryLightbox(window.getMediaItems(post), Number(el.dataset.galleryIndex || 0), post.id);
            return;
        }
        if (t.closest('[data-extlink]')) { e.stopPropagation(); window.openInAppWebView(decodeURIComponent(t.closest('[data-extlink]').dataset.extlink)); return; }
        if (t.closest('.tag-badge')) {
            e.stopPropagation();
            const tag = t.textContent.replace('#', '').trim();
            if (tag) window.Router.openHashtag(tag);
            return;
        }
        if (t.closest('[data-repost-avatar]')) {
            e.stopPropagation();
            const uid = t.closest('[data-repost-avatar]').dataset.userId;
            if (uid) window.Router.openProfile(uid);
            return;
        }
        if (t.closest('[data-repost-name]') || t.closest('[data-repost-tag]')) {
            e.stopPropagation();
            const pid2 = (t.closest('[data-repost-name]') || t.closest('[data-repost-tag]')).dataset.postId;
            if (pid2) window.openRepostersSheet(pid2);
            return;
        }

        const now = Date.now();
        const gap = now - lastDoubleTapTime;
        if (gap < 300 && gap > 0) {
            e.preventDefault();
            window.toggleReaction(pid);
            lastDoubleTapTime = 0;
            return;
        }
        lastDoubleTapTime = now;
        openPostTimer = setTimeout(() => {
            openPostTimer = null;
            if (lastDoubleTapTime === now) {
                window.openExplorePost(pid, 'home');
            }
        }, 300);
    }

    function toggleReadMore(article) {
        isTogglingContent = true;
        const pid = article.dataset.postId;
        const pv = article.querySelector(`.preview-text-${pid}`), fl = article.querySelector(`.full-text-${pid}`), b = article.querySelector('.read-more-btn');
        if (!pv || !fl) { isTogglingContent = false; return; }
        const beforeTop = article.getBoundingClientRect().top;
        if (fl.classList.contains('hidden')) { pv.classList.add('hidden'); fl.classList.remove('hidden'); b.textContent = 'Show less'; }
        else { pv.classList.remove('hidden'); fl.classList.add('hidden'); b.textContent = 'Show more'; }
        const afterTop = article.getBoundingClientRect().top;
        window.scrollBy(0, afterTop - beforeTop);
        isTogglingContent = false;
    }

    // ─── SUGGESTED PEOPLE ────────────────────────────────────────────
    function truncateBio(bio, max = 60) {
        bio = bio || '';
        return bio.length > max ? bio.slice(0, max).trim() + '…' : bio;
    }

    async function loadSuggestedPeople() {
        const cu = window.getCurrentUser();
        if (!cu || !cu.isLoggedIn) return [];
        const followingIds = Array.from(window.getFollowingSet());
        let dismissed = [];
        try { dismissed = JSON.parse(localStorage.getItem('freeupper_dismissed_suggestions') || '[]'); } catch (_) {}
        const excludeIds = [...new Set([...followingIds, ...dismissed])];
        let query = window.sb
            .from('profiles')
            .select('id, display_name, username, avatar_url, bio, verified_status')
            .neq('id', cu.id)
            .limit(15);
        if (excludeIds.length) query = query.not('id', 'in', `(${excludeIds.join(',')})`);
        const { data, error } = await query;
        if (error) { console.warn('loadSuggestedPeople error:', error); return []; }
        return data || [];
    }

    function buildSuggestedPeopleHTML(people) {
        if (!people.length) return '';
        const escapeHtml = window.escapeHtml;
        const cards = people.map(p => {
            const name = window.truncateName(p.display_name || 'User', 14);
            const username = window.truncateName(p.username || '', 16);
            const bio = truncateBio(p.bio, 40);
            const avatarHtml = p.avatar_url
                ? `<img src="${p.avatar_url}" alt="">`
                : `<div class="suggested-person-avatar-fallback"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8.5" r="3.3"/><path d="M4.8 19c.6-4 3.6-6.3 7.2-6.3s6.6 2.3 7.2 6.3c-2 1.8-4.6 2.8-7.2 2.8s-5.2-1-7.2-2.8z"/></svg></div>`;
            const vs = p.verified_status || 'none';
            const badgeHtml2 = (vs !== 'none' && window.getVerifiedBadgeHTML) ? window.getVerifiedBadgeHTML(vs) : '';
            return `<div class="suggested-person-card" data-user-id="${p.id}" onclick="window.Router.openProfile('${p.id}')">
                <div class="suggested-person-cancel" onclick="dismissSuggestedPerson(event, '${p.id}')"><i class="ri-close-line"></i></div>
                <div class="suggested-avatar-wrap">${avatarHtml}${badgeHtml2 ? `<span class="suggested-badge-overlay">${badgeHtml2}</span>` : ''}</div>
                <div class="suggested-person-name">${escapeHtml(name)}</div>
                <div class="suggested-person-username">@${escapeHtml(username)}</div>
                <div class="suggested-person-bio">${escapeHtml(bio)}</div>
                <button class="follow-btn rel-none" data-user-id="${p.id}" onclick="toggleSuggestedFollowHandler(event, '${p.id}')">Follow</button>
            </div>`;
        }).join('');
        return `<div class="suggested-people-section">
            <div class="suggested-people-header">
                <div class="suggested-people-header-text">
                    <h3>Suggested for you</h3>
                </div>
            </div>
            <div class="suggested-people-scroll" id="suggested-people-scroll">${cards}</div>
        </div>`;
    }

    function dismissSuggestedPerson(e, userId) {
        e.stopPropagation();
        let dismissed = [];
        try { dismissed = JSON.parse(localStorage.getItem('freeupper_dismissed_suggestions') || '[]'); } catch (_) {}
        if (!dismissed.includes(userId)) dismissed.push(userId);
        localStorage.setItem('freeupper_dismissed_suggestions', JSON.stringify(dismissed));
        const card = document.querySelector(`.suggested-person-card[data-user-id="${userId}"]`);
        if (!card) return;
        card.classList.add('dismissing');
        setTimeout(() => card.remove(), 200);
    }

    async function toggleSuggestedFollowHandler(e, userId) {
        e.stopPropagation();
        const btn = e.currentTarget;
        await window.toggleFollowUser(userId);
        const newState = window.getRelationshipState(userId);
        btn.textContent = (newState === 'following' || newState === 'friends') ? 'Following' : window.relLabel(newState);
        btn.className = `follow-btn rel-${newState}`;
        window.showToast(newState === 'following' || newState === 'friends' ? 'Following ✓' : 'Unfollowed');
    }

    function goToDiscoverPeople() {
        window.showToast('Coming soon!');
    }

    function loadSuggestedPeopleIntoSlot() {
        loadSuggestedPeople().then(people => {
            const slot = document.getElementById('suggested-people-slot');
            if (slot && people.length) slot.innerHTML = buildSuggestedPeopleHTML(people);
        });
    }

    // ─── TAB ENTRY POINT ─────────────────────────────────────────────
    function renderForYouTab(container) {
        container.innerHTML = renderFeedContainer();
        loadInitialFeed();
    }

    // ─── EXPOSE GLOBALLY ─────────────────────────────────────────────
    window.renderForYouTab = renderForYouTab;
    window.setupForYouInfiniteScroll = setupInfiniteScroll;
    window.loadSuggestedPeopleIntoSlot = loadSuggestedPeopleIntoSlot;
    window.dismissSuggestedPerson = dismissSuggestedPerson;
    window.toggleSuggestedFollowHandler = toggleSuggestedFollowHandler;
    window.goToDiscoverPeople = goToDiscoverPeople;
    window.renderSkeletons = renderSkeletons;

    // Expose a safe way to disconnect the infinite-scroll observer from the main script
    window.disconnectForYouObserver = function () {
        if (observer) observer.disconnect();
    };

})();
