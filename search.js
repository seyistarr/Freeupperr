// ============================================================
// search.js — FreeUpper standalone search + discovery + lightbox
// REWRITTEN — every bug from the previous revision fixed inline.
// Fixes are marked with // ★ FIX
//
// SELF-CONTAINED: does not depend on index.html's inline module.
//
// Depends on: window.sb, window.AuthUser, window.PostsAPI,
//             window.ListingsAPI, window.Hashtags, window.Router,
//             window.Mentions (optional),
//             window.getAuthorFromProfile / getVerifiedBadgeHTML.
//
// SOFT-DELETE: all `.from('posts')` queries filter `.is('deleted_at', null)`.
// RACE: `_searchReqToken` guards against stale async responses.
// ============================================================
(function () {
  'use strict';

  // ─── CONSTANTS ────────────────────────────────────────────
  const RECENT_KEY = 'freeupper_recent_searches';
  const CVK = 'freeupper_comments_visible';
  const PAGE_SIZE = 30;
  const REPLY_BATCH = 3;
  const INITIAL_COMMENT_DISPLAY = 10;
  const COMMENT_LOAD_MORE = 10;
  const COMMENT_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

  // ─── STATE ────────────────────────────────────────────────
  let currentTab = 'top';
  let currentQuery = '';
  let searchDebounce = null;
  let hashtagMode = false;
  let currentHashtag = '';
  let hashtagSort = 'top';
  let hashtagView = 'top';
  let followingSet = new Set();
  let followerSet = new Set();
  let bookmarksSet = new Set();
  let followSetsLoaded = false;
  let _searchReqToken = 0;

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

  const _postStore = new Map();
  function _rememberPost(p) { if (p && p.id) _postStore.set(p.id, p); return p; }
  function _getPost(id) { return _postStore.get(id) || null; }

  let _galleryState = { items: [], index: 0, postId: null, resumeState: null };
  let _lightboxScrollLocked = false;
  let _lightboxCommentsPostId = null;
  let _lightboxReplyTarget = null;
  let _lbFeedList = [];
  let _lbFeedIndex = -1;

  let currentCommentSort = {};
  let locallyLikedComments = new Map();
  let expandedThreads = new Map();
  let _commentsFetchToken = {};
  let lightboxCommentMedia = null;

  let pendingLikes = new Set();
  let pendingBookmarks = new Set();

  let sharePostId = null;
  let repostQuoteTargetId = null;

  let _peekPost = null;

  let ytState = {};
  let ytInfo = {};

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
    chevRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    heartOutline: '<svg viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    clock: '<svg class="clk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    fire: `<svg viewBox="0 0 24 24" width="20" height="20"><defs><linearGradient id="fireOuter" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#B91C1C"/><stop offset="45%" stop-color="#F97316"/><stop offset="100%" stop-color="#FDE047"/></linearGradient><linearGradient id="fireInner" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#F97316"/><stop offset="60%" stop-color="#FACC15"/><stop offset="100%" stop-color="#FEF9C3"/></linearGradient></defs><path d="M12 2c1 3-2 4-2 7a3 3 0 1 0 6 0c0-1-1-2-1-3 2 1 4 4 4 7.5A6.5 6.5 0 0 1 12.5 20 6.5 6.5 0 0 1 6 13.5C6 8 10 5 12 2z" fill="url(#fireOuter)"/><path d="M12.5 9c.6 1.4-.8 2-.8 3.4a1.8 1.8 0 1 0 3.6 0c0-.7-.4-1.1-.4-1.7 1 .7 1.7 1.9 1.7 3.2A3.9 3.9 0 0 1 12.7 18a3.9 3.9 0 0 1-3.9-3.9c0-2.6 2.2-3.7 3.7-5.1z" fill="url(#fireInner)"/></svg>`
    // ★ FIX: `share` key was previously referenced but never defined. Left out on
    // purpose and always use svgShare() instead, which is defined below.
  };

  // ─── SHARED HELPERS ───────────────────────────────────────
  function getCurrentUser() {
    if (window.AuthUser && window.AuthUser.getCurrentUser) return window.AuthUser.getCurrentUser();
    return { id: 'guest', isLoggedIn: false };
  }
  function escapeHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML;
  }
  function fmtNum(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    if (n < 1e9) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'b';
  }
  function formatCount(n) { return fmtNum(n); }
  function formatRelativeTime(iso) {
    if (!iso) return '';
    const now = Date.now(), then = new Date(iso).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 172800) return 'Yesterday';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function truncateName(s, n) { s = s || ''; n = n || 22; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function linkifyContent(text, mentions) {
    let html = escapeHtml(text);
    html = html.replace(/(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g, u =>
      `<a href="javascript:void(0)" style="color:var(--pl);font-weight:800;" data-extlink="${encodeURIComponent(u)}">${u}</a>`
    );
    if (window.Mentions && typeof window.Mentions.renderMentions === 'function' && mentions && mentions.length) {
      html = window.Mentions.renderMentions(html, mentions);
    }
    if (window.Hashtags && typeof window.Hashtags.hashifyHtml === 'function') {
      html = window.Hashtags.hashifyHtml(html);
    }
    return html;
  }
  function getThumb(mediaUrl) {
    const ytMatch = (mediaUrl || '').match(/(?:embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : mediaUrl;
  }
  function profileIdOf(profile) { return (profile && profile.id) ? profile.id : ''; }
  function isYouTubeUrl(url) { return !!url && (url.includes('youtube.com/embed') || url.includes('youtu.be') || url.includes('youtube.com/watch')); }
  function extractYouTubeId(url) {
    const m = (url || '').match(/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/) ||
              (url || '').match(/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/) ||
              (url || '').match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function isDuplicateKeyError(err) {
    return !!(err && err.message && /duplicate key value violates unique constraint/i.test(err.message));
  }
  function haptic(ms) { if (navigator.vibrate) navigator.vibrate(ms || 8); }

  function getAuthor(profile) {
    if (window.getAuthorFromProfile) {
      try { return window.getAuthorFromProfile(profile || {}); } catch (e) {}
    }
    return {
      id: (profile && profile.id) || '',
      name: (profile && (profile.display_name || profile.username)) || 'Anonymous',
      avatar: (profile && profile.avatar_url) || '',
      verified_status: (profile && profile.verified_status) || 'none'
    };
  }
  function badgeHTML(status) {
    if (window.getVerifiedBadgeHTML) return window.getVerifiedBadgeHTML(status);
    if (!status || status === 'none' || status === 'pending') return '';
    return `<span class="verified-badge">${ICON.check}</span>`;
  }

  function lockBodyScroll() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockBodyScroll() {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    if (!t) { console.log('[toast]', msg); return; }
    const iconEl = document.getElementById('toast-icon');
    const msgEl = document.getElementById('toast-message');
    const icons = {
      g: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
      r: '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      o: '<svg viewBox="0 0 24 24"><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="#fff" stroke="none"/></svg>',
      p: '<svg viewBox="0 0 24 24"><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="1" fill="#fff" stroke="none"/></svg>'
    };
    const valid = icons[type] ? type : 'p';
    if (msgEl) msgEl.textContent = msg;
    if (iconEl) { iconEl.className = 'fu-toast-icon t-' + valid; iconEl.innerHTML = icons[valid]; }
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function animateCountRoll(el, newText) {
    if (!el) return;
    const oldText = el.textContent;
    if (oldText === newText) return;
    el.style.position = 'relative'; el.style.display = 'inline-block'; el.style.overflow = 'hidden';
    const a = document.createElement('span');
    a.textContent = oldText; a.style.cssText = 'display:block;animation:countOut 180ms ease-out forwards;';
    const b = document.createElement('span');
    b.textContent = newText; b.style.cssText = 'display:block;position:absolute;top:0;left:0;animation:countIn 180ms ease-out forwards;';
    el.textContent = ''; el.appendChild(a); el.appendChild(b);
    setTimeout(() => { el.textContent = newText; el.style.cssText = ''; }, 190);
  }
  function spawnRipple(el, evt) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = evt && evt.clientX ? evt.clientX - rect.left : rect.width / 2;
    const y = evt && evt.clientY ? evt.clientY - rect.top : rect.height / 2;
    const r = document.createElement('span');
    r.className = 'fu-ripple';
    r.style.left = x + 'px'; r.style.top = y + 'px';
    el.style.position = el.style.position || 'relative';
    el.appendChild(r);
    setTimeout(() => r.remove(), 220);
  }
  function spawnHeartParticles(btn) {
    const wrap = btn.querySelector('.heart-icon-wrap');
    if (!wrap) return;
    const colors = ['#ff5c5c', '#ff8a8a', '#ffb3b3', '#ff3b3b', '#ff6b6b'];
    for (let i = 0; i < 5; i++) {
      const p = document.createElement('span');
      p.className = 'heart-particle';
      const angle = (Math.PI * 2 / 5) * i + Math.random() * 0.4;
      const dist = 14 + Math.random() * 8;
      p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
      p.style.background = colors[i % colors.length];
      wrap.appendChild(p);
      setTimeout(() => p.remove(), 480);
    }
  }
  function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  // ─── SVG HELPERS ─────────────────────────────────────────
  function svgComment() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'; }
  function svgCommentOff() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><line x1="3" y1="21" x2="21" y2="3" stroke="var(--danger,#DC2626)"/></svg>'; }
  function svgShare() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4z"/></svg>'; }
  function svgHeart(reacted) {
    return reacted
      ? '<svg class="heart-icon" viewBox="0 0 24 24" fill="#DC2626" stroke="#DC2626" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
      : '<svg class="heart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  }
  function svgChevronDown() { return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>'; }
  function svgChevronUp() { return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>'; }
  function svgEye() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19V10"/><path d="M12 19V5"/><path d="M20 19V14"/></svg>'; }
  function bookmarkIcon(filled) { const c = filled ? 'var(--gold)' : 'none'; return `<svg width="19" height="19" viewBox="0 0 24 24" fill="${c}" stroke="var(--gold)" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`; }
  function bookmarkIconWithCount(id, filled, count) {
    return `<span class="bookmark-badge ${filled ? 'bookmarked' : ''}" data-bookmark="${id}"><span class="bookmark-icon-wrap">${bookmarkIcon(filled)}</span><span class="bookmark-count">${formatCount(count || 0)}</span></span>`;
  }
  function repostCountBadge(post) {
    return `<span class="repost-count-badge repost-btn" data-repost-btn="${post.id}">
        <i class="ri-repeat-2-line repost-icon" style="font-size:14px;">&#x21bb;</i>
        <span class="repost-count-num">${formatCount(post.repostCount || post.repost_count || 0)}</span>
      </span>`;
  }

  // ─── COMMENT VISIBLE COUNTS ───────────────────────────────
  function getCommentsVisible() { try { return JSON.parse(localStorage.getItem(CVK) || '{}'); } catch (e) { return {}; } }
  function getVisibleComments(postId) { return getCommentsVisible()[postId] || INITIAL_COMMENT_DISPLAY; }
  function setCommentsVisible(postId, count) {
    const cv = getCommentsVisible(); cv[postId] = count;
    localStorage.setItem(CVK, JSON.stringify(cv));
  }

  // ─── RELATIONSHIP SYSTEM ──────────────────────────────────
  // ★ FIX: do NOT mark followSetsLoaded=true when user is guest — retry
  // when auth resolves.
  async function loadFollowSets(force = false) {
    if (followSetsLoaded && !force) return;
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) return; // stay unloaded; retry on auth change
    try {
      const [f1, f2] = await Promise.all([
        window.sb.from('follows').select('following_id').eq('follower_id', user.id),
        window.sb.from('follows').select('follower_id').eq('following_id', user.id)
      ]);
      followingSet = new Set((f1.data || []).map(r => r.following_id));
      followerSet = new Set((f2.data || []).map(r => r.follower_id));
      followSetsLoaded = true;
    } catch (e) { console.warn('loadFollowSets:', e); }
  }
  async function loadBookmarks() {
    const user = getCurrentUser();
    if (!user || !user.isLoggedIn) return;
    try {
      const { data } = await window.sb.from('bookmarks').select('post_id').eq('user_id', user.id);
      bookmarksSet = new Set((data || []).map(b => b.post_id));
    } catch (e) { /* ignore */ }
  }
  function relationshipState(userId) {
    const me = getCurrentUser();
    if (!me.isLoggedIn || userId === me.id) return 'self';
    const iF = followingSet.has(userId);
    const theyF = followerSet.has(userId);
    if (iF && theyF) return 'friends';
    if (iF) return 'following';
    if (theyF) return 'follow-back';
    return 'follow';
  }
  function relLabel(state) {
    return { friends: 'Friends', following: 'Following', 'follow-back': 'Follow Back', follow: 'Follow', self: '' }[state] || 'Follow';
  }
  // ★ FIX: return { ok, following } so callers can distinguish success vs failure.
  async function toggleFollowUser(userId) {
    const me = getCurrentUser();
    if (!me.isLoggedIn) {
      if (window.AuthUser && window.AuthUser.openModal) window.AuthUser.openModal('signup');
      else showToast('Please sign in to follow', 'o');
      return { ok: false, following: false };
    }
    if (userId === me.id) return { ok: false, following: false };
    const currently = followingSet.has(userId);
    try {
      if (currently) {
        const { error } = await window.sb.from('follows').delete().eq('follower_id', me.id).eq('following_id', userId);
        if (error) throw error;
        followingSet.delete(userId);
      } else {
        const { error } = await window.sb.from('follows').insert({ follower_id: me.id, following_id: userId });
        if (error) throw error;
        followingSet.add(userId);
      }
      return { ok: true, following: !currently };
    } catch (err) {
      showToast(err.message || 'Failed', 'r');
      return { ok: false, following: currently };
    }
  }

  // ★ FIX: keep the button visible; flip label to "Following"/"Friends".
  //          Skip the "Unfollowed"/"Following" toast if the call failed
  //          (e.g. guest, network error). try/finally ensures the button
  //          is never left permanently disabled.
  async function toggleFollowHandler(e, userId) {
    if (e) e.stopPropagation();
    const clicked = e ? e.currentTarget : null;
    if (clicked) clicked.disabled = true;
    let result;
    try {
      result = await toggleFollowUser(userId);
    } finally {
      if (clicked) clicked.disabled = false;
    }
    const newState = relationshipState(userId);
    document.querySelectorAll(`.follow-btn[data-user-id="${userId}"]`).forEach(b => {
      b.textContent = relLabel(newState);
      b.className = `follow-btn rel-${newState}`;
      b.dataset.relState = newState;
    });
    if (!result || !result.ok) return;
    showToast(newState === 'friends' ? 'You are now friends' : (newState === 'following' ? 'Following' : 'Unfollowed'));
  }
  window.toggleFollowHandler = toggleFollowHandler;

  // ★ FIX: no early-return "hide if following" — always render button.
  function buildFollowButton(authorId, authorName) {
    const me = getCurrentUser();
    if (!authorId || authorId === me.id) return `<span class="follow-btn hidden-follow"></span>`;
    const state = relationshipState(authorId);
    return `<button class="follow-btn rel-${state}" data-user-id="${authorId}" data-rel-state="${state}" onclick="toggleFollowHandler(event,'${authorId}')">${relLabel(state)}</button>`;
  }

  // ─── DATA ──────────────────────────────────────────────────
  async function fetchTrendingHashtags(limit = 10) {
    if (window.Hashtags && typeof window.Hashtags.fetchTrendingHashtags === 'function') {
      return window.Hashtags.fetchTrendingHashtags(limit);
    }
    const { data, error } = await window.sb.from('posts').select('tags').is('deleted_at', null).not('tags', 'is', null).limit(500);
    if (error || !data) return [];
    const counts = {};
    data.forEach(p => (p.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag, count]) => ({ tag, count }));
  }
  async function fetchSuggestedUsers(limit = 6) {
    const { data, error } = await window.sb.from('profiles').select('id,username,display_name,avatar_url,verified_status').limit(limit);
    return error ? [] : (data || []);
  }
  async function fetchTrendingPosts(limit = 3) {
    const { data, error } = await window.sb.from('posts')
      .select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .is('deleted_at', null).order('views', { ascending: false }).limit(limit);
    const rows = error ? [] : (data || []);
    rows.forEach(_rememberPost);
    return rows;
  }
  async function fetchTrendingVideos(limit = 10) {
    const { data, error } = await window.sb.from('posts')
      .select('id,title,media_url,media_type,views')
      .is('deleted_at', null).eq('media_type', 'video').order('views', { ascending: false }).limit(limit);
    const rows = error ? [] : (data || []);
    rows.forEach(_rememberPost);
    return rows;
  }
  async function fetchTrendingPhotos(limit = 9) {
    const { data, error } = await window.sb.from('posts')
      .select('id,title,media_url,media_type,views')
      .is('deleted_at', null).eq('media_type', 'image').order('views', { ascending: false }).limit(limit);
    const rows = error ? [] : (data || []);
    rows.forEach(_rememberPost);
    return rows;
  }
  async function fetchTrendingMarket(limit = 6) {
    const { data } = await window.ListingsAPI.getListings({ status: 'active', order_by: 'views_count', limit });
    return data || [];
  }
  async function fetchPostById(id) {
    if (!id) return null;
    const cached = _getPost(id);
    if (cached && cached.profiles) return cached;
    try {
      const { data } = await window.sb.from('posts')
        .select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
        .eq('id', id).is('deleted_at', null).single();
      if (data) _rememberPost(data);
      return data;
    } catch (e) { return null; }
  }

  async function searchAll(q, offset = 0) {
    const like = `%${q}%`;
    const [postsRes, usersRes, marketRes] = await Promise.all([
      window.sb.from('posts').select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
        .is('deleted_at', null)
        .or(`title.ilike.${like},content.ilike.${like}`)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
      window.sb.from('profiles').select('id,username,display_name,avatar_url,verified_status,bio')
        .or(`username.ilike.${like},display_name.ilike.${like}`).range(offset, offset + PAGE_SIZE - 1),
      window.ListingsAPI.getListings({ search: q, limit: PAGE_SIZE, offset }).catch(() => ({ data: [] }))
    ]);
    const posts = postsRes.data || []; posts.forEach(_rememberPost);
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
    const { data, error } = await window.sb.from('posts').select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .is('deleted_at', null).eq('media_type', 'video')
      .or(`title.ilike.${like},content.ilike.${like}`)
      .order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
    const rows = error ? [] : (data || []); rows.forEach(_rememberPost); return rows;
  }
  async function searchPhotos(q, offset = 0) {
    const like = `%${q}%`;
    const { data, error } = await window.sb.from('posts').select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .is('deleted_at', null).eq('media_type', 'image')
      .or(`title.ilike.${like},content.ilike.${like}`)
      .order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
    const rows = error ? [] : (data || []); rows.forEach(_rememberPost); return rows;
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
    const { data, error } = await window.sb.from('posts').select('tags')
      .is('deleted_at', null).contains('tags', [q]).range(offset, offset + PAGE_SIZE - 1);
    if (error || !data) return [];
    const allTags = data.flatMap(p => p.tags || []).filter(t => t.toLowerCase().includes(q.toLowerCase()));
    return [...new Set(allTags)];
  }
  async function searchHashtagPosts(tag, sort, offset = 0) {
    if (window.Hashtags && typeof window.Hashtags.fetchHashtagPostIds === 'function') {
      const postIds = await window.Hashtags.fetchHashtagPostIds(tag);
      if (!postIds.length) return [];
      const { data, error } = await window.sb.from('posts')
        .select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
        .is('deleted_at', null).in('id', postIds)
        .order(sort === 'latest' ? 'created_at' : 'views', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      const rows = error ? [] : (data || []); rows.forEach(_rememberPost); return rows;
    }
    const { data, error } = await window.sb.from('posts')
      .select('*, profiles:user_id(id,display_name,username,avatar_url,verified_status)')
      .is('deleted_at', null).contains('tags', [tag])
      .order(sort === 'latest' ? 'created_at' : 'views', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    const rows = error ? [] : (data || []); rows.forEach(_rememberPost); return rows;
  }
  async function getHashtagCount(tag) {
    if (window.Hashtags && typeof window.Hashtags.fetchHashtagPostIds === 'function') {
      const postIds = await window.Hashtags.fetchHashtagPostIds(tag);
      return postIds.length;
    }
    const { count, error } = await window.sb.from('posts')
      .select('id', { count: 'exact', head: true }).is('deleted_at', null).contains('tags', [tag]);
    return error ? 0 : (count || 0);
  }

  // ─── MEDIA HELPERS ───────────────────────────────────────
  function getMediaItems(post) {
    if (!post) return [];
    if (Array.isArray(post.media) && post.media.length) return post.media;
    const url = post.media_url || post.mediaUrl;
    if (!url) return [];
    return [{ url, type: post.media_type || post.mediaType || 'image' }];
  }

  // ─── CARD RENDERERS ──────────────────────────────────────
  function renderSquareGrid(posts, withPage) {
    if (!posts || !posts.length) return '';
    return `<div class="sq-grid">${posts.map(p => squareForPost(p, withPage)).join('')}</div>`;
  }
  function squareForPost(p, withPage) {
    _rememberPost(p);
    const mediaType = p.media_type || p.mediaType;
    const mediaUrl = p.media_url || p.mediaUrl;
    const media = Array.isArray(p.media) ? p.media : [];
    let inner;
    if (mediaUrl) {
      const thumb = mediaType === 'video' ? getThumb(mediaUrl) : mediaUrl;
      inner = `<img src="${thumb}" loading="lazy" draggable="false" onerror="this.parentElement.innerHTML='<div class=\\'sq-text-preview\\' style=\\'background:#7C3AED\\'>${escapeHtml(p.title||'').replace(/'/g,"\\'")}</div>'">`;
    } else {
      const hue = Math.abs((String(p.id) || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
      inner = `<div class="sq-text-preview" style="background:linear-gradient(135deg,hsl(${hue},60%,35%),hsl(${(hue+40)%360},60%,25%))">${escapeHtml((p.title || p.content || '').slice(0, 80))}</div>`;
    }
    if (withPage && media.length > 1) inner += `<span class="page-badge">1/${media.length}</span>`;
    inner += `<span class="heart-badge">${formatCount(p.views || 0)} views</span>`;
    const opener = mediaType === 'video'
      ? `Search._openVideoDirect('${p.id}')`
      : `Search._openImagePeek('${p.id}')`;
    return `<div class="sq-item" onclick="${opener}">${inner}</div>`;
  }
  function vidCardHtml(p) {
    _rememberPost(p);
    const profile = p.profiles || p.profile || {};
    const author = getAuthor(profile);
    const thumb = getThumb(p.media_url || p.mediaUrl);
    const pid = profileIdOf(profile);
    return `<div class="vid-card" onclick="Search._openVideoDirect('${p.id}')">
      <div class="thumb">
        <img src="${thumb||''}" loading="lazy">
        ${p.duration ? `<span class="dur">${p.duration}</span>` : ''}
      </div>
      <div class="title">${escapeHtml(p.title||'')}</div>
      <div class="author-row">
        <div class="author" onclick="_searchOpenProfile(event,'${pid}')"><img src="${author.avatar||''}" onerror="this.style.display='none'"><span class="au-name">${escapeHtml(author.name)}</span>${badgeHTML(author.verified_status)}</div>
        <span class="views">${formatCount(p.views||0)} views</span>
      </div>
    </div>`;
  }
  function pcardHtml(p) {
    _rememberPost(p);
    const profile = p.profiles || p.profile || {};
    const author = getAuthor(profile);
    const mediaType = p.media_type || p.mediaType;
    const mediaUrl = p.media_url || p.mediaUrl;
    const thumb = mediaType === 'video' ? getThumb(mediaUrl) : mediaUrl;
    const pid = profileIdOf(profile);
    const opener = mediaType === 'video' ? `Search._openVideoDirect('${p.id}')` : `Search._openImagePeek('${p.id}')`;
    return `<div class="pcard">
      <div class="head" onclick="_searchOpenProfile(event,'${pid}')">
        <img src="${author.avatar||''}" onerror="this.style.display='none'">
        <span class="nm">${escapeHtml(author.name)}</span>${badgeHTML(author.verified_status)}
      </div>
      <div class="media" onclick="${opener}">
        <img src="${thumb||''}" loading="lazy">
        <div class="stats">
          <span>${ICON.heart}${formatCount(p.like_count || p.likes || 0)}</span>
          <span>${ICON.play}${formatCount(p.views||0)}</span>
        </div>
      </div>
    </div>`;
  }
  function trendingPostCard(p) {
    _rememberPost(p);
    const profile = p.profiles || p.profile || {};
    const author = getAuthor(profile);
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
        ${isVideo ? `<span class="play-c">${ICON.play}</span><span class="stat-badge">${ICON.play}${formatCount(p.views||0)}</span>` : `<span class="stat-badge">${ICON.heart}${formatCount(p.like_count||p.likes||0)}</span>`}
      </div>`;
    }
    return `<article class="tpost" onclick="Search._openPost('${p.id}')">
      <div class="head">
        <img src="${author.avatar||''}" onerror="this.style.display='none'" onclick="_searchOpenProfile(event,'${pid}')">
        <div class="meta" onclick="_searchOpenProfile(event,'${pid}')">
          <div class="nm">${escapeHtml(author.name)}${badgeHTML(author.verified_status)}</div>
          <div class="time">${formatRelativeTime(p.created_at || p.timestamp)}</div>
        </div>
      </div>
      ${p.title ? `<div class="cap">${escapeHtml(p.title)}</div>` : ''}
      ${mediaHtml}
    </article>`;
  }
  // ★ FIX: added data-user-id to the follow button.
  function userRowHtml(u) {
    const state = relationshipState(u.id);
    const btn = state === 'self' ? '' : `<button class="follow-btn rel-${state}" data-user-id="${u.id}" onclick="toggleFollowHandler(event,'${u.id}')">${relLabel(state)}</button>`;
    const showBadge = u.verified_status && u.verified_status !== 'none' && u.verified_status !== 'pending';
    return `<div class="user-row" onclick="window.Router.openProfile('${u.id}')">
      <div class="av"><img src="${u.avatar_url||''}" onerror="this.style.display='none'">${showBadge?`<span class="vb">${ICON.check}</span>`:''}</div>
      <div class="info">
        <div class="name-line">${escapeHtml(u.display_name||u.username||'')}</div>
        <div class="handle">@${escapeHtml(u.username||'')}</div>
        ${u.bio ? `<div class="bio">${escapeHtml(u.bio)}</div>` : ''}
      </div>
      <div class="actions">${btn}</div>
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

  // ★ FIX: fall back to fetching if not in store, so the lightbox footer renders.
  async function _openPost(id) {
    let p = _getPost(id);
    if (!p) p = await fetchPostById(id);
    if (!p) { showToast('Post not found', 'r'); return; }
    const items = getMediaItems(p);
    if (!items.length) { showToast('No media to show', 'o'); return; }
    openGalleryLightbox(items, 0, p.id);
  }

  // ════════════════════════════════════════════════════════
  // LIGHTBOX
  // ════════════════════════════════════════════════════════
  function lbMuteIconSVG(muted) {
    return muted
      ? '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      : '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
  }
  function getActiveLightboxVideo() {
    const track = document.getElementById('galleryLightboxTrack');
    if (!track) return null;
    return track.querySelector(`[data-lb-index="${_galleryState.index}"] [data-lb-video]`);
  }
  function updateLbScrubberUI(vid) {
    const wrap = document.getElementById('lbScrubberWrap');
    const fill = document.getElementById('lbScrubberFill');
    const thumb = document.getElementById('lbScrubberThumb');
    if (!wrap) return;
    if (!vid || !vid.duration) { wrap.classList.remove('active'); return; }
    wrap.classList.add('active');
    const pct = Math.min(100, (vid.currentTime / vid.duration) * 100);
    if (fill) fill.style.width = pct + '%';
    if (thumb) thumb.style.left = pct + '%';
  }
  function updateLbPlayPauseIcon(vid) {
    const btn = document.getElementById('lbPlayPauseBtn');
    if (!btn || !vid) return;
    btn.innerHTML = vid.paused
      ? '<svg viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  }
  function updateLbMuteIcon(vid) {
    const btn = document.getElementById('lbMuteBtn');
    if (!btn || !vid) return;
    btn.innerHTML = lbMuteIconSVG(vid.muted);
  }
  function toggleActiveLightboxPlayback() {
    const vid = getActiveLightboxVideo();
    if (!vid) return;
    if (vid.paused) vid.play().catch(() => {}); else vid.pause();
    updateLbPlayPauseIcon(vid);
  }
  function setupLightboxVideoControls(vid, i) {
    if (vid._lbInit) return;
    vid._lbInit = true;
    vid.addEventListener('timeupdate', () => { if (i === _galleryState.index) updateLbScrubberUI(vid); });
    vid.addEventListener('loadedmetadata', () => { if (i === _galleryState.index) updateLbScrubberUI(vid); });
    vid.addEventListener('play', () => { if (i === _galleryState.index) updateLbPlayPauseIcon(vid); });
    vid.addEventListener('pause', () => { if (i === _galleryState.index) updateLbPlayPauseIcon(vid); });
  }
  function seekLbVideo(e) {
    const vid = getActiveLightboxVideo();
    const track = document.getElementById('lbScrubberTrack');
    if (!vid || !vid.duration || !track) return;
    const rect = track.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    vid.currentTime = pct * vid.duration;
    updateLbScrubberUI(vid);
  }
  function buildLbScrubberHTML() {
    return `<div class="lb-scrubber-wrap" id="lbScrubberWrap">
        <div class="lb-scrubber-track" id="lbScrubberTrack">
          <div class="lb-scrubber-track-line"></div>
          <div class="lb-scrubber-fill" id="lbScrubberFill"></div>
          <div class="lb-scrubber-thumb" id="lbScrubberThumb"></div>
        </div>
        <button type="button" class="lb-mute-btn" id="lbMuteBtn" aria-label="Toggle sound"></button>
        <button type="button" class="lb-playpause-btn" id="lbPlayPauseBtn" aria-label="Play or pause"></button>
      </div>`;
  }
  function releaseGalleryVideos(track) {
    if (!track) return;
    track.querySelectorAll('video').forEach(v => {
      try { v.pause(); } catch (e) {}
      try { v.removeAttribute('src'); v.load(); } catch (e) {}
    });
  }
  function setupLightboxNextPostSwipe(postId) {
    _lbFeedList = [];
    _lbFeedIndex = -1;
  }
  function goToNextLightboxPost() {
    if (_lbFeedIndex < 0 || _lbFeedIndex >= _lbFeedList.length - 1) { showToast('No more videos'); return; }
    const next = _lbFeedList[_lbFeedIndex + 1];
    openGalleryLightbox(getMediaItems(next), 0, next.id);
  }

  function buildLightboxCaptionHTML(post) {
    if (!post) return '';
    const author = getAuthor(post.profiles || post.profile);
    const da = truncateName(author.name || '', 26);
    const uname = author.username || (post.profiles && post.profiles.username) || '';
    const usernameStr = uname ? '@' + escapeHtml(uname) : '';
    const bhtml = badgeHTML(author.verified_status);
    const rawText = [post.title, post.content].filter(Boolean).join('\n').trim();
    const captionHtml = rawText ? linkifyContent(rawText, post.mentions) : '';
    return `<div class="lightbox-caption-block">
        <div class="lightbox-author-row" style="justify-content:space-between;" data-lightbox-author="${author.id}">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <img src="${author.avatar || ''}" alt="">
            <div class="lightbox-author-info">
              <div class="lightbox-author-name">${escapeHtml(da)} ${bhtml}</div>
              <div class="lightbox-author-time">${usernameStr?usernameStr+' · ':''}${formatRelativeTime(post.created_at || post.timestamp)}</div>
            </div>
          </div>
          <div style="flex-shrink:0;">${buildFollowButton(post.user_id, da)}</div>
        </div>
        ${captionHtml ? `<div class="lightbox-caption-text" id="lightboxCaptionText">${captionHtml}</div>
        <button type="button" class="lightbox-caption-seemore">See more</button>` : ''}
      </div>`;
  }

  // ★ FIX: if the post isn't in the store yet, kick off a fetch and re-render
  //          the footer when it arrives. This makes externally-triggered
  //          `window.openGalleryLightbox([...], 0, someId)` work too.
  function renderGalleryTrack() {
    const track = document.getElementById('galleryLightboxTrack');
    const dots = document.getElementById('galleryLightboxDots');
    const counter = document.getElementById('galleryLightboxCounter');
    const { items, index, postId } = _galleryState;
    releaseGalleryVideos(track);
    track.innerHTML = items.map((it, i) => {
      const isYoutube = it.type === 'video' && isYouTubeUrl(it.url || '');
      const isVideo = it.type === 'video' && !isYoutube;
      if (isYoutube) {
        const ytId = extractYouTubeId(it.url);
        const idx = 'lb' + i;
        if (!ytId) return `<div class="gallery-lightbox-slide"></div>`;
        // ★ FIX: start muted so the browser's autoplay policy lets it play.
        ytState[idx] = { muted: true, playing: true };
        return `<div class="gallery-lightbox-slide">
          <div class="ig-video-wrap" style="width:100%;height:100%;">
            <div class="yt-wrap" style="height:100%;padding-bottom:0;">
              <iframe id="yt-${idx}" src="https://www.youtube.com/embed/${ytId}?autoplay=1&loop=0&mute=1&controls=0&modestbranding=1&rel=0&showinfo=0&enablejsapi=1&playsinline=1&origin=${encodeURIComponent(window.location.origin)}" allow="autoplay; encrypted-media" allowfullscreen loading="lazy" onload="window._searchYtInit('${idx}')"></iframe>
              <div class="yt-tap" id="ytTap-${idx}" onclick="window._searchYtToggle('${idx}')"></div>
              <div class="yt-mute-badge" id="ytMuteBadge-${idx}"><svg id="ytMuteIco-${idx}" viewBox="0 0 24 24"></svg></div>
              <div class="yt-pause-icon" id="ytPauseIcon-${idx}"><svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></div>
              <div class="yt-progress" id="ytProg-${idx}" onclick="window._searchYtSeek(event,'${idx}')"><div class="yt-progress-fill" id="ytProgFill-${idx}"></div><div class="yt-progress-thumb" id="ytProgThumb-${idx}"></div></div>
            </div>
          </div>
        </div>`;
      }
      if (!isVideo) return `<div class="gallery-lightbox-slide"><img src="${it.url}" class="gallery-lightbox-media" alt=""></div>`;
      return `<div class="gallery-lightbox-slide">
        <div class="lb-video-wrap" data-lb-index="${i}">
          <video src="${it.url}" playsinline class="gallery-lightbox-media" data-lb-video></video>
        </div>
      </div>`;
    }).join('');
    track.style.transition = 'none';
    track.style.transform = `translateX(-${index * 100}%)`;
    requestAnimationFrame(() => { track.style.transition = 'transform .3s ease'; });
    counter.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : '';
    dots.innerHTML = items.length > 1 ? items.map((_, i) => `<span class="gallery-dot ${i === index ? 'active' : ''}"></span>`).join('') : '';

    // ★ FIX: initialise the YT mute badges for any YouTube slides.
    items.forEach((it, i) => {
      if (it.type === 'video' && isYouTubeUrl(it.url || '')) {
        try { _updateMuteBadge('lb' + i); } catch (e) {}
      }
    });

    track.querySelectorAll('[data-lb-video]').forEach((vid, i) => {
      setupLightboxVideoControls(vid, i);
      if (i === index) {
        const resume = _galleryState.resumeState;
        const applyResume = () => {
          if (resume) {
            try { vid.currentTime = resume.time; vid.muted = resume.muted; } catch (e) {}
          } else vid.muted = false;
          vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
          updateLbPlayPauseIcon(vid); updateLbMuteIcon(vid);
        };
        if (resume && vid.readyState < 1) vid.addEventListener('loadedmetadata', applyResume, { once: true });
        else applyResume();
      } else vid.pause();
    });

    document.getElementById('lightbox').classList.remove('ui-hidden');

    let post = postId ? _getPost(postId) : null;
    let footer = document.getElementById('galleryLightboxFooter');
    if (!footer) {
      footer = document.createElement('div');
      footer.id = 'galleryLightboxFooter';
      footer.className = 'gallery-lightbox-footer';
      document.getElementById('lightbox').appendChild(footer);
      footer.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = e.target;
        const pid = _galleryState.postId;
        if (!pid) return;
        if (t.closest('.lightbox-caption-seemore')) {
          const btn = t.closest('.lightbox-caption-seemore');
          const textEl = document.getElementById('lightboxCaptionText');
          if (textEl) {
            const expanded = textEl.classList.toggle('expanded');
            btn.textContent = expanded ? 'See less' : 'See more';
          }
          return;
        }
        if (t.closest('.follow-btn')) return;
        if (t.closest('.lightbox-author-row')) {
          const uid = t.closest('.lightbox-author-row').dataset.lightboxAuthor;
          if (uid) { closeLightbox(); if (window.Router) window.Router.openProfile(uid); }
          return;
        }
        if (t.closest('.reaction-btn')) { toggleReaction(pid); return; }
        if (t.closest('.bookmark-badge')) { toggleBookmarkUI(pid, t.closest('.bookmark-badge')); return; }
        if (t.closest('.share-btn')) { openShareModal(pid); return; }
        if (t.closest('[data-repost-btn]')) { triggerRepostFromFeed(t.closest('[data-repost-btn]'), pid); return; }
        if (t.closest('.comment-btn')) { openLightboxCommentsSheet(pid); return; }
      });
    }
    if (post) {
      footer.innerHTML = buildLightboxCaptionHTML(post) + buildLbScrubberHTML() + buildActionsRow(post);
      footer.style.display = 'block';
      setTimeout(() => {
        const strack = document.getElementById('lbScrubberTrack');
        if (strack && !strack._lbBound) {
          strack._lbBound = true;
          strack.addEventListener('click', seekLbVideo);
          strack.addEventListener('touchstart', seekLbVideo, { passive: true });
        }
        const muteBtn = document.getElementById('lbMuteBtn');
        const playBtn = document.getElementById('lbPlayPauseBtn');
        if (muteBtn && !muteBtn._lbBound) {
          muteBtn._lbBound = true;
          muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const vid = getActiveLightboxVideo();
            if (!vid) return;
            vid.muted = !vid.muted; updateLbMuteIcon(vid);
          });
        }
        if (playBtn && !playBtn._lbBound) {
          playBtn._lbBound = true;
          playBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleActiveLightboxPlayback(); });
        }
        const activeVid = getActiveLightboxVideo();
        updateLbScrubberUI(activeVid);
        updateLbMuteIcon(activeVid);
        updateLbPlayPauseIcon(activeVid);
      }, 0);
    } else if (postId) {
      // ★ FIX: fetch the post if we don't have it, then re-render the footer.
      footer.style.display = 'none';
      fetchPostById(postId).then(fresh => {
        if (!fresh) return;
        if (_galleryState.postId !== postId) return; // user already closed/changed
        renderGalleryTrack();
      });
    } else {
      footer.style.display = 'none';
    }
  }

  function openGalleryLightbox(mediaItems, startIndex, postId, resumeState) {
    _galleryState = { items: mediaItems || [], index: startIndex || 0, postId: postId || null, resumeState: resumeState || null };
    renderGalleryTrack();
    document.getElementById('lightbox').classList.add('show');
    if (!_lightboxScrollLocked) { lockBodyScroll(); _lightboxScrollLocked = true; }
    setupLightboxNextPostSwipe(postId);
  }
  window.openGalleryLightbox = openGalleryLightbox;

  function galleryGoTo(i) {
    const { items } = _galleryState;
    if (!items.length) return;
    _galleryState.index = Math.max(0, Math.min(items.length - 1, i));
    document.getElementById('galleryLightboxTrack').style.transform = `translateX(-${_galleryState.index * 100}%)`;
    document.getElementById('galleryLightboxCounter').textContent =
      items.length > 1 ? `${_galleryState.index + 1} / ${items.length}` : '';
    document.querySelectorAll('#galleryLightboxDots .gallery-dot').forEach((d, i2) =>
      d.classList.toggle('active', i2 === _galleryState.index));
    const activeVid = getActiveLightboxVideo();
    if (activeVid) { updateLbScrubberUI(activeVid); updateLbMuteIcon(activeVid); updateLbPlayPauseIcon(activeVid); }
  }

  function closeLightbox() {
    const track = document.getElementById('galleryLightboxTrack');
    releaseGalleryVideos(track);
    document.getElementById('lightbox').classList.remove('show', 'ui-hidden');
    unlockBodyScroll(); _lightboxScrollLocked = false;
    track.innerHTML = '';
    const footer = document.getElementById('galleryLightboxFooter');
    if (footer) footer.style.display = 'none';
    closeLightboxCommentsSheet();
  }
  window.closeLightbox = closeLightbox;

  (function setupGallerySwipe() {
    const track = document.getElementById('galleryLightboxTrack');
    if (!track) return;
    let sx = 0, dragging = false;
    track.addEventListener('touchstart', e => { sx = e.touches[0].clientX; dragging = true; }, { passive: true });
    track.addEventListener('touchend', e => {
      if (!dragging) return;
      dragging = false;
      const dx = sx - e.changedTouches[0].clientX;
      if (Math.abs(dx) < 40) return;
      if (_galleryState.items.length > 1) { galleryGoTo(_galleryState.index + (dx > 0 ? 1 : -1)); return; }
      const cur = _galleryState.items[_galleryState.index];
      if (!cur || cur.type !== 'video') closeLightbox();
    }, { passive: true });
  })();

  (function setupGalleryVerticalDismiss() {
    const modal = document.getElementById('lightbox');
    const track = document.getElementById('galleryLightboxTrack');
    if (!modal || !track) return;
    let startY = 0, startX = 0, dragging = false, dragged = false;
    track.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY; startX = e.touches[0].clientX;
      dragging = true; dragged = false;
    }, { passive: true });
    track.addEventListener('touchmove', e => {
      if (!dragging || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
      if (Math.abs(dy) <= Math.abs(dx)) return;
      dragged = true;
      modal.classList.add('dragging');
      const c = Math.max(-120, Math.min(400, dy));
      modal.style.transform = `translateY(${c}px)`;
      modal.style.opacity = String(Math.max(0.5, 1 - Math.abs(c) / 500));
    }, { passive: true });
    track.addEventListener('touchend', e => {
      if (!dragging) return;
      dragging = false;
      modal.classList.remove('dragging');
      const dy = (e.changedTouches[0].clientY - startY);
      modal.style.transition = 'transform .2s ease, opacity .2s ease';
      if (dragged && dy > 120) {
        modal.style.transform = 'translateY(100%)';
        modal.style.opacity = '0';
        setTimeout(() => {
          modal.style.transition = ''; modal.style.transform = ''; modal.style.opacity = '';
          closeLightbox();
        }, 200);
      } else if (dragged && dy < -80 && _lbFeedList.length > 0) {
        modal.style.transform = 'translateY(-40px)'; modal.style.opacity = '0.4';
        setTimeout(() => {
          modal.style.transition = ''; modal.style.transform = ''; modal.style.opacity = '';
          goToNextLightboxPost();
        }, 150);
      } else {
        modal.style.transform = ''; modal.style.opacity = '';
        setTimeout(() => { modal.style.transition = ''; }, 200);
      }
    }, { passive: true });
  })();

  (function setupLightboxTapToggle() {
    const mediaArea = document.getElementById('lightboxMediaArea');
    if (!mediaArea) return;
    mediaArea.addEventListener('click', (e) => {
      if (e.target.closest('.plyr__controls') || e.target.closest('.plyr__control--overlaid')) return;
      if (e.target.closest('.lb-mute-btn') || e.target.closest('.lb-playpause-btn')) return;
      if (e.target.closest('.lb-scrubber-wrap')) return;
      if (e.target.closest('.yt-tap')) return;
      document.getElementById('lightbox').classList.toggle('ui-hidden');
    });
  })();

  // ─── YT PLAYBACK ─────────────────────────────────────────
  function ytPostMessage(idx, func, args = []) {
    const iframe = document.getElementById('yt-' + idx);
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }
  function updateYtProgressUI(idx, currentTime, duration) {
    if (!duration) return;
    const pct = (currentTime / duration) * 100;
    const fill = document.getElementById('ytProgFill-' + idx);
    const thumb = document.getElementById('ytProgThumb-' + idx);
    if (fill) fill.style.width = pct + '%';
    if (thumb) thumb.style.setProperty('--pct', pct + '%');
  }
  function _updateMuteBadge(idx) {
    const badge = document.getElementById('ytMuteBadge-' + idx);
    const ico = document.getElementById('ytMuteIco-' + idx);
    if (!badge || !ico) return;
    const st = ytState[idx] || { muted: true };
    if (st.muted) {
      ico.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
      badge.style.opacity = '.95';
    } else {
      ico.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
      badge.style.opacity = '.6';
    }
  }
  function _showYtPauseIcon(idx, isPlaying) {
    const icon = document.getElementById('ytPauseIcon-' + idx);
    if (!icon) return;
    icon.querySelector('svg').innerHTML = isPlaying
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
      : '<polygon points="5 3 19 12 5 21 5 3"/>';
    icon.classList.remove('hide'); icon.classList.add('show');
    setTimeout(() => {
      icon.classList.remove('show'); icon.classList.add('hide');
      setTimeout(() => icon.classList.remove('hide'), 200);
    }, 700);
  }
  function toggleYtControls(idx) {
    if (!ytState[idx]) ytState[idx] = { muted: true, playing: true };
    const st = ytState[idx];
    if (st.muted) { ytPostMessage(idx, 'unMute'); st.muted = false; _updateMuteBadge(idx); return; }
    if (st.playing) { ytPostMessage(idx, 'pauseVideo'); st.playing = false; _showYtPauseIcon(idx, false); }
    else { ytPostMessage(idx, 'playVideo'); st.playing = true; _showYtPauseIcon(idx, true); }
  }
  function initYtListener(idx) {
    const iframe = document.getElementById('yt-' + idx);
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'yt-' + idx }), '*');
    // Also ask for the current state so the badge is right immediately.
    ytPostMessage(idx, 'mute');
  }
  function seekYoutube(e, idx) {
    const prog = document.getElementById('ytProg-' + idx);
    if (!prog) return;
    const rect = prog.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const info = ytInfo[idx];
    if (!info || !info.duration) return;
    const time = pct * info.duration;
    ytPostMessage(idx, 'seekTo', [time, true]);
    updateYtProgressUI(idx, time, info.duration);
  }
  window._searchYtToggle = toggleYtControls;
  window._searchYtInit = initYtListener;
  window._searchYtSeek = seekYoutube;

  // ★ FIX: single global message handler for YouTube postMessage events.
  //          Routes `infoDelivery` back to the correct iframe via `e.source`.
  window.addEventListener('message', function (e) {
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (!data || data.event !== 'infoDelivery' || !data.info) return;
      const iframes = document.querySelectorAll('iframe[id^="yt-"]');
      for (const f of iframes) {
        if (f.contentWindow === e.source) {
          const idx = f.id.replace(/^yt-/, '');
          ytInfo[idx] = Object.assign({}, ytInfo[idx] || {}, data.info);
          if (typeof data.info.currentTime === 'number' && data.info.duration) {
            updateYtProgressUI(idx, data.info.currentTime, data.info.duration);
          }
          if (typeof data.info.playerState === 'number' && ytState[idx]) {
            // 1 = playing, 2 = paused, 0 = ended, 3 = buffering
            ytState[idx].playing = data.info.playerState === 1;
          }
          break;
        }
      }
    } catch (err) { /* ignore non-JSON messages */ }
  });

  // ─── FOOTER ACTIONS ──────────────────────────────────────
  function isBookmarked(id) { return bookmarksSet.has(id); }

  function buildReactionButton(postId) {
    const post = _getPost(postId);
    const count = post ? (post.like_count || post.likes || 0) : 0;
    const reacted = post ? !!post.likedByMe : false;
    return `<button type="button" class="reaction-btn ${reacted?'reacted':''}" data-reaction="like">
      <span class="heart-icon-wrap">${svgHeart(reacted)}</span>
      <span class="reaction-count">${formatCount(count)}</span>
    </button>`;
  }
  function buildActionsRow(p) {
    const bm = isBookmarked(p.id);
    const off = !!p.commentsHidden;
    const cc = Array.isArray(p.comments) ? p.comments.filter(c => c.approved !== false).length : (p.comment_count || 0);
    return `<div class="post-actions-row" data-post-reactions="${p.id}">
      ${buildReactionButton(p.id)}
      <span class="comment-btn ${off?'comments-off':''}">${off?svgCommentOff():svgComment()}<span class="comment-count">${formatCount(cc)}</span></span>
      ${repostCountBadge(p)}
      <span class="share-btn" data-share-post="${p.id}">${svgShare()}<span class="share-count">${formatCount(p.share_count || p.shareCount || 0)}</span></span>
      ${bookmarkIconWithCount(p.id, bm, p.bookmark_count || p.bookmarkCount || 0)}
    </div>`;
  }

  async function toggleReaction(postId) {
    const post = _getPost(postId);
    if (!post) return;
    if (pendingLikes.has(postId)) return;
    const willLike = !post.likedByMe;
    document.querySelectorAll(`[data-post-reactions="${postId}"] .reaction-btn`).forEach(btn => {
      btn.classList.add('bounce-heart');
      setTimeout(() => btn.classList.remove('bounce-heart'), 500);
      if (willLike) spawnHeartParticles(btn);
    });
    haptic(10);
    const me = getCurrentUser();
    if (!me.isLoggedIn) { showToast('Please sign in to like', 'o'); return; }
    pendingLikes.add(postId);
    try {
      const { liked, count } = await window.PostsAPI.toggleLike(postId);
      post.likedByMe = liked;
      post.like_count = count;
      const text = formatCount(count);
      document.querySelectorAll(`[data-post-reactions="${postId}"] .reaction-btn`).forEach(btn => {
        btn.classList.toggle('reacted', liked);
        const icon = btn.querySelector('.heart-icon-wrap');
        if (icon) icon.innerHTML = svgHeart(liked);
        const cnt = btn.querySelector('.reaction-count');
        if (cnt) animateCountRoll(cnt, text);
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) showToast(err.message, 'r');
    } finally { pendingLikes.delete(postId); }
  }

  async function toggleBookmarkUI(postId, badgeEl) {
    if (pendingBookmarks.has(postId)) return;
    spawnRipple(badgeEl, null);
    haptic(8);
    const me = getCurrentUser();
    if (!me.isLoggedIn) {
      if (window.AuthUser && window.AuthUser.openModal) window.AuthUser.openModal('signup');
      else showToast('Please sign in to bookmark', 'o');
      return;
    }
    pendingBookmarks.add(postId);
    try {
      const { bookmarked, count } = await window.PostsAPI.toggleBookmark(postId);
      const post = _getPost(postId);
      if (post) post.bookmark_count = count;
      if (bookmarked) bookmarksSet.add(postId); else bookmarksSet.delete(postId);
      document.querySelectorAll(`[data-bookmark="${postId}"]`).forEach(el => {
        el.classList.toggle('bookmarked', bookmarked);
        const iconWrap = el.querySelector('.bookmark-icon-wrap');
        if (iconWrap) iconWrap.innerHTML = bookmarkIcon(bookmarked);
        const cnt = el.querySelector('.bookmark-count');
        if (cnt) animateCountRoll(cnt, formatCount(count));
        el.classList.add('bookmark-breathe');
        setTimeout(() => el.classList.remove('bookmark-breathe'), 250);
      });
      showToast(bookmarked ? 'Saved' : 'Removed from saved');
    } catch (err) { showToast(err.message || 'Failed', 'r'); }
    finally { pendingBookmarks.delete(postId); }
  }

  function openShareModal(postId) {
    sharePostId = postId;
    const modal = document.getElementById('share-modal');
    if (!modal) return;
    modal.classList.add('open');
    lockBodyScroll();
  }
  function closeShareModal() {
    const modal = document.getElementById('share-modal');
    if (modal) modal.classList.remove('open');
    unlockBodyScroll();
    sharePostId = null;
  }
  function handleShareAction(action) {
    if (!sharePostId) return;
    const post = _getPost(sharePostId);
    if (!post) { showToast('Post not found'); return; }
    const url = `${window.location.origin}${window.location.pathname}?post=${sharePostId}`;
    const title = post.title || 'FreeUpper post';
    if (action === 'notinterested') {
      closeShareModal();
      // ★ FIX: actually hide the post visually + hide any lightbox showing it.
      document.querySelectorAll(`[data-post-reactions="${sharePostId}"]`).forEach(el => {
        const article = el.closest('.tpost, .pcard, .sq-item, .vid-card');
        if (article) article.style.display = 'none';
      });
      showToast('Post removed from your feed');
      return;
    }
    function record() {
      const me = getCurrentUser();
      if (!me.isLoggedIn) return;
      if (window.PostsAPI && window.PostsAPI.recordShare) {
        window.PostsAPI.recordShare(sharePostId).then(({ count }) => {
          post.share_count = count;
          document.querySelectorAll(`[data-share-post="${sharePostId}"] .share-count`).forEach(el => el.textContent = formatCount(count));
        }).catch(() => {});
      }
    }
    if (action === 'copy') {
      record();
      copyTextToClipboard(url).then(() => { showToast('Link copied'); closeShareModal(); }).catch(() => closeShareModal());
      return;
    }
    if (action === 'native') {
      record();
      if (navigator.share) navigator.share({ title, text: title, url }).catch(() => {});
      else copyTextToClipboard(url).then(() => showToast('Link copied'));
      closeShareModal();
    }
  }

  // ★ FIX: fetch the post if it's not in the store so the preview isn't blank.
  async function openRepostQuoteSheet(postId) {
    repostQuoteTargetId = postId;
    let post = _getPost(postId);
    if (!post) post = await fetchPostById(postId);
    const input = document.getElementById('repostQuoteInput');
    const submitBtn = document.getElementById('repostSubmitBtn');
    const removeBtn = document.getElementById('repostRemoveBtn');
    const title = document.getElementById('repostQuoteTitle');
    if (!input || !title || !removeBtn) return;
    input.value = '';
    updateRepostCharCount();
    title.textContent = 'Repost';
    removeBtn.style.display = 'none';
    if (post) {
      const author = getAuthor(post.profiles || post.profile);
      document.getElementById('repostPreviewAuthor').textContent = author.name;
      document.getElementById('repostPreviewTime').textContent = formatRelativeTime(post.created_at);
      document.getElementById('repostPreviewContent').textContent = post.title || post.content || '';
      const thumbEl = document.getElementById('repostPreviewThumb');
      const media = getMediaItems(post);
      const first = media.find(m => m.type !== 'video');
      if (first && first.url) { thumbEl.src = first.url; thumbEl.style.display = 'block'; }
      else thumbEl.style.display = 'none';
    }
    lockBodyScroll();
    document.getElementById('repostQuoteOverlay').classList.add('open');
  }
  function closeRepostQuoteModal() {
    document.getElementById('repostQuoteOverlay').classList.remove('open');
    unlockBodyScroll();
    repostQuoteTargetId = null;
  }
  function updateRepostCharCount() {
    const input = document.getElementById('repostQuoteInput');
    const el = document.getElementById('repostCharCount');
    if (input && el) el.textContent = `${input.value.length}/280`;
  }
  function triggerRepostFromFeed(btn, postId) {
    haptic(10);
    btn.classList.add('spinning');
    btn.style.pointerEvents = 'none';
    btn.addEventListener('animationend', () => {
      btn.classList.remove('spinning');
      btn.style.pointerEvents = '';
      openRepostQuoteSheet(postId);
    }, { once: true });
  }

  // ─── COMMENTS SHEET ──────────────────────────────────────
  function commentSkeletons(count = 3) {
    let h = '';
    for (let i = 0; i < count; i++) {
      h += `<div class="comment-skeleton"><div class="skeleton-avatar-sm"></div><div style="flex:1;"><div class="skeleton-line-sm w70"></div><div class="skeleton-line-sm w90"></div><div class="skeleton-line-sm w50"></div></div></div>`;
    }
    return h;
  }
  function getAllDescendants(pid, comments) {
    const r = [];
    const dc = comments.filter(c => c.parentId === pid);
    for (const c of dc) { r.push(c); r.push(...getAllDescendants(c.id, comments)); }
    return r;
  }
  function getCommentCount(post) {
    if (!post) return 0;
    if (Array.isArray(post.comments)) return post.comments.filter(c => c.approved !== false).length;
    return typeof post.comments === 'number' ? post.comments : (post.comment_count || 0);
  }
  function getCommentSort(postId) { return currentCommentSort[postId] || 'top'; }
  function openCommentSortModal(postId, listId, labelId) {
    listId = listId || 'lightbox-comments-list';
    labelId = labelId || 'lightboxCommentSortLabel';
    const modal = document.getElementById('commentSortModal');
    if (!modal) return;
    const active = getCommentSort(postId);
    modal.querySelectorAll('.report-reason-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.sort === active);
      opt.onclick = () => {
        currentCommentSort[postId] = opt.dataset.sort;
        const lbl = document.getElementById(labelId);
        if (lbl) lbl.textContent = opt.dataset.sort === 'top' ? 'Top' : 'Recent';
        closeCommentSortModal();
        refreshCommentsList(postId, listId);
      };
    });
    modal.classList.add('open');
  }
  function closeCommentSortModal() {
    const m = document.getElementById('commentSortModal');
    if (m) m.classList.remove('open');
  }

  function renderCommentsHTML(comments, postId, vc) {
    const tl = comments.filter(c => c.parentId === null);
    if (!tl.length) return '<p style="font-size:.85rem;padding:32px 0;text-align:center;color:var(--muted);">No replies yet. Be the first.</p>';
    const sh = tl.slice(0, vc);
    const hi = tl.length > vc;
    let h = sh.map(c => renderCommentThread(c, comments, postId)).join('');
    if (hi) h += `<button type="button" class="view-replies-btn load-more-comments-btn" style="margin-left:0;" data-post-id="${postId}">${svgChevronDown()} View ${formatCount(tl.length-vc)} more repl${tl.length-vc!==1?'ies':'y'}</button>`;
    return h;
  }

  function renderCommentThread(c, allComments, postId) {
    const author = getAuthor(c.profile);
    const username = truncateName(author.name, 16);
    const avatar = author.avatar;
    const bhtml = badgeHTML(author.verified_status);
    const isPinned = !!c.pinned;
    const pinnedBadgeHtml = isPinned ? '<span class="comment-pinned-badge"><svg viewBox="0 0 24 24" width="11" height="11"><path d="M12 17v5"/><path d="M9 3h6l1 6-2 2v3H8v-3L6 9Z"/></svg> Pinned</span>' : '';
    const editedTagHtml = c.edited ? '<span class="comment-edited-tag">(edited)</span>' : '';
    const ds = getAllDescendants(c.id, allComments);
    const hr = ds.length > 0;
    const ec = expandedThreads.has(c.id) ? expandedThreads.get(c.id) : (ds.length > 0 ? 1 : 0);
    let rh = '';
    if (hr && ec > 0) {
      const sh = ds.slice(0, ec);
      const rm = ds.length - ec;
      rh = `<div class="replies-thread">${sh.map(r=>renderReplyItem(r,allComments,postId)).join('')}</div>`;
      if (rm > 0) rh += `<button type="button" class="view-replies-btn expand-replies-btn" data-comment-id="${c.id}" data-post-id="${postId}">${svgChevronDown()} View ${formatCount(rm)} more repl${rm!==1?'ies':'y'}</button>`;
      else rh += `<button type="button" class="hide-replies-btn collapse-replies-btn" data-comment-id="${c.id}" data-post-id="${postId}">${svgChevronUp()} Hide replies</button>`;
    } else if (hr && ec === 0) {
      rh = `<button type="button" class="view-replies-btn expand-replies-btn" data-comment-id="${c.id}" data-post-id="${postId}">${svgChevronDown()} View ${formatCount(ds.length)} repl${ds.length!==1?'ies':'y'}</button>`;
    }
    const il = c.message && c.message.length > 220;
    const avatarHtml = avatar ? `<img src="${avatar}" alt="">` : `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8.5" r="3.3"/><path d="M4.8 19c.6-4 3.6-6.3 7.2-6.3s6.6 2.3 7.2 6.3c-2 1.8-4.6 2.8-7.2 2.8s-5.2-1-7.2-2.8z"/></svg>`;
    const avatarClass = avatar ? 'comment-avatar has-image' : 'comment-avatar';
    const renderedMsg = linkifyContent(c.message || '', c.mentions);
    const commentMediaHtml = c.imageUrl ? `<img class="comment-media" src="${escapeHtml(c.imageUrl)}" alt="" loading="lazy">` : '';
    const _ov = locallyLikedComments.get(c.id);
    const likeCount = _ov ? _ov.count : (c.likeCount || 0);
    const isLiked = _ov ? _ov.liked : !!c.likedByMe;

    return `<div class="comment-item" data-comment-id="${c.id}">
        <div class="${avatarClass}" data-user-id="${c.userId}">${avatarHtml}</div>
        <div class="comment-body">
          <div class="comment-username-row">
            <div class="comment-username" data-user-id="${c.userId}">${pinnedBadgeHtml}${escapeHtml(username)} ${bhtml}</div>
          </div>
          <div class="comment-text${il?' collapsed':''}" data-cid="${c.id}">${renderedMsg}${editedTagHtml}</div>
          ${commentMediaHtml}
          ${il?`<button class="comment-show-more">Show more</button>`:''}
          <div class="comment-meta">
            <span class="comment-time">${formatRelativeTime(c.time)}</span>
            <button class="comment-reply-btn" data-post-id="${postId}">Reply</button>
            <button class="comment-like-btn ${isLiked?'liked':''}" data-comment-id="${c.id}">
              <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span class="like-count">${likeCount>0?likeCount:''}</span>
            </button>
          </div>
        </div>
      </div>${rh}`;
  }

  function renderReplyItem(r, allComments, postId) {
    const author = getAuthor(r.profile);
    const username = truncateName(author.name, 16);
    const avatar = author.avatar;
    const bhtml = badgeHTML(author.verified_status);
    const editedTagHtml = r.edited ? '<span class="comment-edited-tag">(edited)</span>' : '';
    const pc = allComments.find(c => c.id === r.parentId);
    const ru = pc ? (pc.profile ? pc.profile.display_name : '') : '';
    const mn = (ru && ru !== username) ? `<span style="color:#7C3AED;font-weight:600;">@${escapeHtml(ru)}</span> ` : '';
    const il = r.message && r.message.length > 220;
    const avatarHtml = avatar ? `<img src="${avatar}" alt="">` : `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8.5" r="3.3"/><path d="M4.8 19c.6-4 3.6-6.3 7.2-6.3s6.6 2.3 7.2 6.3c-2 1.8-4.6 2.8-7.2 2.8s-5.2-1-7.2-2.8z"/></svg>`;
    const avatarClass = avatar ? 'reply-avatar-dot has-image' : 'reply-avatar-dot';
    const renderedMsg = linkifyContent(r.message || '', r.mentions);
    const replyMediaHtml = r.imageUrl ? `<img class="reply-media" src="${escapeHtml(r.imageUrl)}" alt="" loading="lazy">` : '';
    const _ov = locallyLikedComments.get(r.id);
    const likeCount = _ov ? _ov.count : (r.likeCount || 0);
    const isLiked = _ov ? _ov.liked : !!r.likedByMe;

    return `<div class="reply-item" data-comment-id="${r.id}">
        <div class="${avatarClass}" data-user-id="${r.userId}">${avatarHtml}</div>
        <div class="reply-body">
          <div class="reply-username-row">
            <div class="reply-username" data-user-id="${r.userId}">${escapeHtml(username)} ${bhtml}</div>
          </div>
          <div class="comment-text reply-text${il?' collapsed':''}" data-cid="${r.id}">${mn}${renderedMsg}${editedTagHtml}</div>
          ${replyMediaHtml}
          ${il?`<button class="comment-show-more">Show more</button>`:''}
          <div class="reply-meta">
            <span class="reply-time">${formatRelativeTime(r.time)}</span>
            <button class="reply-reply-btn" data-post-id="${postId}">Reply</button>
            <button class="reply-like-btn ${isLiked?'liked':''}" data-comment-id="${r.id}">
              <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span class="like-count">${likeCount>0?likeCount:''}</span>
            </button>
          </div>
        </div>
      </div>`;
  }

  async function refreshCommentsList(postId, listId) {
    const p = _getPost(postId);
    if (!p) return;
    const cl = document.getElementById(listId);
    if (!cl) return;
    const myToken = Symbol();
    _commentsFetchToken[postId] = myToken;
    cl.innerHTML = commentSkeletons(3);
    try {
      const comments = await window.PostsAPI.loadComments(postId);
      if (_commentsFetchToken[postId] !== myToken) return;
      p.comments = comments;
      const sortMode = getCommentSort(postId);
      const sorted = [...comments].sort((a, b) => {
        if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        if (sortMode === 'recent') return new Date(b.time) - new Date(a.time);
        if ((b.likeCount || 0) !== (a.likeCount || 0)) return (b.likeCount || 0) - (a.likeCount || 0);
        return new Date(a.time) - new Date(b.time);
      });
      if (_commentsFetchToken[postId] !== myToken) return;
      const vc = getVisibleComments(postId);
      cl.innerHTML = renderCommentsHTML(sorted, postId, vc);
      updateCommentCount(postId);
    } catch (err) {
      if (_commentsFetchToken[postId] !== myToken) return;
      cl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Could not load comments.</p>';
    }
  }

  function setupCommentListDelegation(container, postId) {
    if (container._delegated) return;
    container._delegated = true;
    container.addEventListener('click', function (e) {
      const t = e.target;
      if (t.closest('.comment-reply-btn') || t.closest('.reply-reply-btn')) {
        const btn = t.closest('.comment-reply-btn') || t.closest('.reply-reply-btn');
        const ci = btn.closest('[data-comment-id]')?.dataset.commentId;
        const un = btn.closest('[data-comment-id]')?.querySelector('.comment-username,.reply-username')?.textContent;
        if (ci && un) {
          _lightboxReplyTarget = ci;
          const ta = document.getElementById('lightbox-comment-textarea');
          const sendBtn = document.getElementById('lightbox-comment-submit-btn');
          if (ta) { ta.value = '@' + un.trim() + ' '; ta.focus(); }
          if (sendBtn) sendBtn.disabled = false;
        }
        return;
      }
      if (t.closest('.comment-like-btn') || t.closest('.reply-like-btn')) {
        toggleCommentLikeUI(t.closest('.comment-like-btn') || t.closest('.reply-like-btn'));
        return;
      }
      if (t.closest('.comment-show-more')) {
        e.stopPropagation();
        const btn = t.closest('.comment-show-more');
        const textEl = btn.previousElementSibling;
        if (textEl && textEl.classList.contains('comment-text')) toggleCommentExpand(btn, textEl);
        return;
      }
      if (t.closest('.expand-replies-btn')) {
        const btn = t.closest('.expand-replies-btn');
        const ci = btn.dataset.commentId;
        if (ci) { expandedThreads.set(ci, (expandedThreads.get(ci) || 0) + REPLY_BATCH); refreshCommentsList(postId, 'lightbox-comments-list'); }
        return;
      }
      if (t.closest('.collapse-replies-btn')) {
        const ci = t.closest('.collapse-replies-btn').dataset.commentId;
        if (ci) { expandedThreads.delete(ci); refreshCommentsList(postId, 'lightbox-comments-list'); }
        return;
      }
      if (t.closest('.load-more-comments-btn')) {
        setCommentsVisible(postId, getVisibleComments(postId) + COMMENT_LOAD_MORE);
        refreshCommentsList(postId, 'lightbox-comments-list');
        return;
      }
      if (t.closest('.mention-link')) {
        const uid = t.closest('.mention-link').dataset.userid;
        if (uid) { closeLightbox(); if (window.Router) window.Router.openProfile(uid); }
        return;
      }
      if (t.closest('.comment-avatar') || t.closest('.reply-avatar-dot') || t.closest('.comment-username') || t.closest('.reply-username')) {
        const el = t.closest('.comment-avatar') || t.closest('.reply-avatar-dot') || t.closest('.comment-username') || t.closest('.reply-username');
        const uid = el.dataset.userId;
        if (uid) { closeLightboxCommentsSheet(); closeLightbox(); if (window.Router) window.Router.openProfile(uid); }
        return;
      }
    });
  }

  async function toggleCommentLikeUI(btn) {
    const commentId = btn.dataset.commentId;
    if (!commentId || btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    const countEl = btn.querySelector('.like-count');
    const wasLiked = btn.classList.contains('liked');
    const currentCount = parseInt(countEl.dataset.count || countEl.textContent || '0', 10) || 0;
    const optimistic = wasLiked ? Math.max(0, currentCount - 1) : currentCount + 1;
    btn.classList.toggle('liked', !wasLiked);
    countEl.dataset.count = optimistic;
    countEl.textContent = optimistic > 0 ? optimistic : '';
    locallyLikedComments.set(commentId, { liked: !wasLiked, count: optimistic });
    try {
      const result = await window.PostsAPI.toggleCommentLike(commentId);
      btn.classList.toggle('liked', result.liked);
      countEl.dataset.count = result.count;
      countEl.textContent = result.count > 0 ? result.count : '';
      locallyLikedComments.set(commentId, { liked: result.liked, count: result.count });
    } catch (err) {
      btn.classList.toggle('liked', wasLiked);
      countEl.dataset.count = currentCount;
      countEl.textContent = currentCount > 0 ? currentCount : '';
      locallyLikedComments.delete(commentId);
      showToast(err.message || 'Failed', 'r');
    } finally { btn.dataset.busy = '0'; }
  }
  function toggleCommentExpand(btn, textEl) {
    if (!textEl) return;
    const collapsed = textEl.classList.toggle('collapsed');
    btn.textContent = collapsed ? 'Show more' : 'Show less';
  }

  function buildLbSheetHeaderHTML(post) {
    if (!post) return '';
    const author = getAuthor(post.profiles || post.profile);
    const da = truncateName(author.name || '', 26);
    const uname = author.username || (post.profiles && post.profiles.username) || '';
    const bhtml = badgeHTML(author.verified_status);
    const rawText = [post.title, post.content].filter(Boolean).join('\n').trim();
    const captionHtml = rawText ? linkifyContent(rawText, post.mentions) : '';
    const sortLbl = getCommentSort(post.id) === 'recent' ? 'Recent' : 'Top';
    return `<div class="lb-sheet-header">
        <div class="lb-sheet-author-row" data-lightbox-sheet-author="${author.id}">
          <img src="${author.avatar || ''}" alt="">
          <div class="lb-sheet-author-info">
            <div class="lb-sheet-author-name">${escapeHtml(da)} ${bhtml}</div>
            ${uname?`<div class="lb-sheet-author-username">@${escapeHtml(uname)}</div>`:''}
          </div>
          <div>${buildFollowButton(post.user_id, da)}</div>
        </div>
        ${captionHtml ? `<div class="lb-sheet-caption clamp4" id="lbSheetCaption">${captionHtml}</div>
        <button type="button" class="lb-sheet-seemore" id="lbSheetSeeMore">See more</button>` : ''}
        <div class="lb-sheet-meta-row">
          <span class="lb-sheet-views">${svgEye()}${formatCount(post.views||0)} views</span>
          <span class="lb-sheet-date">${formatRelativeTime(post.created_at)}</span>
          <button class="comment-sort-btn" id="lightboxCommentSortBtn"><span id="lightboxCommentSortLabel">${sortLbl}</span>${svgChevronDown()}</button>
        </div>
      </div>`;
  }

  // ★ FIX: if the post isn't in the store, fetch it first so comments can render.
  async function openLightboxCommentsSheet(postId) {
    const overlay = document.getElementById('lightboxCommentsOverlay');
    if (!overlay) return;
    let post = _getPost(postId);
    if (!post) post = await fetchPostById(postId);
    if (!post) { showToast('Post not found', 'r'); return; }
    if (post.commentsHidden) { showToast('Comments are turned off for this post', 'o'); return; }
    _lightboxCommentsPostId = postId;
    _lightboxReplyTarget = null;
    overlay.classList.add('open');

    const header = document.getElementById('lightbox-comments-post-header');
    if (header) {
      header.innerHTML = buildLbSheetHeaderHTML(post);
      const sortBtn = header.querySelector('#lightboxCommentSortBtn');
      if (sortBtn) sortBtn.onclick = () => openCommentSortModal(postId, 'lightbox-comments-list', 'lightboxCommentSortLabel');
      const authorRow = header.querySelector('.lb-sheet-author-row');
      if (authorRow) authorRow.addEventListener('click', (e) => {
        if (e.target.closest('.follow-btn')) return;
        closeLightboxCommentsSheet();
        closeLightbox();
        if (post && post.user_id && window.Router) window.Router.openProfile(post.user_id);
      });
      requestAnimationFrame(() => {
        const cap = document.getElementById('lbSheetCaption');
        const more = document.getElementById('lbSheetSeeMore');
        if (cap && more) {
          if (cap.scrollHeight > cap.clientHeight + 2) {
            more.style.display = 'block';
            more.onclick = () => {
              if (cap.classList.contains('clamp4')) { cap.classList.remove('clamp4'); more.textContent = 'See less'; }
              else { cap.classList.add('clamp4'); more.textContent = 'See more'; }
            };
          } else more.style.display = 'none';
        }
      });
    }

    const list = document.getElementById('lightbox-comments-list');
    if (list) list.innerHTML = commentSkeletons(3);
    if (list) setupCommentListDelegation(list, postId);
    refreshCommentsList(postId, 'lightbox-comments-list');
    const ta = document.getElementById('lightbox-comment-textarea');
    const sendBtn = document.getElementById('lightbox-comment-submit-btn');
    if (ta) { ta.value = ''; ta.style.height = '40px'; }
    if (sendBtn) sendBtn.disabled = true;
    clearCommentMedia('lightbox');
  }
  function closeLightboxCommentsSheet() {
    const o = document.getElementById('lightboxCommentsOverlay');
    if (o) o.classList.remove('open');
    _lightboxCommentsPostId = null;
    _lightboxReplyTarget = null;
  }

  async function submitLightboxComment() {
    const ta = document.getElementById('lightbox-comment-textarea');
    if (!ta || !_lightboxCommentsPostId) return;
    const message = ta.value.trim();
    if (!message && !lightboxCommentMedia) return showToast('Reply cannot be empty.');
    const mentions = window.Mentions ? window.Mentions.extractMentions(ta) : [];
    const pi = _lightboxReplyTarget;
    const postId = _lightboxCommentsPostId;
    const mediaFile = lightboxCommentMedia && lightboxCommentMedia.file;
    try {
      let imageUrl = '';
      if (mediaFile) {
        showToast('Uploading media...');
        imageUrl = await window.AuthUser.uploadCommentMedia(mediaFile, () => {}) || '';
        if (!imageUrl) throw new Error('Media upload failed.');
      }
      await addComment(postId, pi, message, mentions, imageUrl);
      ta.value = ''; ta.style.height = '40px';
      _lightboxReplyTarget = null;
      clearCommentMedia('lightbox');
      const sendBtn = document.getElementById('lightbox-comment-submit-btn');
      if (sendBtn) sendBtn.disabled = true;
      if (!pi) setCommentsVisible(postId, getVisibleComments(postId) + 1);
      await refreshCommentsList(postId, 'lightbox-comments-list');
      updateCommentCount(postId);
      showToast(pi ? 'Reply posted' : 'Comment posted');
    } catch (err) { showToast(err.message || 'Failed to post reply', 'r'); }
  }

  function setupLightboxCommentsBar() {
    const closeBtn = document.getElementById('lightboxCommentsCloseBtn');
    const overlay = document.getElementById('lightboxCommentsOverlay');
    const ta = document.getElementById('lightbox-comment-textarea');
    const sendBtn = document.getElementById('lightbox-comment-submit-btn');
    const mediaBtn = document.getElementById('lightbox-comment-media-btn');
    const mediaInput = document.getElementById('lightbox-comment-media-input');
    const mediaRemoveBtn = document.getElementById('lightbox-comment-media-remove-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeLightboxCommentsSheet);
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLightboxCommentsSheet(); });
    if (ta) ta.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
      if (sendBtn) sendBtn.disabled = !this.value.trim() && !lightboxCommentMedia;
    });
    if (sendBtn) sendBtn.addEventListener('click', submitLightboxComment);
    if (mediaBtn && mediaInput) mediaBtn.addEventListener('click', () => mediaInput.click());
    if (mediaInput) mediaInput.addEventListener('change', (e) => handleCommentMediaSelect(e.target.files && e.target.files[0], 'lightbox'));
    if (mediaRemoveBtn) mediaRemoveBtn.addEventListener('click', () => clearCommentMedia('lightbox'));
  }

  // ★ FIX: clean rejection when requireAuth is unavailable / cancelled, so the
  //          caller's try/catch actually runs and the toast goes away.
  async function addComment(postId, parentId, message, mentions, imageUrl) {
    const p = _getPost(postId);
    if (!p) throw new Error('Post not found');
    if (!(window.AuthUser && window.AuthUser.requireAuth)) {
      throw new Error('Please sign in to comment');
    }
    return new Promise((resolve, reject) => {
      window.AuthUser.requireAuth(async () => {
        try {
          const comment = await window.PostsAPI.addComment(postId, parentId, message, mentions, imageUrl);
          p.comments = getCommentCount(p) + 1;
          resolve(comment);
        } catch (err) { reject(err); }
      });
    });
  }
  function updateCommentCount(postId) {
    const p = _getPost(postId);
    if (!p) return;
    const cc = getCommentCount(p);
    document.querySelectorAll(`[data-post-reactions="${postId}"] .comment-count`).forEach(el => el.textContent = formatCount(cc));
  }

  // ─── COMMENT MEDIA ───────────────────────────────────────
  function isSupportedCommentMediaType(file) {
    if (!file) return false;
    return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
  }
  function renderCommentMediaPreview(kind) {
    const wrap = document.getElementById(kind + '-comment-media-preview');
    const img = document.getElementById(kind + '-comment-media-preview-img');
    const media = lightboxCommentMedia;
    if (!wrap || !img) return;
    if (media) { img.src = media.url; wrap.style.display = 'inline-flex'; }
    else { img.src = ''; wrap.style.display = 'none'; }
  }
  function clearCommentMedia(kind) {
    if (kind === 'lightbox') {
      if (lightboxCommentMedia && lightboxCommentMedia.url) URL.revokeObjectURL(lightboxCommentMedia.url);
      lightboxCommentMedia = null;
      const input = document.getElementById('lightbox-comment-media-input');
      if (input) input.value = '';
      const sendBtn = document.getElementById('lightbox-comment-submit-btn');
      const ta = document.getElementById('lightbox-comment-textarea');
      if (sendBtn) sendBtn.disabled = !(ta && ta.value.trim());
      renderCommentMediaPreview(kind);
    }
  }
  function handleCommentMediaSelect(file, kind) {
    if (!file) return;
    if (file.type === 'image/gif') { showToast('GIFs not supported here', 'o'); return; }
    if (!isSupportedCommentMediaType(file)) { showToast('Choose a JPG, PNG or WebP image', 'o'); return; }
    if (file.size > COMMENT_MEDIA_MAX_BYTES) { showToast('Media must be under 10MB', 'o'); return; }
    const url = URL.createObjectURL(file);
    if (kind === 'lightbox') {
      if (lightboxCommentMedia && lightboxCommentMedia.url) URL.revokeObjectURL(lightboxCommentMedia.url);
      lightboxCommentMedia = { file, url };
      const sendBtn = document.getElementById('lightbox-comment-submit-btn');
      if (sendBtn) sendBtn.disabled = false;
      renderCommentMediaPreview(kind);
    }
  }

  // ─── POST OPEN / PEEK / VIDEO DIRECT ────────────────────
  async function openImagePeek(postId) {
    let p = _getPost(postId);
    if (!p || !p.profiles) p = await fetchPostById(postId);
    if (!p) return;
    _peekPost = p;
    const profile = p.profiles || {};
    const author = getAuthor(profile);
    const pid = profileIdOf(profile);
    document.getElementById('searchPeekImg').src = p.media_url || p.mediaUrl || '';
    const authorEl = document.getElementById('searchPeekAuthor');
    authorEl.innerHTML = `<img src="${author.avatar||''}" onerror="this.style.display='none'"><div><div class="nm">${escapeHtml(author.name)}</div><div class="un">@${escapeHtml(profile.username||'')}</div></div>`;
    authorEl.dataset.pid = pid;
    const caption = [p.title, p.content].filter(Boolean).join(' — ');
    document.getElementById('searchPeekCaption').textContent = caption || '';
    const modal = document.getElementById('searchPeekModal');
    modal.classList.add('open');
    document.body.classList.add('fu-modal-open');
  }
  function closeImagePeek() {
    _peekPost = null;
    document.getElementById('searchPeekModal').classList.remove('open');
    document.body.classList.remove('fu-modal-open');
  }
  function peekExpand() {
    if (!_peekPost) return;
    const p = _peekPost;
    closeImagePeek();
    openGalleryLightbox(getMediaItems(p), 0, p.id);
  }
  function peekGoToProfile() {
    const el = document.getElementById('searchPeekAuthor');
    const pid = el ? el.dataset.pid : '';
    if (!pid) return;
    closeImagePeek();
    if (window.Router) window.Router.openProfile(pid);
  }
  async function openVideoDirect(postId) {
    let p = _getPost(postId);
    if (!p || !p.profiles) p = await fetchPostById(postId);
    if (!p) return;
    const items = getMediaItems(p);
    if (!items.length) { showToast('No media to show', 'o'); return; }
    openGalleryLightbox(items, 0, p.id);
  }
  function openProfileSafe(e, id) {
    if (!id) return;
    e.stopPropagation();
    if (window.Router && window.Router.openProfile) window.Router.openProfile(id);
  }
  window._searchOpenProfile = openProfileSafe;

  // ─── SEARCH UI ────────────────────────────────────────────
  function getRecentSearches() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
  // ★ FIX: collapse prefix duplicates so typing "Monis" replaces "Mon", "Moni", etc.
  function addRecentSearch(q) {
    if (!q || q.trim().length < 2) return;
    const val = q.trim();
    const lower = val.toLowerCase();
    let list = getRecentSearches().filter(x => {
      const xl = (x || '').toLowerCase();
      if (xl === lower) return false;
      if (xl.startsWith(lower) || lower.startsWith(xl)) return false;
      return true;
    });
    list.unshift(val);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
  }
  function removeRecentSearch(q) {
    localStorage.setItem(RECENT_KEY, JSON.stringify(getRecentSearches().filter(x => x.toLowerCase() !== q.toLowerCase())));
    renderDiscovery();
  }
  function clearAllRecent() { localStorage.removeItem(RECENT_KEY); renderDiscovery(); }

  function showNormalHeader(show) { const el = document.getElementById('normalHeader'); if (el) el.style.display = show ? 'block' : 'none'; }
  function showTabs(show) { const el = document.getElementById('searchTabs'); if (el) el.classList.toggle('visible', show); }
  function renderTabsBar() {
    const defs = [
      { id: 'top', label: 'Top' },
      { id: 'users', label: 'Users' },
      { id: 'videos', label: 'Videos' },
      { id: 'photos', label: 'Photos' },
      { id: 'market', label: 'Market' },
      { id: 'hashtags', label: 'Hashtags' }
    ];
    document.getElementById('searchTabs').innerHTML = defs.map(t =>
      `<button class="tab${t.id===currentTab?' active':''}" data-tab="${t.id}" onclick="Search.switchTab('${t.id}')"><span>${t.label}</span></button>`
    ).join('');
  }

  function createSentinel() {
    if (document.getElementById('searchSentinel')) return;
    const s = document.createElement('div');
    s.id = 'searchSentinel';
    document.getElementById('resultsContainer')?.appendChild(s);
  }
  function showLoadingMore(show) {
    let el = document.getElementById('loadingMore');
    if (show) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'loadingMore';
        el.className = 'load-more-row muted';
        el.innerHTML = `<span class="spin-icon"></span><span>Loading more</span>`;
        document.getElementById('resultsContainer')?.appendChild(el);
      }
      el.style.display = 'flex';
    } else if (el) el.style.display = 'none';
  }
  function showLoadMoreIdle() {
    document.getElementById('loadingMore')?.remove();
    document.getElementById('endResults')?.remove();
    if (document.getElementById('loadMoreIdle')) return;
    const el = document.createElement('div');
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
    const s = document.getElementById('searchSentinel');
    if (!s) return;
    const root = document.getElementById('mainScroll');
    observer = new IntersectionObserver(onReachBottom, { root, rootMargin: '500px', threshold: 0 });
    observer.observe(s);
  }
  function disconnectObserver() { if (observer) { observer.disconnect(); observer = null; } }
  async function onReachBottom(entries) {
    if (!entries[0].isIntersecting) return;
    if (loadingMore) return;
    const ts = paging[currentTab];
    if (!ts.hasMore) return;
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
    paging[key].cache = { query: currentQuery || currentHashtag, html };
  }

  async function renderDiscovery() {
    ++_searchReqToken;
    showNormalHeader(true);
    if (!currentQuery && !hashtagMode) showTabs(false);
    disconnectObserver();
    const c = document.getElementById('resultsContainer');
    const recent = getRecentSearches();
    let recentHtml = '';
    if (recent.length) {
      recentHtml = `<div class="discovery-block"><div class="section-title">Recent Searches</div><div class="recent-wrap">${recent.map(r => {
        const isTag = r.startsWith('#');
        const action = isTag ? `Search.openHashtag('${escapeHtml(r.slice(1)).replace(/'/g,"\\'")}')` : `Search.runSearch('${escapeHtml(r).replace(/'/g,"\\'")}')`;
        return `<div class="recent-pill">${ICON.clock}<span onclick="${action}">${escapeHtml(r)}</span><span class="x-btn" onclick="event.stopPropagation();Search.removeRecent('${escapeHtml(r).replace(/'/g,"\\'")}')"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>`;
      }).join('')}</div></div>`;
    }
    c.innerHTML = recentHtml + `<div class="center-loading"><span class="spin-icon"></span>Loading</div>`;
    await loadFollowSets();
    await loadBookmarks();
    const [hashtags, users, posts, videos, photos, market] = await Promise.all([
      fetchTrendingHashtags(4), fetchSuggestedUsers(6), fetchTrendingPosts(3),
      fetchTrendingVideos(10), fetchTrendingPhotos(9), fetchTrendingMarket(6)
    ]);
    let html = recentHtml;
    html += `<div class="discovery-block"><div class="section-title">${ICON.fire}Trending Hashtags</div><div class="trend-tag-grid">${hashtags.map(h => `<div class="trend-tag-card" onclick="Search.openHashtag('${escapeHtml(h.tag)}')"><div class="box">${ICON.hashtag}</div><div class="name">#${escapeHtml(h.tag)}</div><div class="cnt">${formatCount(h.count)} posts</div></div>`).join('')}</div></div>`;
    if (users.length) {
      // ★ FIX: added data-user-id
      html += `<div class="discovery-block"><div class="section-title">${ICON.user}Suggested Users</div><div class="sugg-scroll">${users.map(u => {
        const state = relationshipState(u.id);
        const btn = state === 'self' ? '' : `<button class="follow-btn rel-${state}" data-user-id="${u.id}" onclick="toggleFollowHandler(event,'${u.id}')">${relLabel(state)}</button>`;
        const showBadge = u.verified_status && u.verified_status !== 'none' && u.verified_status !== 'pending';
        return `<div class="sugg-card" onclick="window.Router.openProfile('${u.id}')"><div class="sugg-avatar"><img src="${u.avatar_url||''}" onerror="this.style.display='none'">${showBadge?`<span class="vb">${ICON.check}</span>`:''}</div><div class="name">${escapeHtml(u.display_name||u.username||'')}</div><div class="handle">@${escapeHtml(u.username||'')}</div><div onclick="event.stopPropagation()">${btn}</div></div>`;
      }).join('')}</div></div>`;
    }
    if (posts.length) html += `<div class="discovery-block"><div class="section-title">${ICON.trendUp}Trending Posts</div>${posts.map(trendingPostCard).join('')}</div>`;
    if (videos.length) {
      html += `<div class="discovery-block"><div class="section-title">${ICON.video}Trending Videos</div><div class="sugg-scroll">${videos.map(v => {
        const thumb = getThumb(v.media_url);
        return `<div style="flex-shrink:0;width:120px;cursor:pointer;" onclick="Search._openVideoDirect('${v.id}')"><div style="position:relative;width:120px;height:160px;border-radius:16px;overflow:hidden;background:#000;"><img src="${thumb||''}" style="width:100%;height:100%;object-fit:cover;"><span style="position:absolute;bottom:9px;left:9px;color:#fff;font-weight:700;font-size:11.5px;text-shadow:0 1px 4px rgba(0,0,0,.7);">${formatCount(v.views)} views</span></div></div>`;
      }).join('')}</div></div>`;
    }
    if (photos.length) html += `<div class="discovery-block"><div class="section-title">${ICON.photo}Trending Photos</div>${renderSquareGrid(photos, false)}</div>`;
    if (market.length) html += `<div class="discovery-block"><div class="section-title">${ICON.market}Trending Marketplace</div><div class="sugg-scroll">${market.map(m => `<div style="flex-shrink:0;width:132px;cursor:pointer;" onclick="window.Router.openListing('${m.id}')"><div style="width:132px;height:132px;border-radius:16px;overflow:hidden;background:#eee;"><img src="${(m.images&&m.images[0]&&m.images[0].url)||''}" style="width:100%;height:100%;object-fit:cover;"></div><div style="font-size:14px;font-weight:800;margin-top:7px;color:var(--p);">₦${Number(m.price||0).toLocaleString()}</div><div style="font-size:12px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.title||'')}</div></div>`).join('')}</div></div>`;
    c.innerHTML = html || (recentHtml + emptyState('Nothing to discover yet'));
  }

  // ★ FIX: load-more must not clobber the token of an in-flight fresh search.
  async function renderSearchResults(q, replace = true) {
    showNormalHeader(true); showTabs(true); renderTabsBar();
    const container = document.getElementById('resultsContainer');
    const tabForCall = currentTab;
    const ts = paging[tabForCall];
    const myToken = replace ? ++_searchReqToken : _searchReqToken;
    if (replace) {
      ts.offset = 0; ts.hasMore = true; ts.cache = null;
      container.innerHTML = `<div class="center-loading"><span class="spin-icon"></span>Loading</div>`;
    }
    await loadFollowSets();
    if (myToken !== _searchReqToken) return;
    let dataCount = 0, html = '', headHtml = '';
    if (tabForCall === 'users') {
      const users = await searchUsers(q, ts.offset);
      if (myToken !== _searchReqToken) return;
      dataCount = users.length;
      html = users.map(u => userRowHtml(u)).join('') || emptyState('No users found', `No users match "${q}"`);
      if (replace) headHtml = `<div class="results-head"><h2>Users<span class="cnt">(${formatCount(dataCount)} found)</span></h2></div>`;
    } else if (tabForCall === 'videos') {
      const posts = await searchVideos(q, ts.offset);
      if (myToken !== _searchReqToken) return;
      dataCount = posts.length;
      html = posts.length ? `<div class="vid-grid">${posts.map(vidCardHtml).join('')}</div>` : emptyState('No videos found', `No videos match "${q}"`);
      if (replace) headHtml = `<div class="results-head"><div><h2 style="margin-bottom:2px;">Videos</h2><div class="sub">Top videos matching "${escapeHtml(q)}"</div></div></div>`;
    } else if (tabForCall === 'photos') {
      const posts = await searchPhotos(q, ts.offset);
      if (myToken !== _searchReqToken) return;
      dataCount = posts.length;
      html = renderSquareGrid(posts, false) || emptyState('No photos found', `No photos match "${q}"`);
      if (replace) headHtml = `<div class="results-head"><h2>Photos<span class="cnt">(${formatCount(dataCount)} found)</span></h2></div>`;
    } else if (tabForCall === 'market') {
      const listings = await searchListings(q, ts.offset);
      if (myToken !== _searchReqToken) return;
      dataCount = listings.length;
      const cards = listings.map(marketCardHtml).join('');
      html = cards ? `<div class="market-grid">${cards}</div>` : emptyState('No listings found', `No listings match "${q}"`);
      if (replace) headHtml = `<div class="results-head"><h2>Market<span class="cnt">(${formatCount(dataCount)} found)</span></h2></div>`;
    } else if (tabForCall === 'hashtags') {
      const tags = await searchHashtagsOnly(q, ts.offset);
      if (myToken !== _searchReqToken) return;
      dataCount = tags.length;
      html = tags.map(t => `<div class="tag-row" onclick="Search.openHashtag('${escapeHtml(t)}')"><div class="box">${ICON.hashtag}</div><div class="info"><div class="name">#${escapeHtml(t)}</div></div><div class="chev">${ICON.chevRight}</div></div>`).join('') || emptyState('No hashtags found', `No hashtags match "${q}"`);
      if (replace) headHtml = `<div class="results-head"><h2>Hashtags<span class="cnt">(${formatCount(dataCount)} found)</span></h2></div>`;
    } else {
      const result = await searchAll(q, ts.offset);
      if (myToken !== _searchReqToken) return;
      dataCount = result.posts.length;
      const mixed = [];
      result.posts.forEach(p => mixed.push({ type: 'post', item: p }));
      result.users.slice(0, 4).forEach(u => mixed.push({ type: 'user', item: u }));
      result.market.slice(0, 4).forEach(m => mixed.push({ type: 'market', item: m }));
      result.hashtags.slice(0, 3).forEach(t => mixed.push({ type: 'hashtag', item: t }));
      html = mixed.map(e => {
        if (e.type === 'post') return trendingPostCard(e.item);
        if (e.type === 'user') return userRowHtml(e.item);
        if (e.type === 'market') return `<div class="market-grid" style="grid-template-columns:1fr;">${marketCardHtml(e.item)}</div>`;
        if (e.type === 'hashtag') return `<div class="tag-row" onclick="Search.openHashtag('${escapeHtml(e.item)}')"><div class="box">${ICON.hashtag}</div><div class="info"><div class="name">#${escapeHtml(e.item)}</div></div><div class="chev">${ICON.chevRight}</div></div>`;
        return '';
      }).join('');
      if (!html) html = emptyState('No results found', `We couldn't find anything for "${q}"`);
    }
    if (myToken !== _searchReqToken) return;
    if (replace) container.innerHTML = headHtml + html;
    else container.insertAdjacentHTML('beforeend', html);
    ts.offset += dataCount;
    ts.hasMore = dataCount === PAGE_SIZE;
    if (replace) cacheCurrentTab(container.innerHTML);
    createSentinel();
    if (!ts.hasMore) showEndResults(); else showLoadMoreIdle();
    startInfiniteScroll();
  }

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
    // ★ FIX: was ICON.share which doesn't exist → now uses svgShare().
    hh.innerHTML = `
      <div class="top-row">
        <button class="back" onclick="Search.exitHashtagMode()">${ICON.back}</button>
        <div class="box">${ICON.hashtag}</div>
        <div class="title-block"><h1>#${escapeHtml(currentHashtag)}</h1><div class="cnt" id="hashtagCount"></div></div>
        <div class="side-actions"><button class="follow-btn rel-follow" id="hashtagFollowBtn">Follow</button><button class="icon-btn">${svgShare()}</button></div>
      </div>
      <div class="subtabs" id="hashtagSubtabs">
        <button data-view="top" class="active" onclick="Search._setHashtagView('top')">${ICON.trendUp}Top</button>
        <button data-view="photos" onclick="Search._setHashtagView('photos')">${ICON.photo}Photos</button>
        <button data-view="videos" onclick="Search._setHashtagView('videos')">${ICON.video}Videos</button>
      </div>`;
  }

  async function enterHashtagMode(tag) {
    ++_searchReqToken;
    hashtagMode = true; currentHashtag = tag; hashtagView = 'top'; hashtagSort = 'top'; currentQuery = '';
    showNormalHeader(false); showTabs(false); disconnectObserver();
    renderHashtagHeaderShell();
    document.getElementById('searchInput').value = '';
    document.getElementById('clearBtn').classList.remove('show');
    const ts = paging.hashtags;
    ts.offset = 0; ts.hasMore = true; ts.cache = null;
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
    const ts = paging.hashtags;
    if (replace) { ts.offset = 0; ts.hasMore = true; container.innerHTML = ''; }
    const [posts, count] = await Promise.all([
      searchHashtagPosts(currentHashtag, hashtagSort, ts.offset),
      replace ? getHashtagCount(currentHashtag) : Promise.resolve(null)
    ]);
    if (replace && count !== null) {
      const el = document.getElementById('hashtagCount');
      if (el) el.textContent = `${formatCount(count)} posts`;
    }
    let html;
    if (hashtagView === 'photos') html = renderSquareGrid(posts.filter(p => (p.media_type||p.mediaType) !== 'video'), true);
    else if (hashtagView === 'videos') html = posts.length ? `<div class="vid-grid">${posts.filter(p=>(p.media_type||p.mediaType)==='video').map(vidCardHtml).join('')}</div>` : '';
    else html = `<div class="pcard-grid">${posts.map(pcardHtml).join('')}</div>`;
    if (!html) html = emptyState('No posts yet', `Be the first to post with #${currentHashtag}`);
    if (replace) container.innerHTML = html;
    else container.insertAdjacentHTML('beforeend', html);
    ts.offset += posts.length;
    ts.hasMore = posts.length === PAGE_SIZE;
    if (replace) cacheCurrentTab(container.innerHTML);
    createSentinel();
    if (!ts.hasMore) showEndResults(); else showLoadMoreIdle();
    startInfiniteScroll();
  }

  function switchTab(tab) {
    ++_searchReqToken;
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
    showNormalHeader(true); showTabs(true); renderTabsBar(); disconnectObserver();
    const c = document.getElementById('resultsContainer');
    c.innerHTML = `<div class="center-loading"><span class="spin-icon"></span>Loading</div>`;
    const hashtags = await fetchTrendingHashtags(30);
    c.innerHTML = `<div class="results-head"><h2>Hashtags<span class="cnt">(${formatCount(hashtags.length)} found)</span></h2></div>` +
      (hashtags.length ? hashtags.map(h => `<div class="tag-row" onclick="Search.openHashtag('${escapeHtml(h.tag)}')"><div class="box">${ICON.hashtag}</div><div class="info"><div class="name">#${escapeHtml(h.tag)}</div><div class="cnt">${formatCount(h.count)} posts</div></div><div class="chev">${ICON.chevRight}</div></div>`).join('') : emptyState('No hashtags yet'));
  }

  function onQueryInput(val) {
    const hadQuery = !!currentQuery;
    currentQuery = val.trim();
    document.getElementById('clearBtn').classList.toggle('show', !!currentQuery);
    clearTimeout(searchDebounce);
    if (!currentQuery) { ++_searchReqToken; disconnectObserver(); renderDiscovery(); return; }
    if (!hadQuery) { showTabs(true); renderTabsBar(); }
    searchDebounce = setTimeout(() => { addRecentSearch(currentQuery); renderSearchResults(currentQuery, true); }, 350);
  }
  function runSearch(q) { document.getElementById('searchInput').value = q; onQueryInput(q); }
  function onFocus() { if (!currentQuery) renderDiscovery(); }
  function clear() {
    ++_searchReqToken;
    document.getElementById('searchInput').value = '';
    document.getElementById('clearBtn').classList.remove('show');
    currentQuery = ''; disconnectObserver(); renderDiscovery();
  }
  function exitHashtagMode() {
    ++_searchReqToken;
    hashtagMode = false; currentHashtag = '';
    document.getElementById('hashtagHeader').style.display = 'none';
    showNormalHeader(true); disconnectObserver();
    history.pushState({}, '', 'search.html');
    renderDiscovery();
  }

  // ─── MODAL EVENT WIRING ──────────────────────────────────
  function wireModals() {
    const lbClose = document.getElementById('galleryLightboxClose');
    if (lbClose) lbClose.addEventListener('click', closeLightbox);
    const lb = document.getElementById('lightbox');
    if (lb) lb.addEventListener('click', function (e) { if (e.target === this) closeLightbox(); });

    setupLightboxCommentsBar();

    const sortModal = document.getElementById('commentSortModal');
    if (sortModal) sortModal.addEventListener('click', e => { if (e.target.id === 'commentSortModal') closeCommentSortModal(); });

    const shareCloseBtn = document.getElementById('share-close-btn');
    if (shareCloseBtn) shareCloseBtn.addEventListener('click', closeShareModal);
    const shareModal = document.getElementById('share-modal');
    if (shareModal) shareModal.addEventListener('click', function (e) { if (e.target === this) closeShareModal(); });
    document.querySelectorAll('.share-option').forEach(btn => {
      btn.addEventListener('click', () => { const a = btn.dataset.share; if (a) handleShareAction(a); });
    });

    const rqc = document.getElementById('repostQuoteCloseBtn');
    if (rqc) rqc.addEventListener('click', closeRepostQuoteModal);
    const rqOverlay = document.getElementById('repostQuoteOverlay');
    if (rqOverlay) rqOverlay.addEventListener('click', (e) => { if (e.target === rqOverlay) closeRepostQuoteModal(); });
    const rqInput = document.getElementById('repostQuoteInput');
    if (rqInput) rqInput.addEventListener('input', updateRepostCharCount);
    const rqSubmit = document.getElementById('repostSubmitBtn');
    if (rqSubmit) rqSubmit.addEventListener('click', async () => {
      if (!repostQuoteTargetId) return;
      const quote = document.getElementById('repostQuoteInput').value.trim();
      if (!(window.AuthUser && window.AuthUser.requireAuth)) { showToast('Please sign in', 'o'); return; }
      window.AuthUser.requireAuth(async () => {
        try {
          const result = await window.PostsAPI.toggleRepostAPI(repostQuoteTargetId, quote);
          const post = _getPost(repostQuoteTargetId);
          if (post && typeof result.count === 'number') post.repostCount = result.count;
          await refreshFooterForPost(repostQuoteTargetId);
          showToast('Reposted');
          closeRepostQuoteModal();
        } catch (err) { showToast(err.message, 'r'); }
      });
    });

    document.addEventListener('keydown', e => {
      if (document.getElementById('lightbox').classList.contains('show')) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (_galleryState.items.length > 1) galleryGoTo(_galleryState.index + 1); else goToNextLightboxPost();
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (_galleryState.items.length > 1) galleryGoTo(_galleryState.index - 1);
          return;
        }
        if (e.key === ' ') { e.preventDefault(); toggleActiveLightboxPlayback(); return; }
      }
      if (e.key === 'Escape') {
        closeLightbox();
        closeShareModal();
        closeRepostQuoteModal();
        closeCommentSortModal();
        if (document.getElementById('searchPeekModal').classList.contains('open')) closeImagePeek();
      }
    });

    // ★ FIX: external link delegation (was dead before).
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-extlink]');
      if (!a) return;
      e.preventDefault();
      try {
        const url = decodeURIComponent(a.dataset.extlink);
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (err) {}
    });
  }

  async function refreshFooterForPost(postId) {
    const p = _getPost(postId);
    if (!p) return;
    const footer = document.getElementById('galleryLightboxFooter');
    if (footer && _galleryState.postId === postId) {
      footer.innerHTML = buildLightboxCaptionHTML(p) + buildLbScrubberHTML() + buildActionsRow(p);
    }
    document.querySelectorAll(`[data-repost-btn="${postId}"] .repost-count-num`).forEach(el => el.textContent = formatCount(p.repostCount || p.repost_count || 0));
  }

  // ─── PUBLIC API ──────────────────────────────────────────
  window.Search = {
    switchTab, onQueryInput, onFocus, clear, runSearch,
    openHashtag, exitHashtagMode,
    _setHashtagView: setHashtagView,
    removeRecent: removeRecentSearch,
    clearAllRecent,
    _openImagePeek: openImagePeek,
    _closePeek: closeImagePeek,
    _peekExpand: peekExpand,
    _peekGoToProfile: peekGoToProfile,
    _openVideoDirect: openVideoDirect,
    _openPost: _openPost,
    _openCommentSort: openCommentSortModal,
    reloadFollowSets: () => loadFollowSets(true) // ★ FIX: expose manual refresh
  };

  // ─── INIT ────────────────────────────────────────────────
  function init() {
    document.getElementById('searchIcon').innerHTML = ICON.search;
    document.getElementById('clearBtn').innerHTML = ICON.close;
    wireModals();

    // ★ FIX: retry follow-set load when auth resolves
    if (window.AuthUser && window.AuthUser.onChange) {
      window.AuthUser.onChange(() => {
        loadFollowSets(true).then(() => {
          // Re-render anything currently showing follow buttons so they reflect the new state
          if (currentQuery) renderSearchResults(currentQuery, true);
          else if (!hashtagMode) renderDiscovery();
        });
      });
    }

    const params = new URLSearchParams(window.location.search);
    const tagParam = params.get('tag') || params.get('hashtag');
    const queryParam = params.get('q');
    showTabs(false);
    if (tagParam) enterHashtagMode(tagParam);
    else if (queryParam) { document.getElementById('searchInput').value = queryParam; runSearch(queryParam); }
    else renderDiscovery();
    const main = document.getElementById('mainScroll');
    if (main) main.addEventListener('scroll', function () {
      if (currentQuery || hashtagMode) paging[currentTab].scrollY = main.scrollTop;
    });
    window.addEventListener('popstate', () => {
      const np = new URLSearchParams(location.search);
      const t = np.get('tag');
      if (t) enterHashtagMode(t);
      else {
        hashtagMode = false;
        document.getElementById('hashtagHeader').style.display = 'none';
        showNormalHeader(true); renderDiscovery();
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
