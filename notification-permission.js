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

        document.body.classList.remove('modal-lock');
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
                    from your browser settings.
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        document.body.classList.add('modal-lock');
    }

    async function requestBrowserPermission() {
        if (!('Notification' in window)) {
            console.warn(
                '[FreeUpper Notifications] Browser notifications are not supported.'
            );
            return 'unsupported';
        }

        if (Notification.permission === 'granted') {
            return 'granted';
        }

        if (Notification.permission === 'denied') {
            return 'denied';
        }

        return await Notification.requestPermission();
    }

    async function start() {
        if (!window.FreeUpperFCM) {
            console.warn(
                '[FreeUpper Notifications] Firebase Messaging is not ready.'
            );
            return;
        }

        if (!('Notification' in window)) {
            return;
        }

        /*
         * Permission already granted.
         * No need to show the custom modal again.
         */
        if (Notification.permission === 'granted') {
            markHandled();
            return 'granted';
        }

        /*
         * Browser permission already denied.
         * Don't repeatedly annoy the user.
         */
        if (Notification.permission === 'denied') {
            markHandled();
            return 'denied';
        }

        /*
         * User has already made a FreeUpper choice.
         */
        if (alreadyHandled()) {
            return 'handled';
        }

        createModal();

        return new Promise(resolve => {
            const allowBtn =
                document.getElementById('fuNotificationAllow');

            const laterBtn =
                document.getElementById('fuNotificationLater');

            if (!allowBtn || !laterBtn) {
                removeModal();
                resolve('error');
                return;
            }

            allowBtn.addEventListener('click', async () => {
                allowBtn.disabled = true;
                allowBtn.textContent = 'Enabling…';

                const permission =
                    await requestBrowserPermission();

                markHandled();
                removeModal();

                resolve(permission);
            });

            laterBtn.addEventListener('click', () => {
                markHandled();
                removeModal();

                resolve('dismissed');
            });
        });
    }

    window.FreeUpperNotificationPermission = {
        start,
        reset: () => {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch {}
        }
    };

})();
