/* ============================================================
   FreeUpper — auth.js
   ============================================================ */
(function () {
  'use strict';

  // ─── CONFIG ────────────────────────────────────────────────
  const SUPABASE_URL = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptanRxaWRpcnBtbmVnenZtaWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4ODk0OTAsImV4cCI6MjA5OTQ2NTQ5MH0.Lfxtyexew35L3uzy3bxPcBHogsnlMcAVOE-Ho50FZpk';

  const CLOUDINARY_CLOUD_NAME = 'duzyf1kda';
  const CLOUDINARY_AVATAR_PRESET = 'image_upload';

  const USER_KEY = 'freeupper_user_profile';
  const ALL_USERS_KEY = 'freeupper_all_users';

  if (!window.supabase) {
    console.error('auth.js: include the Supabase CDN script before this file.');
    return;
  }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.sb = sb;

  // ─── LOCAL PROFILE MIRROR ──────────────────────────────────
  function defaultGuest() {
    return {
      id: 'GUEST-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      username: '',
      displayName: 'Guest',
      bio: '',
      avatar: 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#E5E7EB"/><circle cx="50" cy="38" r="16" fill="#9CA3AF"/><ellipse cx="50" cy="75" rx="30" ry="22" fill="#9CA3AF"/></svg>'
      ),
      isLoggedIn: false,
      verified: false,
      verificationStatus: 'none'
    };
  }

  function readLocalUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeLocalUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    registerInDirectory(user);
    updateAllAvatarEls(user.avatar);
    document.dispatchEvent(new CustomEvent('profileUpdated', { detail: { user } }));
  }

  function registerInDirectory(user) {
    let all = [];
    try { all = JSON.parse(localStorage.getItem(ALL_USERS_KEY) || '[]'); } catch (e) {}
    const idx = all.findIndex(u => u.id === user.id);
    const rec = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      avatar: user.avatar,
      verified: user.verified || false
    };
    if (idx >= 0) all[idx] = rec; else all.push(rec);
    localStorage.setItem(ALL_USERS_KEY, JSON.stringify(all));
  }

  function updateAllAvatarEls(src) {
    document.querySelectorAll('.side-av, .nav-av, #profileAvatar, #editAv, #qrAvatar').forEach(el => {
      if (el) el.src = src;
    });
  }

  function getCurrentUser() {
    const cached = readLocalUser();
    if (cached) return cached;
    const guest = defaultGuest();
    localStorage.setItem(USER_KEY, JSON.stringify(guest));
    return guest;
  }

  // ─── SYNC SUPABASE SESSION → LOCAL PROFILE ──────────────
  async function syncSessionToLocal(session) {
    if (!session || !session.user) return;
    const authUser = session.user;

    let { data: profile } = await sb.from('profiles').select('*').eq('id', authUser.id).single();

    if (!profile) {
      const insertPayload = {
        id: authUser.id,
        display_name: authUser.user_metadata?.display_name || authUser.email.split('@')[0],
        username: authUser.user_metadata?.username || authUser.email.split('@')[0],
        avatar_url: authUser.user_metadata?.avatar_url || null
      };
      const { data: created } = await sb.from('profiles').upsert(insertPayload).select().single();
      profile = created || insertPayload;
    }

    const localUser = {
      id: authUser.id,
      username: profile.username || '',
      displayName: profile.display_name || 'User',
      bio: profile.bio || '',
      avatar: profile.avatar_url || defaultGuest().avatar,
      email: authUser.email,
      isLoggedIn: true,
      verified: profile.verified || false,
      verificationStatus: 'none',
      isPrivate: profile.is_private || false,
      hideFollowerCount: profile.hide_follower_count || false,
      activityStatus: profile.activity_status !== undefined ? profile.activity_status : true,
      gender: profile.gender || '',
      country: profile.country || '',
      phone: profile.phone || '',
      dob: profile.dob || null
    };
    writeLocalUser(localUser);
  }

  sb.auth.onAuthStateChange((_event, session) => {
    if (session) syncSessionToLocal(session);
    else {
      const guest = defaultGuest();
      localStorage.setItem(USER_KEY, JSON.stringify(guest));
      updateAllAvatarEls(guest.avatar);
    }
  });

  sb.auth.getSession().then(({ data }) => {
    if (data.session) syncSessionToLocal(data.session);
  });

  // ─── AUTH MODAL ─────────────────────────────────────────────
  let mode = 'signup';
  let pendingAction = null;
  let modalInitialized = false;

  function renderAuthForm() {
    document.getElementById('fu-auth-error').textContent = '';
    if (mode === 'signup') {
      document.getElementById('fu-auth-title').textContent = 'Join FreeUpper';
      document.getElementById('fu-auth-sub').textContent = 'Create an account to post, comment, and save favorites.';
      document.getElementById('fu-name-field').style.display = 'block';
      document.getElementById('fu-submit-btn').textContent = 'Create Account';
      document.getElementById('fu-auth-switch').innerHTML =
        'Already have an account? <button id="fu-switch-btn" type="button">Sign In</button>';
    } else {
      document.getElementById('fu-auth-title').textContent = 'Welcome Back';
      document.getElementById('fu-auth-sub').textContent = 'Sign in to continue to FreeUpper.';
      document.getElementById('fu-name-field').style.display = 'none';
      document.getElementById('fu-submit-btn').textContent = 'Sign In';
      document.getElementById('fu-auth-switch').innerHTML =
        "Don't have an account? <button id=\"fu-switch-btn\" type=\"button\">Sign Up</button>";
    }
    const switchBtn = document.getElementById('fu-switch-btn');
    if (switchBtn) {
      switchBtn.addEventListener('click', function() {
        mode = mode === 'signup' ? 'signin' : 'signup';
        renderAuthForm();
      });
    }
  }

  function openModal(startMode, onSuccess) {
    console.log('🔓 Opening auth modal, mode:', startMode);
    mode = startMode || 'signup';
    pendingAction = onSuccess || null;
    
    // Ensure modal exists
    if (!modalInitialized) {
      createAuthModal();
    }
    
    renderAuthForm();
    const overlay = document.getElementById('fu-auth-overlay');
    if (overlay) {
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    } else {
      console.error('❌ Modal overlay not found!');
    }
  }

  function closeModal() {
    const overlay = document.getElementById('fu-auth-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
    pendingAction = null;
  }

  function createAuthModal() {
    if (modalInitialized) return;
    if (!document.body) {
      console.warn('⚠️ document.body not ready, retrying...');
      setTimeout(createAuthModal, 100);
      return;
    }
    if (document.getElementById('fu-auth-overlay')) {
      modalInitialized = true;
      return;
    }

    const modalCSS = `
    #fu-auth-overlay{position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.7);
      backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;
      opacity:0;pointer-events:none;transition:opacity .25s;padding:20px}
    #fu-auth-overlay.open{opacity:1;pointer-events:auto}
    #fu-auth-card{width:100%;max-width:380px;background:var(--bg3,#111);border:1px solid var(--brd2,rgba(255,255,255,.1));
      border-radius:24px;padding:28px 24px 24px;transform:scale(.94);transition:transform .25s;
      box-shadow:0 24px 80px rgba(0,0,0,.6);color:var(--text,#fff);font-family:inherit;position:relative}
    #fu-auth-overlay.open #fu-auth-card{transform:scale(1)}
    #fu-auth-close{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:50%;
      background:rgba(255,255,255,.08);border:none;color:var(--text,#fff);cursor:pointer;font-size:16px}
    #fu-auth-logo{text-align:center;font-weight:900;font-size:22px;letter-spacing:-1px;margin-bottom:4px}
    #fu-auth-logo span{color:#8b5cf6}
    #fu-auth-title{text-align:center;font-weight:800;font-size:18px;margin-bottom:4px}
    #fu-auth-sub{text-align:center;font-size:13px;color:var(--muted,rgba(255,255,255,.5));margin-bottom:18px;line-height:1.5}
    .fu-field{margin-bottom:12px}
    .fu-field input{width:100%;padding:12px 14px;border-radius:12px;border:1.5px solid var(--brd2,rgba(255,255,255,.12));
      background:var(--inp,rgba(255,255,255,.05));color:var(--text,#fff);font-size:14px;outline:none;box-sizing:border-box}
    .fu-field input:focus{border-color:#8b5cf6}
    #fu-auth-error{font-size:12px;color:#f87171;min-height:16px;margin-bottom:6px}
    .fu-btn-primary{width:100%;padding:13px;border-radius:12px;border:none;cursor:pointer;
      background:linear-gradient(135deg,#8b5cf6,#6c3fc5);color:#fff;font-weight:800;font-size:14px;
      box-shadow:0 4px 18px rgba(108,63,197,.45)}
    .fu-btn-primary:disabled{opacity:.5;cursor:default}
    .fu-divider{display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--muted2,rgba(255,255,255,.35));font-size:12px}
    .fu-divider::before,.fu-divider::after{content:'';flex:1;height:1px;background:var(--brd2,rgba(255,255,255,.12))}
    .fu-btn-google{width:100%;padding:12px;border-radius:12px;border:1.5px solid var(--brd2,rgba(255,255,255,.15));
      background:transparent;color:var(--text,#fff);font-weight:700;font-size:13.5px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;gap:8px}
    #fu-auth-switch{text-align:center;font-size:13px;color:var(--muted,rgba(255,255,255,.55));margin-top:16px}
    #fu-auth-switch button{background:none;border:none;color:#a78bfa;font-weight:700;cursor:pointer;font-size:13px}
    `;

    if (!document.getElementById('fu-auth-styles')) {
      const style = document.createElement('style');
      style.id = 'fu-auth-styles';
      style.textContent = modalCSS;
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = 'fu-auth-overlay';
    overlay.innerHTML = `
      <div id="fu-auth-card">
        <button id="fu-auth-close" type="button">&#10005;</button>
        <div id="fu-auth-logo">Free<span>Upper</span></div>
        <div id="fu-auth-title">Join FreeUpper</div>
        <div id="fu-auth-sub">Create an account to post, comment, and save favorites.</div>
        <div id="fu-auth-error"></div>
        <div id="fu-name-field" class="fu-field"><input id="fu-name" type="text" placeholder="Full name" /></div>
        <div class="fu-field"><input id="fu-email" type="email" placeholder="Email address" /></div>
        <div class="fu-field"><input id="fu-password" type="password" placeholder="Password" /></div>
        <button class="fu-btn-primary" id="fu-submit-btn" type="button">Create Account</button>
        <div class="fu-divider">OR</div>
        <button class="fu-btn-google" id="fu-google-btn" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3 14.6 2 12 2 6.9 2 2.7 6.1 2.7 11.8S6.9 21.6 12 21.6c6.9 0 9.3-4.8 9.3-7.3 0-.5-.1-.9-.1-1.3H12z"/></svg>
          Continue with Google
        </button>
        <div id="fu-auth-switch">Already have an account? <button id="fu-switch-btn" type="button">Sign In</button></div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('fu-auth-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    document.getElementById('fu-submit-btn').addEventListener('click', handleAuthSubmit);
    document.getElementById('fu-google-btn').addEventListener('click', handleGoogleAuth);

    modalInitialized = true;
    console.log('✅ Auth modal created');
  }

  // ─── AUTH HANDLERS ──────────────────────────────────────────
  async function handleAuthSubmit() {
    const errEl = document.getElementById('fu-auth-error');
    const email = document.getElementById('fu-email').value.trim();
    const password = document.getElementById('fu-password').value;
    const name = document.getElementById('fu-name').value.trim();
    errEl.textContent = '';

    if (!email || !password) {
      errEl.textContent = 'Please fill in email and password.';
      return;
    }

    const btn = document.getElementById('fu-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Please wait…';

    try {
      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: { data: { display_name: name || email.split('@')[0], username: (name || email.split('@')[0]).toLowerCase().replace(/\s+/g, '') } }
        });
        if (error) throw error;
        if (data.session) await syncSessionToLocal(data.session);
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await syncSessionToLocal(data.session);
      }
      closeModal();
      if (pendingAction) { const fn = pendingAction; pendingAction = null; fn(); }
    } catch (e) {
      errEl.textContent = e.message || 'Something went wrong.';
    } finally {
      btn.disabled = false;
      btn.textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
    }
  }

  async function handleGoogleAuth() {
    await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
  }

  // ─── PROTECTED ACTION WRAPPER ────────────────────────────
  function requireAuth(fn) {
    const user = getCurrentUser();
    console.log('🔐 requireAuth called, user logged in:', user.isLoggedIn);
    
    if (user && user.isLoggedIn) {
      console.log('✅ User is logged in, executing action');
      fn();
      return;
    }
    
    console.log('❌ User is not logged in, showing signup modal');
    // Ensure modal exists before opening
    if (!modalInitialized) {
      createAuthModal();
    }
    openModal('signup', fn);
  }

  // ─── CLOUDINARY AVATAR UPLOAD ────────────────────────────
  async function uploadAvatar(file, onProgress) {
    const user = getCurrentUser();
    if (!user.isLoggedIn) { openModal('signup'); return null; }

    if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
    if (file.size > 5 * 1024 * 1024) throw new Error('Image too large (max 5MB)');

    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_AVATAR_PRESET);

    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && !res.error) resolve(res);
          else reject(new Error(res.error?.message || 'Avatar upload failed'));
        } catch (e) { reject(new Error('Avatar upload failed')); }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });

    if (onProgress) onProgress(100);

    await sb.from('profiles').update({ avatar_url: data.secure_url }).eq('id', user.id);

    const updated = { ...user, avatar: data.secure_url };
    writeLocalUser(updated);
    return data.secure_url;
  }

  async function signOut() {
    await sb.auth.signOut();
  }

  // ─── INIT ──────────────────────────────────────────────────
  function initAuth() {
    // Create modal on DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createAuthModal);
    } else {
      createAuthModal();
    }
  }

  // ─── EXPOSE ───────────────────────────────────────────────
  window.AuthUser = {
    getCurrentUser: getCurrentUser,
    requireAuth: requireAuth,
    uploadAvatar: uploadAvatar,
    signOut: signOut,
    openModal: openModal,
    closeModal: closeModal
  };

  window.getCurrentUser = getCurrentUser;

  // Init
  initAuth();

  console.log('✅ AuthUser is ready:', window.AuthUser);
})();