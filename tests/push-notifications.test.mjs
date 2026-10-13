import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { getPushEnabledRecipients } from '../supabase/functions/send-push-notification/push-preference.js';

test('global preference keeps missing/null keys enabled and excludes every opted-out device', async () => {
    const supabase = { from: () => ({ select: () => ({ in: async () => ({ data: [
        { user_id: 'off', notification_settings: { push_enabled: false, likes: false } },
        { user_id: 'on', notification_settings: { push_enabled: true } },
        { user_id: 'legacy', notification_settings: { likes: false } },
        { user_id: 'null', notification_settings: null }
    ], error: null }) }) }) };
    assert.deepEqual(await getPushEnabledRecipients(supabase, ['off', 'on', 'legacy', 'missing', 'null', 'off']),
        ['on', 'legacy', 'missing', 'null']);
});

test('preference lookup errors stop delivery rather than opting users in', async () => {
    const supabase = { from: () => ({ select: () => ({ in: async () => ({ error: new Error('unavailable') }) }) }) };
    await assert.rejects(getPushEnabledRecipients(supabase, ['off']), /Could not check/);
    assert.deepEqual(await getPushEnabledRecipients(supabase, []), []);
});

async function sender({ muted = [], settings = {}, failure = false, changeBeforeDispatch = false } = {}) {
    const sends = [];
    let preferenceReads = 0;
    const sb = {
        rpc: async () => ({ data: 0, error: null }),
        from(table) {
            const chain = {
                select() { return chain; }, eq() { return chain; },
                async single() { return { data: table === 'conversations' ?
                    { id: 'c', is_group: true, is_note: false, muted_by: muted } :
                    { display_name: 'Someone', avatar_url: '' }, error: null }; },
                async in(_column, ids) {
                    if (table === 'user_settings') {
                        preferenceReads++;
                        return { data: ids.map(user_id => ({ user_id, notification_settings:
                            changeBeforeDispatch && preferenceReads > 1 ? { push_enabled: false } : settings[user_id] })),
                        error: failure ? new Error('unavailable') : null };
                    }
                    if (table === 'push_tokens') return { data: ids.flatMap(user_id => [
                        { user_id, token: user_id + '-phone', platform: 'web' },
                        { user_id, token: user_id + '-desktop', platform: 'web' }
                    ]), error: null };
                },
                then(resolve, reject) {
                    return Promise.resolve(table === 'conversation_members' ?
                        { data: [{ user_id: 'author' }, { user_id: 'on' }, { user_id: 'off' }, { user_id: 'muted' }] } :
                        { count: 0 }).then(resolve, reject);
                }
            };
            return chain;
        }
    };
    let handle;
    const source = await fs.readFile(new URL('../supabase/functions/send-push-notification/index.ts', import.meta.url), 'utf8');
    const executable = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, ''), { mode: 'strip' });
    const context = vm.createContext({
        getPushEnabledRecipients, createClient: () => sb,
        GoogleAuth: class { async getClient() { return { getAccessToken: async () => ({ token: 'test-only' }) }; } },
        Deno: { env: { get: key => key === 'FIREBASE_SERVICE_ACCOUNT_JSON' ? '{}' : 'test-only' }, serve: fn => { handle = fn; } },
        fetch: async (_url, options) => { sends.push(JSON.parse(options.body).message.token); return { ok: true, status: 200, text: async () => '{}' }; },
        Response, console: { log() {}, error() {} }, Map, Set
    });
    new vm.Script(executable).runInContext(context);
    const response = await handle({ json: async () => ({ table: 'messages', record: {
        id: 'm', conversation_id: 'c', sender_id: 'author', text: 'Hello'
    } }) });
    return { sends, response };
}

test('actual sender preserves per-chat mutes while skipping all old opted-out tokens', async () => {
    const result = await sender({ muted: ['muted'], settings: { off: { push_enabled: false } } });
    assert.deepEqual(result.sends, ['on-phone', 'on-desktop']);
    assert.equal(result.response.status, 200);
});

test('sender skips queued recipients who opt out during badge calculation', async () => {
    const result = await sender({ changeBeforeDispatch: true });
    assert.deepEqual(result.sends, []);
});

test('actual sender never falls back to sending when preferences cannot be read', async () => {
    const result = await sender({ failure: true });
    assert.deepEqual(result.sends, []);
    assert.equal(result.response.status, 500);
});

test('page integration has one shared initializer and no chat permission modal owner', async () => {
    for (const file of ['index.html', 'chat.html', 'settings.html']) {
        const text = await fs.readFile(new URL('../' + file, import.meta.url), 'utf8');
        assert.equal((text.match(/src="push-notifications.js"/g) || []).length, 1, file);
        assert.equal((text.match(/src="notification-permission.js"/g) || []).length, 1, file);
        assert.doesNotMatch(text, /initializeApp\(firebaseConfig\)/);
    }
    const chat = await fs.readFile(new URL('../chat.js', import.meta.url), 'utf8');
    assert.doesNotMatch(chat, /FreeUpperNotificationPermission\.start|\.from\('push_tokens'\)/);
    assert.match(chat, /toggleMuteChat/);
});
