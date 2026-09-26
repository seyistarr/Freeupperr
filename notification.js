// ============================================================
// notification.js — FreeUpper Notification Center (v1)
//
// Reads directly from the `notifications` table under the RLS +
// column-privilege model we validated: authenticated users can
// SELECT only their own rows (receiver_id = auth.uid()) and UPDATE
// only the `read` column on their own rows. No direct INSERT.
//
// KNOWN v1 LIMITATIONS (deliberate, not oversights):
//  - Grouping ("Daniel and 14 others liked your post") is done
//    client-side here, not by a write-time aggregation trigger.
//    It groups ALL matching like/repost rows for the same post,
//    not just consecutive ones — fine for now, may need revisiting
//    once volume is real.
//  - The "System" tab has no producer yet (no admin panel exists),
//    so it will always render empty. UI is ready for when it does.
//  - Clicking a comment/reply/mention notification navigates to the
//    post, not to a scrolled-into-view specific comment — index.html
//    doesn't currently support deep-linking to a comment.
// ============================================================

(function () {
    'use strict';

    const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#E5E7EB"/><circle cx="50" cy="38" r="16" fill="#9CA3AF"/><ellipse cx="50" cy="75" rx="30" ry="22" fill="#9CA3AF"/></svg>'
    );
    const GROUPABLE_TYPES = new Set(['like', 'repost']);
    const SYSTEM_TYPES = new Set(['system', 'verified']);
    const PAGE_LIMIT = 60;

    let currentUser = null;
    let activeTab = 'activity';
    let rawNotifications = [];
    let realtimeChannel = null;

    // ─── HELPERS ──────────────────────────────────────────────
    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function getCurrentUser() {
        if (window.AuthUser && window.AuthUser.getCurrentUser) return window.AuthUser.getCurrentUser();
        return null;
    }

    function truncateName(name, max) {
        name = name || 'Someone';
        return name.length > max ? name.slice(0, max) + '…' : name;
    }

    function formatRelativeTime(iso) {
        const then = new Date(iso).getTime();
        const diff = Math.floor((Date.now() - then) / 1000);
        if (diff < 60) return 'Just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        if (diff < 172800) return 'Yesterday';
        if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function dateBucket(iso) {
        const d = new Date(iso);
        const now = new Date();
        const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
        const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return 'This Week';
        return 'Earlier';
    }

    function showToast(msg) {
        const w = document.getElementById('tw');
        if (!w) return;
        const el = document.createElement('div');
        el.className = 'toast';
        el.textContent = msg;
        w.appendChild(el);
        setTimeout(() => el.remove(), 2400);
    }

    // ─── SVG ICONS PER TYPE ───────────────────────────────────
    const ICONS = {
        like: '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
        comment: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
        reply: '<svg viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
        follow: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg>',
        mention: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-9 9"/></svg>',
        repost: '<svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
        system: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
        verified: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'
    };

    function typeIcon(type) { return ICONS[type] || ICONS.system; }

    // ─── FETCH ────────────────────────────────────────────────
    async function fetchNotifications() {
        const { data, error } = await window.sb
            .from('notifications')
            .select('id, receiver_id, actor_id, type, post_id, comment_id, read, created_at')
            .order('created_at', { ascending: false })
            .limit(PAGE_LIMIT);

        if (error) {
            console.error('fetchNotifications error:', error);
            showToast('Could not load notifications');
            return [];
        }
        return data || [];
    }

    async function hydrate(rows) {
        const actorIds = [...new Set(rows.map(r => r.actor_id).filter(Boolean))];
        const postIds = [...new Set(rows.map(r => r.post_id).filter(Boolean))];
        const commentIds = [...new Set(rows.map(r => r.comment_id).filter(Boolean))];

        const [actorsRes, postsRes, commentsRes] = await Promise.all([
            actorIds.length
                ? window.sb.from('profiles').select('id, username, display_name, avatar_url, verified_status').in('id', actorIds)
                : Promise.resolve({ data: [] }),
            postIds.length
                ? window.sb.from('posts').select('id, title, content, media_url, media_type, user_id').in('id', postIds)
                : Promise.resolve({ data: [] }),
            commentIds.length
                ? window.sb.from('comments').select('id, message, post_id, user_id').in('id', commentIds)
                : Promise.resolve({ data: [] })
        ]);

        const actorMap = new Map((actorsRes.data || []).map(a => [a.id, a]));
        const postMap = new Map((postsRes.data || []).map(p => [p.id, p]));
        const commentMap = new Map((commentsRes.data || []).map(c => [c.id, c]));

        return rows.map(r => ({
            ...r,
            actor: actorMap.get(r.actor_id) || null,
            post: r.post_id ? (postMap.get(r.post_id) || null) : null,
            comment: r.comment_id ? (commentMap.get(r.comment_id) || null) : null
        }));
    }

    // ─── GROUPING (client-side stopgap — see file header) ─────
    function groupNotifications(rows) {
        const groups = [];
        const indexByKey = new Map();

        rows.forEach(row => {
            if (GROUPABLE_TYPES.has(row.type)) {
                const key = row.type + ':' + (row.post_id || '') + ':' + (row.comment_id || '');
                if (indexByKey.has(key)) {
                    const g = groups[indexByKey.get(key)];
                    g.actors.push(row.actor);
                    g.ids.push(row.id);
                    g.read = g.read && row.read;
                    if (new Date(row.created_at) > new Date(g.created_at)) g.created_at = row.created_at;
                    return;
                }
                indexByKey.set(key, groups.length);
                groups.push({ ...row, actors: [row.actor], ids: [row.id] });
                return;
            }
            groups.push({ ...row, actors: [row.actor], ids: [row.id] });
        });

        groups.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return groups;
    }

    function actorsLabel(actors) {
        const names = actors.filter(Boolean).map(a => truncateName(a.display_name || a.username || 'Someone', 18));
        if (names.length === 0) return 'Someone';
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} and ${names[1]}`;
        return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 === 1 ? '' : 's'}`;
    }

    // ─── TEXT PER TYPE ────────────────────────────────────────
    function notifText(g) {
        const who = `<b>${escapeHtml(actorsLabel(g.actors))}</b>`;
        switch (g.type) {
            case 'like':
                return g.comment_id ? `${who} liked your comment` : `${who} liked your post`;
            case 'comment':
                return `${who} commented on your post`;
            case 'reply':
                return `${who} replied to your comment`;
            case 'follow':
                return `${who} started following you`;
            case 'mention':
                return g.comment_id ? `${who} mentioned you in a comment` : `${who} mentioned you in a post`;
            case 'repost':
                return `${who} reposted your post`;
            case 'verified':
                return `Your account has been verified`;
            case 'system':
            default:
                return g.text || 'FreeUpper notification';
        }
    }

    function previewText(g) {
        if (g.comment && g.comment.message) return g.comment.message;
        if (g.post) return g.post.title || g.post.content || '';
        return '';
    }

    // ─── RENDER ───────────────────────────────────────────────
    function renderSkeleton() {
        let html = '';
        for (let i = 0; i < 5; i++) {
            html += `<div class="skeleton-row">
                <div class="skl av"></div>
                <div style="flex:1;">
                    <div class="skl line" style="width:70%;"></div>
                    <div class="skl line" style="width:45%;height:10px;"></div>
                </div>
            </div>`;
        }
        document.getElementById('listRoot').innerHTML = html;
    }

    function buildRow(g) {
        const primaryActor = g.actors.find(Boolean) || {};
        const avatar = primaryActor.avatar_url || DEFAULT_AVATAR;
        const unread = !g.read;
        const badgeClass = 't-' + g.type;
        const text = notifText(g);
        const preview = previewText(g);

        let thumbHtml = '';
        const media = g.post && g.post.media_url;
        if (media) {
            thumbHtml = `<img class="notif-thumb" src="${escapeHtml(media)}" onerror="this.style.display='none'">`;
        }

        let bodyExtra = '';
        if (g.post_id && !g.post) {
            bodyExtra = `<div class="notif-unavailable">This post is no longer available</div>`;
        } else if (preview) {
            bodyExtra = `<div class="notif-preview">${escapeHtml(preview)}</div>`;
        }

        let followBtn = '';
        if (g.type === 'follow' && primaryActor.id) {
            followBtn = `<div class="follow-back-btn" onclick="event.stopPropagation(); window.Router.openProfile('${primaryActor.id}')">View profile</div>`;
        }

        return `
            <div class="notif-row ${unread ? 'unread' : ''}" data-ids="${g.ids.join(',')}" data-type="${g.type}" data-post-id="${g.post_id || ''}" data-actor-id="${primaryActor.id || ''}">
                ${unread ? '<span class="unread-dot"></span>' : ''}
                <div class="avatar-stack">
                    <img src="${avatar}" onerror="this.src='${DEFAULT_AVATAR}'">
                    <span class="type-badge ${badgeClass}">${typeIcon(g.type)}</span>
                </div>
                <div class="notif-body">
                    <div class="notif-text">${text}</div>
                    ${bodyExtra}
                    <div class="notif-time">${formatRelativeTime(g.created_at)}</div>
                    ${followBtn}
                </div>
                ${thumbHtml}
            </div>
        `;
    }

    function renderList() {
        const filtered = activeTab === 'system'
            ? rawNotifications.filter(r => SYSTEM_TYPES.has(r.type))
            : rawNotifications.filter(r => !SYSTEM_TYPES.has(r.type));

        const groups = groupNotifications(filtered);
        const root = document.getElementById('listRoot');

        if (groups.length === 0) {
            root.innerHTML = activeTab === 'system'
                ? `<div class="empty-state">
                    <div class="icon">${ICONS.system}</div>
                    <h3>No system notifications</h3>
                    <p>Announcements, security alerts and account updates will show up here.</p>
                   </div>`
                : `<div class="empty-state">
                    <div class="icon">${ICONS.like}</div>
                    <h3>Nothing yet</h3>
                    <p>Likes, comments, follows and mentions will show up here as they happen.</p>
                   </div>`;
            updateUnreadSub();
            return;
        }

        let html = '';
        let lastBucket = null;
        groups.forEach(g => {
            const bucket = dateBucket(g.created_at);
            if (bucket !== lastBucket) {
                html += `<div class="date-heading">${bucket}</div>`;
                lastBucket = bucket;
            }
            html += buildRow(g);
        });
        html += `<div class="caught-up">You're all caught up 🎉</div>`;
        root.innerHTML = html;

        root.querySelectorAll('.notif-row').forEach(el => {
            el.addEventListener('click', () => handleRowClick(el));
        });

        updateUnreadSub();
    }

    function updateUnreadSub() {
        const unreadCount = rawNotifications.filter(r => !r.read).length;
        const sub = document.getElementById('unreadSub');
        const markAllBtn = document.getElementById('markAllBtn');
        if (sub) sub.textContent = unreadCount > 0 ? `${unreadCount} unread` : 'You\u2019re all caught up';
        if (markAllBtn) markAllBtn.disabled = unreadCount === 0;
    }

    // ─── INTERACTIONS ─────────────────────────────────────────
    async function handleRowClick(el) {
        const ids = (el.dataset.ids || '').split(',').filter(Boolean);
        const type = el.dataset.type;
        const postId = el.dataset.postId;
        const actorId = el.dataset.actorId;

        if (ids.length) markRead(ids);

        if (type === 'follow' && actorId) {
            window.Router.openProfile(actorId);
            return;
        }
        if (postId) {
            window.location.href = 'index.html?post=' + postId;
            return;
        }
        if (actorId) {
            window.Router.openProfile(actorId);
        }
    }

    async function markRead(ids) {
        const unreadIds = ids.filter(id => {
            const row = rawNotifications.find(r => r.id === id);
            return row && !row.read;
        });
        if (!unreadIds.length) return;

        unreadIds.forEach(id => {
            const row = rawNotifications.find(r => r.id === id);
            if (row) row.read = true;
        });
        updateUnreadSub();

        const { error } = await window.sb
            .from('notifications')
            .update({ read: true })
            .in('id', unreadIds);

        if (error) {
            console.error('markRead error:', error);
        }
    }

    async function markAllRead() {
        const unread = rawNotifications.filter(r => !r.read);
        if (!unread.length) return;

        unread.forEach(r => { r.read = true; });
        renderList();

        const { error } = await window.sb
            .from('notifications')
            .update({ read: true })
            .eq('read', false);

        if (error) {
            console.error('markAllRead error:', error);
            showToast('Could not mark all as read');
        } else {
            showToast('All caught up');
        }
    }
    window.markAllRead = markAllRead;

    // ─── TABS ─────────────────────────────────────────────────
    window.switchTab = function (el, tab) {
        activeTab = tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        el.classList.add('active');
        renderList();
    };

    // ─── REALTIME ─────────────────────────────────────────────
    function setupRealtime() {
        if (!currentUser) return;
        realtimeChannel = window.sb
            .channel('notifications-' + currentUser.id)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `receiver_id=eq.${currentUser.id}`
            }, async (payload) => {
                const [hydrated] = await hydrate([payload.new]);
                rawNotifications.unshift(hydrated);
                renderList();
                showToast('New notification');
            })
            .subscribe();
    }

    // ─── INIT ─────────────────────────────────────────────────
    async function init() {
        if (!window.AuthUser) await new Promise(r => setTimeout(r, 300));
        currentUser = getCurrentUser();

        if (!currentUser || !currentUser.isLoggedIn) {
            showToast('Please sign in to view notifications');
            if (window.AuthUser && window.AuthUser.openModal) window.AuthUser.openModal('signin');
            return;
        }

        renderSkeleton();

        const rows = await fetchNotifications();
        rawNotifications = await hydrate(rows);
        renderList();
        setupRealtime();
    }

    window.addEventListener('beforeunload', () => {
        if (realtimeChannel) window.sb.removeChannel(realtimeChannel);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
