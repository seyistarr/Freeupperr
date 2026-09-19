// ============================================================
// search.js — FreeUpper discovery + live search + infinite scroll
// Rebuilt to match exact target UI/UX. SVG-only icons, 3D fire icon.
//
// NOTE ON DELETED POSTS:
//   All `.from('posts')` queries now filter with `.is('deleted_at', null)`.
//   If your schema soft-deletes via a `status` column instead, swap every
//   `.is('deleted_at', null)` for `.neq('status', 'deleted')` (or `.eq('is_deleted', false)`).
//   Search for "SOFT-DELETE FILTER" comments below to find them all.
// ============================================================
(function () {
  'use strict';

  const RECENT_KEY = 'freeupper_recent_searches';
  const PAGE_SIZE = 30;

  let currentTab = 'top';
  let currentQuery = '';
  let searchDebounce = null;
  let hashtagMode = false;
  let currentHashtag = '';
  let hashtagSort = 'top';   // 'top' | 'latest' (used only by Top subtab)
  let hashtagView = 'top';   // 'top' | 'photos' | 'videos'
  let followingSet = new Set();
  let followerSet = new Set();
  let followSetsLoaded = false;

  const paging = {
    top:      { offset: 0, hasMore: true, cache: null, scrollY: 0 },
    users:    { offset: 0, hasMore: true, cache: null, scrollY: 0 },
    videos:   { offset: 0, hasMore: true, cache: null, scrollY: 0 },
    photos:   { offset: 0, hasMore: true, cache: null, scrollY: 0 },
    market:   { offset: 0, hasMore: true, cache: null, scrollY: 0 },
    hashtags: { offset: 0, hasMore: true, cache: null, scrollY: 0 }
  };

  let loadingMore = false;
  let observer = null;

  // ─── ICONS ────────────────────────────────────────────────
  const ICON = {
    search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>',
    photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    market: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    hashtag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><line x1="9" y1="3" x2="6" y2="21"/><line x1="18" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="2.5" y1="15" x2="20.5" y2="15"/></svg>',
    trendUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    chevDown: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    chevRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    heartOutline: '<svg viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    clock: '<svg class="clk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    // 3D fire — layered gradient flame for depth
    fire: `<svg viewBox="0 0 24 24" width="20" height="20">
      <defs>
        <linearGradient id="fireOuter" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="#B91C1C"/><stop offset="45%" stop-color="#F97316"/><stop offset="100%" stop-color="#FDE047"/>
        </linearGradient>
        <linearGradient id="fireInner" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="#F97316"/><stop offset="60%" stop-color="#FACC15"/><stop offset="100%" stop-color="#FEF9C3"/>
        </linearGradient>
      </defs>
      <path d="M12 2c1 3-2 4-2 7a3 3 0 1 0 6 0c0-1-1-2-1-3 2 1 4 4 4 7.5A6.5 6.5 0 0 1 12.5 20 6.5 6.5 0 0 1 6 13.5C6 8 10 5 12 2z" fill="url(#fireOuter)" style="filter:drop-shadow(0 2px 3px rgba(180,60,10,.35));"/>
      <path d="M12.5 9c.6 1.4-.8 2-.8 3.4a1.8 1.8 0 1 0 3.6 0c0-.7-.4-1.1-.4-1.7 1 .7 1.7 1.9 1.7 3.2A3.9 3.9 0 0 1 12.7 18a3.9 3.9 0 0 1-3.9-3.9c0-2.6 2.2-3.7 3.7-5.1z" fill="url(#fireInner)"/>
    </svg>`
  };

  function badgeHTML(status) {
    if (!status || status === 'none' || status === 'pending') return '';
    return `<span class="verified-badge">${ICON.check}</span>`;
  }

  // ─── HELPERS ──────────────────────────────────────────────
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function fmtNum(n) { n = n || 0; if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M'; if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K'; return String(n); }
  function timeAgo(iso) { return window.timeAgo ? window.timeAgo(iso) : ''; }
  function getCurrentUser() { return window.AuthUser && window.AuthUser.getCurrentUser ? window.AuthUser.getCurrentUser() : { id: 'guest', isLoggedIn: false }; }
  function getThumb(mediaUrl) {
    const ytMatch = (mediaUrl || '').match(/(?:embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : mediaUrl;
  }
  function profileIdOf(profile) { return (profile && profile.id) ? profile.id : ''; }
  function openProfileSafe(e, id) {
    if (!id) return;
    e.stopPropagation();
    if (window.Router && window.Router.openProfile) window.Router.openProfile(id);
  }
  window._searchOpenProfile = openProfileSafe;

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
      if (btn) {
        btn.textContent = relLabel(state);
        // Correctly strip only the state class, never the base .rel-btn
        btn.classList.remove('rel-self', 'rel-friends', 'rel-following', 'rel-follow-back', 'rel-follow');
        btn.classList.add('rel-' + state);
      }
      if (window.showToast) window.showToast(state === 'friends' ? 'You are now friends' : (currently ? 'Unfollowed' : 'Following'));
    } catch (err) {
      if (window.showToast) window.showToast(err.message, 'r');
    }
  }
  window._searchToggleFollow = function (e, userId) { e.stopPropagation(); toggleFollowUser(userId, e.currentTarget); };

  // ─── DATA HELPERS ──────────────────────────────────────────────
  async function fetchTrendingHashtags(limit = 10) {
    if (window.Hashtags && typeof window.Hashtags.fetchTrendingHashtags === 'function') {
      return window.Hashtags.fetchTrendingHashtags(limit);
    }
    // SOFT-DELETE FILTER
    const { data, error } = await window.sb.from('posts').select('tags').is('deleted_at', null).not('tags', 'is', null).limit(500);
    if (error || !data) return [];
    const counts = {};
    data.forEach(p => (p.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, limit).map(([tag,count]) => ({ tag, count }));
  }
  async function fetchSuggestedUsers(limit = 6) {
    const { data, error } = await window.sb.from('profiles').select('id,username,display_name,avatar_url,verified_status').limit(limit);
    return error ? [] : (data || []);
  }
  async function fetchTrendingPosts(limit = 3) {
    // SOFT-DELETE FILTER
    const { data, error } = await window.sb.from('posts')
      .select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .is('deleted_at', null)
      .order('views', { ascending: false })
      .limit(limit);
    return error ? [] : (data || []);
  }
  async function fetchTrendingVideos(limit = 10) {
    // SOFT-DELETE FILTER
    const { data, error } = await window.sb.from('posts')
      .select('id,title,media_url,media_type,views')
      .is('deleted_at', null)
      .eq('media_type', 'video')
      .order('views', { ascending: false })
      .limit(limit);
    return error ? [] : (data || []);
  }
  async function fetchTrendingPhotos(limit = 9) {
    // SOFT-DELETE FILTER
    const { data, error } = await window.sb.from('posts')
      .select('id,title,media_url,media_type,views')
      .is('deleted_at', null)
      .eq('media_type', 'image')
      .order('views', { ascending: false })
      .limit(limit);
    return error ? [] : (data || []);
  }
  async function fetchTrendingMarket(limit = 6) {
    const { data } = await window.ListingsAPI.getListings({ status: 'active', order_by: 'views_count', limit });
    return data || [];
  }

  async function searchAll(q, offset = 0) {
    const like = `%${q}%`;
    const [postsRes, usersRes, marketRes] = await Promise.all([
      // SOFT-DELETE FILTER
      window.sb.from('posts').select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
        .is('deleted_at', null)
        .or(`title.ilike.${like},content.ilike.${like}`)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
      window.sb.from('profiles').select('id,username,display_name,avatar_url,verified_status,bio')
        .or(`username.ilike.${like},display_name.ilike.${like}`).range(offset, offset + PAGE_SIZE - 1),
      window.ListingsAPI.getListings({ search: q, limit: PAGE_SIZE, offset }).catch(() => ({ data: [] })),
    ]);
    const posts = postsRes.data || [];
    const users = usersRes.data || [];
    const market = marketRes.data || [];
    const hashtags = Array.from(new Set(posts.flatMap(p => p.tags || []).filter(t => t.toLowerCase().includes(q.toLowerCase()))));
    return { posts, users, market, hashtags };
  }
  async function searchUsers(q, offset = 0) {
    const like = `%${q}%`;
    const { data, error } = await window.sb.from('profiles').select('id,username,display_name,avatar_url,verified_status,bio')
      .or(`username.ilike.${like},display_name.ilike.${like}`).range(offset, offset + PAGE_SIZE - 1);
    return error ? [] : (data || []);
  }
  async function searchVideos(q, offset = 0) {
    const like = `%${q}%`;
    // SOFT-DELETE FILTER
    const { data, error } = await window.sb.from('posts').select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .is('deleted_at', null)
      .eq('media_type', 'video')
      .or(`title.ilike.${like},content.ilike.${like}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    return error ? [] : (data || []);
  }
  async function searchPhotos(q, offset = 0) {
    const like = `%${q}%`;
    // SOFT-DELETE FILTER
    const { data, error } = await window.sb.from('posts').select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .is('deleted_at', null)
      .eq('media_type', 'image')
      .or(`title.ilike.${like},content.ilike.${like}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    return error ? [] : (data || []);
  }
  async function searchListings(q, offset = 0) {
    const { data } = await window.ListingsAPI.getListings({ search: q, limit: PAGE_SIZE, offset });
    return data || [];
  }
  async function searchHashtagsOnly(q, offset = 0) {
    if (window.Hashtags && typeof window.Hashtags.searchHashtags === 'function') {
      const results = await window.Hashtags.searchHashtags(q, 50);
      return results.slice(offset, offset + PAGE_SIZE).map(r => r.tag);
    }
    // SOFT-DELETE FILTER
    const { data, error } = await window.sb.from('posts').select('tags')
      .is('deleted_at', null)
      .contains('tags', [q])
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !data) return [];
    const allTags = data.flatMap(p => p.tags || []).filter(t => t.toLowerCase().includes(q.toLowerCase()));
    return [...new Set(allTags)];
  }

  async function searchHashtagPosts(tag, sort, offset = 0) {
    if (window.Hashtags && typeof window.Hashtags.fetchHashtagPostIds === 'function') {
      const postIds = await window.Hashtags.fetchHashtagPostIds(tag);
      if (!postIds.length) return [];
      // SOFT-DELETE FILTER
      const { data, error } = await window.sb
        .from('posts')
        .select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
        .is('deleted_at', null)
        .in('id', postIds)
        .order(sort === 'latest' ? 'created_at' : 'views', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      return error ? [] : (data || []);
    }
    // SOFT-DELETE FILTER
    const { data, error } = await window.sb.from('posts').select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .is('deleted_at', null)
      .contains('tags', [tag])
      .order(sort === 'latest' ? 'created_at' : 'views', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    return error ? [] : (data || []);
  }

  async function getHashtagCount(tag) {
    if (window.Hashtags && typeof window.Hashtags.fetchHashtagPostIds === 'function') {
      const postIds = await window.Hashtags.fetchHashtagPostIds(tag);
      return postIds.length;
    }
    // SOFT-DELETE FILTER
    const { count, error } = await window.sb.from('posts')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .contains('tags', [tag]);
    return error ? 0 : (count || 0);
  }

  // ─── CARD RENDERERS ──────────────────────────────────────
  function renderSquareGrid(posts, withPage) {
    if (!posts || posts.length === 0) return '';
    return `<div class="sq-grid">${posts.map(p => squareForPost(p, withPage)).join('')}</div>`;
  }
  function squareForPost(p, withPage) {
    const mediaType = p.media_type || p.mediaType;
    const mediaUrl = p.media_url || p.mediaUrl;
    const media = Array.isArray(p.media) ? p.media : [];
    let inner;
    if (mediaUrl) {
      const thumb = mediaType === 'video' ? getThumb(mediaUrl) : mediaUrl;
      inner = `<img src="${thumb}" loading="lazy" draggable="false" onerror="this.parentElement.innerHTML='<div class=\\'sq-text-preview\\' style=\\'background:#7C3AED\\'>${escapeHtml(p.title||'').replace(/'/g,"\\'")}</div>'">`;
    } else {
      const hue = Math.abs((String(p.id)||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % 360;
      inner = `<div class="sq-text-preview" style="background:linear-gradient(135deg,hsl(${hue},60%,35%),hsl(${(hue+40)%360},60%,25%))">${escapeHtml((p.title||p.content||'').slice(0,80))}</div>`;
    }
    if (withPage && media.length > 1) inner += `<span class="page-badge">1/${media.length}</span>`;
    // Views badge instead of likes
    inner += `<span class="heart-badge">${ICON.eye}${fmtNum(p.views)}</span>`;
    return `<div class="sq-item" onclick="window.Router.openPostById('${p.id}','${mediaType||''}')">${inner}</div>`;
  }

  function vidCardHtml(p) {
    const profile = p.profiles || p.profile || {};
    const author = window.getAuthorFromProfile ? window.getAuthorFromProfile(profile) : { name: profile.display_name || 'Anonymous', avatar: profile.avatar_url || '', verified_status: profile.verified_status || 'none' };
    const mediaType = p.media_type || p.mediaType;
    const mediaUrl = p.media_url || p.mediaUrl;
    const thumb = getThumb(mediaUrl);
    const pid = profileIdOf(profile);
    return `<div class="vid-card" onclick="window.Router.openPostById('${p.id}','${mediaType||''}')">
      <div class="thumb">
        <img src="${thumb||''}" loading="lazy">
        ${p.duration ? `<span class="dur">${p.duration}</span>` : ''}
        <span class="play-c">${ICON.play}</span>
      </div>
      <div class="title">${escapeHtml(p.title||'')}</div>
      <div class="author" onclick="_searchOpenProfile(event,'${pid}')"><img src="${author.avatar||''}" onerror="this.style.display='none'"><span>${escapeHtml(author.name)}</span>${badgeHTML(author.verified_status)}</div>
      <div class="views">${fmtNum(p.views)} views</div>
    </div>`;
  }

  function pcardHtml(p) {
    const profile = p.profiles || p.profile || {};
    const author = window.getAuthorFromProfile ? window.getAuthorFromProfile(profile) : { name: profile.display_name || 'Anonymous', avatar: profile.avatar_url || '', verified_status: profile.verified_status || 'none' };
    const mediaType = p.media_type || p.mediaType;
    const mediaUrl = p.media_url || p.mediaUrl;
    const thumb = mediaType === 'video' ? getThumb(mediaUrl) : mediaUrl;
    const pid = profileIdOf(profile);
    return `<div class="pcard" onclick="window.Router.openPostById('${p.id}','${mediaType||''}')">
      <div class="head" onclick="_searchOpenProfile(event,'${pid}')">
        <img src="${author.avatar||''}" onerror="this.style.display='none'">
        <span class="nm">${escapeHtml(author.name)}</span>${badgeHTML(author.verified_status)}
      </div>
      <div class="media">
        <img src="${thumb||''}" loading="lazy">
        <div class="stats">
          <span>${ICON.heart}${fmtNum(p.like_count || p.likes)}</span>
          <span>${ICON.play}${fmtNum(p.views)}</span>
        </div>
      </div>
    </div>`;
  }

  function trendingPostCard(p) {
    const profile = p.profiles || p.profile || {};
    const author = window.getAuthorFromProfile ? window.getAuthorFromProfile(profile) : { name: profile.display_name || 'Anonymous', avatar: profile.avatar_url || '', verified_status: profile.verified_status || 'none' };
    const mediaType = p.media_type || p.mediaType;
    const mediaUrl = p.media_url || p.mediaUrl;
    const media = Array.isArray(p.media) ? p.media : [];
    const isVideo = mediaType === 'video' && mediaUrl;
    const thumb = getThumb(mediaUrl);
    const pid = profileIdOf(profile);
    let mediaHtml = '';
    if (mediaUrl) {
      mediaHtml = `<div class="media" onclick="event.stopPropagation()">
        <img src="${thumb||''}" loading="lazy">
        ${media.length > 1 ? `<span class="page-badge">1/${media.length}</span>` : ''}
        ${isVideo ? `<span class="play-c">${ICON.play}</span><span class="stat-badge">${ICON.play}${fmtNum(p.views)}</span>` : `<span class="stat-badge">${ICON.heart}${fmtNum(p.like_count || p.likes)}</span>`}
      </div>`;
    }
    return `<article class="tpost" onclick="window.Router.openPostById('${p.id}','${mediaType||''}')">
      <div class="head">
        <img src="${author.avatar||''}" onerror="this.style.display='none'" onclick="_searchOpenProfile(event,'${pid}')">
        <div class="meta" onclick="_searchOpenProfile(event,'${pid}')">
          <div class="nm">${escapeHtml(author.name)}${badgeHTML(author.verified_status)}</div>
          <div class="time">${timeAgo(p.created_at || p.timestamp)}</div>
        </div>
      </div>
      ${p.title ? `<div class="cap">${escapeHtml(p.title)}</div>` : ''}
      ${mediaHtml}
    </article>`;
  }

  function userRowHtml(u, ringed) {
    const state = relationshipState(u.id);
    const btn = state === 'self' ? '' : `<button class="rel-btn inline rel-${state}" onclick="_searchToggleFollow(event,'${u.id}')">${relLabel(state)}</button>`;
    const showBadge = u.verified_status && u.verified_status !== 'none' && u.verified_status !== 'pending';
    return `<div class="user-row${ringed?' ringed':''}" onclick="window.Router.openProfile('${u.id}')">
      <div class="av"><img src="${u.avatar_url||''}" onerror="this.style.display='none'">${showBadge?`<span class="vb">${ICON.check}</span>`:''}</div>
      <div class="info">
        <div class="name-line">${escapeHtml(u.display_name||u.username||'')}</div>
        <div class="handle">@${escapeHtml(u.username||'')}</div>
        ${u.bio ? `<div class="bio">${escapeHtml(u.bio)}</div>` : ''}
      </div>
      <div class="actions">
        ${btn}
      </div>
    </div>`;
  }

  function classifyCondition(cond) {
    const c = (cond || '').toLowerCase();
    if (c === 'new') return 'cond-new';
    if (c.includes('like') || c.includes('excellent')) return 'cond-good';
    return 'cond-fair';
  }
  function marketCardHtml(m) {
    const img = (m.images && m.images[0] && m.images[0].url) || '';
    return `<div class="market-card" onclick="window.Router.openListing('${m.id}')">
      <div class="img-wrap">
        <img src="${img}" loading="lazy">
        ${m.featured ? `<span class="featured">Featured</span>` : ''}
        <span class="fav" onclick="event.stopPropagation()">${ICON.heartOutline}</span>
      </div>
      <div class="title">${escapeHtml(m.title||'')}</div>
      <div class="price">₦${Number(m.price||0).toLocaleString()}</div>
      <div class="meta-row">
        <span class="loc">${ICON.pin}${escapeHtml(m.location||'')}</span>
        ${m.condition ? `<span class="cond ${classifyCondition(m.condition)}">${escapeHtml(m.condition)}</span>` : ''}
      </div>
    </div>`;
  }

  function emptyState(title, sub) {
    return `<div class="empty-state"><div class="ic">${ICON.search}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub||'')}</p></div>`;
  }

  // ─── HEADER VISIBILITY ────────────────────────────────────
  function showNormalHeader(show) {
    document.getElementById('normalHeader').style.display = show ? 'block' : 'none';
  }
  function showTabs(show) {
    document.getElementById('searchTabs').classList.toggle('visible', show);
  }
  function renderTabsBar() {
    // Sounds tab removed. Text-only tab bar (no pill icon).
    const defs = [
      { id: 'top', label: 'Top' },
      { id: 'users', label: 'Users' },
      { id: 'videos', label: 'Videos' },
      { id: 'photos', label: 'Photos' },
      { id: 'market', label: 'Market' },
      { id: 'hashtags', label: 'Hashtags' },
    ];
    document.getElementById('searchTabs').innerHTML = defs.map(t =>
      `<button class="tab${t.id===currentTab?' active':''}" data-tab="${t.id}" onclick="Search.switchTab('${t.id}')">
        <span>${t.label}</span>
      </button>`
    ).join('');
  }

  // ─── SENTINEL & OBSERVER ──────────────────────────────────
  function createSentinel() {
    if (document.getElementById('searchSentinel')) return;
    const sentinel = document.createElement('div');
    sentinel.id = 'searchSentinel';
    const container = document.getElementById('resultsContainer');
    if (container) container.appendChild(sentinel);
  }
  function showLoadingMore(show) {
    let el = document.getElementById('loadingMore');
    if (show) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'loadingMore';
        el.className = 'load-more-row muted';
        el.innerHTML = `<span class="spin-icon"></span><span>Loading more</span>`;
        const container = document.getElementById('resultsContainer');
        if (container) container.appendChild(el);
      }
      el.style.display = 'flex';
    } else if (el) el.style.display = 'none';
  }
  function showLoadMoreIdle() {
    document.getElementById('loadingMore')?.remove();
    document.getElementById('endResults')?.remove();
    if (document.getElementById('loadMoreIdle')) return;
    let el = document.createElement('div');
    el.id = 'loadMoreIdle';
    el.className = 'load-more-row';
    el.innerHTML = `<span class="dashed"></span><span>Load more</span>`;
    document.getElementById('resultsContainer')?.appendChild(el);
  }
  function showEndResults() {
    document.getElementById('loadingMore')?.remove();
    document.getElementById('loadMoreIdle')?.remove();
    let el = document.getElementById('endResults');
    if (!el) {
      el = document.createElement('div');
      el.id = 'endResults';
      el.className = 'load-more-row muted';
      el.textContent = "You're all caught up";
      document.getElementById('resultsContainer')?.appendChild(el);
    }
    el.style.display = 'flex';
  }
  function startInfiniteScroll() {
    disconnectObserver();
    const sentinelEl = document.getElementById('searchSentinel');
    if (!sentinelEl) return;
    const scrollContainer = document.getElementById('mainScroll');
    observer = new IntersectionObserver(onReachBottom, { root: scrollContainer, rootMargin: '500px', threshold: 0 });
    observer.observe(sentinelEl);
  }
  function disconnectObserver() { if (observer) { observer.disconnect(); observer = null; } }

  async function onReachBottom(entries) {
    if (!entries[0].isIntersecting) return;
    if (loadingMore) return;
    const tabState = paging[currentTab];
    if (!tabState.hasMore) return;
    if (!currentQuery && !hashtagMode) return;
    loadingMore = true;
    showLoadingMore(true);
    if (hashtagMode) await loadHashtagResults(false);
    else await renderSearchResults(currentQuery, false);
    loadingMore = false;
  }

  function cacheCurrentTab(html) {
    if (!currentQuery && !hashtagMode) return;
    const key = hashtagMode ? 'hashtags' : currentTab;
    paging[key].cache = { query: currentQuery || currentHashtag, html: html };
  }

  // ─── DISCOVERY (default state) ─────────────────────────
  async function renderDiscovery() {
    showNormalHeader(true);
    if (!currentQuery && !hashtagMode) showTabs(false);
    disconnectObserver();
    const c = document.getElementById('resultsContainer');
    const recent = getRecentSearches();

    let recentHtml = '';
    if (recent.length) {
      recentHtml = `<div class="discovery-block">
        <div class="section-title">Recent Searches</div>
        <div class="recent-wrap">${recent.map(r => {
          const isTag = r.startsWith('#');
          const action = isTag ? `Search.openHashtag('${escapeHtml(r.slice(1)).replace(/'/g,"\\'")}')` : `Search.runSearch('${escapeHtml(r).replace(/'/g,"\\'")}')`;
          return `<div class="recent-pill">
            ${ICON.clock}
            <span onclick="${action}">${escapeHtml(r)}</span>
            <span class="x-btn" onclick="event.stopPropagation();Search.removeRecent('${escapeHtml(r).replace(/'/g,"\\'")}')"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
          </div>`;
        }).join('')}</div>
      </div>`;
    }
    c.innerHTML = recentHtml + `<div class="center-loading"><span class="spin-icon"></span>Loading</div>`;

    await loadFollowSets();
    const [hashtags, users, posts, videos, photos, market] = await Promise.all([
      fetchTrendingHashtags(4), fetchSuggestedUsers(6), fetchTrendingPosts(3),
      fetchTrendingVideos(10), fetchTrendingPhotos(9), fetchTrendingMarket(6)
    ]);

    let html = recentHtml;
    html += `<div class="discovery-block"><div class="section-title">${ICON.fire}Trending Hashtags</div>
      <div class="trend-tag-grid">${hashtags.map(h => `<div class="trend-tag-card" onclick="Search.openHashtag('${escapeHtml(h.tag)}')">
        <div class="box">${ICON.hashtag}</div><div class="name">#${escapeHtml(h.tag)}</div><div class="cnt">${fmtNum(h.count)} posts</div>
      </div>`).join('')}</div></div>`;

    if (users.length) {
      html += `<div class="discovery-block"><div class="section-title">${ICON.user}Suggested Users</div>
        <div class="sugg-scroll">${users.map(u => {
          const state = relationshipState(u.id);
          const btn = state === 'self' ? '' : `<button class="rel-btn rel-${state}" onclick="_searchToggleFollow(event,'${u.id}')">${relLabel(state)}</button>`;
          const showBadge = u.verified_status && u.verified_status !== 'none' && u.verified_status !== 'pending';
          return `<div class="sugg-card" onclick="window.Router.openProfile('${u.id}')">
            <div class="sugg-avatar"><img src="${u.avatar_url||''}" onerror="this.style.display='none'">${showBadge?`<span class="vb">${ICON.check}</span>`:''}</div>
            <div class="name">${escapeHtml(u.display_name||u.username||'')}</div>
            <div class="handle">@${escapeHtml(u.username||'')}</div>
            <div onclick="event.stopPropagation()">${btn}</div>
          </div>`;
        }).join('')}</div></div>`;
    }

    if (posts.length) html += `<div class="discovery-block"><div class="section-title">${ICON.trendUp}Trending Posts</div>${posts.map(trendingPostCard).join('')}</div>`;

    if (videos.length) {
      html += `<div class="discovery-block"><div class="section-title">${ICON.video}Trending Videos</div>
        <div class="sugg-scroll">${videos.map(v => {
          const thumb = getThumb(v.media_url);
          return `<div style="flex-shrink:0;width:120px;cursor:pointer;" onclick="window.Router.openPostById('${v.id}','video')">
            <div style="position:relative;width:120px;height:160px;border-radius:16px;overflow:hidden;background:#000;">
              <img src="${thumb||''}" style="width:100%;height:100%;object-fit:cover;">
              <span style="position:absolute;bottom:9px;left:9px;color:#fff;font-weight:700;font-size:11.5px;text-shadow:0 1px 4px rgba(0,0,0,.7);">${fmtNum(v.views)} views</span>
            </div>
          </div>`;
        }).join('')}</div></div>`;
    }

    if (photos.length) html += `<div class="discovery-block"><div class="section-title">${ICON.photo}Trending Photos</div>${renderSquareGrid(photos, false)}</div>`;

    if (market.length) html += `<div class="discovery-block"><div class="section-title">${ICON.market}Trending Marketplace</div>
      <div class="sugg-scroll">${market.map(m => `<div style="flex-shrink:0;width:132px;cursor:pointer;" onclick="window.Router.openListing('${m.id}')">
        <div style="width:132px;height:132px;border-radius:16px;overflow:hidden;background:#eee;"><img src="${(m.images&&m.images[0]&&m.images[0].url)||''}" style="width:100%;height:100%;object-fit:cover;"></div>
        <div style="font-size:14px;font-weight:800;margin-top:7px;color:var(--p);">₦${Number(m.price||0).toLocaleString()}</div>
        <div style="font-size:12px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.title||'')}</div>
      </div>`).join('')}</div></div>`;

    c.innerHTML = html || (recentHtml + emptyState('Nothing to discover yet'));
  }

  // ─── LIVE SEARCH ─────────────────────────────────
  async function renderSearchResults(q, replace = true) {
    showNormalHeader(true);
    showTabs(true);
    renderTabsBar();
    const container = document.getElementById('resultsContainer');
    const tabState = paging[currentTab];

    if (replace) {
      tabState.offset = 0; tabState.hasMore = true; tabState.cache = null;
      container.innerHTML = `<div class="center-loading"><span class="spin-icon"></span>Loading</div>`;
    }
    await loadFollowSets();

    let dataCount = 0;
    let html = '';
    let headHtml = '';

    if (currentTab === 'users') {
      const users = await searchUsers(q, tabState.offset);
      dataCount = users.length;
      html = users.map(u => userRowHtml(u, true)).join('') || emptyState('No users found', `No users match "${q}"`);
      if (replace) headHtml = `<div class="results-head"><h2>Users<span class="cnt">(${fmtNum(dataCount>=PAGE_SIZE?dataCount+'+':dataCount)} found)</span></h2></div>`;
    } else if (currentTab === 'videos') {
      const posts = await searchVideos(q, tabState.offset);
      dataCount = posts.length;
      html = posts.length ? `<div class="vid-grid">${posts.map(vidCardHtml).join('')}</div>` : emptyState('No videos found', `No videos match "${q}"`);
      if (replace) headHtml = `<div class="results-head"><div><h2 style="margin-bottom:2px;">Videos</h2><div class="sub">Top videos matching "${escapeHtml(q)}"</div></div></div>`;
    } else if (currentTab === 'photos') {
      const posts = await searchPhotos(q, tabState.offset);
      dataCount = posts.length;
      html = renderSquareGrid(posts, false) || emptyState('No photos found', `No photos match "${q}"`);
      if (replace) headHtml = `<div class="results-head"><h2>Photos<span class="cnt">(${fmtNum(dataCount)} found)</span></h2></div>`;
    } else if (currentTab === 'market') {
      const listings = await searchListings(q, tabState.offset);
      dataCount = listings.length;
      const cards = listings.map(marketCardHtml).join('');
      html = cards ? `<div class="market-grid">${cards}</div>` : emptyState('No listings found', `No listings match "${q}"`);
      if (replace) headHtml = `<div class="results-head"><h2>Market<span class="cnt">(${fmtNum(dataCount)} found)</span></h2></div>`;
    } else if (currentTab === 'hashtags') {
      const hashtags = await searchHashtagsOnly(q, tabState.offset);
      dataCount = hashtags.length;
      html = hashtags.map(t => `<div class="tag-row" onclick="Search.openHashtag('${escapeHtml(t)}')">
        <div class="box">${ICON.hashtag}</div><div class="info"><div class="name">#${escapeHtml(t)}</div></div><div class="chev">${ICON.chevRight}</div>
      </div>`).join('') || emptyState('No hashtags found', `No hashtags match "${q}"`);
      if (replace) headHtml = `<div class="results-head"><h2>Hashtags<span class="cnt">(${fmtNum(dataCount)} found)</span></h2></div>`;
    } else {
      const result = await searchAll(q, tabState.offset);
      dataCount = result.posts.length;
      const mixed = [];
      result.posts.forEach(p => mixed.push({ type: 'post', item: p }));
      result.users.slice(0, 4).forEach(u => mixed.push({ type: 'user', item: u }));
      result.market.slice(0, 4).forEach(m => mixed.push({ type: 'market', item: m }));
      result.hashtags.slice(0, 3).forEach(t => mixed.push({ type: 'hashtag', item: t }));
      html = mixed.map(entry => {
        if (entry.type === 'post') return trendingPostCard(entry.item);
        if (entry.type === 'user') return userRowHtml(entry.item, false);
        if (entry.type === 'market') return `<div class="market-grid" style="grid-template-columns:1fr;">${marketCardHtml(entry.item)}</div>`;
        if (entry.type === 'hashtag') return `<div class="tag-row" onclick="Search.openHashtag('${escapeHtml(entry.item)}')"><div class="box">${ICON.hashtag}</div><div class="info"><div class="name">#${escapeHtml(entry.item)}</div></div><div class="chev">${ICON.chevRight}</div></div>`;
        return '';
      }).join('');
      if (!html) html = emptyState('No results found', `We couldn't find anything for "${q}"`);
    }

    if (replace) container.innerHTML = headHtml + html;
    else container.insertAdjacentHTML('beforeend', html);

    tabState.offset += dataCount;
    tabState.hasMore = dataCount === PAGE_SIZE;
    if (replace) cacheCurrentTab(container.innerHTML);

    createSentinel();
    if (!tabState.hasMore) showEndResults(); else showLoadMoreIdle();
    startInfiniteScroll();
  }

  // ─── HASHTAG MODE ───────────────────────────────────────────
  function openHashtag(tag) {
    if (!tag) return;
    const clean = tag.replace(/^#/, '');
    history.pushState({}, '', '?tag=' + encodeURIComponent(clean));
    enterHashtagMode(clean);
  }

  function renderHashtagHeaderShell() {
    const hh = document.getElementById('hashtagHeader');
    hh.style.display = 'block';
    hh.className = 'tag-header';
    hh.innerHTML = `
      <div class="top-row">
        <button class="back" onclick="Search.exitHashtagMode()">${ICON.back}</button>
        <div class="box">${ICON.hashtag}</div>
        <div class="title-block">
          <h1>#${escapeHtml(currentHashtag)}</h1>
          <div class="cnt" id="hashtagCount"></div>
        </div>
        <div class="side-actions">
          <button class="rel-btn inline rel-follow" id="hashtagFollowBtn">Follow</button>
          <button class="icon-btn">${ICON.share}</button>
        </div>
      </div>
      <div class="subtabs" id="hashtagSubtabs">
        <button data-view="top" class="active" onclick="Search._setHashtagView('top')">${ICON.trendUp}Top</button>
        <button data-view="photos" onclick="Search._setHashtagView('photos')">${ICON.photo}Photos</button>
        <button data-view="videos" onclick="Search._setHashtagView('videos')">${ICON.video}Videos</button>
      </div>`;
  }

  async function enterHashtagMode(tag) {
    hashtagMode = true;
    currentHashtag = tag;
    hashtagView = 'top';
    hashtagSort = 'top';
    currentQuery = '';
    showNormalHeader(false);
    showTabs(false);
    disconnectObserver();
    renderHashtagHeaderShell();
    document.getElementById('searchInput').value = '';
    document.getElementById('clearBtn').classList.remove('show');

    const tabState = paging.hashtags;
    tabState.offset = 0; tabState.hasMore = true; tabState.cache = null;
    document.getElementById('resultsContainer').innerHTML = '';
    await loadHashtagResults(true);
  }

  function setHashtagView(view) {
    hashtagView = view;
    document.querySelectorAll('#hashtagSubtabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    paging.hashtags.offset = 0; paging.hashtags.hasMore = true; paging.hashtags.cache = null;
    document.getElementById('resultsContainer').innerHTML = '';
    loadHashtagResults(true);
  }

  async function loadHashtagResults(replace = true) {
    const container = document.getElementById('resultsContainer');
    const tabState = paging.hashtags;
    if (replace) { tabState.offset = 0; tabState.hasMore = true; container.innerHTML = ''; }

    const [posts, count] = await Promise.all([
      searchHashtagPosts(currentHashtag, hashtagSort, tabState.offset),
      replace ? getHashtagCount(currentHashtag) : Promise.resolve(null)
    ]);

    if (replace && count !== null) {
      const el = document.getElementById('hashtagCount');
      if (el) el.textContent = `${fmtNum(count)} posts`;
    }

    // The Photos subview no longer renders any dropdown row.
    let html;
    if (hashtagView === 'photos') {
      html = renderSquareGrid(posts.filter(p => (p.media_type||p.mediaType) !== 'video'), true);
    } else if (hashtagView === 'videos') {
      html = posts.length ? `<div class="vid-grid">${posts.filter(p=>(p.media_type||p.mediaType)==='video').map(vidCardHtml).join('')}</div>` : '';
    } else {
      html = `<div class="pcard-grid">${posts.map(pcardHtml).join('')}</div>`;
    }
    if (!html) html = emptyState('No posts yet', `Be the first to post with #${currentHashtag}`);

    if (replace) container.innerHTML = html;
    else container.insertAdjacentHTML('beforeend', html);

    tabState.offset += posts.length;
    tabState.hasMore = posts.length === PAGE_SIZE;
    if (replace) cacheCurrentTab(container.innerHTML);

    createSentinel();
    if (!tabState.hasMore) showEndResults(); else showLoadMoreIdle();
    startInfiniteScroll();
  }

  // ─── TAB SWITCHING ──────────────────────────────────────────
  function switchTab(tab) {
    const main = document.getElementById('mainScroll');
    if (main) paging[currentTab].scrollY = main.scrollTop;
    currentTab = tab;
    renderTabsBar();

    const cached = paging[tab].cache;
    if (cached && cached.query === currentQuery) {
      document.getElementById('resultsContainer').innerHTML = cached.html;
      if (main) requestAnimationFrame(() => { main.scrollTop = paging[tab].scrollY || 0; });
      createSentinel(); startInfiniteScroll();
      return;
    }

    if (currentQuery) renderSearchResults(currentQuery, true);
    else if (tab === 'hashtags') renderHashtagsTabDiscovery();
    else renderDiscovery();
  }

  async function renderHashtagsTabDiscovery() {
    showNormalHeader(true);
    showTabs(true); renderTabsBar(); disconnectObserver();
    const c = document.getElementById('resultsContainer');
    c.innerHTML = `<div class="center-loading"><span class="spin-icon"></span>Loading</div>`;
    const hashtags = await fetchTrendingHashtags(30);
    c.innerHTML = `<div class="results-head"><h2>Hashtags<span class="cnt">(${fmtNum(hashtags.length)} found)</span></h2></div>` +
      (hashtags.length
        ? hashtags.map(h => `<div class="tag-row" onclick="Search.openHashtag('${escapeHtml(h.tag)}')"><div class="box">${ICON.hashtag}</div><div class="info"><div class="name">#${escapeHtml(h.tag)}</div><div class="cnt">${fmtNum(h.count)} posts</div></div><div class="chev">${ICON.chevRight}</div></div>`).join('')
        : emptyState('No hashtags yet'));
  }

  // ─── SEARCH INPUT HANDLING ────────────────────────────────
  function onQueryInput(val) {
    const hadQuery = !!currentQuery;
    currentQuery = val.trim();
    document.getElementById('clearBtn').classList.toggle('show', !!currentQuery);
    clearTimeout(searchDebounce);
    if (!currentQuery) { disconnectObserver(); renderDiscovery(); return; }
    if (!hadQuery) { showTabs(true); renderTabsBar(); }
    searchDebounce = setTimeout(() => { addRecentSearch(currentQuery); renderSearchResults(currentQuery, true); }, 350);
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
    disconnectObserver();
    renderDiscovery();
  }
  function cancelFocus() { clear(); }

  function exitHashtagMode() {
    hashtagMode = false;
    currentHashtag = '';
    document.getElementById('hashtagHeader').style.display = 'none';
    showNormalHeader(true);
    disconnectObserver();
    history.pushState({}, '', 'search.html');
    renderDiscovery();
  }

  function setHashtagSort(sort) { /* reserved */ }

  // ─── PUBLIC API ──────────────────────────────────────────────
  window.Search = {
    switchTab, onQueryInput, onFocus, clear, runSearch,
    openHashtag, exitHashtagMode, setHashtagSort,
    _setHashtagView: setHashtagView,
    removeRecent: removeRecentSearch,
    clearAllRecent, cancelFocus
  };

  // ─── INIT ───────────────────────────────────────────────────
  function init() {
    document.getElementById('searchIcon').innerHTML = ICON.search;
    document.getElementById('clearBtn').innerHTML = ICON.close;

    const params = new URLSearchParams(window.location.search);
    const tagParam = params.get('tag') || params.get('hashtag');
    const queryParam = params.get('q');

    showTabs(false);

    if (tagParam) enterHashtagMode(tagParam);
    else if (queryParam) { document.getElementById('searchInput').value = queryParam; runSearch(queryParam); }
    else renderDiscovery();

    const main = document.getElementById('mainScroll');
    if (main) main.addEventListener('scroll', function() { if (currentQuery || hashtagMode) paging[currentTab].scrollY = main.scrollTop; });

    window.addEventListener('popstate', () => {
      const newParams = new URLSearchParams(location.search);
      const tag = newParams.get('tag');
      if (tag) enterHashtagMode(tag);
      else { hashtagMode = false; document.getElementById('hashtagHeader').style.display = 'none'; showNormalHeader(true); renderDiscovery(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
