/*
 * FreeUpper — Header Unread Badges
 *
 * Handles:
 *   💬 Chat unread-message count
 *   🔔 Notification unread count
 *
 * IMPORTANT:
 * - Uses the existing Supabase client: window.sb
 * - Database remains the source of truth.
 * - Realtime events trigger a fresh count instead of blindly
 *   incrementing/decrementing local numbers.
 * - Chat unread count is calculated server-side through:
 *     public.get_unread_message_count()
 */

(() => {
    'use strict';

    const MAX_BADGE_NUMBER = 99;

    let currentUserId = null;

    let notificationChannel = null;
    let messageChannel = null;
    let messageReadChannel = null;

    let refreshTimer = null;
    let isRefreshing = false;
    let refreshAgain = false;


    /* =========================================================
       ELEMENTS
    ========================================================= */

    function getNotificationBadge() {
        return document.getElementById('notificationUnreadBadge');
    }

    function getChatBadge() {
        return document.getElementById('chatUnreadBadge');
    }


    /* =========================================================
       BADGE UI
    ========================================================= */

    function setBadge(element, count) {
        if (!element) return;

        const number = Number(count) || 0;

        if (number <= 0) {
            element.textContent = '';
            element.style.display = 'none';
            return;
        }

        element.textContent =
            number > MAX_BADGE_NUMBER
                ? '99+'
                : String(number);

        element.style.display = 'flex';
    }


    /* =========================================================
       NOTIFICATION COUNT
    ========================================================= */

    async function getUnreadNotificationCount() {
        if (!currentUserId || !window.sb) return 0;

        const { count, error } = await window.sb
            .from('notifications')
            .select('id', {
                count: 'exact',
                head: true
            })
            .eq('receiver_id', currentUserId)
            .eq('read', false);

        if (error) {
            console.error(
                '[Header Badges] Notification count error:',
                error
            );

            return 0;
        }

        return count || 0;
    }


    /* =========================================================
       CHAT UNREAD COUNT
    ========================================================= */

    async function getUnreadChatCount() {
        if (!currentUserId || !window.sb) {
            return 0;
        }

        /*
         * The unread calculation is performed server-side.
         * This keeps message IDs/read rows out of the browser and
         * reduces the badge refresh to one scalar RPC result.
         */
        const { data, error } = await window.sb
            .rpc('get_unread_message_count');

        if (error) {
            console.error(
                '[Header Badges] Unread chat count RPC error:',
                error
            );

            return 0;
        }

        return Number(data) || 0;
    }


    /* =========================================================
       REFRESH BOTH BADGES
    ========================================================= */

    async function refreshBadges() {
        if (!currentUserId || !window.sb) {
            return;
        }

        /*
         * If a refresh is already running, mark that another
         * refresh is needed when it finishes. This prevents
         * Realtime events from being dropped during a slow query.
         */
        if (isRefreshing) {
            refreshAgain = true;
            return;
        }

        isRefreshing = true;

        try {
            const [
                notificationCount,
                chatCount
            ] = await Promise.all([
                getUnreadNotificationCount(),
                getUnreadChatCount()
            ]);

            setBadge(
                getNotificationBadge(),
                notificationCount
            );

            setBadge(
                getChatBadge(),
                chatCount
            );

        } catch (error) {
            console.error(
                '[Header Badges] Refresh error:',
                error
            );
        } finally {
            isRefreshing = false;

            if (refreshAgain) {
                refreshAgain = false;
                scheduleRefresh();
            }
        }
    }


    /* =========================================================
       DEBOUNCED REFRESH
    ========================================================= */

    function scheduleRefresh() {
        clearTimeout(refreshTimer);

        refreshTimer = setTimeout(() => {
            refreshBadges();
        }, 300);
    }


    /* =========================================================
       REALTIME — NOTIFICATIONS
    ========================================================= */

    function subscribeToNotifications() {
        if (!window.sb || !currentUserId) {
            return;
        }

        if (notificationChannel) {
            window.sb.removeChannel(notificationChannel);
            notificationChannel = null;
        }

        notificationChannel = window.sb
            .channel(
                `header-notifications-${currentUserId}`
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'notifications',
                    filter: `receiver_id=eq.${currentUserId}`
                },
                () => {
                    /*
                     * Don't trust the event to calculate the count.
                     * Re-read the database.
                     */
                    scheduleRefresh();
                }
            )
            .subscribe((status, error) => {
                if (
                    status === 'CHANNEL_ERROR' ||
                    status === 'TIMED_OUT'
                ) {
                    console.error(
                        '[Header Badges] Notification Realtime error:',
                        status,
                        error
                    );
                }
            });
    }


    /* =========================================================
       REALTIME — MESSAGES
    ========================================================= */

    function subscribeToMessages() {
        if (!window.sb || !currentUserId) {
            return;
        }

        if (messageChannel) {
            window.sb.removeChannel(messageChannel);
            messageChannel = null;
        }

        /*
         * We listen for new messages globally on the public
         * messages table and then recalculate the user's actual
         * unread count.
         *
         * RLS still determines which events the authenticated
         * client is allowed to receive.
         */
        messageChannel = window.sb
            .channel(
                `header-messages-${currentUserId}`
            )
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages'
                },
                payload => {
                    /*
                     * Ignore messages sent by ourselves.
                     */
                    if (
                        payload?.new?.sender_id === currentUserId
                    ) {
                        return;
                    }

                    scheduleRefresh();
                }
            )
            .subscribe((status, error) => {
                if (
                    status === 'CHANNEL_ERROR' ||
                    status === 'TIMED_OUT'
                ) {
                    console.error(
                        '[Header Badges] Message Realtime error:',
                        status,
                        error
                    );
                }
            });
    }


    /* =========================================================
       REALTIME — MESSAGE READS
    ========================================================= */

    function subscribeToMessageReads() {
        if (!window.sb || !currentUserId) {
            return;
        }

        if (messageReadChannel) {
            window.sb.removeChannel(messageReadChannel);
            messageReadChannel = null;
        }

        /*
         * When this user reads a message, message_reads changes.
         * Refresh the badge so the header number falls immediately.
         */
        messageReadChannel = window.sb
            .channel(
                `header-message-reads-${currentUserId}`
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'message_reads',
                    filter: `user_id=eq.${currentUserId}`
                },
                () => {
                    scheduleRefresh();
                }
            )
            .subscribe((status, error) => {
                if (
                    status === 'CHANNEL_ERROR' ||
                    status === 'TIMED_OUT'
                ) {
                    console.error(
                        '[Header Badges] Message-read Realtime error:',
                        status,
                        error
                    );
                }
            });
    }


    /* =========================================================
       CLEANUP
    ========================================================= */

    function cleanupRealtime() {
        if (!window.sb) return;

        if (notificationChannel) {
            window.sb.removeChannel(notificationChannel);
            notificationChannel = null;
        }

        if (messageChannel) {
            window.sb.removeChannel(messageChannel);
            messageChannel = null;
        }

        if (messageReadChannel) {
            window.sb.removeChannel(messageReadChannel);
            messageReadChannel = null;
        }
    }


    /* =========================================================
       AUTH
    ========================================================= */

    async function initialize() {
        if (!window.sb) {
            console.error(
                '[Header Badges] window.sb is not available.'
            );

            return;
        }

        const {
            data: { user },
            error
        } = await window.sb.auth.getUser();

        if (error) {
            console.error(
                '[Header Badges] Auth error:',
                error
            );

            return;
        }

        if (!user) {
            currentUserId = null;

            setBadge(
                getNotificationBadge(),
                0
            );

            setBadge(
                getChatBadge(),
                0
            );

            cleanupRealtime();

            return;
        }

        currentUserId = user.id;

        /*
         * Initial database count.
         */
        await refreshBadges();

        /*
         * Then keep the badges synchronized.
         */
        subscribeToNotifications();
        subscribeToMessages();
        subscribeToMessageReads();
    }


    /* =========================================================
       AUTH STATE CHANGES
    ========================================================= */

    function listenForAuthChanges() {
        if (!window.sb) return;

        window.sb.auth.onAuthStateChange(
            async (event, session) => {

                if (
                    event === 'SIGNED_IN' &&
                    session?.user
                ) {
                    currentUserId = session.user.id;

                    await refreshBadges();

                    subscribeToNotifications();
                    subscribeToMessages();
                    subscribeToMessageReads();

                    return;
                }

                if (event === 'SIGNED_OUT') {
                    currentUserId = null;

                    cleanupRealtime();

                    setBadge(
                        getNotificationBadge(),
                        0
                    );

                    setBadge(
                        getChatBadge(),
                        0
                    );
                }
            }
        );
    }


    /* =========================================================
       PAGE VISIBILITY
    ========================================================= */

    document.addEventListener(
        'visibilitychange',
        () => {
            if (
                document.visibilityState === 'visible' &&
                currentUserId
            ) {
                refreshBadges();
            }
        }
    );


    /* =========================================================
       START
    ========================================================= */

    async function start() {
        /*
         * Wait until the existing FreeUpper Supabase
         * initialization has created window.sb.
         */
        if (!window.sb) {
            setTimeout(start, 250);
            return;
        }

        await initialize();
        listenForAuthChanges();
    }

    start();


    /* =========================================================
       OPTIONAL GLOBAL API
       Useful for chat.html / notification.html when they
       explicitly want to refresh the header.
    ========================================================= */

    window.FreeUpperHeaderBadges = {
        refresh: refreshBadges,

        refreshChat: async () => {
            const count = await getUnreadChatCount();

            setBadge(
                getChatBadge(),
                count
            );
        },

        refreshNotifications: async () => {
            const count =
                await getUnreadNotificationCount();

            setBadge(
                getNotificationBadge(),
                count
            );
        }
    };

})();
