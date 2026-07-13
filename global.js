// ══════════════════════════════════════════
// GLOBAL DATA LAYER + THEME + UTILITIES
// Used across all Freeupper pages
// ══════════════════════════════════════════

(function () {
  'use strict';

  // ─── LOCAL STORAGE KEYS ──────────────────
  const THEME_KEY = 'freeupper_theme';
  const USER_KEY = 'freeupper_user_profile';
  const ALL_USERS_KEY = 'freeupper_all_users';
  const FOLLOW_KEY = 'freeupper_follows';
  const BLOG_KEY = 'freeupper_blog_data_v2';
  const BOOKMARK_KEY = 'freeupper_bookmarks';
  const SHARE_KEY = 'freeupper_shares';               // ← NEW
  const VERIFICATION_KEY = 'freeupper_verification_requests'; // ← NEW
  const MARKET_SAVED_KEY = 'freeupper_market_saved';

  // ─── THEME CONTROLLER (already provided) ──
  let currentTheme = localStorage.getItem(THEME_KEY) || 'dark';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    currentTheme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: theme } }));
    updateThemeButton();
  }

  window.toggleTheme = function () {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
  };

  window.getCurrentTheme = function () {
    return currentTheme;
  };

  function updateThemeButton() {
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      const svg = btn.querySelector('svg');
      if (svg) {
        if (currentTheme === 'dark') {
          svg.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
        } else {
          svg.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
        }
      }
    });
  }

  function initTheme() {
    applyTheme(currentTheme);
    window.addEventListener('storage', function (e) {
      if (e.key === THEME_KEY && e.newValue && e.newValue !== currentTheme) {
        applyTheme(e.newValue);
      }
    });
    document.addEventListener('themeChanged', function (e) {
      if (e.detail && e.detail.theme) {
        currentTheme = e.detail.theme;
        updateThemeButton();
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  // ─── USER CRUD ────────────────────────────
  function getDefaultUser() {
    return {
      id: 'FU-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      username: '',
      displayName: 'Guest',
      bio: '',
      website: '',
      avatar: 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#E5E7EB"/><circle cx="50" cy="38" r="16" fill="#9CA3AF"/><ellipse cx="50" cy="75" rx="30" ry="22" fill="#9CA3AF"/></svg>'
      ),
      createdAt: Date.now(),
      isLoggedIn: false,
      isPrivate: false,
      verified: false,
      verificationStatus: 'none', // 'none' | 'pending' | 'approved' | 'rejected'
      isAdmin: false,            // only admins can access admin.html
      gender: '',
      dob: null,
      country: '',
      phone: '',
      hideFollowerCount: false,
      hideFollowingCount: false,
      activityStatus: true
    };
  }

  window.getCurrentUser = function () {
    let user = JSON.parse(localStorage.getItem(USER_KEY));
    if (!user) {
      user = getDefaultUser();
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
    return user;
  };

  window.saveCurrentUser = function (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    // Also update directory
    registerCurrentUserInDirectory(user);
  };

  window.getAllUsers = function () {
    return JSON.parse(localStorage.getItem(ALL_USERS_KEY) || '[]');
  };

  function registerCurrentUserInDirectory(user) {
    let all = getAllUsers();
    const idx = all.findIndex(u => u.id === user.id);
    const record = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      website: user.website,
      avatar: user.avatar,
      isPrivate: user.isPrivate || false,
      verified: user.verified || false,
      verificationStatus: user.verificationStatus || 'none',
      isAdmin: user.isAdmin || false,
      gender: user.gender || '',
      dob: user.dob || null,
      country: user.country || '',
      phone: user.phone || '',
      hideFollowerCount: user.hideFollowerCount || false,
      hideFollowingCount: user.hideFollowingCount || false,
      activityStatus: user.activityStatus !== undefined ? user.activityStatus : true
    };
    if (idx >= 0) all[idx] = record;
    else all.push(record);
    localStorage.setItem(ALL_USERS_KEY, JSON.stringify(all));
  }

  // Auto-register the current user on page load
  (function registerOnLoad() {
    const user = window.getCurrentUser();
    registerCurrentUserInDirectory(user);
  })();

  // ─── FOLLOW SYSTEM ────────────────────────
  window.getFollows = function () {
    return JSON.parse(localStorage.getItem(FOLLOW_KEY) || '{}');
  };

  function saveFollows(follows) {
    localStorage.setItem(FOLLOW_KEY, JSON.stringify(follows));
  }

  window.isFollowing = function (userId) {
    const follows = getFollows();
    return !!follows[userId];
  };

  window.toggleFollowUser = function (userId) {
    const follows = getFollows();
    if (follows[userId]) {
      delete follows[userId];
    } else {
      follows[userId] = true;
    }
    saveFollows(follows);
    return !!follows[userId];
  };

  window.getFollowCounts = function (userId) {
    const all = getAllUsers();
    const follows = getFollows();
    let followers = 0;
    let following = 0;
    for (const uid in follows) {
      if (follows[uid]) following++;
    }
    for (const uid in follows) {
      if (follows[uid] && all.find(u => u.id === uid)) followers++;
    }
    return { followers, following };
  };

  // ─── BLOG DATA (posts) ────────────────────
  function getDefaultBlogData() {
    return {
      posts: [],
      nextId: 1,
      nextCommentId: 1,
      userReactions: {},
      notificationLastId: 0,
      notifications: [],
      marketItems: [],
      nextMarketId: 1,
      views: {},
      watchTime: {}
    };
  }

  window.loadBlogData = function () {
    const raw = localStorage.getItem(BLOG_KEY);
    const data = raw ? JSON.parse(raw) : getDefaultBlogData();
    if (!data.marketItems) data.marketItems = [];
    if (!data.nextMarketId) data.nextMarketId = 1;
    if (!data.userReactions) data.userReactions = {};
    if (!data.notifications) data.notifications = [];
    return data;
  };

  window.saveBlogData = function (data) {
    localStorage.setItem(BLOG_KEY, JSON.stringify(data));
  };

  // ─── POST CRUD ────────────────────────────
  window.getPosts = function () {
    return loadBlogData().posts;
  };

  window.savePost = function (post) {
    const data = loadBlogData();
    data.posts.unshift(post);
    data.nextId++;
    saveBlogData(data);
  };

  window.deletePost = function (postId) {
    const data = loadBlogData();
    data.posts = data.posts.filter(p => p.id !== postId);
    saveBlogData(data);
  };

  window.getUserPosts = function (userId) {
    const data = loadBlogData();
    return data.posts.filter(p => p.authorId === userId);
  };

  // ─── MARKET CRUD ──────────────────────────
  window.getMarketItems = function () {
    return loadBlogData().marketItems;
  };

  window.saveMarketItem = function (item) {
    const data = loadBlogData();
    data.marketItems.unshift(item);
    data.nextMarketId++;
    saveBlogData(data);
  };

  window.deleteMarketItem = function (itemId) {
    const data = loadBlogData();
    data.marketItems = data.marketItems.filter(i => i.id !== itemId);
    saveBlogData(data);
  };

  window.getUserMarketItems = function (userId) {
    const data = loadBlogData();
    return data.marketItems.filter(i => i.sellerId === userId);
  };

  // ─── REACTIONS ────────────────────────────
  window.toggleReaction = function (postId, type) {
    type = type || 'like'; // we only use 'like' for now
    const data = loadBlogData();
    const key = postId + '-' + type;
    const post = data.posts.find(p => p.id === postId);
    if (!post) return;
    if (data.userReactions[key]) {
      delete data.userReactions[key];
      if (post.reactions && post.reactions[type]) {
        post.reactions[type] = Math.max(0, post.reactions[type] - 1);
      }
    } else {
      data.userReactions[key] = true;
      if (post.reactions) {
        post.reactions[type] = (post.reactions[type] || 0) + 1;
      } else {
        post.reactions = { like: 1 };
      }
    }
    saveBlogData(data);
    return data.userReactions[key] ? true : false;
  };

  window.hasReacted = function (postId, type) {
    const data = loadBlogData();
    return !!data.userReactions[postId + '-' + (type || 'like')];
  };

  // ─── BOOKMARKS ────────────────────────────
  window.getBookmarks = function () {
    return JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]');
  };

  window.saveBookmarks = function (bookmarks) {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks));
  };

  window.toggleBookmark = function (postId) {
    let b = getBookmarks();
    if (b.includes(postId)) {
      b = b.filter(id => id !== postId);
    } else {
      b.push(postId);
    }
    saveBookmarks(b);
    return b.includes(postId);
  };

  window.isBookmarked = function (postId) {
    return getBookmarks().includes(postId);
  };

  // ─── SHARES ───────────────────────────────
  window.getShares = function () {
    return JSON.parse(localStorage.getItem(SHARE_KEY) || '[]');
  };

  window.saveShares = function (shares) {
    localStorage.setItem(SHARE_KEY, JSON.stringify(shares));
  };

  window.toggleShare = function (postId) {
    let s = getShares();
    if (s.includes(postId)) {
      s = s.filter(id => id !== postId);
    } else {
      s.push(postId);
    }
    saveShares(s);
    return s.includes(postId);
  };

  window.isShared = function (postId) {
    return getShares().includes(postId);
  };

  // ─── VERIFICATION REQUESTS ────────────────
  window.getVerificationRequests = function () {
    return JSON.parse(localStorage.getItem(VERIFICATION_KEY) || '[]');
  };

  window.saveVerificationRequests = function (requests) {
    localStorage.setItem(VERIFICATION_KEY, JSON.stringify(requests));
  };

  window.submitVerificationRequest = function (userId, category, reason, link) {
    const requests = getVerificationRequests();
    // Check if already pending
    const existing = requests.find(r => r.userId === userId && r.status === 'pending');
    if (existing) {
      return false; // already pending
    }
    const newRequest = {
      id: 'vreq-' + Date.now(),
      userId: userId,
      category: category,
      reason: reason,
      link: link || '',
      status: 'pending', // pending | approved | rejected
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      rejectionReason: null
    };
    requests.push(newRequest);
    saveVerificationRequests(requests);
    // Update user's verificationStatus
    const user = getCurrentUser();
    if (user.id === userId) {
      user.verificationStatus = 'pending';
      saveCurrentUser(user);
    }
    return true;
  };

  window.approveVerification = function (requestId) {
    const requests = getVerificationRequests();
    const req = requests.find(r => r.id === requestId);
    if (!req) return false;
    req.status = 'approved';
    req.reviewedAt = new Date().toISOString();
    saveVerificationRequests(requests);
    // Update user's verified flag
    const allUsers = getAllUsers();
    const user = allUsers.find(u => u.id === req.userId);
    if (user) {
      user.verified = true;
      user.verificationStatus = 'approved';
      localStorage.setItem(ALL_USERS_KEY, JSON.stringify(allUsers));
      // Also update current user if same
      const current = getCurrentUser();
      if (current.id === req.userId) {
        current.verified = true;
        current.verificationStatus = 'approved';
        saveCurrentUser(current);
      }
    }
    return true;
  };

  window.rejectVerification = function (requestId, reason) {
    const requests = getVerificationRequests();
    const req = requests.find(r => r.id === requestId);
    if (!req) return false;
    req.status = 'rejected';
    req.reviewedAt = new Date().toISOString();
    req.rejectionReason = reason || '';
    saveVerificationRequests(requests);
    // Update user's verificationStatus
    const allUsers = getAllUsers();
    const user = allUsers.find(u => u.id === req.userId);
    if (user) {
      user.verificationStatus = 'rejected';
      localStorage.setItem(ALL_USERS_KEY, JSON.stringify(allUsers));
      const current = getCurrentUser();
      if (current.id === req.userId) {
        current.verificationStatus = 'rejected';
        saveCurrentUser(current);
      }
    }
    return true;
  };

  // ─── MARKET SAVED ─────────────────────────
  window.getMarketSaved = function () {
    return JSON.parse(localStorage.getItem(MARKET_SAVED_KEY) || '[]');
  };

  window.saveMarketSaved = function (items) {
    localStorage.setItem(MARKET_SAVED_KEY, JSON.stringify(items));
  };

  window.toggleMarketSaved = function (itemId) {
    let s = getMarketSaved();
    if (s.includes(itemId)) {
      s = s.filter(id => id !== itemId);
    } else {
      s.push(itemId);
    }
    saveMarketSaved(s);
    return s.includes(itemId);
  };

  // ─── NAVIGATION HELPERS ───────────────────
  window.updateNavAvatar = function () {
    const user = getCurrentUser();
    const avatars = document.querySelectorAll('.side-av, .nav-av');
    avatars.forEach(el => {
      el.src = user.avatar;
      el.onerror = function () { this.style.display = 'none'; };
    });
  };

  window.navigateToProfile = function (userId) {
    if (!userId) userId = getCurrentUser().id;
    window.location.href = 'profile.html?uid=' + userId;
  };

  // ─── TOAST (unified) ──────────────────────
  window.showToast = function (msg, type) {
    type = type || 'p';
    const w = document.getElementById('tw');
    if (!w) return;
    const el = document.createElement('div');
    el.className = 'toast';
    const colorMap = { p: 'tp', g: 'tg', r: 'tr', o: 'to' };
    el.innerHTML = '<div class="td ' + (colorMap[type] || 'tp') + '"></div>' + msg;
    w.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 2600);
  };

  // ─── INIT ──────────────────────────────────
  // Auto-update nav avatar on page load
  document.addEventListener('DOMContentLoaded', function () {
    updateNavAvatar();
  });

})();

// ─── PROFILE UPDATE HELPER ──────────────────────
window.updateUserProfile = function(updates) {
    const user = getCurrentUser();
    Object.assign(user, updates);
    saveCurrentUser(user);
    
    // Update nav avatar immediately
    updateNavAvatar();
    
    // Dispatch custom event for same-tab listeners
    document.dispatchEvent(new CustomEvent('profileUpdated', {
        detail: { user: user }
    }));
    
    // Attempt to trigger storage event for other tabs
    try {
        window.dispatchEvent(new StorageEvent('storage', {
            key: 'freeupper_user_profile',
            newValue: JSON.stringify(user)
        }));
    } catch(e) {
        // Some browsers don't allow manual StorageEvent dispatch
        // The custom event will handle same-tab, and storage events
        // will trigger naturally when other tabs read localStorage
    }
    
    return user;
};

// ─── SYNC HELPER FOR ANY PAGE ──────────────────
window.setupProfileSync = function(refreshCallback) {
    // Listen for storage events (cross-tab)
    window.addEventListener('storage', function(e) {
        if (e.key === 'freeupper_user_profile' || e.key === 'freeupper_all_users') {
            const user = getCurrentUser();
            updateNavAvatar();
            if (typeof refreshCallback === 'function') {
                refreshCallback(user);
            }
        }
    });
    
    // Listen for custom profileUpdated event (same-tab)
    document.addEventListener('profileUpdated', function(e) {
        if (e.detail && e.detail.user) {
            updateNavAvatar();
            if (typeof refreshCallback === 'function') {
                refreshCallback(e.detail.user);
            }
        }
    });
};

