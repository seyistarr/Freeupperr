// ============================================================
// search.js — FreeUpper discovery + live search + hashtag mode
// ============================================================
(function () {
  'use strict';

  const RECENT_KEY = 'freeupper_recent_searches';
  let currentTab = 'top';
  let currentQuery = '';
  let searchDebounce = null;
  let hashtagMode = false;
  let currentHashtag = '';
  let hashtagSort = 'top';

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function fmtNum(n) { n = n || 0; if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M'; if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K'; return String(n); }

  function getRecentSearches() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; }
  }
  function addRecentSearch(q) {
    if (!q) return;
    let list = getRecentSearches().filter(x => x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  }
  function clearRecentSearches() { localStorage.removeItem(RECENT_KEY); renderDiscovery(); }

  // ─── DATA HELPERS ──────────────────────────────────────────
  async function fetchTrendingHashtags(limit = 10) {
    // Aggregate from posts.tags client-side (swap for an RPC/hashtags table if you have one)
    const { data, error } = await window.sb.from('posts').select('tags').not('tags', 'is', null).limit(500);
    if (error || !data) return [];
    const counts = {};
    data.forEach(p => (p.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, limit).map(([tag,count]) => ({ tag, count }));
  }

  async function fetchSuggestedUsers(limit = 6) {
    const { data, error } = await window.sb.from('profiles').select('id,username,display_name,avatar_url,verified_status').limit(limit);
    return error ? [] : (data || []);
  }

  async function fetchTrendingPosts(limit = 5) {
    const { data, error } = await window.sb.from('posts')
      .select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .order('views', { ascending: false }).limit(limit);
    return error ? [] : (data || []);
  }

  async function fetchTrendingMarket(limit = 6) {
    const { data } = await window.ListingsAPI.getListings({ status: 'active', order_by: 'views_count', limit });
    return data || [];
  }

  async function searchAll(q) {
    const like = `%${q}%`;
    const [postsRes, usersRes, marketRes] = await Promise.all([
      window.sb.from('posts').select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
        .or(`title.ilike.${like},content.ilike.${like}`).limit(30),
      window.sb.from('profiles').select('id,username,display_name,avatar_url,verified_status,bio')
        .or(`username.ilike.${like},display_name.ilike.${like}`).limit(20),
      window.ListingsAPI.getListings({ search: q, limit: 20 }).catch(() => ({ data: [] })),
    ]);
    const posts = postsRes.data || [];
    const users = usersRes.data || [];
    const market = marketRes.data || [];
    const hashtags = Array.from(new Set(posts.flatMap(p => p.tags || []).filter(t => t.toLowerCase().includes(q.toLowerCase()))));
    return { posts, users, market, hashtags };
  }

  async function searchHashtag(tag, sort) {
    const { data, error } = await window.sb.from('posts')
      .select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .contains('tags', [tag])
      .order(sort === 'latest' ? 'created_at' : 'views', { ascending: false })
      .limit(60);
    return error ? [] : (data || []);
  }

  // ─── RENDER: SQUARE GRID (hashtag mode + photos tab) ───────
  function squareForPost(p) {
    const mediaType = p.media_type || p.mediaType;
    const mediaUrl = p.media_url || p.mediaUrl;
    let inner;
    if (mediaType === 'video' && mediaUrl) {
      const ytMatch = mediaUrl.match(/(?:embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const thumb = ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : mediaUrl;
      inner = ytMatch
        ? `<img src="${thumb}" loading="lazy">`
        : `<video src="${mediaUrl}" muted></video>`;
      inner += `<span class="video-flag"><svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>`;
    } else if (mediaUrl) {
      inner = `<img src="${mediaUrl}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'square-text-preview\\' style=\\'background:#7C3AED\\'>${escapeHtml(p.title||'').replace(/'/g,"\\'")}</div>'">`;
    } else {
      const hue = Math.abs((p.id||'').toString().split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % 360;
      inner = `<div class="square-text-preview" style="background:linear-gradient(135deg,hsl(${hue},60%,35%),hsl(${(hue+40)%360},60%,25%))">${escapeHtml((p.title||p.content||'').slice(0,80))}</div>`;
    }
    return `<div class="square-item" onclick="window.location.href='index.html?post=${p.id}'">${inner}</div>`;
  }

  // ─── DISCOVERY (empty search state) ────────────────────────
  async function renderDiscovery() {
    const c = document.getElementById('resultsContainer');
    c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted);">Loading…</div>`;

    const [hashtags, users, posts, market] = await Promise.all([
      fetchTrendingHashtags(4), fetchSuggestedUsers(6), fetchTrendingPosts(5), fetchTrendingMarket(6)
    ]);
    const recent = getRecentSearches();

    let html = '';

    if (recent.length) {
      html += `<div class="discovery-section"><h3>🕒 Recent Searches</h3>` +
        recent.map(r => `<div class="recent-search-row" onclick="Search.runSearch('${escapeHtml(r).replace(/'/g,"\\'")}')"><span>${escapeHtml(r)}</span><span style="color:var(--muted2);">×</span></div>`).join('') +
        `</div>`;
    }

    html += `<div class="discovery-section"><h3>🔥 Trending</h3>` +
      hashtags.map(h => `<div class="hashtag-row" onclick="window.Hashtags.goToHashtag('${escapeHtml(h.tag)}')"><span class="tag-name">#${escapeHtml(h.tag)}</span><span class="tag-count">${fmtNum(h.count)} posts</span></div>`).join('') +
      `</div>`;

    if (users.length) {
      html += `<div class="discovery-section"><h3>👥 Suggested Users</h3><div style="display:flex;gap:12px;overflow-x:auto;">` +
        users.map(u => `<div style="text-align:center;flex-shrink:0;cursor:pointer;width:70px;" onclick="window.location.href='profile.html?uid=${u.id}'">
          <img src="${u.avatar_url||''}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;background:var(--bg4);" onerror="this.style.display='none'">
          <div style="font-size:11px;font-weight:600;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(u.display_name||u.username)}</div>
        </div>`).join('') + `</div></div>`;
    }

    if (posts.length) {
      html += `<div class="discovery-section"><h3>📈 Trending Posts</h3>` +
        posts.map(p => window.renderListingCard ? '' : '').join('') + // placeholder if you have a post-card renderer
        posts.map(p => `<div style="padding:10px 0;border-bottom:1px solid var(--brd);cursor:pointer;" onclick="window.location.href='index.html?post=${p.id}'">
          <div style="font-weight:700;font-size:14px;">${escapeHtml(p.title||'')}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">${escapeHtml((p.profiles&&p.profiles.display_name)||'')} · ${fmtNum(p.views)} views</div>
        </div>`).join('') + `</div>`;
    }

    if (market.length) {
      html += `<div class="discovery-section"><h3>🛍 Trending Marketplace</h3><div style="display:flex;gap:10px;overflow-x:auto;">` +
        market.map(m => `<div style="flex-shrink:0;width:130px;cursor:pointer;">
          <div style="width:130px;height:130px;border-radius:12px;overflow:hidden;background:var(--bg4);">
            <img src="${(m.images&&m.images[0]&&m.images[0].url)||''}" style="width:100%;height:100%;object-fit:cover;">
          </div>
          <div style="font-size:12px;font-weight:700;margin-top:4px;">₦${Number(m.price).toLocaleString()}</div>
        </div>`).join('') + `</div></div>`;
    }

    c.innerHTML = html || `<div style="text-align:center;padding:40px;color:var(--muted);">Nothing to discover yet.</div>`;
  }

  // ─── LIVE SEARCH RESULTS ────────────────────────────────────
  async function renderSearchResults(q) {
    const c = document.getElementById('resultsContainer');
    c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted);">Searching…</div>`;
    const { posts, users, market, hashtags } = await searchAll(q);

    if (currentTab === 'users') {
      c.innerHTML = users.length ? users.map(userRowHtml).join('') : emptyState('No users found', `No users match "${escapeHtml(q)}"`);
      return;
    }
    if (currentTab === 'videos') {
      const vids = posts.filter(p => (p.media_type||p.mediaType) === 'video');
      c.innerHTML = vids.length ? `<div class="square-grid">${vids.map(squareForPost).join('')}</div>` : emptyState('No videos found');
      return;
    }
    if (currentTab === 'photos') {
      const pics = posts.filter(p => (p.media_type||p.mediaType) === 'image');
      c.innerHTML = pics.length ? `<div class="square-grid">${pics.map(squareForPost).join('')}</div>` : emptyState('No photos found');
      return;
    }
    if (currentTab === 'market') {
      c.innerHTML = market.length ? `<div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${market.map(window.renderListingCard).join('')}</div>` : emptyState('No listings found');
      return;
    }
    if (currentTab === 'hashtags') {
      c.innerHTML = hashtags.length
        ? hashtags.map(t => `<div class="hashtag-row" onclick="window.Hashtags.goToHashtag('${escapeHtml(t)}')"><span class="tag-name">#${escapeHtml(t)}</span></div>`).join('')
        : emptyState('No hashtags found');
      return;
    }
    if (currentTab === 'sounds') { renderSounds(); return; }

    // TOP — mixed feed
    let html = '';
    posts.slice(0, 6).forEach(p => {
      html += `<div style="padding:12px 0;border-bottom:1px solid var(--brd);cursor:pointer;" onclick="window.location.href='index.html?post=${p.id}'">
        <div style="font-weight:700;">${escapeHtml(p.title||'')}</div>
        <div style="font-size:13px;color:var(--muted);margin-top:2px;">${escapeHtml((p.content||'').slice(0,90))}</div>
      </div>`;
    });
    if (users.length) {
      html += users.slice(0, 3).map(userRowHtml).join('');
    }
    if (market.length) {
      html += market.slice(0, 3).map(m => `<div style="padding:10px 0;border-bottom:1px solid var(--brd);cursor:pointer;">🛍 ${escapeHtml(m.title)} — ₦${Number(m.price).toLocaleString()}</div>`).join('');
    }
    if (hashtags.length) {
      html += hashtags.slice(0, 3).map(t => `<div class="hashtag-row" onclick="window.Hashtags.goToHashtag('${escapeHtml(t)}')">#${escapeHtml(t)}</div>`).join('');
    }
    c.innerHTML = html || emptyState('No results found', `We couldn't find anything for "${escapeHtml(q)}"`);
  }

  function userRowHtml(u) {
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--brd);cursor:pointer;" onclick="window.location.href='profile.html?uid=${u.id}'">
      <img src="${u.avatar_url||''}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;background:var(--bg4);" onerror="this.style.display='none'">
      <div><div style="font-weight:700;">${escapeHtml(u.display_name||u.username||'')}</div><div style="font-size:12px;color:var(--muted);">@${escapeHtml(u.username||'')}</div></div>
    </div>`;
  }

  function emptyState(title, sub) {
    return `<div style="text-align:center;padding:50px 20px;color:var(--muted);"><h3 style="color:var(--text);margin-bottom:6px;">${escapeHtml(title)}</h3><p style="font-size:13px;">${escapeHtml(sub||'')}</p></div>`;
  }

  function renderSounds() {
    document.getElementById('resultsContainer').innerHTML = `
      <div class="sounds-empty">
        <div style="font-size:48px;">🎵</div>
        <h3 style="font-weight:800;">Sounds</h3>
        <div style="font-weight:700;color:var(--muted);">Coming Soon</div>
        <p style="font-size:13px;color:var(--muted);max-width:280px;">Soon you'll be able to discover trending sounds and audio used in videos on FreeUpper.</p>
      </div>`;
  }

  // ─── HASHTAG MODE ───────────────────────────────────────────
  async function enterHashtagMode(tag) {
    hashtagMode = true;
    currentHashtag = tag;
    document.getElementById('searchTabs').style.display = 'none';
    document.getElementById('hashtagHeader').style.display = 'block';
    document.getElementById('hashtagTitle').textContent = '#' + tag;
    document.getElementById('searchInput').value = '';
    await loadHashtagResults();
  }

  async function loadHashtagResults() {
    const posts = await searchHashtag(currentHashtag, hashtagSort);
    document.getElementById('hashtagCount').textContent = `${fmtNum(posts.length)} Posts`;
    document.getElementById('resultsContainer').innerHTML = posts.length
      ? `<div class="square-grid">${posts.map(squareForPost).join('')}</div>`
      : emptyState('No posts yet', `Be the first to post with #${escapeHtml(currentHashtag)}`);
  }

  function setHashtagSort(sort) {
    hashtagSort = sort;
    document.querySelectorAll('#hashtagHeader .search-tab').forEach(t => t.classList.toggle('active', t.dataset.sort === sort));
    loadHashtagResults();
  }

  function exitHashtagMode() {
    hashtagMode = false;
    currentHashtag = '';
    document.getElementById('searchTabs').style.display = 'flex';
    document.getElementById('hashtagHeader').style.display = 'none';
    history.replaceState({}, '', 'search.html');
    renderDiscovery();
  }

  // ─── PUBLIC CONTROLS ────────────────────────────────────────
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#searchTabs .search-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (tab === 'sounds') { renderSounds(); return; }
    if (currentQuery) renderSearchResults(currentQuery); else renderDiscovery();
  }

  function onQueryInput(val) {
    currentQuery = val.trim();
    document.getElementById('clearBtn').classList.toggle('show', !!currentQuery);
    clearTimeout(searchDebounce);
    if (!currentQuery) { renderDiscovery(); return; }
    searchDebounce = setTimeout(() => {
      addRecentSearch(currentQuery);
      renderSearchResults(currentQuery);
    }, 350);
  }

  function runSearch(q) {
    document.getElementById('searchInput').value = q;
    onQueryInput(q);
  }

  function onFocus() { if (!currentQuery) renderDiscovery(); }

  function clear() {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearBtn').classList.remove('show');
    currentQuery = '';
    renderDiscovery();
  }

  window.Search = { switchTab, onQueryInput, onFocus, clear, runSearch, exitHashtagMode, setHashtagSort, clearRecentSearches };

  // ─── INIT ───────────────────────────────────────────────────
  function init() {
    const params = new URLSearchParams(window.location.search);
    const hashtagParam = params.get('hashtag');
    if (hashtagParam) {
      enterHashtagMode(hashtagParam);
    } else {
      renderDiscovery();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
