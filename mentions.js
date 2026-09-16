// ============================================================
// mentions.js – Centralized mention handling for FreeUpper
// ============================================================

(function() {
    'use strict';

    // ─── CONFIG ──────────────────────────────────────────────
    const DEBOUNCE_DELAY = 300;
    const MAX_SUGGESTIONS = 8;

    // ─── STATE ───────────────────────────────────────────────
    let activeTextarea = null;
    let mentionSearchTimer = null;
    let mentionTriggerIndex = -1;
    let mentionQuery = '';

    // ─── PUBLIC API ──────────────────────────────────────────

    /**
     * Initialize mention detection on a textarea/input.
     * @param {HTMLTextAreaElement|HTMLInputElement} el - The input element.
     * @param {Object} options - { onMentionInsert, onMentionRemove }
     */
    function initMentions(el, options = {}) {
        if (!el) return;

        el.addEventListener('input', function(e) {
            const cursorPos = el.selectionStart;
            const text = el.value;

            // Find @ symbol before cursor
            let mentionStart = text.lastIndexOf('@', cursorPos - 1);
            if (mentionStart === -1) {
                closeSuggestionBox();
                return;
            }

            // Check if there's any whitespace between @ and cursor
            const substring = text.substring(mentionStart + 1, cursorPos);
            if (/\s/.test(substring)) {
                closeSuggestionBox();
                return;
            }

            // We have a valid mention trigger
            mentionTriggerIndex = mentionStart;
            mentionQuery = substring.toLowerCase();

            // Debounce search
            clearTimeout(mentionSearchTimer);
            mentionSearchTimer = setTimeout(() => {
                searchUsers(mentionQuery, (results) => {
                    showSuggestionBox(results, el, mentionStart, options);
                });
            }, DEBOUNCE_DELAY);
        });

        el.addEventListener('blur', function() {
            // Close suggestions when focus leaves
            setTimeout(closeSuggestionBox, 200);
        });

        // Keyboard navigation for suggestions
        el.addEventListener('keydown', function(e) {
            const box = document.getElementById('mention-suggestions');
            if (!box || box.style.display === 'none') return;

            const items = box.querySelectorAll('.mention-item');
            const current = box.querySelector('.mention-item.active');
            let idx = -1;

            if (current) {
                idx = Array.from(items).indexOf(current);
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIdx = (idx + 1) % items.length;
                items.forEach((item, i) => item.classList.toggle('active', i === nextIdx));
                scrollSuggestionIntoView(box, items[nextIdx]);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIdx = (idx - 1 + items.length) % items.length;
                items.forEach((item, i) => item.classList.toggle('active', i === prevIdx));
                scrollSuggestionIntoView(box, items[prevIdx]);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const selected = box.querySelector('.mention-item.active');
                if (selected) {
                    selected.click();
                }
            } else if (e.key === 'Escape') {
                closeSuggestionBox();
            }
        });

        // Store reference for cleanup
        el._mentionCleanup = function() {
            el.removeEventListener('input', arguments.callee);
            el.removeEventListener('blur', arguments.callee);
            el.removeEventListener('keydown', arguments.callee);
        };
    }

    /**
     * Search users from Supabase profiles table.
     * @param {string} query - Search term.
     * @param {Function} callback - Receives array of user objects.
     */
    function searchUsers(query, callback) {
        if (!query || query.length < 1) {
            callback([]);
            return;
        }

        window.sb
            .from('profiles')
            .select('id, username, display_name, avatar_url, verified_status')
            .ilike('username', `%${query}%`)
            .order('username')
            .limit(MAX_SUGGESTIONS)
            .then(({ data, error }) => {
                if (error) {
                    console.error('Mention search error:', error);
                    callback([]);
                    return;
                }
                callback(data || []);
            });
    }

    /**
     * Insert a mention into the text.
     * @param {HTMLTextAreaElement|HTMLInputElement} el - The input element.
     * @param {Object} user - The selected user object.
     * @param {number} startIndex - The index where @ was typed.
     * @param {Function} onInsert - Optional callback.
     */
    function insertMention(el, user, startIndex, onInsert) {
        const text = el.value;
        const cursorPos = el.selectionStart;
        const endIndex = cursorPos;

        // Build the mention string (e.g., "@john ")
        const mentionText = `@${user.username} `;

        // Replace the typed @query with the full mention
        const newText = text.substring(0, startIndex) + mentionText + text.substring(endIndex);
        el.value = newText;

        // Recalculate cursor position (after the mention + space)
        const newCursorPos = startIndex + mentionText.length;
        el.setSelectionRange(newCursorPos, newCursorPos);

        // Store mention metadata for saving later
        const mentionData = {
            userId: user.id,
            username: user.username,
            displayName: user.display_name,
            avatar: user.avatar_url,
            verified: user.verified_status === 'verified' || 
                     user.verified_status === 'official' || 
                     user.verified_status === 'staff' || 
                     user.verified_status === 'business',
            start: startIndex,
            end: startIndex + mentionText.length - 1, // end is exclusive in JSON
            type: 'user'
        };

        // Store in a data attribute for later extraction
        if (!el._mentions) el._mentions = [];
        // Remove any existing mention at this start position
        el._mentions = el._mentions.filter(m => m.start !== startIndex);
        el._mentions.push(mentionData);

        // Trigger input event to re-run detection
        el.dispatchEvent(new Event('input'));

        closeSuggestionBox();

        if (onInsert) onInsert(mentionData);
    }

    /**
     * Extract all mentions from a text input as a clean JSON array.
     * @param {HTMLTextAreaElement|HTMLInputElement} el - The input element.
     * @returns {Array} Array of mention objects.
     */
    function extractMentions(el) {
        if (!el._mentions) return [];
        // Remove duplicates and sort by start
        const unique = [];
        const seen = new Set();
        el._mentions.forEach(m => {
            const key = `${m.start}-${m.end}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(m);
            }
        });
        return unique.sort((a, b) => a.start - b.start);
    }

    /**
     * Render mentions as clickable, bold, highlighted links.
     * IMPORTANT: call this AFTER escapeHtml() has already run on the text
     * (same contract as Hashtags.hashifyHtml). It matches "@username"
     * patterns in the given HTML string and only turns a match into a
     * link when that username exists in the supplied mentions array —
     * so plain "@word" text that was never an actual tagged mention
     * doesn't get linked by accident.
     * @param {string} html - Already-escaped HTML string.
     * @param {Array} mentions - Array of mention objects with .username, .userId, .verified.
     * @returns {string} HTML string with mentions wrapped in clickable, styled links.
     */
    function renderMentions(html, mentions) {
        if (!html || !mentions || !mentions.length) return html;

        const byUsername = new Map();
        mentions.forEach(m => {
            if (m && m.username) byUsername.set(m.username.toLowerCase(), m);
        });
        if (!byUsername.size) return html;

        return html.replace(/@([A-Za-z0-9_]{1,30})/g, (match, uname) => {
            const m = byUsername.get(uname.toLowerCase());
            if (!m) return match;
            const verifiedBadge = m.verified ? getVerifiedBadgeHTML() : '';
            return `<a href="javascript:void(0)" class="mention-link" data-userid="${m.userId}" data-username="${escapeHtml(uname)}">@${escapeHtml(uname)}${verifiedBadge}</a>`;
        });
    }

    /**
     * Notify mentioned users.
     * @param {string} targetType - 'post', 'video', 'comment', 'reply', 'chat'
     * @param {string} targetId - The ID of the content.
     * @param {Array} mentions - Array of mention objects.
     * @param {string} senderId - The ID of the user who created the content.
     * @param {string} parentId - Optional parent ID (e.g., post_id for comment).
     */
    function notifyMentionedUsers(targetType, targetId, mentions, senderId, parentId = null) {
        if (!mentions || mentions.length === 0) return;

        const postId = targetType === 'post' ? targetId : parentId;
        const commentId = targetType === 'comment' ? targetId : null;

        mentions.forEach(m => {
            window.sb.rpc('create_mention_notification', {
                p_receiver_id: m.userId,
                p_post_id: postId,
                p_comment_id: commentId
            }).then(({ error }) => {
                if (error) console.error('Mention notification error:', error);
            });
        });
    }

    // ─── INTERNAL UI HELPERS ──────────────────────────────────

    function showSuggestionBox(users, el, startIndex, options) {
        let box = document.getElementById('mention-suggestions');
        if (!box) {
            box = document.createElement('div');
            box.id = 'mention-suggestions';
            box.className = 'mention-suggestions';
            document.body.appendChild(box);
        }

        if (!users || users.length === 0) {
            box.style.display = 'none';
            return;
        }

        // Position the box near the textarea
        const rect = el.getBoundingClientRect();
        const cursorPos = el.selectionStart;
        // Estimate the position of the @
        // We'll position below the textarea with a fixed offset.
        box.style.left = Math.min(rect.left + 10, window.innerWidth - 200) + 'px';
        box.style.top = (rect.bottom + 8) + 'px';
        box.style.width = Math.min(rect.width, 300) + 'px';

        const html = users.map(user => {
            const verified = user.verified_status === 'verified' || 
                           user.verified_status === 'official' || 
                           user.verified_status === 'staff' || 
                           user.verified_status === 'business';
            const avatar = user.avatar_url || '';
            const badge = verified ? getVerifiedBadgeHTML() : '';
            return `
                <div class="mention-item" data-userid="${user.id}" data-username="${user.username}">
                    <img src="${avatar}" class="mention-avatar" onerror="this.style.display='none'" />
                    <div class="mention-info">
                        <span class="mention-name">${escapeHtml(user.display_name || user.username)}</span>
                        <span class="mention-username">@${escapeHtml(user.username)}</span>
                        ${badge}
                    </div>
                </div>
            `;
        }).join('');

        box.innerHTML = html;
        box.style.display = 'block';

        // Highlight first item
        const first = box.querySelector('.mention-item');
        if (first) first.classList.add('active');

        // Click handler
        box.querySelectorAll('.mention-item').forEach(item => {
            item.addEventListener('click', function() {
                const userId = this.dataset.userid;
                const username = this.dataset.username;
                const user = users.find(u => u.id === userId);
                if (user) {
                    insertMention(el, user, startIndex, options.onMentionInsert);
                }
            });
        });

        // Store current textarea reference for cleanup
        activeTextarea = el;
    }

    function closeSuggestionBox() {
        const box = document.getElementById('mention-suggestions');
        if (box) box.style.display = 'none';
        activeTextarea = null;
    }

    function scrollSuggestionIntoView(box, item) {
        if (!box || !item) return;
        const boxRect = box.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        if (itemRect.bottom > boxRect.bottom || itemRect.top < boxRect.top) {
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function getVerifiedBadgeHTML() {
        // Reuse your global verified badge HTML
        return `<span class="verified-badge-sm"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>`;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ─── STYLES (inject once) ──────────────────────────────────
    function injectStyles() {
        if (document.getElementById('mention-styles')) return;
        const style = document.createElement('style');
        style.id = 'mention-styles';
        style.textContent = `
            .mention-suggestions {
                position: fixed;
                background: var(--bg2);
                border: 1px solid var(--brd);
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.2);
                max-height: 200px;
                overflow-y: auto;
                padding: 6px 0;
                z-index: 10000;
                display: none;
                min-width: 200px;
            }
            .mention-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 14px;
                cursor: pointer;
                transition: background 0.15s;
            }
            .mention-item:hover,
            .mention-item.active {
                background: var(--pdim);
            }
            .mention-avatar {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                object-fit: cover;
                background: var(--bg4);
                flex-shrink: 0;
            }
            .mention-info {
                flex: 1;
                min-width: 0;
                display: flex;
                align-items: center;
                gap: 4px;
                flex-wrap: wrap;
            }
            .mention-name {
                font-weight: 600;
                font-size: 13px;
                color: var(--text);
            }
            .mention-username {
                font-size: 12px;
                color: var(--muted);
            }
            .mention-link {
                color: var(--pl, #A78BFA);
                font-weight: 800;
                text-decoration: none;
            }
            .mention-link:hover {
                text-decoration: underline;
            }
            .mention-suggestions::-webkit-scrollbar {
                width: 4px;
            }
            .mention-suggestions::-webkit-scrollbar-thumb {
                background: var(--brd2);
                border-radius: 2px;
            }
        `;
        document.head.appendChild(style);
    }

    injectStyles();

    // ─── EXPOSE GLOBALLY ──────────────────────────────────────
    window.Mentions = {
        initMentions,
        searchUsers,
        insertMention,
        extractMentions,
        renderMentions,
        notifyMentionedUsers,
        closeSuggestionBox
    };

    console.log('✅ mentions.js loaded');

})();
