/* FreeUpper in-page sounds. Firebase/background push remains independent. */
(() => {
  'use strict';
  if (window.FUSound) return;

  const VERSION = '2';
  const CACHE = 'fu-sound:';
  const SEEN = 'fu-sound-events:';
  const tones = {
    // [frequency, start offset, duration, waveform]. Quiet sine/triangle envelopes.
    notify: [[660, 0, .13, 'sine'], [880, .10, .18, 'sine']],
    message: [[740, 0, .09, 'sine'], [988, .08, .13, 'sine'], [1175, .15, .12, 'sine']],
    like: [[880, 0, .10, 'triangle'], [1320, .06, .14, 'sine']],
    comment: [[587, 0, .12, 'sine'], [784, .11, .16, 'triangle']],
    repost: [[523, 0, .10, 'triangle'], [659, .08, .10, 'sine'], [784, .16, .13, 'sine']],
    follow: [[523, 0, .16, 'sine'], [659, .03, .17, 'sine'], [1047, .13, .19, 'sine']]
  };
  let client, userId = null, enabled = true, ready = false;
  let epoch = 0, revision = 0, saving = false, syncPromise = Promise.resolve();
  let context = null, unlocked = false, lastPlay = -Infinity;
  let visibilityRevision = 0;
  const seen = new Set();
  const active = new Set();
  let preferenceStatus = 'waiting-auth';
  let resumePending = null, gestureSeen = false;
  let debug = freshDiagnostics();
  function freshDiagnostics() {
    return { unlockAttempts: 0, unlockError: null, playInvocations: 0, scheduled: 0,
      notificationEvents: 0, messageEvents: 0, lastPlay: null, lastEvent: null, channels: {}, previousPage: null };
  }
  function diagnostics() {
    return { version: VERSION, enabled, authenticated: !!userId, preferenceReady: ready,
      preferenceStatus, contextState: context?.state || 'not-created', unlocked,
      webAudioAvailable: !!(window.AudioContext || window.webkitAudioContext),
      displayMode: window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone ? 'standalone' : 'browser',
      audioSessionType: navigator.audioSession?.type || 'unavailable',
      visibility: document.visibilityState, ...JSON.parse(JSON.stringify(debug)) };
  }
  function debugChanged() {
    window.dispatchEvent(new CustomEvent('fu-sound-diagnostics', { detail: diagnostics() }));
  }
  function saveTrace() {
    if (!userId) return;
    try {
      // Only fixed labels/counters; never payloads, message IDs, account data or tokens.
      const { lastPlay, lastEvent, playInvocations, scheduled, notificationEvents, messageEvents, channels } = debug;
      sessionStorage.setItem('fu-sound-debug:' + userId,
        JSON.stringify({ version: VERSION, lastPlay, lastEvent, playInvocations, scheduled, notificationEvents, messageEvents, channels }));
    } catch (_) {}
  }
  function eventResult(source, reason) {
    debug.lastEvent = { source, reason };
    saveTrace(); debugChanged();
    return false;
  }
  function playResult(type, source, reason, scheduled = false) {
    debug.lastPlay = { type, source, reason, scheduled };
    if (scheduled) debug.scheduled++;
    saveTrace(); debugChanged();
    return scheduled;
  }
  function channel(source, status) {
    if (!['header-notifications', 'header-messages', 'chat-messages', 'notification-center'].includes(source)) return;
    if (!['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) return;
    debug.channels[source] = status;
    saveTrace(); debugChanged();
  }

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private browsing/quota */ }
  }
  function changed() {
    window.dispatchEvent(new CustomEvent('fu-sound-preference', {
      detail: preferenceState()
    }));
    debugChanged();
  }
  function preferenceState() { return { enabled, ready, authenticated: !!userId, saving }; }
  function stop() {
    for (const oscillator of active) { try { oscillator.stop(); } catch (_) {} }
    active.clear();
  }
  function setLocal(value) {
    enabled = value !== false;
    if (!enabled) stop();
    if (userId) write(CACHE + userId, enabled);
    changed();
  }
  function audioContext() {
    if (context?.state === 'closed') context = null;
    if (!context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return null;
      context = new Audio();
      context.onstatechange = () => {
        unlocked = gestureSeen && context.state === 'running';
        debugChanged();
      };
    }
    return context;
  }
  // resume() and the silent buffer start happen inside the original trusted tap.
  // Unlocking a silent context is safe before auth; audible playback still requires auth.
  function unlock(event) {
    if (!event?.isTrusted) return Promise.resolve(false);
    gestureSeen = true;
    debug.unlockAttempts++;
    try {
      const ctx = audioContext();
      if (!ctx) { debug.unlockError = 'web-audio-unavailable'; debugChanged(); return Promise.resolve(false); }
      debug.unlockError = null;
      const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => source.disconnect();
      source.start();
      unlocked = gestureSeen && ctx.state === 'running';
      // A pending iOS resume must not leave Test sound waiting indefinitely.
      resumePending = Promise.resolve(resumed).then(() => {
        unlocked = gestureSeen && ctx.state === 'running';
        debugChanged();
        return unlocked;
      }, () => {
        unlocked = false;
        debug.unlockError = 'resume-rejected';
        debugChanged();
        return false;
      });
      debugChanged();
      return resumePending;
    } catch (_) {
      unlocked = false;
      debug.unlockError = 'audio-initialization-failed';
      debugChanged();
      return Promise.resolve(false);
    }
  }
  for (const event of ['pointerdown', 'touchend', 'keydown', 'click']) {
    document.addEventListener(event, unlock, { capture: true, passive: true });
  }
  function boundedResume(promise) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 900);
      Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); },
        () => { clearTimeout(timer); resolve(false); });
    });
  }
  function gateReason() {
    if (!userId) return 'not-authenticated';
    if (!ready) return preferenceStatus === 'error' ? 'preference-sync-error' : 'preference-pending';
    if (!enabled) return 'preference-off';
    if (document.visibilityState !== 'visible') return 'page-hidden';
    return null;
  }
  async function play(type = 'notify', options = {}) {
    type = Object.prototype.hasOwnProperty.call(tones, type) ? type : 'notify';
    const owner = epoch, visible = visibilityRevision, started = Date.now();
    const preview = options.preview === true && options.event?.isTrusted === true;
    const source = preview ? 'test-button' : 'automatic';
    debug.playInvocations++;
    // Manual preview isolates the audio engine from the saved preference and Realtime.
    // It never changes the preference and still requires an authenticated, visible page.
    const reason = preview ? (!userId ? 'not-authenticated' : document.visibilityState !== 'visible' ? 'page-hidden' : null) : gateReason();
    if (reason) return playResult(type, source, reason);
    try {
      const ctx = audioContext();
      if (!ctx) return playResult(type, source, 'web-audio-unavailable');
      if (options.event?.isTrusted) {
        // No network operation or await before this call.
        const attempt = unlock(options.event);
        if (ctx.state !== 'running') await boundedResume(attempt);
      } else {
        if (!unlocked) return playResult(type, source, 'interaction-required');
        if (ctx.state !== 'running') {
          unlocked = false;
          await boundedResume(ctx.resume());
          unlocked = gestureSeen && ctx.state === 'running';
        }
      }
      if (owner !== epoch) return playResult(type, source, 'account-changed');
      if (visible !== visibilityRevision || document.visibilityState !== 'visible') return playResult(type, source, 'page-hidden');
      if (!preview && gateReason()) return playResult(type, source, gateReason());
      if (ctx.state !== 'running') return playResult(type, source, debug.unlockError || 'context-not-running');
      if (Date.now() - started > 1000) return playResult(type, source, 'resume-too-late');
      if (!preview && Date.now() - lastPlay < 180) return playResult(type, source, 'rate-limited');
      lastPlay = Date.now();
      for (const [frequency, offset, duration, wave] of (tones[type] || tones.notify)) {
        const oscillator = ctx.createOscillator(), gain = ctx.createGain();
        const time = ctx.currentTime + offset;
        oscillator.type = wave;
        oscillator.frequency.setValueAtTime(frequency, time);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(.035, time + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        active.add(oscillator);
        oscillator.onended = () => { active.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(time);
        oscillator.stop(time + duration + .015);
      }
      return playResult(type, source, 'scheduled', true);
    } catch (_) { stop(); return playResult(type, source, 'audio-operation-failed'); }
  }

  async function sync() {
    if (!client || !userId || saving) return;
    const owner = epoch, version = ++revision;
    preferenceStatus = 'syncing'; debugChanged();
    try {
      let { data, error } = await client.rpc('get_user_settings');
      // Two fresh devices may race to initialize the existing settings row.
      if (error?.code === '23505') ({ data, error } = await client.rpc('get_user_settings'));
      if (error) throw error;
      if (owner !== epoch || version !== revision || saving) return;
      ready = true;
      preferenceStatus = 'saved';
      setLocal(data?.notification_settings?.sound !== false);
    } catch (_) {
      // Keep the cache for the UI, but stay quiet until the saved preference is known.
      if (owner === epoch && version === revision) { ready = false; preferenceStatus = 'error'; changed(); }
    }
  }

  function account(id) {
    if (id === userId) return;
    const previousId = userId;
    userId = id;
    epoch++;
    revision++;
    ready = false;
    saving = false;
    if (previousId) { unlocked = false; gestureSeen = false; }
    preferenceStatus = id ? 'syncing' : 'signed-out';
    if (previousId) debug = freshDiagnostics();
    try {
      if (previousId && !id) sessionStorage.removeItem('fu-sound-debug:' + previousId);
      if (id) debug.previousPage = JSON.parse(sessionStorage.getItem('fu-sound-debug:' + id));
    } catch (_) {}
    enabled = id ? read(CACHE + id) !== false : true;
    seen.clear();
    stop();
    changed();
    // Do not await SDK calls inside an auth callback (Supabase auth lock).
    syncPromise = new Promise(resolve => setTimeout(resolve, 0)).then(sync);
  }
  function bindClient(sb) {
    if (!sb || client) return;
    client = sb;
    let authEvent = false;
    client.auth.onAuthStateChange((_event, session) => {
      authEvent = true;
      account(session?.user?.is_anonymous ? null : session?.user?.id || null);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (!error && !authEvent) account(data?.session?.user?.is_anonymous ? null : data?.session?.user?.id || null);
    }).catch(() => {});
  }

  async function setEnabled(value) {
    if (typeof value !== 'boolean') throw new Error('Invalid sound preference.');
    if (!client || !userId) throw new Error('Please sign in to update notification sounds.');
    if (saving) throw new Error('Please wait for your sound preference to save.');
    const owner = epoch;
    await syncPromise;
    if (owner !== epoch) throw new Error('Your account changed. Please try again.');
    if (saving) throw new Error('Please wait for your sound preference to save.');
    const previous = enabled;
    saving = true;
    revision++;
    setLocal(value);
    try {
      // Existing RPC is the only settings write boundary in production.
      // This key merges sound inside the database; no read/replace JSON race.
      const { data, error } = await client.rpc('update_user_setting', {
        p_key: 'notification_sound', p_value: String(value)
      });
      if (error) throw error;
      if (data !== true) throw new Error('Settings were not saved. Please try again.');
      if (owner === epoch) { ready = true; preferenceStatus = 'saved'; setLocal(value); }
      return value;
    } catch (error) {
      if (owner === epoch) setLocal(previous);
      throw error;
    } finally {
      if (owner === epoch) { saving = false; changed(); }
    }
  }

  // Shared by existing callbacks. No new Realtime subscriptions.
  async function once(key, type, owner, source) {
    const reason = gateReason();
    if (owner !== epoch) return eventResult(source, 'account-changed');
    if (reason) return eventResult(source, reason);
    const id = userId;
    async function claim() {
      if (owner !== epoch) return eventResult(source, 'account-changed');
      const now = Date.now();
      const stored = read(SEEN + id);
      const recent = (Array.isArray(stored) ? stored : []).filter(item => now - item.time < 300000);
      if (recent.some(item => item.key === key)) return eventResult(source, 'duplicate-persistent');
      eventResult(source, 'play-invoked');
      const played = await window.FUSound.play(type);
      // A blocked context must not claim the event for another foreground tab.
      if (played) write(SEEN + id, [...recent.slice(-127), { key, time: now }]);
      return played;
    }
    try {
      return navigator.locks ? await navigator.locks.request('fu-sound-' + id, claim) : await claim();
    } catch (_) { return eventResult(source, 'event-claim-failed'); }
  }
  function reserve(key) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 512) seen.delete(seen.values().next().value);
    return true;
  }
  function notification(row, recipient, source = 'notification') {
    debug.notificationEvents++;
    eventResult(source, 'callback-received');
    if (!row?.id) return eventResult(source, 'missing-event');
    if (!userId || recipient !== userId || row.receiver_id !== userId) return eventResult(source, 'recipient-mismatch');
    if (row.actor_id === userId) return eventResult(source, 'own-notification');
    if (row.read) return eventResult(source, 'already-read');
    if (['message', 'chat', 'new_message'].includes(row.type)) return eventResult(source, 'message-uses-chat-path');
    if (!reserve('notification:' + row.id)) return eventResult(source, 'duplicate-memory');
    const type = { like: 'like', comment: 'comment', reply: 'comment', mention: 'comment',
      repost: 'repost', follow: 'follow' }[row.type] || 'notify';
    void once('notification:' + row.id, type, epoch, source);
  }
  async function message(row, recipient, source = 'message') {
    debug.messageEvents++;
    eventResult(source, 'callback-received');
    if (!row?.id || !row.sender_id) return eventResult(source, 'missing-event');
    if (!userId || recipient !== userId) return eventResult(source, 'recipient-mismatch');
    if (row.sender_id === userId) return eventResult(source, 'own-message');
    const reason = gateReason();
    if (reason) return eventResult(source, reason);
    if (!reserve('message:' + row.id)) return eventResult(source, 'duplicate-memory');
    const id = userId, owner = epoch, visible = visibilityRevision, started = Date.now();
    try {
      const { data: msg, error } = await client.from('messages')
        .select('id, sender_id, conversation_id, deleted_for, expires_at, message_type')
        .eq('id', row.id).maybeSingle();
      if (error || !msg) return eventResult(source, 'message-read-denied-or-failed');
      if (msg.sender_id === id || msg.message_type === 'system' || (msg.deleted_for || []).includes(id) ||
          (msg.expires_at && Date.parse(msg.expires_at) <= Date.now())) return eventResult(source, 'message-not-eligible');
      const { data: conv, error: convError } = await client.from('conversations')
        .select('id, user1_id, user2_id, is_group, is_note, hidden_by, muted_by').eq('id', msg.conversation_id).maybeSingle();
      if (convError || !conv) return eventResult(source, 'conversation-read-denied-or-failed');
      if (conv.is_note || (conv.hidden_by || []).includes(id) || (conv.muted_by || []).includes(id)) return eventResult(source, 'conversation-muted-hidden-or-note');
      if (conv.is_group) {
        const { data: membership, error: memberError } = await client.from('conversation_members')
          .select('user_id').eq('conversation_id', conv.id).eq('user_id', id).maybeSingle();
        if (memberError || !membership) return eventResult(source, 'not-a-group-member');
      } else if (conv.user1_id !== id && conv.user2_id !== id) return eventResult(source, 'not-a-participant');
      if (visible !== visibilityRevision || Date.now() - started > 3000) return eventResult(source, 'event-stale');
      await once('message:' + msg.id, 'message', owner, source);
    } catch (_) { return eventResult(source, 'message-check-failed'); }
  }

  window.FUSound = { play, isEnabled: () => enabled, setEnabled, diagnostics };
  window.FreeUpperSounds = { notification, message, bindClient, preferenceState, channel };
  window.addEventListener('storage', event => {
    if (userId && event.key === CACHE + userId && !saving) {
      revision++;
      setLocal(read(CACHE + userId) !== false);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { visibilityRevision++; stop(); }
    else void sync();
  });
  window.addEventListener('pageshow', () => { void sync(); });
  window.addEventListener('online', () => { void sync(); });
  bindClient(window.sb);
})();
