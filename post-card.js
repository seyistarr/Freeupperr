// Actual current Home card renderer; shared with Profile Notes.
(function(){
    function buildPostHTML(p, index) {
        const escapeHtml = window.escapeHtml;
        const author = window.getAuthorFromProfile(p.profile);
        const da = window.truncateName(author.name, 15);
        const handle = window.truncateName(author.username || '', 5);
        const aa = author.avatar;
        const verifiedStatus = author.verified_status;

        const repostBanner = window.buildRepostBanner(p);

        const hd = p.description && p.description.trim().length > 0;
        const rawContent = p.content || '';
        const hasMedia = window.getMediaItems(p).length > 0;
        const th = p.tags && p.tags.length > 0 ?
            `<div class="flex flex-wrap gap-1 mt-2">${p.tags.map(t =>
                `<span class="tag-badge" style="display:inline-block;padding:3px 9px;border-radius:20px;font-size:.7rem;font-weight:600;background:rgba(124,58,237,.08);color:#7C3AED;cursor:pointer;" onclick="event.stopPropagation();window.Router.openHashtag('${escapeHtml(t)}')">#${escapeHtml(t)}</span>`
            ).join('')}</div>` :
            '';
        const mh = window.buildMediaHTML(p, index);
        window.buildFollowButton(p.user_id, da);
        const badgeHtml = window.getVerifiedBadgeHTML ? window.getVerifiedBadgeHTML(verifiedStatus) : '';

        const cuForLock = window.getCurrentUser();
        const lockPill = (p.is_hidden && p.user_id === cuForLock.id)
            ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:.68rem;font-weight:700;color:#7C3AED;background:rgba(124,58,237,.1);padding:2px 8px;border-radius:20px;margin-left:4px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Only you</span>'
            : '';

        const isRepostClass = repostBanner ? 'is-repost' : '';

        return `<article class="feed-post ${isRepostClass}" data-post-id="${p.id}" data-author-id="${author.id}">
                ${repostBanner}
                <div class="flex items-start gap-3" style="padding:0 16px;">
                  <div class="avatar-plus-wrap">
                    <img data-author-avatar src="${aa}" class="user-mini-avatar" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover;cursor:pointer;flex-shrink:0;">
                    ${window.buildFollowPlusButton(p.user_id)}
                  </div>
                  <div style="min-width:0;flex:1;">
                    <div class="flex items-center gap-1.5" style="min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;">
                      <span data-author-name class="font-bold cursor-pointer hover:underline" style="color:var(--text);font-size:17px;line-height:1.3;min-width:0;overflow:hidden;text-overflow:ellipsis;flex-shrink:1;" title="${escapeHtml(author.name)}">${escapeHtml(da)}</span>
                      <span data-author-badge-wrapper style="flex-shrink:0;display:inline-flex;align-items:center;">${badgeHtml}</span>
                      ${handle ? `<span data-author-handle style="font-size:14px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;flex-shrink:1;min-width:0;" title="@${escapeHtml(author.username)}">@${escapeHtml(handle)}</span>` : ''}
                      <span class="text-xs" style="color:var(--muted);flex-shrink:0;">· ${window.formatRelativeTime(p.timestamp || p.date)}</span>
                      ${lockPill}
                    </div>
                    <div class="cursor-pointer mt-0.5">${window.renderPostTitle(p.title, { hasMedia, mentions: p.mentions })}</div>
                    ${hd ? `<p class="text-sm mt-1 leading-relaxed" style="white-space:pre-wrap;color:var(--muted);">${escapeHtml(p.description)}</p>` : ''}
                    <div class="mt-1" id="post-content-${p.id}">
                      ${window.buildContentBlockHTML(p.id, rawContent, hasMedia, { mentions: p.mentions })}
                    </div>
                  </div>
                </div>
                ${mh}
                ${window.buildQuotedPostCard ? window.buildQuotedPostCard(p) : ''}
                ${window.buildPublishedLinkCard ? window.buildPublishedLinkCard(p) : ''}
                <div style="padding:0 16px;">
                  ${th}
                  <div class="post-actions-row" style="position:relative;">
                    ${window.buildActionsRow(p)}
                  </div>
                </div>
              </article>`;
    }
window.FreeUpperPostCard={render:buildPostHTML};
})();
