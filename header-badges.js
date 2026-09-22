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
 */

(() => {
    'use strict';

    const MAX_BADGE_NUMBER = 99;

    let currentUserId = null;

    let notificationChannel = null;
    let messageChannel = null;
    let conversationMemberChannel = null;

    let refreshTimer = null;
    let isRefreshing = false;


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
       CONVERSATION IDS
    ========================================================= */

    async function getUserConversationIds() {
        if (!currentUserId || !window.sb) {
            return [];
        }

        const ids = new Set();


        /*
         * DIRECT CONVERSATIONS
         *
         * Your existing schema uses user1_id/user2_id
         */
        const { data: directConversations, error: directError } =
            await window.sb
                .from('conversations')
                .select('id')
                .or(
                    `user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`
                );

        if (directError) {
            console.error(
                '[Header Badges] Direct conversations error:',
                directError
            );
        } else {
            for (const conversation of directConversations || []) {
                if (conversation.id) {
                    ids.add(conversation.id);
                }
            }
        }


        /*
         * GROUP CONVERSATIONS
         *
         * Group membership comes from conversation_members.
         */
        const { data: memberships, error: membershipError } =
            await window.sb
                .from('conversation_members')
                .select('conversation_id')
                .eq('user_id', currentUserId);

        if (membershipError) {
            console.error(
                '[Header Badges] Conversation membership error:',
                membershipError
            );
        } else {
            for (const membership of memberships || []) {
                if (membership.conversation_id) {
                    ids.add(membership.conversation_id);
                }
            }
        }

        return [...ids];
    }


    /* =========================================================
       CHAT UNREAD COUNT
    ========================================================= */

    async function getUnreadChatCount() {
        if (!currentUserId || !window.sb) {
            return 0;
        }

        const conversationIds = await getUserConversationIds();

        if (!conversationIds.length) {
            return 0;
        }


        /*
         * Fetch messages belonging to the user's conversations.
         *
         * We deliberately do not try to maintain a local counter.
         * message_reads is the source of truth for whether this
         * particular user has read a message.
         */

        const { data: messages, error: messageError } =
            await window.sb
                .from('messages')
                .select('id, sender_id')
                .in('conversation_id', conversationIds)
                .neq('sender_id', currentUserId);

        if (messageError) {
            console.error(
                '[Header Badges] Messages query error:',
                messageError
            );

            return 0;
        }

        if (!messages?.length) {
            return 0;
        }

        const messageIds = messages
            .map(message => message.id)
            .filter(Boolean);

        if (!messageIds.length) {
            return 0;
        }


        /*
         * Find the messages this user has already read.
         */
        const { data: readRows, error: readError } =
            await window.sb
                .from('message_reads')
                .select('message_id')
                .eq('user_id', currentUserId)
                .in('message_id', messageIds);

        if (readError) {
            console.error(
                '[Header Badges] Message reads query error:',
                readError
            );

            return 0;
        }

        const readIds = new Set(
            (readRows || [])
                .map(row => row.message_id)
                .filter(Boolean)
        );

        let unreadCount = 0;

        for (const message of messages) {
            if (!readIds.has(message.id)) {
                unreadCount++;
            }
        }

        return unreadCount;
    }


    /* =========================================================
       REFRESH BOTH BADGES
    ========================================================= */

    async function refreshBadges() {
        if (!currentUserId || !window.sb) {
            return;
        }

        /*
         * Prevent overlapping refreshes.
         */
        if (isRefreshing) {
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

        if (conversationMemberChannel) {
            window.sb.removeChannel(
                conversationMemberChannel
            );

            conversationMemberChannel = null;
        }

        /*
         * When this user reads a message, message_reads changes.
         * Refresh the badge so the header number falls immediately.
         */
        conversationMemberChannel = window.sb
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

        if (conversationMemberChannel) {
            window.sb.removeChannel(
                conversationMemberChannel
            );

            conversationMemberChannel = null;
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

