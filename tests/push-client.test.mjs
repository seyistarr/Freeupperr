import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const clientSource = await fs.readFile(new URL('../push-notifications.js', import.meta.url), 'utf8');
const permissionSource = await fs.readFile(new URL('../notification-permission.js', import.meta.url), 'utf8');
const authSource = await fs.readFile(new URL('../auth.js', import.meta.url), 'utf8');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

// The real client scripts run unchanged except remote SDK imports, which are replaced by local mocks.
async function device({ db = { settings: new Map(), tokens: [] }, user = 'u', permission = 'granted',
    page = 'settings', storage = new Map(), ios = false, standalone = false, tablet = false, token = 'device-A', preferencePause = null } = {}) {
    const state = { user, permission, result: 'granted', requests: 0, inGesture: false, imports: 0,
        initialized: 0, getTokens: 0, workerRegistrations: 0, listenerAdds: 0, handlers: new Set(),
        failure: false, concurrentChange: false, pauseToken: null, toasts: [], signOutMode: null, tokenDeleteFailure: false };
    const elements = new Map();
    const listeners = new Map();
    class Element {
        constructor() { this.listeners = new Map(); this.children = []; this.classList = {
            set: new Set(), add(value) { this.set.add(value); }, remove(value) { this.set.delete(value); },
            contains(value) { return this.set.has(value); }
        }; }
        set innerHTML(html) {
            this.children = [...html.matchAll(/id="([^"]+)"/g)].map(match => { const child = new Element(); child.id = match[1]; return child; });
        }
        appendChild(child) { this.children.push(child); elements.set(child.id, child); for (const item of child.children) elements.set(item.id, item); }
        remove() { elements.delete(this.id); for (const child of this.children) child.remove(); }
        focus() { document.activeElement = this; }
        addEventListener(name, fn, options = {}) {
            const list = this.listeners.get(name) || []; list.push({ fn, once: options.once }); this.listeners.set(name, list);
        }
        emit(name, event = {}) {
            for (const item of [...(this.listeners.get(name) || [])]) {
                if (item.once) this.listeners.set(name, this.listeners.get(name).filter(other => other !== item));
                item.fn(event);
            }
        }
    }
    const body = new Element(); body.dataset = { pushPage: page };
    const document = { body, readyState: 'loading', activeElement: null, visibilityState: 'visible',
        createElement: () => new Element(), getElementById: id => elements.get(id) || null,
        querySelector: () => null,
        addEventListener(name, fn) { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list); }
    };
    for (const id of ['pushNotificationsToggle', 'pushNotificationsStatus', 'pushNotificationsEnableDevice',
        'pushIosInstallGuidance', 'pushIosInstallDismiss']) { const e = new Element(); e.id = id; e.hidden = true; elements.set(id, e); }
    const authListeners = [];
    const observers = [];
    function query(table) {
        let operation = 'read'; let payload; const filters = [];
        const q = {
            select() { return q; }, eq(key, value) { filters.push([key, value]); return q; },
            is(key, value) { filters.push([key, value]); return q; },
            update(value) { operation = 'update'; payload = value; return q; },
            insert(value) { operation = 'insert'; payload = value; return q; },
            upsert(value) { operation = 'upsert'; payload = value; return q; },
            delete() { operation = 'delete'; return q; },
            maybeSingle() { return execute(); },
            then(resolve, reject) { return execute().then(resolve, reject); }
        };
        async function execute() {
            const id = filters.find(([key]) => key === 'user_id')?.[1] || payload?.user_id;
            if (!state.user || id !== state.user) return { error: { message: 'owner policy' }, data: null };
            if (table === 'user_settings') {
                if (state.failure) return { error: { message: 'unavailable' }, data: null };
                if (operation === 'read') {
                    if (preferencePause) await preferencePause;
                    return { data: db.settings.has(id) ? { notification_settings: clone(db.settings.get(id)) } : null };
                }
                if (operation === 'insert') {
                    if (db.settings.has(id)) return { error: { code: '23505' } };
                    db.settings.set(id, { likes: true, follows: true, replies: true, comments: true, mentions: true });
                    return { data: null };
                }
                if (state.concurrentChange) {
                    state.concurrentChange = false;
                    db.settings.set(id, { ...db.settings.get(id), mentions: false, future_setting: { value: 42 } });
                }
                const previous = filters.find(([key]) => key === 'notification_settings')?.[1];
                if ((previous === null && db.settings.get(id) !== null) ||
                    (previous !== null && JSON.stringify(db.settings.get(id)) !== previous)) return { data: [] };
                db.settings.set(id, clone(payload.notification_settings));
                return { data: [{ user_id: id }] };
            }
            if (operation === 'upsert') {
                const existing = db.tokens.find(row => row.token === payload.token);
                if (existing && existing.user_id !== id) return { error: { message: 'owner policy' } };
                db.tokens = db.tokens.filter(row => row.token !== payload.token);
                db.tokens.push(clone(payload));
            }
            if (operation === 'delete') {
                if (state.tokenDeleteFailure) return { error: new Error('token cleanup failed') };
                db.tokens = db.tokens.filter(row => !filters.every(([key, value]) => row[key] === value));
            }
            return { data: null };
        }
        return q;
    }
    const sb = { from: query, auth: {
        getSession: async () => ({ data: { session: state.user ? { user: { id: state.user } } : null } }),
        async signOut() {
            if (state.signOutMode === 'throw') throw new Error('sign-out threw');
            if (state.signOutMode === 'error') return { error: new Error('sign-out returned error') };
            state.user = null;
            for (const fn of authListeners) fn('SIGNED_OUT', null);
            return { error: null };
        },
        onAuthStateChange: fn => { authListeners.push(fn); }
    } };
    const fcm = { isSupported: async () => true, getMessaging: () => ({}),
        async getToken() { state.getTokens++; if (state.pauseToken) await state.pauseToken; return token; },
        onMessage(_messaging, fn) { state.listenerAdds++; state.handlers.add(fn); return () => state.handlers.delete(fn); }
    };
    const app = { getApps: () => state.initialized ? [{}] : [], getApp: () => ({}),
        initializeApp() { state.initialized++; return {}; } };
    const windowListeners = new Map();
    const window = { document, sb, isSecureContext: true, PushManager: class {}, matchMedia: () => ({ matches: standalone }),
        showToast: msg => state.toasts.push(msg),
        addEventListener(name, fn) { const list = windowListeners.get(name) || []; list.push(fn); windowListeners.set(name, list); }
    };
    const navigator = { userAgent: tablet ? 'Macintosh' : ios ? 'iPhone' : 'test', maxTouchPoints: tablet ? 5 : 0,
        standalone, serviceWorker: { async register() { state.workerRegistrations++; return {}; } } };
    const Notification = { get permission() { return state.permission; }, requestPermission() {
        assert.equal(state.inGesture, true, 'permission request must run inside the original gesture');
        state.requests++; state.permission = state.result; return Promise.resolve(state.result);
    } };
    window.Notification = Notification;
    const context = vm.createContext({ window, document, navigator, Notification,
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
        MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} }, setTimeout, console: { warn() {} },
        __importFirebase: async name => { state.imports++; return name === 'app' ? app : fcm; }
    });
    const executable = clientSource.replace(/import\('https:\/\/www.gstatic.com\/firebasejs\/12.18.0\/firebase-(app|messaging).js'\)/g,
        (_match, name) => `__importFirebase('${name === 'app' ? 'app' : 'messaging'}')`);
    vm.runInContext(permissionSource, context);
    vm.runInContext(executable, context);
    for (const fn of listeners.get('DOMContentLoaded') || []) fn();
    await settle();
    return { db, state, elements, storage, window, sb, api: window.FreeUpperPushNotifications,
        repeatScript: () => vm.runInContext(executable, context),
        async mutate() { for (const fn of observers) fn(); await settle(); },
        async click(id, checked) {
            const e = elements.get(id); assert.ok(e, id);
            if (checked !== undefined) e.checked = checked;
            state.inGesture = true;
            try { e.emit(checked === undefined ? 'click' : 'change'); } finally { state.inGesture = false; }
            await settle();
        },
        async setUser(id) { state.user = id; for (const fn of authListeners) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); await settle(); },
        async focus() { for (const fn of windowListeners.get('focus') || []) fn(); await settle(); },
        async message(payload) { for (const fn of state.handlers) fn(payload); await settle(); }
    };
}

test('homepage opt-in starts only after authentication and requests permission in the click gesture', async () => {
    const d = await device({ user: null, page: 'home', permission: 'default' });
    assert.equal(d.elements.has('fuNotificationPermissionModal'), false);
    await d.setUser('u');
    assert.equal(d.state.requests, 0);
    assert.equal(d.elements.has('fuNotificationPermissionModal'), true);
    await d.click('fuNotificationAllow');
    assert.equal(d.state.requests, 1);
    assert.equal(d.db.tokens.length, 1);
    assert.equal(d.storage.get('freeupper_notification_prompt'), 'handled');
});

function authSignOut(device) {
    const start = authSource.indexOf('  async function signOut() {');
    const end = authSource.indexOf('\n  // ─── LEGAL UPDATE MODAL', start);
    assert.ok(start >= 0 && end > start);
    const effects = { guestWrites: 0, avatarUpdates: 0, events: 0 };
    const context = vm.createContext({ window: device.window, sb: device.sb,
        defaultGuest: () => ({ isLoggedIn: false }), USER_KEY: 'test-auth-cache',
        localStorage: { setItem() { effects.guestWrites++; } },
        updateAvatarEls() { effects.avatarUpdates++; },
        document: { dispatchEvent() { effects.events++; } },
        CustomEvent: class {}, console: { warn() {} }
    });
    vm.runInContext(authSource.slice(start, end) + '\nthis.runSignOut = signOut;', context);
    return { run: context.runSignOut, effects };
}

test('returned sign-out error preserves the signed-in UI and restores one push listener', async () => {
    const d = await device(); const auth = authSignOut(d); d.state.signOutMode = 'error';
    await assert.rejects(auth.run(), /sign-out returned error/); await settle();
    assert.deepEqual(auth.effects, { guestWrites: 0, avatarUpdates: 0, events: 0 });
    assert.equal(d.state.user, 'u'); assert.equal(d.state.handlers.size, 1);
    assert.equal(d.db.tokens.some(row => row.token === 'device-A'), true);
    await d.click('pushNotificationsToggle', false);
    assert.equal(d.db.settings.get('u').push_enabled, false, 'failed logout must not leave controls suspended');
});

test('thrown sign-out error also recovers without writing a guest cache', async () => {
    const d = await device(); const auth = authSignOut(d); d.state.signOutMode = 'throw';
    await assert.rejects(auth.run(), /sign-out threw/); await settle();
    assert.equal(auth.effects.guestWrites, 0); assert.equal(d.state.handlers.size, 1);
});

test('sign-out failure recovery still honors a global opt-out', async () => {
    const d = await device(); const auth = authSignOut(d);
    d.db.settings.set('u', { push_enabled: false, likes: false }); d.state.signOutMode = 'error';
    await assert.rejects(auth.run(), /sign-out returned error/); await settle();
    assert.equal(d.state.handlers.size, 0); assert.equal(d.db.tokens.length, 0);
    assert.equal(d.db.settings.get('u').push_enabled, false);
});

test('token cleanup failure does not block a successful sign-out or delete another device', async () => {
    const db = { settings: new Map(), tokens: [{ user_id: 'u', token: 'other-device' }] };
    const d = await device({ db }); const auth = authSignOut(d); d.state.tokenDeleteFailure = true;
    await auth.run(); await settle();
    assert.deepEqual(auth.effects, { guestWrites: 1, avatarUpdates: 1, events: 1 });
    assert.equal(d.state.user, null); assert.equal(d.state.handlers.size, 0);
    assert.equal(db.tokens.some(row => row.token === 'other-device'), true);
    assert.equal(db.tokens.some(row => row.token === 'device-A'), true, 'failed cleanup leaves a server token; it must be reported as a residual risk');
});

test('homepage DOM changes cannot show a prompt before the saved global preference loads', async () => {
    let release;
    const pause = new Promise(resolve => { release = resolve; });
    const d = await device({ page: 'home', permission: 'default', preferencePause: pause,
        db: { settings: new Map([['u', { push_enabled: false }]]), tokens: [] } });
    await d.mutate();
    assert.equal(d.elements.has('fuNotificationPermissionModal'), false);
    release(); await settle(); await d.mutate();
    assert.equal(d.elements.has('fuNotificationPermissionModal'), false);
});

test('dismissal survives reload and denial never requests permission again', async () => {
    const d = await device({ page: 'home', permission: 'default' });
    await d.click('fuNotificationLater');
    const reload = await device({ page: 'home', permission: 'default', storage: d.storage });
    assert.equal(reload.elements.has('fuNotificationPermissionModal'), false);
    const denied = await device({ page: 'home', permission: 'denied' });
    assert.equal(denied.state.requests, 0);
    assert.equal(denied.elements.has('fuNotificationPermissionModal'), false);
    await denied.click('pushNotificationsToggle', false);
    await denied.click('pushNotificationsToggle', true);
    assert.equal(denied.db.settings.get('u').push_enabled, false);
    assert.equal(denied.state.requests, 0);
});

test('settings opt-out and opt-in preserve unknown JSONB keys, including concurrent device updates', async () => {
    const db = { settings: new Map([['u', { likes: false, unknown: { preserve: true } }]]), tokens: [] };
    const d = await device({ db }); d.state.concurrentChange = true;
    await d.click('pushNotificationsToggle', false);
    assert.deepEqual(db.settings.get('u'), { likes: false, unknown: { preserve: true }, mentions: false,
        future_setting: { value: 42 }, push_enabled: false });
    const before = d.state.getTokens; await d.focus(); assert.equal(d.state.getTokens, before);
    await d.click('pushNotificationsToggle', true);
    assert.equal(db.settings.get('u').push_enabled, true);
    assert.deepEqual(db.settings.get('u').future_setting, { value: 42 });
});

test('new settings rows retain database defaults; null JSONB is also supported', async () => {
    const d = await device(); await d.click('pushNotificationsToggle', false);
    assert.equal(d.db.settings.get('u').likes, true);
    assert.equal(d.db.settings.get('u').push_enabled, false);
    const n = await device({ db: { settings: new Map([['u', null]]), tokens: [] } });
    await n.click('pushNotificationsToggle', false);
    assert.deepEqual(n.db.settings.get('u'), { push_enabled: false });
});

test('global off persists across reload, multiple devices and old registered tokens', async () => {
    const db = { settings: new Map(), tokens: [{ user_id: 'u', token: 'old-phone' }] };
    const a = await device({ db, token: 'A' }); const b = await device({ db, token: 'B' });
    await a.click('pushNotificationsToggle', false);
    const bCalls = b.state.getTokens; await b.focus(); assert.equal(b.state.getTokens, bCalls);
    assert.equal(b.state.handlers.size, 0);
    const reload = await device({ db, token: 'C', page: 'home' });
    assert.equal(reload.state.getTokens, 0);
    assert.equal(reload.elements.has('fuNotificationPermissionModal'), false);
    assert.equal(db.tokens.some(row => row.token === 'old-phone'), true);
    await a.click('pushNotificationsToggle', true); await b.focus();
    assert.equal(b.state.handlers.size, 1);
});

test('sign-out unregisters only this device and sign-in cannot register tokens for a disabled account', async () => {
    const db = { settings: new Map([['other', { push_enabled: false }]]), tokens: [{ user_id: 'u', token: 'another-device' }] };
    const d = await device({ db }); await d.api.beforeSignOut(); await d.setUser(null); await d.focus();
    assert.deepEqual(db.tokens.map(row => row.token), ['another-device']);
    assert.equal(d.state.handlers.size, 0);
    await d.setUser('other'); assert.equal(db.tokens.some(row => row.user_id === 'other'), false);
    await d.setUser('u'); assert.equal(db.tokens.some(row => row.token === 'device-A'), true);
});

test('registration completing during sign-out is discarded without recreating an old token', async () => {
    const d = await device(); let release;
    d.state.pauseToken = new Promise(resolve => { release = resolve; });
    const refresh = d.api.refresh(); await settle();
    const logout = d.api.beforeSignOut(); release(); await refresh; await logout; await d.setUser(null);
    assert.equal(d.db.tokens.length, 0);
});

test('repeated initialization and refresh leave one Firebase app and one foreground listener', async () => {
    const d = await device(); d.repeatScript(); await d.api.start(); await d.focus();
    assert.equal(d.state.initialized, 1); assert.equal(d.state.handlers.size, 1); assert.equal(d.state.listenerAdds, 1);
    await d.message({ data: { title: '<script>', body: 'hello' } });
    assert.match(d.state.toasts[0], /&lt;script&gt;/);
    await d.click('pushNotificationsToggle', false); await d.message({ data: { body: 'ignored' } });
    assert.equal(d.state.toasts.length, 1);
});

test('iPhone and desktop-mode iPad require installation; dismissed guidance stays dismissed', async () => {
    for (const tablet of [false, true]) {
        const d = await device({ page: 'home', ios: true, tablet, permission: 'default' });
        assert.equal(d.state.requests, 0); assert.equal(d.state.getTokens, 0);
        assert.equal(d.elements.get('pushIosInstallGuidance').hidden, false);
        await d.click('pushIosInstallDismiss');
        const reload = await device({ page: 'home', ios: true, tablet, permission: 'default', storage: d.storage });
        assert.equal(reload.elements.get('pushIosInstallGuidance').hidden, true);
    }
    const installed = await device({ page: 'home', ios: true, standalone: true, permission: 'default' });
    assert.equal(installed.elements.has('fuNotificationPermissionModal'), true);
});

test('preference read failures do not register tokens or silently enable the account', async () => {
    const db = { settings: new Map([['u', { push_enabled: false, likes: false }]]), tokens: [] };
    const d = await device({ db }); d.state.failure = true;
    await d.click('pushNotificationsToggle', true);
    assert.equal(db.settings.get('u').push_enabled, false);
    assert.equal(d.state.getTokens, 0);
});
