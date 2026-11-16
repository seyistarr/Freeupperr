/* ============================================================
   FreeUpper — auth.js (production)
   with Safari autofix, unique usernames, and bulletproof errors
   + strict comment-media MIME allowlist (GIFs excluded)
   + consent notice (Terms of Service + Privacy Policy) in modal
   + fixed fu-name input, cleaned consent CSS,
     and 3-second first-visit prompt with auth recheck
   + legal update modal (Terms & Privacy re-acceptance)
   ============================================================ */
(function () {
  'use strict';

  // ─── CONFIG ────────────────────────────────────────────────
  const SUPABASE_URL = 'https://api.freeupper.com';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptanRxaWRpcnBtbmVnenZtaWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4ODk0OTAsImV4cCI6MjA5OTQ2NTQ5MH0.Lfxtyexew35L3uzy3bxPcBHogsnlMcAVOE-Ho50FZpk';

  const CLOUDINARY_CLOUD_NAME = 'duzyf1kda';
  const CLOUDINARY_AVATAR_PRESET = 'image_upload';

  const USER_KEY = 'freeupper_user_profile';

  // Legal page URLs (used by the consent notice in the auth modal)
  const TERMS_URL = 'https://www.freeupper.com/policy.html';
  const PRIVACY_URL = 'https://www.freeupper.com/privacy.html';

  // Current legal document versions. Update these when the documents change.
  const LEGAL_VERSIONS = {
    terms: '2026-10',
    privacy: '2026-10'
  };

  if (!window.supabase) {
    console.error('auth.js: include the Supabase CDN script before this file.');
    return;
  }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // Preserve sessions created before the API hostname changed.
    auth: { storageKey: 'sb-jmjtqidirpmnegzvmiaq-auth-token' }
  });
  window.sb = sb;

  // Shared sounds use this authenticated gateway client on every app page.
  // Loading independently keeps audio support optional and auth initialization intact.
  if (window.FreeUpperSounds) window.FreeUpperSounds.bindClient(sb);
  if (!document.querySelector('script[data-fu-sounds]')) {
    const sounds = document.createElement('script');
    sounds.dataset.fuSounds = '';
    sounds.src = '/ui-sounds.js?v=4';
    sounds.onload = () => window.FreeUpperSounds?.bindClient(sb);
    document.head.appendChild(sounds);
  }

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
    const els = document.querySelectorAll('.side-av, .nav-av');
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

  async function readMyPrivateProfile() {
    try {
      const { data, error } = await sb.rpc('get_my_private_profile');
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) || {};
    } catch (error) {
      console.warn('Private profile unavailable:', error);
      return {};
    }
  }

  // Profile reads never create or replace accounts or public identities.
  let authGeneration = 0;
  let activeAuthId = null;
  const profileLoads = new Map();
  async function getAuthenticatedUser() {
    const generation = authGeneration;
    const { data, error } = await sb.auth.getUser();
    if (generation !== authGeneration) throw new Error('Your session changed. Please try again.');
    if (error) throw error;
    if (!data.user) return defaultGuest();
    return syncSessionToLocal({ user: data.user });
  }

  async function syncSessionToLocal(session) {
    if (!session?.user) throw new Error('Please sign in again.');
    const authUser = session.user;
    if (activeAuthId !== authUser.id) {
      activeAuthId = authUser.id;
      authGeneration++;
    }
    const generation = authGeneration;
    const key = generation + ':' + authUser.id;
    if (profileLoads.has(key)) return profileLoads.get(key);
    const load = (async () => {
      const { data: finalProfile, error } = await sb.from('profiles')
        .select('id, username, display_name, bio, cover_url, avatar_url, verified_status, is_private, hide_follower_count, activity_status, country')
        .eq('id', authUser.id).maybeSingle();
      if (error || !finalProfile) {
        const failure = new Error('You are signed in, but your profile could not load. Retry without signing in again.');
        failure.code = 'profile_unavailable';
        failure.generation = generation;
        throw failure;
      }
      const privateProfile = await readMyPrivateProfile();
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
        isPrivate: finalProfile.is_private || false,
        hideFollowerCount: finalProfile.hide_follower_count || false,
        activityStatus: finalProfile.activity_status !== undefined ? finalProfile.activity_status : true,
        gender: privateProfile.gender || '',
        country: finalProfile.country || '',
        phone: privateProfile.phone || '',
        dob: privateProfile.dob || null
      };
      if (generation !== authGeneration || activeAuthId !== authUser.id) throw new Error('Your session changed. Please try again.');
      writeLocalUser(localUser);
      return localUser;
    })();
    const guarded = load.catch(error => {
      if (generation !== authGeneration) throw new Error('Your session changed. Please try again.');
      if (error.code === 'profile_unavailable') throw error;
      const failure = new Error('You are signed in, but your profile could not load. Retry without signing in again.');
      failure.code = 'profile_unavailable';
      failure.generation = generation;
      throw failure;
    });
    profileLoads.set(key, guarded);
    try { return await guarded; }
    finally { profileLoads.delete(key); }
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
    const id = session?.user?.id || null;
    if (activeAuthId !== id) { activeAuthId = id; authGeneration++; }
    const generation = authGeneration;
    // Supabase callbacks run under the auth lock. Do SDK work after returning.
    setTimeout(() => {
      if (generation !== authGeneration) return;
      if (session) {
        syncSessionToLocal(session).then(() => {
          if (mode === 'confirm' && session.user.email?.toLowerCase() === document.getElementById('fu-email').value.trim().toLowerCase()) completeAuthentication();
          checkLegalUpdate(session);
        }).catch(showProfileFailure);
        if (_event === 'SIGNED_IN') registerSessionLocation();
      } else {
        if (_event === 'SIGNED_OUT') closeModal();
        writeLocalUser(defaultGuest());
      }
    }, 0);
  });

  // ─── AUTH MODAL ──────────────────────────────────────────────
  let mode = 'signup';
  let pendingAction = null;
  let modalInitialized = false;
  let modalGeneration = 0;
  let submitting = false;
  let cooldownTimer;
  const emailCooldowns = new Map();
  const emailRedirect = () => window.location.origin + '/';
  const recoveryRedirect = () => window.location.origin + '/reset-password.html';

  function setStatus(message) {
    document.getElementById('fu-auth-status').textContent = message;
  }
  function updateEmailButtons() {
    clearTimeout(cooldownTimer);
    const email = document.getElementById('fu-email').value.trim().toLowerCase();
    const action = mode === 'recover' ? 'recover' : 'confirm';
    const remaining = Math.max(0, Math.ceil(((emailCooldowns.get(action + ':' + email) || 0) - Date.now()) / 1000));
    const button = document.getElementById(mode === 'recover' ? 'fu-submit-btn' : 'fu-resend-btn');
    button.disabled = submitting || remaining > 0;
    button.textContent = remaining ? `Try again in ${remaining}s` : mode === 'recover' ? 'Send reset link' : 'Resend confirmation';
    if (remaining) cooldownTimer = setTimeout(updateEmailButtons, 1000);
  }
  function cooldown(action, email, error) {
    const seconds = Number(error?.retryAfter || error?.retry_after || 60);
    emailCooldowns.set(action + ':' + email.toLowerCase(), Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000);
  }
  function showProfileFailure(error) {
    if (error?.code !== 'profile_unavailable' || error.generation !== authGeneration) return;
    if (!modalInitialized) createAuthModal();
    mode = 'profile';
    renderAuthForm();
    document.getElementById('fu-auth-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('fu-auth-error').textContent = extractErrorMessage(error);
  }
  function completeAuthentication() {
    const action = pendingAction;
    closeModal();
    if (action) action();
  }


  // ─── HELPER: extract Supabase error message ────────────────
  function extractErrorMessage(err) {
    if (!err) return 'Something went wrong. Please try again.';
    if (err.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(err.code)) return 'Too many requests. Please wait before trying again.';
    if (err.code === 'invalid_credentials') return 'Email or password is incorrect. If you joined with Google, continue with Google or request a password reset.';
    if (err.code === 'email_not_confirmed') return 'Confirm your email before signing in. You can resend the confirmation below.';
    if (err.code === 'weak_password') return 'Choose a stronger password that meets the account password requirements.';
    if (err.code === 'signup_disabled') return 'Registration is currently unavailable. Please try again later.';
    if (err.code === 'user_already_exists') return 'Unable to complete this request. Try signing in or request a password reset.';
    if (err.name === 'AuthRetryableFetchError' || err instanceof TypeError) return 'Could not connect. Check your connection and try again.';


    if (err.code === 'profile_unavailable') return 'You are signed in, but your profile could not load. Retry without signing in again.';
    // Do not serialize arbitrary backend error objects, which may contain
    // request details, credentials or provider/account diagnostics.
    return 'Something went wrong. Please try again.';
  }

  // ─── RENDER AUTH FORM ──────────────────────────────────────
  function renderAuthForm() {
    document.getElementById('fu-auth-error').textContent = '';
    setStatus('');
    clearTimeout(cooldownTimer);

    const nameField = document.getElementById('fu-name-field');
    const nameInput = document.getElementById('fu-name');
    const emailInput = document.getElementById('fu-email');
    const passwordInput = document.getElementById('fu-password');

    if (mode === 'signup') {
      document.getElementById('fu-auth-title').textContent = 'Join FreeUpper';
      document.getElementById('fu-auth-sub').textContent = 'Start as FreeUpper User. Choose your public name and username in your profile.';
      nameField.style.display = 'none';
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

    const confirm = mode === 'confirm';
    const recover = mode === 'recover';
    const profile = mode === 'profile';
    passwordInput.closest('.fu-password-wrapper').hidden = confirm || recover || profile;
    emailInput.closest('.fu-field').hidden = profile;
    document.getElementById('fu-submit-btn').hidden = confirm;
    document.getElementById('fu-google-btn').hidden = confirm || recover || profile;
    document.getElementById('fu-auth-divider').hidden = confirm || recover || profile;
    document.getElementById('fu-forgot-btn').hidden = mode !== 'signin';
    document.getElementById('fu-resend-btn').hidden = !(confirm || mode === 'signin');
    document.getElementById('fu-submit-btn').disabled = submitting;
    if (confirm || recover || profile) {
      document.getElementById('fu-auth-title').textContent = profile ? 'Load your profile' : recover ? 'Reset your password' : 'Check your email';
      document.getElementById('fu-auth-sub').textContent = profile ? 'Your sign-in session is preserved.' : recover ? 'Enter your email to request a password reset link.' : 'Open the confirmation link in your inbox to finish signing up. Check your spam folder too.';
      document.getElementById('fu-submit-btn').textContent = profile ? 'Retry profile loading' : 'Send reset link';
      document.getElementById('fu-auth-switch').innerHTML = '<button id="fu-switch-btn" type="button">Back to Sign In</button>';
      if (confirm) setStatus('If this address is eligible, a confirmation email has been requested.');
    }
    document.getElementById('fu-switch-btn').addEventListener('click', () => {
      if (submitting) return;
      mode = mode === 'signin' ? 'signup' : 'signin';
      passwordInput.value = '';
      renderAuthForm();
    });
    if (confirm || recover || mode === 'signin') updateEmailButtons();
  }

  function openModal(startMode, onSuccess) {
    modalGeneration++;
    console.log('Opening auth modal, mode:', startMode);
    mode = ['signup', 'signin', 'recover'].includes(startMode) ? startMode : 'signup';
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
    modalGeneration++;
    const overlay = document.getElementById('fu-auth-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
    pendingAction = null;
    clearTimeout(cooldownTimer);
    const password = document.getElementById('fu-password');
    if (password) password.value = '';
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

    // ─── MODAL STYLES ──────────────────────────────────────
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
    #fu-auth-overlay [hidden]{display:none!important}
    #fu-forgot-btn,#fu-resend-btn{border:0;background:transparent;color:var(--pl,#a78bfa);padding:10px;cursor:pointer;font:inherit}
    #fu-resend-btn:disabled{opacity:.6;cursor:wait}
    .fu-divider{display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--muted2,rgba(255,255,255,.35));font-size:12px}
    .fu-divider::before,.fu-divider::after{content:'';flex:1;height:1px;background:var(--brd2,rgba(255,255,255,.12))}
    .fu-btn-google{width:100%;padding:12px;border-radius:12px;border:1.5px solid var(--brd2,rgba(255,255,255,.15));
      background:transparent;color:var(--text,#fff);font-weight:700;font-size:13.5px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;gap:8px}
    .fu-btn-google svg{flex-shrink:0}
    #fu-auth-switch{text-align:center;font-size:13px;color:var(--muted,rgba(255,255,255,.55));margin-top:16px}
    #fu-auth-switch button{background:none;border:none;color:#a78bfa;font-weight:700;cursor:pointer;font-size:13px}
    #fu-auth-maybe-later{display:block;width:100%;text-align:center;background:none;border:none;
      color:var(--muted2,rgba(255,255,255,.4));font-size:12.5px;font-weight:600;cursor:pointer;
      margin-top:12px;padding:4px;text-decoration:underline;text-underline-offset:2px}
    #fu-auth-maybe-later:hover{color:var(--text,#fff)}
    .fu-auth-consent {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid var(--brd2, rgba(255,255,255,.08));
      text-align: center;
      font-size: 11.5px;
      line-height: 1.6;
      color: var(--muted2, rgba(255,255,255,.55));
    }
    .fu-auth-consent a {
      color: #a78bfa;
      font-weight: 600;
      text-decoration: none;
    }
    .fu-auth-consent a:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    `;

    if (!document.getElementById('fu-auth-styles')) {
      const style = document.createElement('style');
      style.id = 'fu-auth-styles';
      style.textContent = modalCSS;
      document.head.appendChild(style);
    }

    // ─── MODAL MARKUP ──────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'fu-auth-overlay';
    overlay.innerHTML = `
      <div id="fu-auth-card">
        <button id="fu-auth-close" type="button">&#10005;</button>
        <div id="fu-auth-logo">Free<span>Upper</span></div>
        <div id="fu-auth-title">Join FreeUpper</div>
        <div id="fu-auth-sub">Start as FreeUpper User. Choose your public name and username in your profile.</div>
        <div id="fu-auth-error" role="alert"></div>
        <div id="fu-auth-status" role="status" aria-live="polite" style="margin:12px 0"></div>
        <div id="fu-name-field" class="fu-field">
          <input id="fu-name" type="text" placeholder="Full name" autocomplete="name" />
        </div>
        <div class="fu-field"><input id="fu-email" aria-label="Email address" type="email" placeholder="Email address" /></div>
        <div class="fu-field fu-password-wrapper">
          <input id="fu-password" aria-label="Password" type="password" placeholder="Password" />
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
        <div class="fu-divider" id="fu-auth-divider">OR</div>
        <button id="fu-forgot-btn" type="button">Forgot password?</button>
        <button id="fu-resend-btn" type="button" hidden>Resend confirmation</button>
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
        <div class="fu-auth-consent">
          By continuing, you agree to our
          <a href="${TERMS_URL}" target="_blank" rel="noopener noreferrer">Terms of Service</a>
          and acknowledge our
          <a href="${PRIVACY_URL}" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
        </div>
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
    document.getElementById('fu-forgot-btn').addEventListener('click', () => { if (!submitting) { mode = 'recover'; renderAuthForm(); } });
    document.getElementById('fu-resend-btn').addEventListener('click', () => sendEmail('confirm'));
    document.getElementById('fu-email').addEventListener('input', updateEmailButtons);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Enter' && ['fu-email', 'fu-password'].includes(event.target.id)) {
        event.preventDefault();
        if (mode === 'confirm') sendEmail('confirm'); else handleAuthSubmit();
      }
    });

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
  async function sendEmail(action) {
    if (submitting) return;
    const generation = modalGeneration;
    const emailInput = document.getElementById('fu-email');
    const email = emailInput.value.trim();
    const errEl = document.getElementById('fu-auth-error');
    errEl.textContent = '';
    if (!email || !emailInput.checkValidity()) { errEl.textContent = 'Enter a valid email address.'; return; }
    if ((emailCooldowns.get(action + ':' + email.toLowerCase()) || 0) > Date.now()) { updateEmailButtons(); return; }
    submitting = true;
    updateEmailButtons();
    try {
      const result = action === 'recover'
        ? await sb.auth.resetPasswordForEmail(email, { redirectTo: recoveryRedirect() })
        : await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: emailRedirect() } });
      if (result.error && !['user_not_found', 'user_already_exists', 'email_not_found'].includes(result.error.code)) throw result.error;
      cooldown(action, email);
      if (generation !== modalGeneration) return;
      setStatus(action === 'recover' ? 'If this address is eligible, a password reset link has been requested. Check your inbox and spam folder.' : 'If this address is eligible, a confirmation email has been requested. Check your inbox and spam folder.');
    } catch (error) {
      if (error.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error.code)) cooldown(action, email, error);
      if (generation === modalGeneration) errEl.textContent = extractErrorMessage(error);
    } finally { submitting = false; updateEmailButtons(); }
  }

  async function handleAuthSubmit() {
    if (submitting) return;
    if (mode === 'recover') return sendEmail('recover');
    if (mode === 'confirm') return;
    const generation = modalGeneration;
    const errEl = document.getElementById('fu-auth-error');
    const emailInput = document.getElementById('fu-email');
    const email = emailInput.value.trim();
    const password = document.getElementById('fu-password').value;
    errEl.textContent = '';
    if (mode !== 'profile' && (!email || !emailInput.checkValidity() || !password)) {
      errEl.textContent = 'Enter a valid email address and password.';
      return;
    }
    const btn = document.getElementById('fu-submit-btn');
    submitting = true;
    btn.disabled = true;
    btn.textContent = 'Please wait...';
    try {
      let session;
      if (mode === 'profile') {
        const result = await sb.auth.getSession();
        if (result.error) throw result.error;
        session = result.data.session;
      } else if (mode === 'signup') {
        // No metadata or identity linking: the database retains identity ownership.
        const result = await sb.auth.signUp({ email, password, options: { emailRedirectTo: emailRedirect() } });
        if (result.error && result.error.code !== 'user_already_exists') throw result.error;
        if (generation !== modalGeneration) return;
        session = result.data?.session;
        if (!session) {
          cooldown('confirm', email);
          mode = 'confirm';
          document.getElementById('fu-password').value = '';
          renderAuthForm();
          return;
        }
      } else {
        const result = await sb.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        session = result.data.session;
      }
      if (generation !== modalGeneration) return;
      document.getElementById('fu-password').value = '';
      await syncSessionToLocal(session);
      if (generation === modalGeneration) completeAuthentication();
    } catch (error) {
      if (generation !== modalGeneration) return;
      if (error.code === 'profile_unavailable') showProfileFailure(error);
      else {
        if (mode === 'profile') { mode = 'signin'; renderAuthForm(); }
        errEl.textContent = extractErrorMessage(error);
      }
    } finally {
      submitting = false;
      btn.disabled = false;
      btn.textContent = mode === 'profile' ? 'Retry profile loading' : mode === 'signup' ? 'Create Account' : 'Sign In';
      if (mode === 'confirm') updateEmailButtons();
    }
  }

  async function handleGoogleAuth() {
    if (submitting) return;
    submitting = true;
    const button = document.getElementById('fu-google-btn');
    button.disabled = true;
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href }
      });
      if (error) throw error;
    } catch (error) {
      document.getElementById('fu-auth-error').textContent = 'Google login could not finish. Please try again.';
    } finally { submitting = false; button.disabled = false; }
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

  // ─── CLOUDINARY UPLOAD HELPER (shared) ────────────────────
  async function uploadToCloudinary(file, onProgress, fallbackError) {
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
            reject(new Error(res.error?.message || fallbackError));
          }
        } catch (e) {
          reject(new Error(fallbackError));
        }
      };
      xhr.onerror = function () {
        reject(new Error('Network error during upload'));
      };
      xhr.send(formData);
    });
    if (onProgress) onProgress(100);
    return data;
  }

  // ─── COMMENT MEDIA UPLOAD (public wrapper) ────────────────
  // Strict MIME allowlist: JPG / PNG / WebP only.
  // GIFs are intentionally excluded — they belong to the separate
  // GIF system, not Cloudinary.
  const ALLOWED_COMMENT_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp'
  ];

  async function uploadCommentMedia(file, onProgress) {
    const user = await getAuthenticatedUser();
    if (!user || !user.isLoggedIn) {
      if (typeof openModal === 'function') {
        openModal('signup');
      }
      return null;
    }
    if (!file || !ALLOWED_COMMENT_IMAGE_TYPES.includes(file.type)) {
      throw new Error('Please choose a JPG, PNG, or WebP image.');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('Media must be under 10MB.');
    }
    const data = await uploadToCloudinary(
      file,
      onProgress,
      'Comment media upload failed'
    );
    return data.secure_url || null;
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

    const data = await uploadToCloudinary(
      file,
      onProgress,
      'Avatar upload failed'
    );

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
        .select('avatar_url')
        .single();
      if (updateError) {
        throw new Error('Failed to update avatar: ' + updateError.message);
      }
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

    const data = await uploadToCloudinary(
      file,
      onProgress,
      'Cover photo upload failed'
    );

    const { data: updatedProfile, error: updateError } = await sb
      .from('profiles')
      .update({ cover_url: data.secure_url })
      .eq('id', user.id)
      .select('cover_url')
      .single();
    if (updateError) {
      throw new Error('Failed to update cover photo: ' + updateError.message);
    }
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

  // ─── LEGAL UPDATE MODAL ──────────────────────────────────
  let legalModalChecking = false;
  async function checkLegalUpdate(session) {
    if (!session?.user || legalModalChecking) return;
    const user = session.user;
    const overlayId = 'fu-legal-update-overlay';
    if (document.getElementById(overlayId)) return;
    legalModalChecking = true;
    try {
      const { data: rows, error } = await sb
        .from('legal_acceptances')
        .select('document_type, document_version')
        .eq('user_id', user.id);
      if (error) throw error;
      const acceptedTerms = rows.some(row =>
        row.document_type === 'terms' &&
        row.document_version === LEGAL_VERSIONS.terms
      );
      const acceptedPrivacy = rows.some(row =>
        row.document_type === 'privacy' &&
        row.document_version === LEGAL_VERSIONS.privacy
      );
      if (acceptedTerms && acceptedPrivacy) return;
      // Wait if the sign-in modal is still open.
      const authOverlay = document.getElementById('fu-auth-overlay');
      if (authOverlay?.classList.contains('open')) {
        setTimeout(() => checkLegalUpdate(session), 800);
        return;
      }
      const overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:22000;
        background:rgba(0,0,0,.75);display:flex;
        align-items:center;justify-content:center;padding:20px;
      `;
      overlay.innerHTML = `
        <section style="
          width:100%;max-width:420px;max-height:90vh;overflow:auto;
          padding:26px 22px;border-radius:20px;
          background:var(--bg3,#fff);color:var(--text,#171717);
          text-align:center;font-family:inherit;
          box-shadow:0 20px 60px rgba(0,0,0,.3);
        ">
          <div style="font-size:22px;font-weight:900;margin-bottom:16px">
            Free<span style="color:#8b5cf6">Upper</span>
          </div>
          <h2 style="font-size:21px;margin-bottom:12px">
            We've updated our Terms &amp; Privacy Policy
          </h2>
          <p style="font-size:14px;line-height:1.7;margin-bottom:18px">
            Please review our updated documents. Continue when you agree
            to the Terms of Service and acknowledge the Privacy Policy.
          </p>
          <a href="${TERMS_URL}" target="_blank" rel="noopener noreferrer"
            style="display:block;padding:13px;margin-bottom:10px;
            border:1px solid #8b5cf6;border-radius:12px;
            color:#8b5cf6;text-decoration:none;font-weight:700">
            Read Terms of Service ↗
          </a>
          <a href="${PRIVACY_URL}" target="_blank" rel="noopener noreferrer"
            style="display:block;padding:13px;margin-bottom:18px;
            border:1px solid #8b5cf6;border-radius:12px;
            color:#8b5cf6;text-decoration:none;font-weight:700">
            Read Privacy Policy ↗
          </a>
          <button id="fu-legal-accept" type="button"
            style="width:100%;padding:14px;border:0;border-radius:12px;
            background:#8b5cf6;color:white;font-weight:800;font-size:14px">
            I Agree &amp; Continue
          </button>
          <p id="fu-legal-error" role="status"
            style="color:#dc2626;font-size:12px;margin-top:12px"></p>
        </section>
      `;
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      document.getElementById('fu-legal-accept')
        .addEventListener('click', async function () {
          const button = this;
          const errorBox = document.getElementById('fu-legal-error');
          button.disabled = true;
          button.textContent = 'Saving…';
          errorBox.textContent = '';
          try {
            const { data: currentRows, error: readError } = await sb
              .from('legal_acceptances')
              .select('document_type, document_version')
              .eq('user_id', user.id);
            if (readError) throw readError;
            const newAcceptances = [];
            for (const type of ['terms', 'privacy']) {
              const version = LEGAL_VERSIONS[type];
              const exists = currentRows.some(row =>
                row.document_type === type &&
                row.document_version === version
              );
              if (!exists) {
                newAcceptances.push({
                  user_id: user.id,
                  document_type: type,
                  document_version: version
                });
              }
            }
            if (newAcceptances.length) {
              const { error: saveError } = await sb
                .from('legal_acceptances')
                .insert(newAcceptances);
              if (saveError) throw saveError;
            }
            overlay.remove();
            document.body.style.overflow = '';
          } catch (err) {
            console.error('Legal acknowledgement failed:', err);
            errorBox.textContent =
              'Could not save your acknowledgement. Please try again.';
            button.disabled = false;
            button.textContent = 'I Agree & Continue';
          }
        });
    } catch (err) {
      console.error('Legal update check failed:', err);
    } finally {
      legalModalChecking = false;
    }
  }

  // ─── FIRST-VISIT PROMPT (show after 3 seconds) ────────────
  const FIRST_VISIT_KEY = 'freeupper_seen_signup_prompt';
  function maybeShowFirstVisitPrompt() {
    try {
      const user = getCurrentUser();
      // Never show the signup prompt to an authenticated user.
      if (user && user.isLoggedIn) return;
      // Show the automatic prompt only once per browser.
      if (localStorage.getItem(FIRST_VISIT_KEY)) return;
      // Mark the prompt as scheduled.
      localStorage.setItem(FIRST_VISIT_KEY, '1');
      setTimeout(function () {
        // Recheck authentication in case the user signed in meanwhile.
        const currentUser = getCurrentUser();
        if (currentUser && currentUser.isLoggedIn) return;
        // Do not interrupt another open modal.
        const existingOverlay = document.getElementById('fu-auth-overlay');
        if (existingOverlay && existingOverlay.classList.contains('open')) {
          return;
        }
        openModal('signup', null);
      }, 3000);
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
    uploadCommentMedia,
    signOut,
    openModal,
    closeModal,
    updateCurrentUser,
    onChange
  };

  window.getCurrentUser = getCurrentUser;

  initAuth();
  const authQuery = new URLSearchParams(window.location.search);
  const authHash = new URLSearchParams(window.location.hash.slice(1));
  if (authQuery.get('auth') === 'recover' || authHash.has('error')) {
    openModal(authQuery.get('auth') === 'recover' ? 'recover' : 'signin');
    if (authHash.has('error')) {
      document.getElementById('fu-auth-error').textContent = authHash.get('error_code') === 'otp_expired'
        ? 'This confirmation link is invalid or expired. Enter your email to resend confirmation.'
        : 'Sign-in or email verification could not finish. Please try again. If you used an expired email link, resend confirmation.';
    }
    const clean = new URL(window.location.href);
    clean.searchParams.delete('auth');
    if (authHash.has('error')) clean.hash = '';
    window.history.replaceState(window.history.state, '', clean.pathname + clean.search + clean.hash);
  }


  // ─── SESSION CHECK & FIRST-VISIT TRIGGER ──────────────────
  const restorationGeneration = authGeneration;
  sb.auth.getSession().then(({ data, error }) => {
    if (restorationGeneration !== authGeneration) return;
    if (error) throw error;
    if (data.session) {
      syncSessionToLocal(data.session).then(() => checkLegalUpdate(data.session)).catch(showProfileFailure);
      registerSessionLocation();
    } else {
      maybeShowFirstVisitPrompt();
    }
  }).catch(() => {
    openModal('signin');
    document.getElementById('fu-auth-error').textContent = 'Your session could not be restored. Please sign in again.';
  });

  console.log('AuthUser is ready:', window.AuthUser);
})();
