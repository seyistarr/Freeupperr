/* Shared push lifecycle. Browser permission and the account preference are separate. */
(() => {
    'use strict';
    if (window.FreeUpperPushNotifications) return;

    const config = {
        apiKey: 'AIzaSyCmAuJE-nvJunX-vXQH2l_zjjrcDt2DiA8',
        authDomain: 'freeupper-notifications.firebaseapp.com',
        projectId: 'freeupper-notifications',
        storageBucket: 'freeupper-notifications.firebasestorage.app',
        messagingSenderId: '37328138260',
        appId: '1:37328138260:web:f362538c37f279fccf7701'
    };
    const vapidKey = 'BHmk5m_sPqAlX_JlLtLfHS0oPQgQFLtuANDGZhtBNEeamb760XLZxfYGdatnjrWUmDU7zfwTIRaUM8IRsa7rYUw';
    let userId = null;
    let epoch = 0;
    let enabled = true;
    let firebasePromise = null;
    let registrationTask = null;
    let unsubscribe = null;
    let activeToken = null;
    let saving = false;
    let promptTask = null;
    let foregroundHandler = null;
    let signingOut = false;
    let preferenceLoaded = false;

    function deviceStatus() {
        const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
            (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
        const standalone = navigator.standalone === true ||
            window.matchMedia('(display-mode: standalone)').matches;
        if (ios && !standalone) return 'ios-install';
        if (!window.isSecureContext || !('Notification' in window) ||
            !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
        return Notification.permission;
    }

    async function readPreference(id) {
        const { data, error } = await window.sb.from('user_settings')
            .select('notification_settings').eq('user_id', id).maybeSingle();
        if (error) throw error;
        return data?.notification_settings?.push_enabled !== false;
    }

    // Compare the previously read JSONB, retrying a concurrent change instead of losing keys.
    async function writePreference(id, value) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const { data: row, error } = await window.sb.from('user_settings')
                .select('notification_settings').eq('user_id', id).maybeSingle();
            if (error) throw error;
            if (!row) {
                // Let Postgres populate all existing defaults before merging the new key.
                const result = await window.sb.from('user_settings').insert({ user_id: id });
                if (result.error && result.error.code !== '23505') throw result.error;
                continue;
            }
            const old = row.notification_settings;
            if (old !== null && (typeof old !== 'object' || Array.isArray(old))) {
                throw new Error('Notification settings could not be updated safely.');
            }
            let query = window.sb.from('user_settings').update({
                notification_settings: { ...(old || {}), push_enabled: value },
                updated_at: new Date().toISOString()
            }).eq('user_id', id);
            query = old === null ? query.is('notification_settings', null) :
                query.eq('notification_settings', JSON.stringify(old));
            const result = await query.select('user_id');
            if (result.error) throw result.error;
            if (result.data?.length) return;
        }
        throw new Error('Settings changed on another device. Please try again.');
    }

    function statusText() {
        if (!userId) return 'Sign in to manage notifications.';
        if (!enabled) return 'Push notifications are off for your account on all devices.';
        const status = deviceStatus();
        if (status === 'ios-install') return 'On for your account. Add FreeUpper to your Home Screen to enable this device.';
        if (status === 'denied') return 'On for your account. Notifications are blocked on this device; change browser or device settings.';
        if (status === 'unsupported') return 'On for your account. Push notifications are unavailable in this browser.';
        if (status === 'default') return 'On for your account. Use Enable on this device to grant permission.';
        return 'Push notifications are on. Existing conversation mute settings still apply.';
    }

    function render(message) {
        const toggle = document.getElementById('pushNotificationsToggle');
        if (toggle) { toggle.checked = enabled; toggle.disabled = !userId || saving || !preferenceLoaded; }
        const text = document.getElementById('pushNotificationsStatus');
        if (text) text.textContent = message || statusText();
        const button = document.getElementById('pushNotificationsEnableDevice');
        if (button) {
            button.hidden = !userId || !enabled || deviceStatus() === 'granted';
            button.disabled = saving;
        }
    }

    function showInstallGuidance() {
        if (deviceStatus() !== 'ios-install') return;
        try { if (localStorage.getItem('fu_a2hs_dismissed') === '1') return; } catch {}
        const banner = document.getElementById('pushIosInstallGuidance');
        if (banner) banner.hidden = false;
    }

    async function firebase() {
        if (!firebasePromise) {
            firebasePromise = (async () => {
                const [app, fcm] = await Promise.all([
                    import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js'),
                    import('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging.js')
                ]);
                if (!(await fcm.isSupported())) throw new Error('Push notifications are unavailable on this device.');
                const instance = app.getApps().length ? app.getApp() : app.initializeApp(config);
                const result = { ...fcm, messaging: fcm.getMessaging(instance) };
                window.FreeUpperFCM = result;
                return result;
            })().catch(error => { firebasePromise = null; throw error; });
        }
        return firebasePromise;
    }

    function stopListener() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
    }

    async function foreground(payload, id) {
        const version = epoch;
        if (signingOut || id !== userId || !(await readPreference(id)) ||
            id !== userId || version !== epoch || !enabled) return;
        const count = Number(payload.data?.unread_count);
        if (Number.isFinite(count) && count >= 0 && typeof navigator.setAppBadge === 'function') {
            try {
                if (count > 0) await navigator.setAppBadge(Math.floor(count));
                else if (navigator.clearAppBadge) await navigator.clearAppBadge();
            } catch { /* Badge support must not interrupt chat. */ }
        }
        if (foregroundHandler) foregroundHandler(payload);
        else if (typeof window.showToast === 'function') {
            const escape = value => String(value).replace(/[&<>"']/g, char =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
            const title = payload.data?.title || payload.notification?.title || 'FreeUpper';
            const body = payload.data?.body || payload.notification?.body || 'You have a new notification.';
            window.showToast(`<b>${escape(title)}:</b>&nbsp;${escape(body)}`, 'p');
        }
    }

    function register() {
        if (registrationTask) return registrationTask;
        const id = userId;
        const version = epoch;
        registrationTask = (async () => {
            if (!id || signingOut || !enabled || deviceStatus() !== 'granted') return;
            if (!(await readPreference(id)) || id !== userId || version !== epoch) return;
            const fcm = await firebase();
            const worker = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
            if (id !== userId || version !== epoch || signingOut || !(await readPreference(id))) return;
            if (id !== userId || version !== epoch) return;
            const token = await fcm.getToken(fcm.messaging, { vapidKey, serviceWorkerRegistration: worker });
            if (!token || id !== userId || version !== epoch || !(await readPreference(id))) return;
            if (id !== userId || version !== epoch) return;
            const { error } = await window.sb.from('push_tokens').upsert({
                user_id: id, token, platform: 'web', updated_at: new Date().toISOString()
            }, { onConflict: 'token' });
            if (error) throw error;
            if (id !== userId || version !== epoch) {
                // Discard a registration that completed during logout/account switching.
                await window.sb.from('push_tokens').delete().eq('user_id', id).eq('token', token);
                return;
            }
            activeToken = token;
            if (!unsubscribe) unsubscribe = fcm.onMessage(fcm.messaging, payload => {
                foreground(payload, id).catch(error => console.warn('Push notification unavailable:', error.message));
            });
        })().finally(() => { registrationTask = null; });
        return registrationTask;
    }

    async function refresh() {
        const id = userId;
        if (!id) { render(); return; }
        const preference = await readPreference(id);
        if (id !== userId) return;
        enabled = preference;
        preferenceLoaded = true;
        if (!enabled) stopListener();
        render();
        if (enabled) await register();
    }

    async function homePrompt() {
        if (document.body.dataset.pushPage !== 'home' || !userId || signingOut ||
            !preferenceLoaded || !enabled || promptTask) return;
        const id = userId;
        const status = deviceStatus();
        if (status === 'ios-install') { showInstallGuidance(); return; }
        if (status === 'granted' || status === 'denied') {
            await window.FreeUpperNotificationPermission.start();
            return;
        }
        if (status !== 'default') return;
        // Auth, legal consent and onboarding finish before displaying another dialog.
        if (document.body.classList.contains('modal-lock') ||
            document.querySelector('#fu-auth-overlay.open, #fu-legal-update-overlay, #onboardingOverlay.open')) return;
        promptTask = window.FreeUpperNotificationPermission.start();
        try {
            const permission = await promptTask;
            if (permission === 'granted' && id === userId && await readPreference(id)) await register();
        } finally { promptTask = null; }
    }

    // Call permission API synchronously from the click handler, before any network await.
    async function setEnabled(value) {
        if (!userId || signingOut || saving || !preferenceLoaded) return;
        const id = userId;
        const permission = value ? window.FreeUpperNotificationPermission.requestBrowserPermission() : Promise.resolve('off');
        saving = true;
        render();
        try {
            const result = await permission;
            if (value && result !== 'granted') {
                const messages = {
                    denied: 'Notifications are blocked on this device. Change browser or device settings, then try again.',
                    'ios-install': 'Tap Share, then Add to Home Screen. Open FreeUpper from the Home Screen to enable notifications.',
                    unsupported: 'Push notifications are unavailable in this browser.'
                };
                render(messages[result] || 'Permission was not granted. Your account preference was not changed.');
                return;
            }
            if (id !== userId) return;
            await writePreference(id, value);
            if (id !== userId) return;
            epoch++;
            enabled = value;
            stopListener();
            if (value) { if (registrationTask) await registrationTask; await register(); }
            render();
        } catch (error) { render(error.message || 'Could not update notification settings.'); }
        finally {
            saving = false;
            const toggle = document.getElementById('pushNotificationsToggle');
            if (toggle) { toggle.disabled = !userId || !preferenceLoaded; toggle.checked = enabled; }
            const button = document.getElementById('pushNotificationsEnableDevice');
            if (button) button.disabled = false;
        }
    }

    async function beforeSignOut() {
        const id = userId;
        signingOut = true;
        epoch++;
        stopListener();
        window.FreeUpperNotificationPermission.cancel();
        if (registrationTask) await registrationTask.catch(() => {});
        if (id && activeToken) {
            const { error } = await window.sb.from('push_tokens').delete()
                .eq('user_id', id).eq('token', activeToken);
            if (error) throw error;
        }
        activeToken = null;
    }

    async function applyUser(user) {
        const id = user?.id || null;
        if (id !== userId) {
            epoch++;
            stopListener();
            activeToken = null;
            window.FreeUpperNotificationPermission.cancel();
            userId = id;
            signingOut = false;
            preferenceLoaded = false;
            enabled = true;
            render();
        }
        try { await refresh(); await homePrompt(); }
        catch (error) { render('Could not load notification settings. Please try again.'); console.warn('Push setup unavailable:', error.message); }
    }

    async function start(options = {}) {
        if (options.onMessage) foregroundHandler = options.onMessage;
        const { data, error } = await window.sb.auth.getSession();
        if (error) throw error;
        await applyUser(data.session?.user);
    }

    async function resumeAfterSignOutFailure() {
        signingOut = false;
        // The SDK may retain or clear its session on failure; use the actual session.
        await start();
    }

    window.FreeUpperPushNotifications = { start, refresh, setEnabled, beforeSignOut, resumeAfterSignOutFailure, deviceStatus };
    function boot() {
        if (!window.sb) return;
        const toggle = document.getElementById('pushNotificationsToggle');
        toggle?.addEventListener('change', () => setEnabled(toggle.checked));
        document.getElementById('pushNotificationsEnableDevice')?.addEventListener('click', () => setEnabled(true));
        document.getElementById('pushIosInstallDismiss')?.addEventListener('click', () => {
            document.getElementById('pushIosInstallGuidance').hidden = true;
            try { localStorage.setItem('fu_a2hs_dismissed', '1'); } catch {}
        });
        window.sb.auth.onAuthStateChange((_event, session) => {
            // Never call Supabase APIs synchronously inside its auth callback.
            setTimeout(() => applyUser(session?.user), 0);
        });
        window.addEventListener('focus', () => { refresh().catch(() => render('Could not refresh notification settings.')); });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') refresh().catch(() => {});
        });
        if (document.body.dataset.pushPage === 'home') {
            const observer = new MutationObserver(() => { homePrompt().catch(() => {}); });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        }
        start().catch(error => console.warn('Push setup unavailable:', error.message));
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
