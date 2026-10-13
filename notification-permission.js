/* ============================================================
   FreeUpper Notification Permission
   Custom in-app permission gate before browser permission.
   ============================================================ */

(() => {
    'use strict';

    const STORAGE_KEY = 'freeupper_notification_prompt';

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value || '';
        return div.innerHTML;
    }

    function alreadyHandled() {
        try {
            return localStorage.getItem(STORAGE_KEY) === 'handled';
        } catch {
            return false;
        }
    }

    function markHandled() {
        try {
            localStorage.setItem(STORAGE_KEY, 'handled');
        } catch {}
    }

    function removeModal() {
        const modal = document.getElementById('fuNotificationPermissionModal');
        if (modal) modal.remove();

        document.body.classList.remove('fu-notification-lock');
    }

    function createModal() {
        if (document.getElementById('fuNotificationPermissionModal')) {
            return;
        }

        const modal = document.createElement('div');

        modal.id = 'fuNotificationPermissionModal';

        modal.innerHTML = `
            <div class="fu-notification-backdrop"></div>

            <div class="fu-notification-card" role="dialog"
                 aria-modal="true"
                 aria-labelledby="fuNotificationTitle">

                <div class="fu-notification-icon">
                    <svg viewBox="0 0 24 24"
                         aria-hidden="true">
                        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                </div>

                <h2 id="fuNotificationTitle">
                    Stay connected on FreeUpper
                </h2>

                <p>
                    Get notified when someone likes, comments,
                    replies, follows, mentions you, or sends you
                    a message — even when FreeUpper isn't open.
                </p>

                <div class="fu-notification-features">
                    <div>
                        <span>♡</span>
                        <span>Likes & comments</span>
                    </div>

                    <div>
                        <span>↗</span>
                        <span>Follows & mentions</span>
                    </div>

                    <div>
                        <span>✉</span>
                        <span>Messages</span>
                    </div>
                </div>

                <button
                    type="button"
                    class="fu-notification-allow"
                    id="fuNotificationAllow">
                    Allow notifications
                </button>

                <button
                    type="button"
                    class="fu-notification-later"
                    id="fuNotificationLater">
                    Not now
                </button>

                <div class="fu-notification-note">
                    You can change notification permissions later
                    from FreeUpper Settings or your browser settings.
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        document.body.classList.add('fu-notification-lock');
    }


    let pending = null;
    let finishPending = null;
    let previousFocus = null;

    function requestBrowserPermission() {
        const status = window.FreeUpperPushNotifications?.deviceStatus() ||
            (!('Notification' in window) ? 'unsupported' : Notification.permission);
        if (status === 'granted' || status === 'denied') markHandled();
        if (status !== 'default') return Promise.resolve(status);
        markHandled();
        try { return Promise.resolve(Notification.requestPermission()); }
        catch (error) { return Promise.reject(error); }
    }

    function cancel() {
        if (finishPending) finishPending('cancelled');
    }

    function start() {
        if (pending) return pending;
        const status = window.FreeUpperPushNotifications?.deviceStatus() ||
            (!('Notification' in window) ? 'unsupported' : Notification.permission);
        if (status === 'granted' || status === 'denied') {
            markHandled();
            return Promise.resolve(status);
        }
        if (status !== 'default') return Promise.resolve(status);
        if (alreadyHandled()) return Promise.resolve('handled');
        previousFocus = document.activeElement;
        createModal();
        pending = new Promise(resolve => {
            const allowBtn = document.getElementById('fuNotificationAllow');
            const laterBtn = document.getElementById('fuNotificationLater');
            const modal = document.getElementById('fuNotificationPermissionModal');
            const finish = result => {
                removeModal();
                pending = null;
                finishPending = null;
                previousFocus?.focus?.();
                resolve(result);
            };
            finishPending = finish;
            if (!allowBtn || !laterBtn) { finish('error'); return; }
            allowBtn.addEventListener('click', () => {
                allowBtn.disabled = true;
                allowBtn.textContent = 'Enabling…';
                // This call remains in the browser's original user gesture.
                requestBrowserPermission().then(finish, () => finish('error'));
            }, { once: true });
            const dismiss = () => { markHandled(); finish('dismissed'); };
            laterBtn.addEventListener('click', dismiss, { once: true });
            modal.addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
                if (event.key === 'Tab') {
                    event.preventDefault();
                    (document.activeElement === allowBtn ? laterBtn : allowBtn).focus();
                }
            });
            allowBtn.focus();
        });
        return pending;
    }

    window.FreeUpperNotificationPermission = {
        start, cancel, requestBrowserPermission,
        reset: () => { try { localStorage.removeItem(STORAGE_KEY); } catch {} }
    };
})();
