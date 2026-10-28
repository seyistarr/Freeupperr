import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export const source = readFileSync('ui-sounds.js', 'utf8');
export async function fixture(options = {}) {
  const listeners = {}, windowListeners = {}, rows = options.rows || new Map();
  const sessionStorage = options.sessionStorage || new Map();
  let authCallback, now = 10000, failWrite = false, conflict = null, queryGate = null;
  const frequencies = [], gains = [], channels = [];
  const storage = options.storage || new Map();
  const state = { uid: options.uid === undefined ? 'alice' : options.uid, frequencies, gains, rows, channels,
    advance() { now += 2000; }, fail() { failWrite = true; }, conflict(fn) { conflict = fn; },
    gate(fn) { queryGate = fn; },
    async flush() { await delay(10); },
    async login(uid) { state.uid = uid; authCallback('SIGNED_IN', { user: { id: uid } }); await delay(10); },
    async logout() { state.uid = null; authCallback('SIGNED_OUT', null); await delay(10); },
    gesture() { listeners.pointerdown?.forEach(fn => fn({ isTrusted: true })); },
    tap() { return { isTrusted: true }; },
    async visibility(value) { document.visibilityState = value; listeners.visibilitychange?.forEach(fn => fn()); await delay(10); }
  };
  class Audio {
    constructor() { this.state = options.blocked || options.hangingResume ? 'suspended' : 'running'; this.currentTime = 0; this.sampleRate = 44100; state.audio = this; }
    resume() { if (options.hangingResume) return new Promise(() => {}); if (options.blocked) return Promise.reject(Error('NotAllowedError')); this.state = 'running'; return Promise.resolve(); }
    createBuffer() { return {}; }
    createBufferSource() { return { connect() {}, disconnect() {}, start() {} }; }
    createOscillator() { return { frequency: { setValueAtTime(f) { frequencies.push(f); } }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime(v) { gains.push(v); }, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const db = {
    user_settings: rows,
    messages: new Map([['m1', { id: 'm1', sender_id: 'bob', conversation_id: 'c1' }]]),
    conversations: new Map([['c1', { id: 'c1', user1_id: 'alice', user2_id: 'bob' }]]),
    conversation_members: new Map()
  };
  state.db = db;
  const sb = {
    auth: {
      onAuthStateChange(cb) { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => { if (options.sessionGate) await options.sessionGate; return ({ data: { session: state.uid ? { user: { id: state.uid, is_anonymous: options.anonymous } } : null } }); },
      getUser: async () => ({ data: { user: state.uid ? { id: state.uid } : null } })
    },
    channel(name) {
      const channel = { name, callbacks: [], on(event, filter, cb) { this.callbacks.push({ filter, cb }); return this; }, subscribe() { channels.push(this); return this; } };
      return channel;
    }, removeChannel() {}, async rpc(name, args) {
      if (name === 'get_unread_message_count') return { data: 4 };
      const key = state.uid;
      if (queryGate) await queryGate('user_settings', name);
      if (name === 'get_user_settings' && options.preferenceError) return { error: Error('offline') };
      if (name === 'get_user_settings') return { data: structuredClone(rows.get(key) || { user_id: key, notification_settings: {} }) };
      if (failWrite) { failWrite = false; return { error: Error('offline') }; }
      if (conflict) { const fn = conflict; conflict = null; fn(rows, key); }
      const row = rows.get(key) || { user_id: key };
      rows.set(key, { ...row, notification_settings: { ...row.notification_settings, sound: args.p_value === 'true' } });
      return { data: true };
    },
    from(table) {
      const filters = []; let action = 'select', payload;
      const query = {
        select() { return query; }, eq(k, v) { filters.push([k, v]); return query; },
        is(k, v) { filters.push([k, v]); return query; },
        update(p) { action = 'update'; payload = p; return query; },
        insert(p) { action = 'insert'; payload = p; return query; },
        maybeSingle() { return query; },
        async then(resolve, reject) {
          try {
            if (queryGate) await queryGate(table, action);
            if (table === 'notifications') return resolve({ count: 3 });
            const map = db[table];
            const key = filters.find(([k]) => ['user_id', 'id'].includes(k))?.[1] || payload?.user_id;
            const row = map?.get(key);
            if (action === 'select') return resolve({ data: row ? structuredClone(row) : null });
            if (failWrite) { failWrite = false; return resolve({ error: Error('offline') }); }
            if (conflict) { const fn = conflict; conflict = null; fn(map, key); }
            const current = map.get(key);
            if (action === 'insert') {
              if (current) return resolve({ error: { code: '23505' } });
              map.set(key, structuredClone(payload));
              return resolve({ data: { user_id: key } });
            }
            const compare = filters.find(([k]) => k === 'notification_settings');
            if (!current || (compare && JSON.stringify(current.notification_settings) !== JSON.stringify(compare[1] === null ? null : JSON.parse(compare[1])))) return resolve({ data: null });
            map.set(key, { ...current, ...structuredClone(payload) });
            resolve({ data: { user_id: key } });
          } catch (error) { reject(error); }
        }
      };
      return query;
    }
  };
  const badges = { notificationUnreadBadge: { style: {} }, chatUnreadBadge: { style: {} } };
  const document = { visibilityState: 'visible', addEventListener(name, cb) { (listeners[name] ||= []).push(cb); }, getElementById: id => badges[id] };
  const window = { sb: options.lateClient ? undefined : sb, ...(options.unavailable ? {} : { AudioContext: Audio }),
    addEventListener(name, cb) { (windowListeners[name] ||= []).push(cb); },
    dispatchEvent(event) { windowListeners[event.type]?.forEach(fn => fn(event)); }
  };
  const sandbox = { window, document, navigator: {}, console, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    Date: class extends Date { static now() { return now; } },
    setTimeout, clearTimeout, sessionStorage: { getItem: key => sessionStorage.get(key) ?? null, setItem: (key, val) => sessionStorage.set(key, val), removeItem: key => sessionStorage.delete(key) }, localStorage: {
      getItem: key => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val)
    }
  };
  state.sandbox = vm.createContext(sandbox);
  vm.runInContext(options.source || source, state.sandbox);
  state.sound = window.FUSound; state.events = window.FreeUpperSounds; state.badges = badges;
  state.domReady = () => { window.sb = sb; listeners.DOMContentLoaded?.forEach(fn => fn()); };
  state.storage = storage; state.sessionStorage = sessionStorage;
  state.notification = (type = 'like', id = 'n1', rest = {}) => state.events.notification({ id, type, actor_id: 'bob', receiver_id: 'alice', ...rest }, 'alice');
  await state.flush();
  return state;
}
