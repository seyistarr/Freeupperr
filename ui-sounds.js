/* FreeUpper in-page sounds. Firebase/background push remains independent. */
(() => {
  'use strict';
  if (window.FUSound) return;

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
    }
    return context;
  }
  // Must run synchronously in a genuine interaction, including iOS Safari/PWA.
  function unlock(event) {
    if (!event.isTrusted || !userId) return;
    try {
      const ctx = audioContext();
      if (!ctx) return;
      unlocked = true;
      const resumed = ctx.resume();
      if (resumed?.catch) resumed.catch(() => {});
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => source.disconnect();
      source.start();
    } catch (_) { /* autoplay and unavailable audio are normal */ }
  }
  for (const event of ['pointerdown', 'touchend', 'keydown', 'click']) {
    document.addEventListener(event, unlock, { capture: true, passive: true });
  }

  async function play(type = 'notify') {
    const owner = epoch, visible = visibilityRevision, started = Date.now();
    if (!userId || !ready || !enabled || !unlocked || document.visibilityState !== 'visible') return false;
    try {
      const ctx = audioContext();
      if (!ctx) return false;
      if (ctx.state !== 'running') await ctx.resume();
      // Never queue old sounds after app suspension or account changes.
      if (owner !== epoch || visible !== visibilityRevision || !enabled || !ready || ctx.state !== 'running' ||
          document.visibilityState !== 'visible' || Date.now() - started > 1000 ||
          Date.now() - lastPlay < 180) return false;
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
      return true;
    } catch (_) { stop(); return false; }
  }

  async function sync() {
    if (!client || !userId || saving) return;
    const owner = epoch, version = ++revision;
    try {
      let { data, error } = await client.rpc('get_user_settings');
      // Two fresh devices may race to initialize the existing settings row.
      if (error?.code === '23505') ({ data, error } = await client.rpc('get_user_settings'));
      if (error) throw error;
      if (owner !== epoch || version !== revision || saving) return;
      ready = true;
      setLocal(data?.notification_settings?.sound !== false);
    } catch (_) {
      // Keep the cache for the UI, but stay quiet until the saved preference is known.
      if (owner === epoch && version === revision) { ready = false; changed(); }
    }
  }

  function account(id) {
    if (id === userId) return;
    userId = id;
    epoch++;
    revision++;
    ready = false;
    saving = false;
    unlocked = false;
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
      if (owner === epoch) { ready = true; setLocal(value); }
      return value;
    } catch (error) {
      if (owner === epoch) setLocal(previous);
      throw error;
    } finally {
      if (owner === epoch) { saving = false; changed(); }
    }
  }

  // Claim before asynchronous checks; shared by all existing Realtime callbacks.
  async function once(key, type, owner) {
    if (owner !== epoch || !ready || !enabled || !unlocked || document.visibilityState !== 'visible') return false;
    const id = userId;
    async function claim() {
      if (owner !== epoch) return false;
      const now = Date.now();
      const recent = (read(SEEN + id) || []).filter(item => now - item.time < 300000);
      if (recent.some(item => item.key === key)) return false;
      write(SEEN + id, [...recent.slice(-127), { key, time: now }]);
      return play(type);
    }
    try {
      // Locks make the persistent event claim atomic across foreground tabs.
      return navigator.locks ? await navigator.locks.request('fu-sound-' + id, claim) : await claim();
    } catch (_) { return false; }
  }
  function reserve(key) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 512) seen.delete(seen.values().next().value);
    return true;
  }
  function notification(row, recipient) {
    if (!row?.id || !userId || recipient !== userId || row.receiver_id !== userId ||
        row.actor_id === userId || row.read || !reserve('notification:' + row.id)) return;
    // Chat audio is driven only by messages, never by a second notification row.
    if (['message', 'chat', 'new_message'].includes(row.type)) return;
    const type = { like: 'like', comment: 'comment', reply: 'comment', mention: 'comment',
      repost: 'repost', follow: 'follow' }[row.type] || 'notify';
    void once('notification:' + row.id, type, epoch);
  }
  async function message(row, recipient) {
    if (!row?.id || !userId || recipient !== userId || !row.sender_id || row.sender_id === userId ||
        !ready || !enabled || !unlocked || document.visibilityState !== 'visible' || !reserve('message:' + row.id)) return;
    const id = userId, owner = epoch, visible = visibilityRevision, started = Date.now();
    try {
      // Re-read under the current JWT/RLS, including block and membership rules.
      const { data: msg, error } = await client.from('messages')
        .select('id, sender_id, conversation_id, deleted_for, expires_at, message_type')
        .eq('id', row.id).maybeSingle();
      if (error || !msg || msg.sender_id === id || msg.message_type === 'system' ||
          (msg.deleted_for || []).includes(id) || (msg.expires_at && Date.parse(msg.expires_at) <= Date.now())) return;
      const { data: conv, error: convError } = await client.from('conversations')
        .select('id, user1_id, user2_id, is_group, is_note, hidden_by, muted_by').eq('id', msg.conversation_id).maybeSingle();
      if (convError || !conv || conv.is_note || (conv.hidden_by || []).includes(id) || (conv.muted_by || []).includes(id)) return;
      if (conv.is_group) {
        const { data: membership, error: memberError } = await client.from('conversation_members')
          .select('user_id').eq('conversation_id', conv.id).eq('user_id', id).maybeSingle();
        if (memberError || !membership) return;
      } else if (conv.user1_id !== id && conv.user2_id !== id) return;
      if (visible !== visibilityRevision || Date.now() - started > 3000) return;
      await once('message:' + msg.id, 'message', owner);
    } catch (_) { /* RLS denial/network failure: no sound, leave delivery alone. */ }
  }

  window.FUSound = { play, isEnabled: () => enabled, setEnabled };
  window.FreeUpperSounds = { notification, message, bindClient, preferenceState };
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
