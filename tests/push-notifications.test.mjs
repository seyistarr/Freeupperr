import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { senderEnvironment, isolatePayload, stagingRequestAllowed } from '../supabase/functions/send-push-notification/environment.js';
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

async function sender({ muted = [], settings = {}, failure = false, changeBeforeDispatch = false,
    environment = 'production', webhookSecret = 'x'.repeat(32), table = 'messages', record = { id: 'm', conversation_id: 'c', sender_id: 'author', text: 'Hello' } } = {}) {
    const sends = [];
    const endpoints = [];
    const environmentValues = environment === 'staging' ? { APP_ENV: 'staging', APP_ORIGIN: 'https://freeupper-stage.example.test', FIREBASE_PROJECT_ID: 'freeupper-staging-test', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', STAGING_WEBHOOK_SECRET: 'x'.repeat(32), FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'freeupper-staging-test' }) } : { SUPABASE_URL: 'https://jmjtqidirpmnegzvmiaq.supabase.co', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' };
    const payloads = [];
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
        getPushEnabledRecipients, senderEnvironment, isolatePayload, stagingRequestAllowed, createClient: () => sb,
        GoogleAuth: class { async getClient() { return { getAccessToken: async () => ({ token: 'test-only' }) }; } },
        Deno: { env: { get: key => environmentValues[key] }, serve: fn => { handle = fn; } },
        fetch: async (_url, options) => { endpoints.push(_url); const message = JSON.parse(options.body).message; sends.push(message.token); payloads.push(message); return { ok: true, status: 200, text: async () => '{}' }; },
        Response, URL, TextEncoder, crypto: globalThis.crypto, console: { log() {}, error() {} }, Map, Set
    });
    new vm.Script(executable).runInContext(context);
    const response = await handle({ headers: new Headers(webhookSecret ? { 'x-freeupper-staging-secret': webhookSecret } : {}), json: async () => ({ table, record }) });
    return { sends, response, payloads, endpoints };
}

test('sender scope audit matches the original deployed source after removing only approved changes', async () => {
    const prepared = await fs.readFile(new URL('../supabase/functions/send-push-notification/index.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(prepared, /freeupper\.vercel\.app/);
    const stage1Baseline = prepared
        .replace("import { senderEnvironment, isolatePayload, stagingRequestAllowed } from './environment.js';\n", '')
        .replace('// Selected after service-account parsing below.', 'const FIREBASE_PROJECT_ID = "freeupper-notifications";')
        .replace('const SENDER_CONFIG = senderEnvironment(Deno.env, FIREBASE_SERVICE_ACCOUNT);\nconst FIREBASE_PROJECT_ID = SENDER_CONFIG.firebaseProjectId;\nconst APP_ORIGIN = SENDER_CONFIG.appOrigin;\n\n', '')
        .replace('const payload = isolatePayload({\n          ...dataPayload\n        }, SENDER_CONFIG);', 'const payload = {\n          ...dataPayload\n        };')
        .replace('    if (!(await stagingRequestAllowed(req, Deno.env, SENDER_CONFIG))) return new Response("Unauthorized", { status: 401 });\n\n', '')
        .replaceAll('${APP_ORIGIN}', 'https://www.freeupper.com')
        .replace(/`https:\/\/www\.freeupper\.com\/(index\.html|freeupper\.png)`/g, '"https://www.freeupper.com/$1"');
    assert.equal(createHash('sha256').update(stage1Baseline).digest('hex'), '47080fe9851d83ddcc0ac112a87704e18d25b8fb6d65162a707b1630e3ffe3ec');
    const baseline = stage1Baseline
        .replace("import { getPushEnabledRecipients } from './push-preference.js';\n", '')
        .replace('  recipientIds = await getPushEnabledRecipients(supabase, recipientIds);\n  if (!recipientIds.length) return;\n\n', '')
        .replace('  // Recheck after badge/token work so a recent opt-out also suppresses queued work.\n  const enabledRecipients = new Set(await getPushEnabledRecipients(supabase, recipientIds));\n\n', '')
        .replace('tokens.filter(({ user_id }) => enabledRecipients.has(user_id)).map(', 'tokens.map(')
        .replaceAll('https://www.freeupper.com', 'https://freeupper.vercel.app');
    assert.equal(createHash('sha256').update(baseline).digest('hex'),
        '4932109b15865447900d1f7f1aa6208e12c8337c1cd966f8caca8dc27893be4b');
});

test('chat destination keeps its path and encoded conversation query on the canonical domain', async () => {
    const conversation = 'conversation /?#&';
    const result = await sender({ muted: ['off', 'muted'], record: {
        id: 'm', conversation_id: conversation, sender_id: 'author', text: 'Hello'
    } });
    const expected = 'https://www.freeupper.com/chat.html?conversation=' + encodeURIComponent(conversation);
    for (const message of result.payloads) {
        assert.equal(message.data.destination_url, expected);
        assert.equal(message.webpush.fcm_options.link, expected);
        assert.equal(message.data.actor_avatar_url, 'https://www.freeupper.com/freeupper.png');
    }
    assert.ok(result.payloads.length);
});

test('social destinations preserve encoded post and profile query parameters', async () => {
    for (const type of ['comment', 'follow', 'mention']) {
        const record = { id: 'n', receiver_id: 'on', actor_id: 'actor /?#&', type };
        if (type === 'comment') record.post_id = 'post /?#&';
        const result = await sender({ table: 'notifications', record });
        const expected = record.post_id ? 'https://www.freeupper.com/index.html?post=' + encodeURIComponent(record.post_id) :
            'https://www.freeupper.com/profile.html?uid=' + encodeURIComponent(record.actor_id);
        assert.ok(result.payloads.length);
        for (const message of result.payloads) {
            assert.equal(message.data.destination_url, expected);
            assert.equal(message.webpush.fcm_options.link, expected);
            assert.equal(message.data.actor_avatar_url, 'https://www.freeupper.com/freeupper.png');
        }
    }
});

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

test('actual staging sender authenticates and sends only through staging Firebase with staging links', async () => {
    const rejected = await sender({ environment: 'staging', webhookSecret: '' });
    assert.equal(rejected.response.status, 401);
    assert.equal(rejected.sends.length, 0);
    const accepted = await sender({ environment: 'staging', muted: ['off', 'muted'] });
    assert.equal(accepted.response.status, 200);
    assert.ok(accepted.payloads.length);
    for (const endpoint of accepted.endpoints) assert.equal(endpoint, 'https://fcm.googleapis.com/v1/projects/freeupper-staging-test/messages:send');
    for (const message of accepted.payloads) {
        assert.equal(message.webpush.fcm_options.link, 'https://freeupper-stage.example.test/chat.html?conversation=c');
        assert.equal(message.data.actor_avatar_url, 'https://freeupper-stage.example.test/freeupper.png');
    }
});
