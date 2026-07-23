// ============================================================
// search.js — FreeUpper discovery + live search + infinite scroll
// ============================================================
(function () {
  'use strict';

  // ─── CONSTANTS ──────────────────────────────────────────────
  const RECENT_KEY = 'freeupper_recent_searches';
  const PAGE_SIZE = 30; // items per page

  // ─── STATE ──────────────────────────────────────────────────
  let currentTab = 'top';
  let currentQuery = '';
  let searchDebounce = null;
  let hashtagMode = false;
  let currentHashtag = '';
  let hashtagSort = 'top';
  let followingSet = new Set();
  let followerSet = new Set();
  let followSetsLoaded = false;

  // ─── PAGINATION STATE (per tab) ────────────────────────────
  const paging = {
    top:      { offset: 0, hasMore: true, cache: null, scrollY: 0 },
    users:    { offset: 0, hasMore: true, cache: null, scrollY: 0 },
    videos:   { offset: 0, hasMore: true, cache: null, scrollY: 0 },
    photos:   { offset: 0, hasMore: true, cache: null, scrollY: 0 },
    market:   { offset: 0, hasMore: true, cache: null, scrollY: 0 },
    hashtags: { offset: 0, hasMore: true, cache: null, scrollY: 0 }
  };

  // ─── INFINITE SCROLL OBSERVER ──────────────────────────────
  let loadingMore = false;
  let observer = null;
  let sentinel = null;

  // ─── HELPERS ──────────────────────────────────────────────
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function fmtNum(n) { n = n || 0; if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M'; if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K'; return String(n); }
  function timeAgo(iso) { return window.timeAgo ? window.timeAgo(iso) : ''; }
  function getCurrentUser() { return window.AuthUser && window.AuthUser.getCurrentUser ? window.AuthUser.getCurrentUser() : { id: 'guest', isLoggedIn: false }; }

  // ─── RECENT SEARCHES ──────────────────────────────────────
  function getRecentSearches() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
  function addRecentSearch(q) {
    if (!q) return;
    let list = getRecentSearches().filter(x => x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
  }
  function removeRecentSearch(q) {
    localStorage.setItem(RECENT_KEY, JSON.stringify(getRecentSearches().filter(x => x.toLowerCase() !== q.toLowerCase())));
    renderDiscovery();
  }
  function clearAllRecent() { localStorage.removeItem(RECENT_KEY); renderDiscovery(); }

  // ─── RELATIONSHIP SYSTEM ──────────────────────────────────
  async function loadFollowSets() {
    if (followSetsLoaded) return;
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) { followSetsLoaded = true; return; }
    try {
      const [f1, f2] = await Promise.all([
        window.sb.from('follows').select('following_id').eq('follower_id', user.id),
        window.sb.from('follows').select('follower_id').eq('following_id', user.id),
      ]);
      followingSet = new Set((f1.data || []).map(r => r.following_id));
      followerSet = new Set((f2.data || []).map(r => r.follower_id));
    } catch (e) { console.warn('loadFollowSets error', e); }
    followSetsLoaded = true;
  }

  function relationshipState(userId) {
    const me = getCurrentUser();
    if (!me.isLoggedIn || userId === me.id) return 'self';
    const iFollow = followingSet.has(userId);
    const theyFollow = followerSet.has(userId);
    if (iFollow && theyFollow) return 'friends';
    if (iFollow) return 'following';
    if (theyFollow) return 'follow-back';
    return 'follow';
  }

  function relLabel(state) {
    return { friends: 'Friends', following: 'Following', 'follow-back': 'Follow Back', follow: 'Follow', self: '' }[state] || 'Follow';
  }

  async function toggleFollowUser(userId, btn) {
    const me = getCurrentUser();
    if (!me.isLoggedIn) { if (window.showToast) window.showToast('Please sign in to follow', 'o'); return; }
    const currently = followingSet.has(userId);
    try {
      if (currently) {
        await window.sb.from('follows').delete().eq('follower_id', me.id).eq('following_id', userId);
        followingSet.delete(userId);
      } else {
        await window.sb.from('follows').insert({ follower_id: me.id, following_id: userId });
        followingSet.add(userId);
      }
      const state = relationshipState(userId);
      if (btn) { btn.textContent = relLabel(state); btn.className = 'rel-btn rel-' + state; }
      if (window.showToast) window.showToast(state === 'friends' ? 'You are now friends' : (currently ? 'Unfollowed' : 'Following ✓'));
    } catch (err) {
      if (window.showToast) window.showToast(err.message, 'r');
    }
  }
  window._searchToggleFollow = function (e, userId) { e.stopPropagation(); toggleFollowUser(userId, e.currentTarget); };

  // ─── DATA HELPERS (PAGINATED) ──────────────────────────────
  async function fetchTrendingHashtags(limit = 10) {
    const { data, error } = await window.sb.from('posts').select('tags').not('tags', 'is', null).limit(500);
    if (error || !data) return [];
    const counts = {};
    data.forEach(p => (p.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, limit).map(([tag,count]) => ({ tag, count }));
  }
  async function fetchSuggestedUsers(limit = 5) {
    const { data, error } = await window.sb.from('profiles').select('id,username,display_name,avatar_url,verified_status').limit(limit);
    return error ? [] : (data || []);
  }
  async function fetchTrendingPosts(limit = 3) {
    const { data, error } = await window.sb.from('posts').select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)').order('views', { ascending: false }).limit(limit);
    return error ? [] : (data || []);
  }
  async function fetchTrendingVideos(limit = 10) {
    const { data, error } = await window.sb.from('posts').select('id,title,media_url,media_type,views').eq('media_type', 'video').order('views', { ascending: false }).limit(limit);
    return error ? [] : (data || []);
  }
  async function fetchTrendingPhotos(limit = 9) {
    const { data, error } = await window.sb.from('posts').select('id,title,media_url,media_type,views').eq('media_type', 'image').order('views', { ascending: false }).limit(limit);
    return error ? [] : (data || []);
  }
  async function fetchTrendingMarket(limit = 6) {
    const { data } = await window.ListingsAPI.getListings({ status: 'active', order_by: 'views_count', limit });
    return data || [];
  }

  // ─── PAGINATED SEARCH ──────────────────────────────────────
  async function searchAll(q, offset = 0) {
    const like = `%${q}%`;
    const [postsRes, usersRes, marketRes] = await Promise.all([
      window.sb.from('posts')
        .select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
        .or(`title.ilike.${like},content.ilike.${like}`)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
      window.sb.from('profiles')
        .select('id,username,display_name,avatar_url,verified_status,bio')
        .or(`username.ilike.${like},display_name.ilike.${like}`)
        .range(offset, offset + PAGE_SIZE - 1),
      window.ListingsAPI.getListings({ search: q, limit: PAGE_SIZE, offset }).catch(() => ({ data: [] })),
    ]);
    const posts = postsRes.data || [];
    const users = usersRes.data || [];
    const market = marketRes.data || [];
    const hashtags = Array.from(new Set(posts.flatMap(p => p.tags || []).filter(t => t.toLowerCase().includes(q.toLowerCase()))));
    return { posts, users, market, hashtags };
  }

  async function searchHashtag(tag, sort, offset = 0) {
    const { data, error } = await window.sb.from('posts')
      .select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .contains('tags', [tag])
      .order(sort === 'latest' ? 'created_at' : 'views', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    return error ? [] : (data || []);
  }

  async function getHashtagCount(tag) {
    const { count, error } = await window.sb.from('posts').select('id', { count: 'exact', head: true }).contains('tags', [tag]);
    return error ? 0 : (count || 0);
  }

  // ─── CANONICAL ROUTING ────────────────────────────────────
  function openContent(p) {
    if (window.Hashtags && window.Hashtags.openPost) { window.Hashtags.openPost(p); return; }
    const mediaType = p.media_type || p.mediaType;
    window.location.href = (mediaType === 'video' ? 'video.html?post=' : 'index.html?post=') + p.id;
  }
  window._searchOpenPost = function (id, mediaType) {
    window.location.href = (mediaType === 'video' ? 'video.html?post=' : 'index.html?post=') + id;
  };

  // ─── RENDER HELPERS ──────────────────────────────────────
  function squareForPost(p) {
    const mediaType = p.media_type || p.mediaType;
    const mediaUrl = p.media_url || p.mediaUrl;
    let inner;
    if (mediaType === 'video' && mediaUrl) {
      const ytMatch = mediaUrl.match(/(?:embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const thumb = ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : mediaUrl;
      inner = ytMatch ? `<img src="${thumb}" loading="lazy">` : `<video src="${mediaUrl}" muted></video>`;
      inner += `<span class="video-flag"><svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>`;
    } else if (mediaUrl) {
      inner = `<img src="${mediaUrl}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'square-text-preview\\' style=\\'background:#7C3AED\\'>${escapeHtml(p.title||'').replace(/'/g,"\\'")}</div>'">`;
    } else {
      const hue = Math.abs((String(p.id)||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % 360;
      inner = `<div class="square-text-preview" style="background:linear-gradient(135deg,hsl(${hue},60%,35%),hsl(${(hue+40)%360},60%,25%))">${escapeHtml((p.title||p.content||'').slice(0,80))}</div>`;
    }
    return `<div class="square-item" onclick="_searchOpenPost('${p.id}','${mediaType||''}')">${inner}</div>`;
  }

  function feedStylePostCard(p) {
    const profile = p.profiles || p.profile || {};
    const author = window.getAuthorFromProfile ? window.getAuthorFromProfile(profile) : { name: profile.display_name || 'Anonymous', avatar: profile.avatar_url || '', verified_status: profile.verified_status || 'none' };
    const badgeHtml = window.getVerifiedBadgeHTML ? window.getVerifiedBadgeHTML(author.verified_status) : '';
    const mediaType = p.media_type || p.mediaType;
    const mediaUrl = p.media_url || p.mediaUrl;
    let mediaHtml = '';
    if (mediaType === 'video' && mediaUrl) {
      const ytMatch = mediaUrl.match(/(?:embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const thumb = ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : mediaUrl;
      mediaHtml = `<div style="width:100%;aspect-ratio:16/9;overflow:hidden;background:#000;margin-top:8px;position:relative;">
        <img src="${thumb}" style="width:100%;height:100%;object-fit:cover;">
        <span style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.6);border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg></span></div>`;
    } else if (mediaUrl) {
      mediaHtml = `<div style="width:100%;max-height:70vh;overflow:hidden;margin-top:8px;background:#000;"><img src="${mediaUrl}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`;
    }
    return `<article style="border-bottom:1px solid var(--brd);padding:14px 0;cursor:pointer;" onclick="_searchOpenPost('${p.id}','${mediaType||''}')">
      <div style="display:flex;align-items:center;gap:10px;">
        <img src="${author.avatar||''}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;background:var(--bg4);flex-shrink:0;" onerror="this.style.display='none'">
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:4px;"><span style="font-weight:700;font-size:14px;">${escapeHtml(author.name)}</span>${badgeHtml}</div>
          <div style="font-size:11px;color:var(--muted);">${timeAgo(p.created_at || p.timestamp)}</div>
        </div>
      </div>
      <h3 style="font-size:15px;font-weight:700;margin-top:8px;line-height:1.4;">${escapeHtml(p.title||'')}</h3>
      ${p.content ? `<p style="font-size:13px;color:var(--muted);margin-top:4px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">${escapeHtml(p.content)}</p>` : ''}
      ${mediaHtml}
      <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;color:var(--muted);">
        <span>👁 ${fmtNum(p.views)}</span><span>❤️ ${fmtNum(p.like_count || p.likes)}</span>
      </div>
    </article>`;
  }

  function userRowHtml(u) {
    const badgeHtml = window.getVerifiedBadgeHTML ? window.getVerifiedBadgeHTML(u.verified_status) : '';
    const state = relationshipState(u.id);
    const btn = state === 'self' ? '' : `<button class="rel-btn rel-${state}" onclick="_searchToggleFollow(event,'${u.id}')">${relLabel(state)}</button>`;
    return `<div class="user-result" onclick="window.location.href='profile.html?uid=${u.id}'">
      <div class="user-avatar"><img src="${u.avatar_url||''}" onerror="this.style.display='none'"></div>
      <div class="user-info">
        <div class="user-name">${escapeHtml(u.display_name||u.username||'')} ${badgeHtml}</div>
        <div class="user-handle">@${escapeHtml(u.username||'')}</div>
        ${u.bio ? `<div class="user-bio">${escapeHtml(u.bio)}</div>` : ''}
      </div>
      ${btn}
    </div>`;
  }

  function marketCardHtml(m) {
    const img = (m.images && m.images[0] && m.images[0].url) || '';
    return `<div style="flex-shrink:0;width:130px;cursor:pointer;" onclick="window.location.href='index.html?product=${m.id}'">
      <div style="width:130px;height:130px;border-radius:12px;overflow:hidden;background:var(--bg4);"><img src="${img}" style="width:100%;height:100%;object-fit:cover;"></div>
      <div style="font-size:12px;font-weight:700;margin-top:4px;">₦${Number(m.price).toLocaleString()}</div>
      <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.title||'')}</div>
    </div>`;
  }

  function emptyState(title, sub) { return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub||'')}</p></div>`; }

  // ─── TAB VISIBILITY ────────────────────────────────────────
  function showTabs(show) {
    document.getElementById('searchTabs').classList.toggle('visible', show);
  }

  // ─── SENTINEL & OBSERVER ──────────────────────────────────
  function appendSentinel() {
    const container = document.getElementById('resultsContainer');
    // Remove old sentinel
    const old = document.getElementById('searchSentinel');
    if (old) old.remove();
    // Remove old footers
    document.getElementById('loadingMore')?.remove();
    document.getElementById('endResults')?.remove();

    const sentinel = document.createElement('div');
    sentinel.id = 'searchSentinel';
    sentinel.style.height = '1px';
    container.appendChild(sentinel);
  }

  function showLoadingMore(show) {
    let el = document.getElementById('loadingMore');
    if (show) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'loadingMore';
        el.style.textAlign = 'center';
        el.style.padding = '20px';
        el.style.color = 'var(--muted)';
        el.textContent = 'Loading…';
        const container = document.getElementById('resultsContainer');
        container.appendChild(el);
      }
      el.style.display = 'block';
    } else {
      if (el) el.style.display = 'none';
    }
  }

  function showEndResults() {
    let el = document.getElementById('endResults');
    if (!el) {
      el = document.createElement('div');
      el.id = 'endResults';
      el.style.textAlign = 'center';
      el.style.padding = '30px';
      el.style.color = 'var(--muted)';
      el.textContent = 'You\'re all caught up.';
      const container = document.getElementById('resultsContainer');
      container.appendChild(el);
    }
    el.style.display = 'block';
    document.getElementById('loadingMore')?.remove();
  }

  function startInfiniteScroll() {
    disconnectObserver();
    const sentinelEl = document.getElementById('searchSentinel');
    if (!sentinelEl) return;
    observer = new IntersectionObserver(onReachBottom, {
      root: null,
      rootMargin: '400px',
      threshold: 0
    });
    observer.observe(sentinelEl);
  }

  function disconnectObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  async function onReachBottom(entries) {
    if (!entries[0].isIntersecting) return;
    if (loadingMore) return;
    const tabState = paging[currentTab];
    if (!tabState.hasMore) return;
    if (!currentQuery && !hashtagMode) return;
    loadingMore = true;
    if (hashtagMode) {
      await loadHashtagResults(false);
    } else {
      await renderSearchResults(currentQuery, false);
    }
    loadingMore = false;
  }

  // ─── DISCOVERY (State 1 / State 2) ─────────────────────────
  async function renderDiscovery() {
    showTabs(false);
    disconnectObserver();
    const c = document.getElementById('resultsContainer');
    const recent = getRecentSearches();

    if (recent.length) {
      c.innerHTML = `<div class="discovery-section">
        <h3>Recent Searches</h3>
        <div class="recent-clear-all" onclick="Search.clearAllRecent()">Clear All</div>
        ${recent.map(r => {
          const isTag = r.startsWith('#');
          const action = isTag ? `window.Hashtags.goToHashtag('${escapeHtml(r.slice(1)).replace(/'/g,"\\'")}')` : `Search.runSearch('${escapeHtml(r).replace(/'/g,"\\'")}')`;
          return `<div class="recent-search-row"><span onclick="${action}" style="flex:1;">${escapeHtml(r)}</span><span class="remove" onclick="event.stopPropagation();Search.removeRecent('${escapeHtml(r).replace(/'/g,"\\'")}')">×</span></div>`;
        }).join('')}
      </div>`;
      return;
    }

    c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted);">Loading…</div>`;
    await loadFollowSets();
    const [hashtags, users, posts, videos, photos, market] = await Promise.all([
      fetchTrendingHashtags(4), fetchSuggestedUsers(5), fetchTrendingPosts(3),
      fetchTrendingVideos(10), fetchTrendingPhotos(9), fetchTrendingMarket(6)
    ]);
    let html = '';
    html += `<div class="discovery-section"><h3>🔥 Trending Hashtags</h3>` +
      hashtags.map(h => `<div class="hashtag-row" onclick="window.Hashtags.goToHashtag('${escapeHtml(h.tag)}')"><span class="tag-name">#${escapeHtml(h.tag)}</span><span class="tag-count">${fmtNum(h.count)} posts</span></div>`).join('') + `</div>`;
    if (users.length) {
      html += `<div class="discovery-section"><h3>👤 Suggested Users</h3><div style="display:flex;gap:14px;overflow-x:auto;padding-bottom:4px;">` +
        users.map(u => `<div style="text-align:center;flex-shrink:0;cursor:pointer;width:64px;" onclick="window.location.href='profile.html?uid=${u.id}'">
          <img src="${u.avatar_url||''}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;background:var(--bg4);" onerror="this.style.display='none'">
          <div style="font-size:11px;font-weight:600;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">@${escapeHtml(u.username||u.display_name||'')}</div>
        </div>`).join('') + `</div></div>`;
    }
    if (posts.length) html += `<div class="discovery-section"><h3>📈 Trending Posts</h3>${posts.map(feedStylePostCard).join('')}</div>`;
    if (videos.length) {
      html += `<div class="discovery-section"><h3>🎥 Trending Videos</h3><div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">` +
        videos.map(v => {
          const ytMatch = (v.media_url||'').match(/(?:embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          const thumb = ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : v.media_url;
          return `<div style="flex-shrink:0;width:110px;height:150px;border-radius:10px;overflow:hidden;position:relative;cursor:pointer;background:#000;" onclick="_searchOpenPost('${v.id}','video')">
            <img src="${thumb||''}" style="width:100%;height:100%;object-fit:cover;">
            <div style="position:absolute;bottom:4px;left:4px;color:#fff;font-size:10px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.7);">${fmtNum(v.views)} views</div>
          </div>`;
        }).join('') + `</div></div>`;
    }
    if (photos.length) html += `<div class="discovery-section"><h3>📷 Trending Photos</h3><div class="square-grid">${photos.map(squareForPost).join('')}</div></div>`;
    if (market.length) html += `<div class="discovery-section"><h3>🛍 Trending Marketplace</h3><div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;">${market.map(marketCardHtml).join('')}</div></div>`;
    c.innerHTML = html || emptyState('Nothing to discover yet');
  }

  // ─── LIVE SEARCH (State 3+) ─────────────────────────────────
  async function renderSearchResults(q, replace = true) {
    showTabs(true);
    const container = document.getElementById('resultsContainer');
    const tabState = paging[currentTab];

    if (replace) {
      tabState.offset = 0;
      tabState.hasMore = true;
      tabState.cache = null;
      container.innerHTML = '';
    }

    await loadFollowSets();

    let result;
    if (currentTab === 'users') {
      result = await searchAll(q, tabState.offset);
      // users are already filtered
    } else if (currentTab === 'videos') {
      result = await searchAll(q, tabState.offset);
      result.posts = result.posts.filter(p => (p.media_type||p.mediaType) === 'video');
    } else if (currentTab === 'photos') {
      result = await searchAll(q, tabState.offset);
      result.posts = result.posts.filter(p => (p.media_type||p.mediaType) === 'image');
    } else if (currentTab === 'market') {
      result = await searchAll(q, tabState.offset);
      // market already filtered
    } else if (currentTab === 'hashtags' && !hashtagMode) {
      result = await searchAll(q, tabState.offset);
      // will show only hashtags
    } else {
      // TOP (or any other)
      result = await searchAll(q, tabState.offset);
    }

    let html = '';
    if (currentTab === 'users') {
      html = result.users.map(userRowHtml).join('');
    } else if (currentTab === 'videos') {
      html = result.posts.map(squareForPost).join('');
    } else if (currentTab === 'photos') {
      html = result.posts.map(squareForPost).join('');
    } else if (currentTab === 'market') {
      html = result.market.map(m => window.renderListingCard ? window.renderListingCard(m) : marketCardHtml(m)).join('');
    } else if (currentTab === 'hashtags' && !hashtagMode) {
      html = result.hashtags.map(t => `<div class="hashtag-row" onclick="window.Hashtags.goToHashtag('${escapeHtml(t)}')"><span class="tag-name">#${escapeHtml(t)}</span></div>`).join('');
    } else {
      // TOP — mixed
      const mixed = [];
      result.posts.forEach(p => mixed.push({ type: 'post', item: p }));
      result.users.slice(0, 4).forEach(u => mixed.push({ type: 'user', item: u }));
      result.market.slice(0, 4).forEach(m => mixed.push({ type: 'market', item: m }));
      result.hashtags.slice(0, 3).forEach(t => mixed.push({ type: 'hashtag', item: t }));
      html = mixed.map(entry => {
        if (entry.type === 'post') return feedStylePostCard(entry.item);
        if (entry.type === 'user') return userRowHtml(entry.item);
        if (entry.type === 'market') return `<div style="padding:10px 0;border-bottom:1px solid var(--brd);cursor:pointer;display:flex;gap:10px;align-items:center;" onclick="window.location.href='index.html?product=${entry.item.id}'">
          <img src="${(entry.item.images&&entry.item.images[0]&&entry.item.images[0].url)||''}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;background:var(--bg4);">
          <div><div style="font-weight:700;font-size:13px;">${escapeHtml(entry.item.title)}</div><div style="font-size:12px;color:var(--muted);">₦${Number(entry.item.price).toLocaleString()}</div></div>
        </div>`;
        if (entry.type === 'hashtag') return `<div class="hashtag-row" onclick="window.Hashtags.goToHashtag('${escapeHtml(entry.item)}')"><span class="tag-name">#${escapeHtml(entry.item)}</span></div>`;
        return '';
      }).join('');
    }

    if (!html) {
      html = emptyState('No results found', `We couldn't find anything for "${q}"`);
    }

    if (replace) {
      container.innerHTML = html;
    } else {
      container.insertAdjacentHTML('beforeend', html);
    }

    // Update offset based on the primary data source
    let count = 0;
    if (currentTab === 'users') count = result.users.length;
    else if (currentTab === 'market') count = result.market.length;
    else count = result.posts.length; // for top/videos/photos/hashtags
    tabState.offset += count;

    tabState.hasMore = count === PAGE_SIZE;

    // Cache the content for this tab
    if (replace) {
      tabState.cache = { query: q, html: container.innerHTML };
    }

    appendSentinel();
    if (!tabState.hasMore) {
      showEndResults();
    } else {
      showLoadingMore(false);
    }
    startInfiniteScroll();
  }

  // ─── HASHTAG MODE ───────────────────────────────────────────
  async function enterHashtagMode(tag) {
    hashtagMode = true;
    currentHashtag = tag;
    currentQuery = '';
    showTabs(false);
    disconnectObserver();
    document.getElementById('hashtagHeader').style.display = 'block';
    document.getElementById('hashtagTitle').textContent = '#' + tag;
    document.getElementById('searchInput').value = '';
    document.getElementById('clearBtn').classList.remove('show');

    // Reset hashtag paging
    const tabState = paging.hashtags;
    tabState.offset = 0;
    tabState.hasMore = true;
    tabState.cache = null;
    document.getElementById('resultsContainer').innerHTML = '';
    await loadHashtagResults(true);
  }

  async function loadHashtagResults(replace = true) {
    const container = document.getElementById('resultsContainer');
    const tabState = paging.hashtags;

    if (replace) {
      tabState.offset = 0;
      tabState.hasMore = true;
      container.innerHTML = '';
    }

    const [posts, count] = await Promise.all([
      searchHashtag(currentHashtag, hashtagSort, tabState.offset),
      getHashtagCount(currentHashtag)
    ]);

    if (replace) {
      document.getElementById('hashtagCount').textContent = `${fmtNum(count)} Posts`;
    }

    let html = posts.map(squareForPost).join('');
    if (!html) {
      html = emptyState('No posts yet', `Be the first to post with #${currentHashtag}`);
    }

    if (replace) {
      container.innerHTML = html;
    } else {
      container.insertAdjacentHTML('beforeend', html);
    }

    tabState.offset += posts.length;
    tabState.hasMore = posts.length === PAGE_SIZE;

    // Cache hashtag results
    if (replace) {
      tabState.cache = { query: currentHashtag, html: container.innerHTML };
    }

    appendSentinel();
    if (!tabState.hasMore) {
      showEndResults();
    } else {
      showLoadingMore(false);
    }
    startInfiniteScroll();
  }

  // ─── TAB SWITCHING ──────────────────────────────────────────
  function switchTab(tab) {
    // Save current tab's scroll position
    const main = document.getElementById('mainScroll');
    if (main) {
      paging[currentTab].scrollY = main.scrollTop;
    }

    currentTab = tab;
    document.querySelectorAll('#searchTabs .search-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    if (tab === 'sounds') {
      showTabs(true);
      disconnectObserver();
      renderSounds();
      return;
    }

    // If we have a cached version of this tab with the same query, restore it
    const cached = paging[tab].cache;
    if (cached && cached.query === currentQuery) {
      const container = document.getElementById('resultsContainer');
      container.innerHTML = cached.html;
      if (main) {
        main.scrollTop = paging[tab].scrollY || 0;
      }
      // Re-attach sentinel and observer
      appendSentinel();
      startInfiniteScroll();
      return;
    }

    if (currentQuery) {
      renderSearchResults(currentQuery, true);
    } else {
      if (tab === 'hashtags') {
        renderHashtagsTabDiscovery();
      } else {
        renderDiscovery();
      }
    }
  }

  // ─── HASHTAGS TAB DISCOVERY ────────────────────────────────
  async function renderHashtagsTabDiscovery() {
    showTabs(false);
    disconnectObserver();
    const c = document.getElementById('resultsContainer');
    c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted);">Loading…</div>`;
    const hashtags = await fetchTrendingHashtags(30);
    c.innerHTML = hashtags.length
      ? hashtags.map(h => `<div class="hashtag-row" onclick="window.Hashtags.goToHashtag('${escapeHtml(h.tag)}')"><span class="tag-name">#${escapeHtml(h.tag)}</span><span class="tag-count">${fmtNum(h.count)} posts</span></div>`).join('')
      : emptyState('No hashtags yet');
  }

  // ─── SOUNDS ──────────────────────────────────────────────────
  function renderSounds() {
    document.getElementById('resultsContainer').innerHTML = `
      <div class="sounds-empty"><div style="font-size:48px;">🎵</div><h3>Sounds</h3>
        <div style="font-weight:700;color:var(--muted);">Coming Soon</div>
        <p>Soon you'll discover trending sounds, popular audio and original sounds used in FreeUpper videos.</p></div>`;
  }

  // ─── SEARCH INPUT HANDLING ────────────────────────────────
  function onQueryInput(val) {
    const hadQuery = !!currentQuery;
    currentQuery = val.trim();
    document.getElementById('clearBtn').classList.toggle('show', !!currentQuery);
    clearTimeout(searchDebounce);

    if (!currentQuery) {
      disconnectObserver();
      renderDiscovery(); // hides tabs, back to State 2
      return;
    }
    if (!hadQuery) showTabs(true); // State 3 transition

    searchDebounce = setTimeout(() => {
      addRecentSearch(currentQuery);
      renderSearchResults(currentQuery, true);
    }, 350);
  }

  function runSearch(q) {
    document.getElementById('searchInput').value = q;
    document.getElementById('cancelSearchBtn').style.display = 'inline-block';
    onQueryInput(q);
  }

  function onFocus() {
    document.getElementById('cancelSearchBtn').style.display = 'inline-block';
    if (!currentQuery) renderDiscovery();
  }

  function cancelFocus() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchInput').blur();
    document.getElementById('cancelSearchBtn').style.display = 'none';
    document.getElementById('clearBtn').classList.remove('show');
    currentQuery = '';
    disconnectObserver();
    renderDiscovery();
  }

  function clear() {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearBtn').classList.remove('show');
    currentQuery = '';
    disconnectObserver();
    renderDiscovery();
  }

  // ─── HASHTAG MODE EXIT ────────────────────────────────────
  function exitHashtagMode() {
    hashtagMode = false;
    currentHashtag = '';
    document.getElementById('hashtagHeader').style.display = 'none';
    disconnectObserver();
    history.replaceState({}, '', 'search.html');
    renderDiscovery();
  }

  function setHashtagSort(sort) {
    hashtagSort = sort;
    document.querySelectorAll('#hashtagHeader .sub-tabs button').forEach(t => t.classList.toggle('active', t.dataset.sort === sort));
    // Reset and reload
    paging.hashtags.offset = 0;
    paging.hashtags.hasMore = true;
    paging.hashtags.cache = null;
    document.getElementById('resultsContainer').innerHTML = '';
    loadHashtagResults(true);
  }

  // ─── PUBLIC API ──────────────────────────────────────────────
  window.Search = {
    switchTab,
    onQueryInput,
    onFocus,
    clear,
    runSearch,
    exitHashtagMode,
    setHashtagSort,
    removeRecent: removeRecentSearch,
    clearAllRecent,
    cancelFocus
  };

  // ─── INIT ───────────────────────────────────────────────────
  function init() {
    const params = new URLSearchParams(window.location.search);
    const tagParam = params.get('tag') || params.get('hashtag');
    showTabs(false);
    if (tagParam) {
      enterHashtagMode(tagParam);
    } else {
      renderDiscovery();
    }

    // Save scroll position on scroll
    const main = document.getElementById('mainScroll');
    if (main) {
      main.addEventListener('scroll', function() {
        if (currentQuery || hashtagMode) {
          paging[currentTab].scrollY = main.scrollTop;
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
