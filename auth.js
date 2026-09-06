/* ============================================================
   FreeUpper — auth.js (production)
   with Safari autofix, unique usernames, and bulletproof errors
   ============================================================ */
(function () {
  'use strict';

  // ─── CONFIG ────────────────────────────────────────────────
  const SUPABASE_URL = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptanRxaWRpcnBtbmVnenZtaWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4ODk0OTAsImV4cCI6MjA5OTQ2NTQ5MH0.Lfxtyexew35L3uzy3bxPcBHogsnlMcAVOE-Ho50FZpk';

  const CLOUDINARY_CLOUD_NAME = 'duzyf1kda';
  const CLOUDINARY_AVATAR_PRESET = 'image_upload';

  const USER_KEY = 'freeupper_user_profile';

  if (!window.supabase) {
    console.error('auth.js: include the Supabase CDN script before this file.');
    return;
  }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.sb = sb;

  // ─── CHANGE LISTENERS ──────────────────────────────────────
  const changeListeners = [];

  // ─── LOCAL PROFILE MIRROR ──────────────────────────────────
  function defaultGuest() {
    return {
      id: 'GUEST-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      username: '',
      displayName: 'Guest',
      bio: '',
      coverUrl: '',
      avatar: 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#E5E7EB"/><circle cx="50" cy="38" r="16" fill="#9CA3AF"/><ellipse cx="50" cy="75" rx="30" ry="22" fill="#9CA3AF"/></svg>'
      ),
      isLoggedIn: false,
      verified: false,
      verificationStatus: 'none',
      accountType: 'personal',
      accountIconUrl: ''
    };
  }

  function readLocalUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeLocalUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    updateAvatarEls(user.avatar);
    document.dispatchEvent(new CustomEvent('profileUpdated', { detail: { user: user } }));
    for (let i = 0; i < changeListeners.length; i++) {
      try {
        changeListeners[i](user);
      } catch (e) {
        console.error('Error in onChange listener:', e);
      }
    }
  }

  function updateAvatarEls(src) {
    const els = document.querySelectorAll('.side-av, .nav-av, #profileAvatar, #editAv, #qrAvatar');
    for (let i = 0; i < els.length; i++) {
      if (els[i]) els[i].src = src;
    }
  }

  // ─── CACHED USER (synchronous) ────────────────────────────
  function getCurrentUser() {
    const cached = readLocalUser();
    if (cached) return cached;
    const guest = defaultGuest();
    localStorage.setItem(USER_KEY, JSON.stringify(guest));
    return guest;
  }

  // ─── AUTHENTICATED USER (async) ───────────────────────────
  async function getAuthenticatedUser() {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) {
      return getCurrentUser();
    }

    const { data: profile, error: profileError } = await sb
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      console.warn('getAuthenticatedUser: profile fetch failed', profileError);
      return {
        id: user.id,
        username: user.user_metadata?.username || '',
        displayName: user.user_metadata?.display_name || 'User',
        bio: '',
        coverUrl: '',
        avatar: user.user_metadata?.avatar_url || defaultGuest().avatar,
        email: user.email,
        isLoggedIn: true,
        verified: false,
        verificationStatus: 'none',
        accountType: 'personal',
        accountIconUrl: '',
        isPrivate: false,
        hideFollowerCount: false,
        activityStatus: true,
        gender: '',
        country: '',
        phone: '',
        dob: null
      };
    }

    if (!profile) {
      const insertPayload = {
        id: user.id,
        display_name: user.user_metadata?.display_name || user.email.split('@')[0],
        username: user.user_metadata?.username || user.email.split('@')[0],
        avatar_url: user.user_metadata?.avatar_url || null,
        cover_url: null,
        verified_status: 'none',
        account_type: 'personal',
        account_icon_url: ''
      };
      const { data: newProfile, error: insertError } = await sb
        .from('profiles')
        .insert(insertPayload)
        .select()
        .single();
      if (insertError) {
        console.error('getAuthenticatedUser: could not create profile', insertError);
        return getCurrentUser();
      }
      profile = newProfile;
    }

    const localUser = {
      id: user.id,
      username: profile.username || '',
      displayName: profile.display_name || 'User',
      bio: profile.bio || '',
      coverUrl: profile.cover_url || '',
      avatar: profile.avatar_url || defaultGuest().avatar,
      email: user.email,
      isLoggedIn: true,
      verified: profile.verified_status === 'verified' ||
                 profile.verified_status === 'official' ||
                 profile.verified_status === 'staff' ||
                 profile.verified_status === 'business',
      verificationStatus: profile.verified_status || 'none',
      accountType: profile.account_type || 'personal',
      accountIconUrl: profile.account_icon_url || '',
      isPrivate: profile.is_private || false,
      hideFollowerCount: profile.hide_follower_count || false,
      activityStatus: profile.activity_status !== undefined ? profile.activity_status : true,
      gender: profile.gender || '',
      country: profile.country || '',
      phone: profile.phone || '',
      dob: profile.dob || null
    };

    writeLocalUser(localUser);
    return localUser;
  }

  // ─── SYNC SESSION ──────────────────────────────────────────
  async function syncSessionToLocal(session) {
    if (!session || !session.user) return;
    const authUser = session.user;

    try {
      const { data: profile, error } = await sb
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      if (error) {
        console.warn('syncSessionToLocal: profile fetch failed', error);
        return;
      }

      let finalProfile = profile;
      if (!profile) {
        const insertPayload = {
          id: authUser.id,
          display_name: authUser.user_metadata?.display_name || authUser.email.split('@')[0],
          username: authUser.user_metadata?.username || authUser.email.split('@')[0],
          avatar_url: authUser.user_metadata?.avatar_url || null,
          cover_url: null,
          verified_status: 'none',
          account_type: 'personal',
          account_icon_url: ''
        };
        const { data: inserted, error: insertError } = await sb
          .from('profiles')
          .insert(insertPayload)
          .select()
          .single();
        if (insertError) {
          console.error('syncSessionToLocal: could not create profile', insertError);
          return;
        }
        finalProfile = inserted;
      }

      const localUser = {
        id: authUser.id,
        username: finalProfile.username || '',
        displayName: finalProfile.display_name || 'User',
        bio: finalProfile.bio || '',
        coverUrl: finalProfile.cover_url || '',
        avatar: finalProfile.avatar_url || defaultGuest().avatar,
        email: authUser.email,
        isLoggedIn: true,
        verified: finalProfile.verified_status === 'verified' ||
                   finalProfile.verified_status === 'official' ||
                   finalProfile.verified_status === 'staff' ||
                   finalProfile.verified_status === 'business',
        verificationStatus: finalProfile.verified_status || 'none',
        accountType: finalProfile.account_type || 'personal',
        accountIconUrl: finalProfile.account_icon_url || '',
        isPrivate: finalProfile.is_private || false,
        hideFollowerCount: finalProfile.hide_follower_count || false,
        activityStatus: finalProfile.activity_status !== undefined ? finalProfile.activity_status : true,
        gender: finalProfile.gender || '',
        country: finalProfile.country || '',
        phone: finalProfile.phone || '',
        dob: finalProfile.dob || null
      };
      writeLocalUser(localUser);
    } catch (err) {
      console.error('syncSessionToLocal: unexpected error', err);
    }
  }

  // ─── REGISTER SESSION LOCATION ────────────────────────────
  async function registerSessionLocation() {
    try {
      const { error } = await sb.functions.invoke('manage-sessions', {
        body: { action: 'register' }
      });
      if (error) console.warn('registerSessionLocation failed:', error.message);
    } catch (e) {
      console.warn('registerSessionLocation exception:', e);
    }
  }

  // ─── PUBLIC: updateCurrentUser ────────────────────────────
  function updateCurrentUser(partialUpdates) {
    const current = getCurrentUser();
    const merged = Object.assign({}, current, partialUpdates);
    writeLocalUser(merged);
    return merged;
  }

  function onChange(fn) {
    if (typeof fn === 'function') {
      changeListeners.push(fn);
    }
  }

  // ─── SUPABASE AUTH STATE ──────────────────────────────────
  sb.auth.onAuthStateChange((_event, session) => {
    if (session) {
      syncSessionToLocal(session);
      if (_event === 'SIGNED_IN') {
        registerSessionLocation();
      }
    } else {
      const guest = defaultGuest();
      localStorage.setItem(USER_KEY, JSON.stringify(guest));
      updateAvatarEls(guest.avatar);
    }
  });

  // ─── AUTH MODAL ──────────────────────────────────────────────
  let mode = 'signup';
  let pendingAction = null;
  let modalInitialized = false;

  // ─── HELPER: extract Supabase error message ────────────────
  function extractErrorMessage(err) {
    if (!err) return 'Unknown error.';

    // Supabase often nests errors
    const candidate =
      err?.message ||
      err?.error_description ||
      err?.error?.message ||
      err?.error ||
      err?.msg ||
      '';

    if (candidate && candidate !== '{}' && candidate !== '') {
      return candidate;
    }

    // If it's an object, stringify it (but avoid cyclic)
    if (typeof err === 'object') {
      try {
        const str = JSON.stringify(err, Object.getOwnPropertyNames(err));
        if (str && str !== '{}' && str !== '') return str;
      } catch (_) {
        // ignore
      }
    }

    return 'Something went wrong. Please try again.';
  }

  // ─── RENDER AUTH FORM ──────────────────────────────────────
  function renderAuthForm() {
    document.getElementById('fu-auth-error').textContent = '';

    const nameField = document.getElementById('fu-name-field');
    const nameInput = document.getElementById('fu-name');
    const emailInput = document.getElementById('fu-email');
    const passwordInput = document.getElementById('fu-password');

    if (mode === 'signup') {
      document.getElementById('fu-auth-title').textContent = 'Join FreeUpper';
      document.getElementById('fu-auth-sub').textContent = 'Create an account to post, comment, and save favorites.';
      nameField.style.display = 'block';
      document.getElementById('fu-submit-btn').textContent = 'Create Account';
      document.getElementById('fu-auth-switch').innerHTML =
        'Already have an account? <button id="fu-switch-btn" type="button">Sign In</button>';

      // Safari autofill hints
      nameInput.setAttribute('name', 'name');
      nameInput.setAttribute('autocomplete', 'name');
      emailInput.setAttribute('name', 'email');
      emailInput.setAttribute('autocomplete', 'email');
      passwordInput.setAttribute('name', 'new-password');
      passwordInput.setAttribute('autocomplete', 'new-password');
    } else {
      document.getElementById('fu-auth-title').textContent = 'Welcome Back';
      document.getElementById('fu-auth-sub').textContent = 'Sign in to continue to FreeUpper.';
      nameField.style.display = 'none';
      document.getElementById('fu-submit-btn').textContent = 'Sign In';
      document.getElementById('fu-auth-switch').innerHTML =
        "Don't have an account? <button id=\"fu-switch-btn\" type=\"button\">Sign Up</button>";

      nameInput.removeAttribute('name');
      nameInput.removeAttribute('autocomplete');
      emailInput.setAttribute('name', 'email');
      emailInput.setAttribute('autocomplete', 'email');
      passwordInput.setAttribute('name', 'password');
      passwordInput.setAttribute('autocomplete', 'current-password');
    }

    const switchBtn = document.getElementById('fu-switch-btn');
    if (switchBtn) {
      switchBtn.addEventListener('click', () => {
        mode = mode === 'signup' ? 'signin' : 'signup';
        renderAuthForm();
      });
    }
  }

  function openModal(startMode, onSuccess) {
    console.log('Opening auth modal, mode:', startMode);
    mode = startMode || 'signup';
    pendingAction = onSuccess || null;

    if (!modalInitialized) {
      createAuthModal();
    }

    renderAuthForm();
    const overlay = document.getElementById('fu-auth-overlay');
    if (overlay) {
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    } else {
      console.error('Auth modal overlay not found');
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
      setTimeout(createAuthModal, 100);
      return;
    }
    if (document.getElementById('fu-auth-overlay')) {
      modalInitialized = true;
      return;
    }

    // ─── MODAL STYLES (includes "Maybe later" style) ──────
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
    .fu-password-wrapper{position:relative}
    .fu-password-wrapper input{padding-right:44px}
    .fu-password-toggle{position:absolute;right:12px;top:50%;transform:translateY(-50%);
      background:none;border:none;color:var(--muted,rgba(255,255,255,.5));cursor:pointer;
      display:flex;align-items:center;justify-content:center;padding:4px;border-radius:6px;
      transition:color .2s,background .2s}
    .fu-password-toggle:hover{color:var(--text,#fff);background:rgba(255,255,255,.05)}
    .fu-password-toggle svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
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
    .fu-btn-google svg{flex-shrink:0}
    /* ─── Updated switch and "Maybe later" styles ─── */
    #fu-auth-switch{text-align:center;font-size:13px;color:var(--muted,rgba(255,255,255,.55));margin-top:16px}
    #fu-auth-switch button{background:none;border:none;color:#a78bfa;font-weight:700;cursor:pointer;font-size:13px}
    #fu-auth-maybe-later{display:block;width:100%;text-align:center;background:none;border:none;
      color:var(--muted2,rgba(255,255,255,.4));font-size:12.5px;font-weight:600;cursor:pointer;
      margin-top:12px;padding:4px;text-decoration:underline;text-underline-offset:2px}
    #fu-auth-maybe-later:hover{color:var(--text,#fff)}
    `;

    if (!document.getElementById('fu-auth-styles')) {
      const style = document.createElement('style');
      style.id = 'fu-auth-styles';
      style.textContent = modalCSS;
      document.head.appendChild(style);
    }

    // ─── MODAL MARKUP (includes "Maybe later" button) ──────
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
        <div class="fu-field fu-password-wrapper">
          <input id="fu-password" type="password" placeholder="Password" />
          <button id="fu-password-toggle" type="button" class="fu-password-toggle" aria-label="Toggle password visibility">
            <svg class="icon-eye" viewBox="0 0 24 24">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <svg class="icon-eye-off" viewBox="0 0 24 24" style="display:none;">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
        </div>
        <button class="fu-btn-primary" id="fu-submit-btn" type="button">Create Account</button>
        <div class="fu-divider">OR</div>
        <button class="fu-btn-google" id="fu-google-btn" type="button">
          <svg width="18" height="18" viewBox="0 0 256 262" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="red3D" x1="120" y1="20" x2="160" y2="120" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#FF6B5B"/><stop offset="60%" stop-color="#EA4335"/><stop offset="100%" stop-color="#B31A0F"/>
              </linearGradient>
              <linearGradient id="yellow3D" x1="30" y1="120" x2="120" y2="240" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#FFE082"/><stop offset="50%" stop-color="#FBBC05"/><stop offset="100%" stop-color="#C68B00"/>
              </linearGradient>
              <linearGradient id="green3D" x1="40" y1="200" x2="180" y2="250" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#54DB80"/><stop offset="60%" stop-color="#34A853"/><stop offset="100%" stop-color="#1E6B31"/>
              </linearGradient>
              <linearGradient id="blue3D" x1="140" y1="100" x2="250" y2="180" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#6AA2FA"/><stop offset="50%" stop-color="#4285F4"/><stop offset="100%" stop-color="#1A52B8"/>
              </linearGradient>
              <linearGradient id="lightGlow" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="white" stop-opacity="0.35"/><stop offset="100%" stop-color="black" stop-opacity="0.4"/>
              </linearGradient>
            </defs>
            <g>
              <path d="M128 51.6c18.5 0 35.3 6.4 48.4 18.8l36.2-36.2C190.8 13.3 161.4 3 128 3 78 3 35.2 31.7 15 73.6l42.4 32.9C67.3 73.6 95.1 51.6 128 51.6z" fill="url(#red3D)"/>
              <path d="M15 73.6C5.5 93.3 0 115.4 0 139s5.5 45.7 15 65.4l42.4-32.9c-2.4-7.2-3.8-15-3.8-23.5s1.4-16.3 3.8-23.5L15 73.6z" fill="url(#yellow3D)"/>
              <path d="M128 210.4c-32.9 0-60.7-22-70.6-54.9L15 188.4c20.2 41.9 63 70.6 113 70.6 31.8 0 61.4-10.4 83.8-28.5l-40.2-31.2c-12.2 7.7-26.6 11.1-43.6 11.1z" fill="url(#green3D)"/>
              <path d="M251.1 139c0-8.8-.8-17.7-2.2-26.2H128v49.6h69.2c-3 15.6-11.8 28.8-25 37.6l40.2 31.2c23.5-21.7 38.7-53.6 38.7-92.2z" fill="url(#blue3D)"/>
            </g>
            <path d="M128 3C57.3 3 0 60.3 0 131s57.3 128 128 128 128-57.3 128-128S198.7 3 128 3z" fill="url(#lightGlow)" opacity="0.65"/>
          </svg>
          Continue with Google
        </button>
        <div id="fu-auth-switch">Already have an account? <button id="fu-switch-btn" type="button">Sign In</button></div>
        <button id="fu-auth-maybe-later" type="button">Maybe later</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // ─── EVENT LISTENERS ────────────────────────────────────
    document.getElementById('fu-auth-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    const maybeLaterBtn = document.getElementById('fu-auth-maybe-later');
    if (maybeLaterBtn) maybeLaterBtn.addEventListener('click', closeModal);

    document.getElementById('fu-submit-btn').addEventListener('click', handleAuthSubmit);
    document.getElementById('fu-google-btn').addEventListener('click', handleGoogleAuth);

    // Password visibility toggle
    const passwordInput = document.getElementById('fu-password');
    const toggleBtn = document.getElementById('fu-password-toggle');
    if (passwordInput && toggleBtn) {
      const eyeIcon = toggleBtn.querySelector('.icon-eye');
      const eyeOffIcon = toggleBtn.querySelector('.icon-eye-off');

      toggleBtn.addEventListener('click', function () {
        if (passwordInput.type === 'password') {
          passwordInput.type = 'text';
          eyeIcon.style.display = 'none';
          eyeOffIcon.style.display = 'block';
        } else {
          passwordInput.type = 'password';
          eyeIcon.style.display = 'block';
          eyeOffIcon.style.display = 'none';
        }
      });
    }

    modalInitialized = true;
    console.log('Auth modal created');
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
    btn.textContent = 'Please wait...';

    try {
      if (mode === 'signup') {
        // Generate a unique username with random suffix
        const baseUsername = (name || email.split('@')[0])
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/[^a-z0-9]/g, '');
        const randomSuffix = Math.floor(Math.random() * 10000);
        const username = baseUsername + randomSuffix;

        const result = await sb.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: name || email.split('@')[0],
              username: username
            }
          }
        });
        if (result.error) throw result.error;
        if (result.data.session) await syncSessionToLocal(result.data.session);
      } else {
        const signInResult = await sb.auth.signInWithPassword({ email, password });
        if (signInResult.error) throw signInResult.error;
        await syncSessionToLocal(signInResult.data.session);
      }
      closeModal();
      if (pendingAction) {
        const fn = pendingAction;
        pendingAction = null;
        fn();
      }
    } catch (e) {
      // Use the improved error extractor
      const msg = extractErrorMessage(e);
      errEl.textContent = msg;
      console.error('Auth error:', e); // always log the raw error to console
    } finally {
      btn.disabled = false;
      btn.textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
    }
  }

  async function handleGoogleAuth() {
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href }
    });
  }

  // ─── PROTECTED ACTION WRAPPER ────────────────────────────
  function requireAuth(fn) {
    const user = getCurrentUser();
    if (user && user.isLoggedIn) {
      fn();
      return;
    }
    if (!modalInitialized) {
      createAuthModal();
    }
    openModal('signup', fn);
  }

  // ─── AVATAR UPLOAD ────────────────────────────────────────
  async function uploadAvatar(file, onProgress) {
    const user = getCurrentUser();
    if (!user.isLoggedIn) {
      openModal('signup');
      return null;
    }

    if (!file.type.startsWith('image/')) {
      throw new Error('Please choose an image file');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Image too large (max 5MB)');
    }

    const url = 'https://api.cloudinary.com/v1_1/' + CLOUDINARY_CLOUD_NAME + '/image/upload';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_AVATAR_PRESET);

    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = function (e) {
        if (onProgress && e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = function () {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && !res.error) {
            resolve(res);
          } else {
            reject(new Error(res.error?.message || 'Avatar upload failed'));
          }
        } catch (e) {
          reject(new Error('Avatar upload failed'));
        }
      };
      xhr.onerror = function () {
        reject(new Error('Network error during upload'));
      };
      xhr.send(formData);
    });

    if (onProgress) onProgress(100);

    try {
      const { data: updatedProfileArr, error: rpcError } = await sb.rpc('update_avatar', {
        p_avatar_url: data.secure_url
      });
      if (rpcError) throw rpcError;
      const updatedProfile = updatedProfileArr[0];
      const updated = Object.assign({}, user, { avatar: updatedProfile.avatar_url });
      writeLocalUser(updated);
      return updatedProfile.avatar_url;
    } catch (rpcErr) {
      console.warn('RPC update_avatar failed, trying direct update', rpcErr);
      const { data: updatedProfile, error: updateError } = await sb
        .from('profiles')
        .update({ avatar_url: data.secure_url })
        .eq('id', user.id)
        .select()
        .single();
      if (updateError) throw new Error('Failed to update avatar: ' + updateError.message);
      const updated = Object.assign({}, user, { avatar: updatedProfile.avatar_url });
      writeLocalUser(updated);
      return updatedProfile.avatar_url;
    }
  }

  // ─── COVER PHOTO UPLOAD ────────────────────────────────────
  async function uploadCoverPhoto(file, onProgress) {
    const user = getCurrentUser();
    if (!user.isLoggedIn) {
      openModal('signup');
      return null;
    }

    if (!file.type.startsWith('image/')) {
      throw new Error('Please choose an image file');
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new Error('Image too large (max 8MB)');
    }

    const url = 'https://api.cloudinary.com/v1_1/' + CLOUDINARY_CLOUD_NAME + '/image/upload';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_AVATAR_PRESET);

    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = function (e) {
        if (onProgress && e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = function () {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && !res.error) {
            resolve(res);
          } else {
            reject(new Error(res.error?.message || 'Cover photo upload failed'));
          }
        } catch (e) {
          reject(new Error('Cover photo upload failed'));
        }
      };
      xhr.onerror = function () {
        reject(new Error('Network error during upload'));
      };
      xhr.send(formData);
    });

    if (onProgress) onProgress(100);

    const { data: updatedProfile, error: updateError } = await sb
      .from('profiles')
      .update({ cover_url: data.secure_url })
      .eq('id', user.id)
      .select()
      .single();
    if (updateError) throw new Error('Failed to update cover photo: ' + updateError.message);
    const updated = Object.assign({}, user, { coverUrl: updatedProfile.cover_url });
    writeLocalUser(updated);
    return updatedProfile.cover_url;
  }

  // ─── SIGN OUT ──────────────────────────────────────────────
  async function signOut() {
    await sb.auth.signOut();
    const guest = defaultGuest();
    localStorage.setItem(USER_KEY, JSON.stringify(guest));
    updateAvatarEls(guest.avatar);
    document.dispatchEvent(new CustomEvent('profileUpdated', { detail: { user: guest } }));
  }

  // ─── FIRST-VISIT PROMPT (auto-show once) ──────────────────
  const FIRST_VISIT_KEY = 'freeupper_seen_signup_prompt';
  function maybeShowFirstVisitPrompt() {
    try {
      const user = getCurrentUser();
      if (user && user.isLoggedIn) return;
      if (localStorage.getItem(FIRST_VISIT_KEY)) return;
      localStorage.setItem(FIRST_VISIT_KEY, '1');
      setTimeout(function () { openModal('signup', null); }, 600);
    } catch (e) {
      console.warn('maybeShowFirstVisitPrompt failed:', e);
    }
  }

  // ─── INIT ──────────────────────────────────────────────────
  function initAuth() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createAuthModal);
    } else {
      createAuthModal();
    }
  }

  // ─── EXPOSE ───────────────────────────────────────────────
  window.AuthUser = {
    getCurrentUser,
    getAuthenticatedUser,
    requireAuth,
    uploadAvatar,
    uploadCoverPhoto,
    signOut,
    openModal,
    closeModal,
    updateCurrentUser,
    onChange
  };

  window.getCurrentUser = getCurrentUser; // backward compatibility

  initAuth();

  // ─── SESSION CHECK & FIRST-VISIT TRIGGER ──────────────────
  sb.auth.getSession().then(({ data }) => {
    if (data.session) {
      syncSessionToLocal(data.session).then(maybeShowFirstVisitPrompt);
      registerSessionLocation();
    } else {
      maybeShowFirstVisitPrompt();
    }
  });

  console.log('AuthUser is ready:', window.AuthUser);
})();
