/* =====================================================================
   index-render.js
   FreeUpper Feed Renderer
===================================================================== */

(function () {
    'use strict';


    // ================================================================
    // SELECTORS
    // ================================================================

    const SELECTORS = {

        feed:
            '#feed, #forYouFeed, [data-feed-container]',

        empty:
            '#feedEmpty, [data-feed-empty]',

        loading:
            '#feedLoading, [data-feed-loading]',

        error:
            '#feedError, [data-feed-error]'
    };


    // ================================================================
    // GET FEED CONTAINER
    // ================================================================

    function getFeedContainer() {

        return document.querySelector(
            SELECTORS.feed
        );
    }


    // ================================================================
    // MAIN RENDER
    // ================================================================

    function renderFeed(
        posts = []
    ) {

        const container =
            getFeedContainer();


        if (!container) {

            console.error(
                'FreeUpper: feed container not found.'
            );

            return;
        }


        hideLoading();
        hideError();


        if (
            !Array.isArray(posts) ||
            posts.length === 0
        ) {

            showEmpty();

            return;
        }


        hideEmpty();


        // ------------------------------------------------------------
        // Render
        // ------------------------------------------------------------

        container.innerHTML =
            posts
                .map(
                    post =>
                        renderFeedItem(
                            post
                        )
                )
                .join('');


        // ------------------------------------------------------------
        // Register interaction tracking
        // ------------------------------------------------------------

        registerInteractions(
            container
        );


        // ------------------------------------------------------------
        // Register post observer
        // ------------------------------------------------------------

        if (
            window.FreeUpperInteractions &&
            typeof window.FreeUpperInteractions
                .registerFeedPosts ===
                'function'
        ) {

            window.FreeUpperInteractions
                .registerFeedPosts(
                    container.querySelectorAll(
                        '[data-post-id]'
                    )
                );
        }


        // ------------------------------------------------------------
        // Video tracking
        // ------------------------------------------------------------

        setupVideos(
            container
        );
    }


    // ================================================================
    // RENDER ONE FEED ITEM
    // ================================================================

    function renderFeedItem(
        post
    ) {

        const profile =
            post.profile || {};


        const displayName =
            escapeHTML(
                profile.display_name ||
                'Anonymous'
            );


        const username =
            escapeHTML(
                profile.username ||
                ''
            );


        const avatar =
            profile.avatar_url ||
            createAvatarFallback(
                displayName
            );


        const verified =
            renderVerifiedBadge(
                profile
            );


        const time =
            formatRelativeTime(
                post.timestamp
            );


        const content =
            renderPostContent(
                post
            );


        const context =
            renderRepostContext(
                post
            );


        const sound =
            renderSound(
                post
            );


        return `
            <article
                class="freeupper-feed-post"
                data-post-id="${escapeAttr(post.id)}"
                data-user-id="${escapeAttr(post.user_id || '')}"
                data-media-type="${escapeAttr(post.mediaType || 'text')}"
                data-category="${escapeAttr(post.category || 'General')}"
            >

                ${context}

                <div class="freeupper-post-card">

                    <header class="freeupper-post-header">

                        <button
                            type="button"
                            class="freeupper-author"
                            data-action="profile"
                            data-user-id="${escapeAttr(post.user_id || '')}"
                        >

                            <img
                                class="freeupper-avatar"
                                src="${escapeAttr(avatar)}"
                                alt="${escapeAttr(displayName)}"
                                loading="lazy"
                            >

                            <span class="freeupper-author-info">

                                <span class="freeupper-display-name">
                                    ${displayName}
                                    ${verified}
                                </span>

                                <span class="freeupper-username">
                                    ${username ? '@' + username : ''}
                                    <span aria-hidden="true"> · </span>
                                    ${time}
                                </span>

                            </span>

                        </button>


                        <button
                            type="button"
                            class="freeupper-post-menu"
                            data-action="menu"
                            data-post-id="${escapeAttr(post.id)}"
                            aria-label="Post options"
                        >
                            ⋯
                        </button>

                    </header>


                    ${renderTitle(post)}


                    ${content}


                    ${sound}


                    ${renderTags(post)}


                    ${renderActions(post)}

                </div>

            </article>
        `;
    }


    // ================================================================
    // TITLE
    // ================================================================

    function renderTitle(
        post
    ) {

        if (
            !post.title
        ) {

            return '';
        }


        return `
            <h2 class="freeupper-post-title">
                ${escapeHTML(
                    post.title
                )}
            </h2>
        `;
    }


    // ================================================================
    // CONTENT
    // ================================================================

    function renderPostContent(
        post
    ) {

        const media =
            Array.isArray(post.media)
                ? post.media
                : [];


        // ------------------------------------------------------------
        // Media post
        // ------------------------------------------------------------

        if (
            media.length
        ) {

            const mediaHTML =
                renderMediaGallery(
                    post,
                    media
                );


            const text =
                renderTextContent(
                    post
                );


            return `
                ${text}
                ${mediaHTML}
            `;
        }


        // ------------------------------------------------------------
        // Text-only post
        // ------------------------------------------------------------

        return renderTextContent(
            post
        );
    }


    // ================================================================
    // TEXT
    // ================================================================

    function renderTextContent(
        post
    ) {

        const text =
            post.content ||
            post.description ||
            '';


        if (!text.trim()) {
            return '';
        }


        return `
            <div
                class="freeupper-post-text"
                data-post-content
            >
                ${formatPostText(
                    text
                )}
            </div>
        `;
    }


    // ================================================================
    // MEDIA GALLERY
    // ================================================================

    function renderMediaGallery(
        post,
        media
    ) {

        if (
            media.length === 1
        ) {

            return renderSingleMedia(
                post,
                media[0]
            );
        }


        return `
            <div
                class="freeupper-media-gallery"
                data-media-count="${media.length}"
            >
                ${media
                    .map(
                        (item, index) =>
                            renderSingleMedia(
                                post,
                                item,
                                index
                            )
                    )
                    .join('')}
            </div>
        `;
    }


    // ================================================================
    // SINGLE MEDIA
    // ================================================================

    function renderSingleMedia(
        post,
        media,
        index = 0
    ) {

        if (!media?.url) {
            return '';
        }


        const type =
            String(
                media.type ||
                post.mediaType ||
                'image'
            ).toLowerCase();


        const url =
            media.url;


        // ------------------------------------------------------------
        // VIDEO
        // ------------------------------------------------------------

        if (
            type === 'video'
        ) {

            return `
                <div
                    class="freeupper-media freeupper-video-wrap"
                    data-media-index="${index}"
                >

                    <video
                        class="freeupper-video"
                        data-post-video
                        data-post-id="${escapeAttr(post.id)}"
                        src="${escapeAttr(url)}"
                        ${
                            media.thumbnail
                                ? `poster="${escapeAttr(media.thumbnail)}"`
                                : post.thumbnail_url
                                    ? `poster="${escapeAttr(post.thumbnail_url)}"`
                                    : ''
                        }
                        playsinline
                        preload="metadata"
                        controls
                    ></video>

                </div>
            `;
        }


        // ------------------------------------------------------------
        // IMAGE
        // ------------------------------------------------------------

        return `
            <button
                type="button"
                class="freeupper-media freeupper-image-wrap"
                data-action="open-media"
                data-post-id="${escapeAttr(post.id)}"
                data-media-url="${escapeAttr(url)}"
            >

                <img
                    class="freeupper-post-image"
                    src="${escapeAttr(url)}"
                    alt="${escapeAttr(post.title || 'FreeUpper post image')}"
                    loading="lazy"
                >

            </button>
        `;
    }


    // ================================================================
    // SOUND
    // ================================================================

    function renderSound(
        post
    ) {

        if (
            !post.sound_id
        ) {

            return '';
        }


        return `
            <button
                type="button"
                class="freeupper-sound"
                data-action="sound"
                data-sound-id="${escapeAttr(post.sound_id)}"
            >
                <span aria-hidden="true">♫</span>
                <span>Original sound</span>
            </button>
        `;
    }


    // ================================================================
    // TAGS
    // ================================================================

    function renderTags(
        post
    ) {

        if (
            !Array.isArray(
                post.tags
            ) ||
            !post.tags.length
        ) {

            return '';
        }


        return `
            <div class="freeupper-post-tags">

                ${post.tags
                    .slice(0, 12)
                    .map(
                        tag => `
                            <button
                                type="button"
                                class="freeupper-tag"
                                data-action="hashtag"
                                data-tag="${escapeAttr(
                                    String(tag)
                                        .replace(/^#/, '')
                                )}"
                            >
                                #${escapeHTML(
                                    String(tag)
                                        .replace(/^#/, '')
                                )}
                            </button>
                        `
                    )
                    .join('')}

            </div>
        `;
    }


    // ================================================================
    // ACTIONS
    // ================================================================

    function renderActions(
        post
    ) {

        return `
            <footer class="freeupper-post-actions">

                <button
                    type="button"
                    data-action="like"
                    data-post-id="${escapeAttr(post.id)}"
                    aria-label="Like"
                    class="${post.likedByMe ? 'is-active' : ''}"
                >
                    <span aria-hidden="true">
                        ${post.likedByMe ? '♥' : '♡'}
                    </span>

                    <span data-like-count>
                        ${formatCount(post.likes)}
                    </span>
                </button>


                <button
                    type="button"
                    data-action="comment"
                    data-post-id="${escapeAttr(post.id)}"
                    aria-label="Comments"
                >
                    <span aria-hidden="true">💬</span>

                    <span>
                        ${formatCount(post.comments)}
                    </span>
                </button>


                <button
                    type="button"
                    data-action="repost"
                    data-post-id="${escapeAttr(post.id)}"
                    aria-label="Repost"
                >
                    <span aria-hidden="true">↻</span>

                    <span>
                        ${formatCount(post.repostCount)}
                    </span>
                </button>


                <button
                    type="button"
                    data-action="bookmark"
                    data-post-id="${escapeAttr(post.id)}"
                    aria-label="Bookmark"
                >
                    <span aria-hidden="true">🔖</span>

                    <span>
                        ${formatCount(post.bookmarkCount)}
                    </span>
                </button>


                <button
                    type="button"
                    data-action="share"
                    data-post-id="${escapeAttr(post.id)}"
                    aria-label="Share"
                >
                    <span aria-hidden="true">↗</span>

                    <span>
                        ${formatCount(post.shareCount)}
                    </span>
                </button>

            </footer>
        `;
    }


    // ================================================================
    // REPOST CONTEXT
    // ================================================================

    function renderRepostContext(
        post
    ) {

        if (
            post._feedType !==
            'repost'
        ) {

            return '';
        }


        const context =
            window.PostsAPI?.getFeedContext?.(
                post.id
            );


        const reposts =
            context?.repost?.items ||
            [];


        if (
            !reposts.length
        ) {

            return `
                <div class="freeupper-repost-context">
                    ↻ Reposted
                </div>
            `;
        }


        const first =
            reposts[0];


        return `
            <div class="freeupper-repost-context">

                <span aria-hidden="true">
                    ↻
                </span>

                <span>
                    ${escapeHTML(
                        first.user?.display_name ||
                        first.user?.username ||
                        'Someone'
                    )}
                    reposted
                </span>

            </div>
        `;
    }


    // ================================================================
    // VERIFIED
    // ================================================================

    function renderVerifiedBadge(
        profile
    ) {

        if (
            !profile?.verified &&
            profile?.verified_status !==
                'verified'
        ) {

            return '';
        }


        return `
            <span
                class="freeupper-verified"
                aria-label="Verified"
            >
                ✓
            </span>
        `;
    }


    // ================================================================
    // EVENT DELEGATION
    // ================================================================

    function registerInteractions(
        container
    ) {

        // Prevent duplicate listeners.
        if (
            container.dataset
                .interactionsReady ===
            'true'
        ) {

            return;
        }


        container.dataset
            .interactionsReady =
            'true';


        container.addEventListener(
            'click',
            handleAction
        );
    }


    async function handleAction(
        event
    ) {

        const target =
            event.target.closest(
                '[data-action]'
            );


        if (!target) {
            return;
        }


        const action =
            target.dataset.action;


        const postId =
            target.dataset.postId;


        const post =
            getPostFromFeed(
                postId
            );


        try {

            switch (action) {

                case 'like':
                    await handleLike(
                        target,
                        post
                    );
                    break;


                case 'comment':
                    handleComment(
                        post
                    );
                    break;


                case 'repost':
                    await handleRepost(
                        post
                    );
                    break;


                case 'bookmark':
                    await handleBookmark(
                        target,
                        post
                    );
                    break;


                case 'share':
                    await handleShare(
                        target,
                        post
                    );
                    break;


                case 'profile':
                    handleProfile(
                        target.dataset.userId
                    );
                    break;


                case 'hashtag':
                    handleHashtag(
                        target.dataset.tag
                    );
                    break;


                case 'sound':
                    handleSound(
                        target.dataset.soundId
                    );
                    break;


                case 'open-media':
                    handleMedia(
                        post,
                        target.dataset.mediaUrl
                    );
                    break;


                case 'menu':
                    handleMenu(
                        post,
                        target
                    );
                    break;
            }

        } catch (error) {

            console.error(
                'FreeUpper action error:',
                error
            );
        }
    }


    // ================================================================
    // LIKE
    // ================================================================

    async function handleLike(
        button,
        post
    ) {

        if (!post) {
            return;
        }


        if (
            !window.PostsAPI
        ) {
            return;
        }


        const result =
            await window.PostsAPI
                .toggleLike(
                    post.id
                );


        const liked =
            !!result.liked;


        button.classList.toggle(
            'is-active',
            liked
        );


        const icon =
            button.querySelector(
                '[aria-hidden="true"]'
            );


        if (icon) {

            icon.textContent =
                liked
                    ? '♥'
                    : '♡';
        }


        const count =
            button.querySelector(
                '[data-like-count]'
            );


        if (count) {

            count.textContent =
                formatCount(
                    result.count
                );
        }


        recordBehavior(
            post,
            liked
                ? 'like'
                : 'unlike'
        );
    }


    // ================================================================
    // COMMENT
    // ================================================================

    function handleComment(
        post
    ) {

        if (!post) {
            return;
        }


        recordBehavior(
            post,
            'comment_open'
        );


        if (
            typeof window.openComments ===
            'function'
        ) {

            window.openComments(
                post.id
            );

            return;
        }


        if (
            window.location
        ) {

            window.location.href =
                `comments.html?post=${encodeURIComponent(
                    post.id
                )}`;
        }
    }


    // ================================================================
    // REPOST
    // ================================================================

    async function handleRepost(
        post
    ) {

        if (!post) {
            return;
        }


        const result =
            await window.PostsAPI
                .toggleRepostAPI(
                    post.id
                );


        recordBehavior(
            post,
            result.reposted
                ? 'repost'
                : 'unrepost'
        );


        // Re-run ranking because repost
        // context changed.
        if (
            window.FreeUpperFeed
        ) {

            window.FreeUpperFeed
                .rerank();
        }
    }


    // ================================================================
    // BOOKMARK
    // ================================================================

    async function handleBookmark(
        button,
        post
    ) {

        if (!post) {
            return;
        }


        const result =
            await window.PostsAPI
                .toggleBookmark(
                    post.id
                );


        recordBehavior(
            post,
            result.bookmarked
                ? 'save'
                : 'unsave'
        );


        const count =
            button.querySelector(
                'span:last-child'
            );


        if (count) {

            count.textContent =
                formatCount(
                    result.count
                );
        }
    }


    // ================================================================
    // SHARE
    // ================================================================

    async function handleShare(
        button,
        post
    ) {

        if (!post) {
            return;
        }


        const url =
            `${window.location.origin}/post.html?id=${encodeURIComponent(
                post.id
            )}`;


        try {

            if (
                navigator.share
            ) {

                await navigator.share({

                    title:
                        post.title ||
                        'FreeUpper',

                    text:
                        post.description ||
                        post.content ||
                        '',

                    url
                });

            } else {

                await navigator.clipboard.writeText(
                    url
                );

                showToast(
                    'Post link copied'
                );
            }


            await window.PostsAPI
                .recordShare(
                    post.id
                );


            recordBehavior(
                post,
                'share'
            );

        } catch (error) {

            // User cancelled native share.
            if (
                error?.name !==
                'AbortError'
            ) {

                console.warn(
                    'Share failed:',
                    error
                );
            }
        }
    }


    // ================================================================
    // PROFILE
    // ================================================================

    function handleProfile(
        userId
    ) {

        if (!userId) {
            return;
        }


        window.location.href =
            `profile.html?id=${encodeURIComponent(
                userId
            )}`;
    }


    // ================================================================
    // HASHTAG
    // ================================================================

    function handleHashtag(
        tag
    ) {

        if (!tag) {
            return;
        }


        if (
            typeof window.goToHashtag ===
            'function'
        ) {

            window.goToHashtag(
                tag
            );

            return;
        }


        window.location.href =
            `search.html?q=${encodeURIComponent(
                '#' + tag
            )}`;
    }


    // ================================================================
    // SOUND
    // ================================================================

    function handleSound(
        soundId
    ) {

        if (!soundId) {
            return;
        }


        window.location.href =
            `sound.html?id=${encodeURIComponent(
                soundId
            )}`;
    }


    // ================================================================
    // MEDIA
    // ================================================================

    function handleMedia(
        post,
        mediaUrl
    ) {

        if (!post) {
            return;
        }


        recordBehavior(
            post,
            'open'
        );


        if (
            typeof window.openMediaViewer ===
            'function'
        ) {

            window.openMediaViewer(
                mediaUrl,
                post
            );

            return;
        }


        if (
            typeof window.openPost ===
            'function'
        ) {

            window.openPost(
                post.id
            );

            return;
        }


        window.location.href =
            `post.html?id=${encodeURIComponent(
                post.id
            )}`;
    }


    // ================================================================
    // MENU
    // ================================================================

    function handleMenu(
        post,
        button
    ) {

        if (!post) {
            return;
        }


        if (
            typeof window.openPostMenu ===
            'function'
        ) {

            window.openPostMenu(
                post,
                button
            );

            return;
        }


        console.log(
            'Post menu:',
            post.id
        );
    }


    // ================================================================
    // VIDEO SETUP
    // ================================================================

    function setupVideos(
        container
    ) {

        const videos =
            container.querySelectorAll(
                '[data-post-video]'
            );


        videos.forEach(
            video => {

                const postId =
                    video.dataset.postId;


                const post =
                    getPostFromFeed(
                        postId
                    );


                if (!post) {
                    return;
                }


                // Use the existing interaction
                // tracking implementation if available.
                if (
                    window.FreeUpperInteractions &&
                    typeof window.FreeUpperInteractions
                        .startVideoTracking ===
                        'function'
                ) {

                    window.FreeUpperInteractions
                        .startVideoTracking(
                            video,
                            post
                        );
                }


                // Autoplay muted videos when visible.
                setupVideoAutoplay(
                    video
                );
            }
        );
    }


    // ================================================================
    // VIDEO AUTOPLAY
    // ================================================================

    function setupVideoAutoplay(
        video
    ) {

        if (
            typeof IntersectionObserver ===
            'undefined'
        ) {
            return;
        }


        const observer =
            new IntersectionObserver(
                entries => {

                    entries.forEach(
                        entry => {

                            if (
                                entry.isIntersecting &&
                                entry.intersectionRatio >= 0.6
                            ) {

                                video.muted =
                                    true;


                                video.play()
                                    .catch(
                                        () => {}
                                    );

                            } else {

                                video.pause();
                            }
                        }
                    );

                },
                {
                    threshold: [
                        0,
                        0.6,
                        1
                    ]
                }
            );


        observer.observe(
            video
        );
    }


    // ================================================================
    // BEHAVIOR
    // ================================================================

    function recordBehavior(
        post,
        action
    ) {

        if (!post) {
            return;
        }


        // Send to algorithm's local model.
        if (
            window.FreeUpperFeed &&
            typeof window.FreeUpperFeed
                .recordInteraction ===
                'function'
        ) {

            window.FreeUpperFeed
                .recordInteraction(
                    post,
                    action
                );
        }


        // Send to interaction analytics.
        if (
            window.FreeUpperInteractions
        ) {

            const api =
                window.FreeUpperInteractions;


            const map = {

                like:
                    'trackLike',

                comment:
                    'trackComment',

                repost:
                    'trackRepost',

                share:
                    'trackShare',

                save:
                    'trackSave',

                skip:
                    'trackSkip',

                hide:
                    'trackHide',

                not_interested:
                    'trackNotInterested',

                open:
                    'trackPostOpen',

                read_more:
                    'trackReadMore'
            };


            const method =
                map[action];


            if (
                method &&
                typeof api[method] ===
                'function'
            ) {

                api[method](
                    post.id,
                    post
                );
            }
        }
    }


    // ================================================================
    // FIND POST
    // ================================================================

    function getPostFromFeed(
        postId
    ) {

        if (!postId) {
            return null;
        }


        const state =
            window.FreeUpperFeed?.getState?.();


        const posts =
            state?.displayedPosts ||
            [];


        return posts.find(
            post =>
                post.id === postId
        ) || null;
    }


    // ================================================================
    // LOADING
    // ================================================================

    function showLoading() {

        const loading =
            document.querySelector(
                SELECTORS.loading
            );


        if (loading) {

            loading.hidden =
                false;
        }
    }


    function hideLoading() {

        const loading =
            document.querySelector(
                SELECTORS.loading
            );


        if (loading) {

            loading.hidden =
                true;
        }
    }


    // ================================================================
    // EMPTY
    // ================================================================

    function showEmpty() {

        const empty =
            document.querySelector(
                SELECTORS.empty
            );


        if (empty) {

            empty.hidden =
                false;
        }
    }


    function hideEmpty() {

        const empty =
            document.querySelector(
                SELECTORS.empty
            );


        if (empty) {

            empty.hidden =
                true;
        }
    }


    // ================================================================
    // ERROR
    // ================================================================

    function showError(
        error
    ) {

        const element =
            document.querySelector(
                SELECTORS.error
            );


        if (!element) {
            return;
        }


        element.hidden =
            false;


        element.textContent =
            error?.message ||
            'Something went wrong while loading your feed.';
    }


    function hideError() {

        const element =
            document.querySelector(
                SELECTORS.error
            );


        if (element) {

            element.hidden =
                true;
        }
    }


    // ================================================================
    // TEXT FORMAT
    // ================================================================

    function formatPostText(
        text
    ) {

        let safe =
            escapeHTML(
                String(text)
            );


        // URLs.
        safe =
            safe.replace(
                /(https?:\/\/[^\s<]+)/g,
                '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
            );


        // Mentions.
        safe =
            safe.replace(
                /(^|\s)@([a-zA-Z0-9_.]+)/g,
                '$1<button type="button" class="freeupper-mention" data-action="mention" data-username="$2">@$2</button>'
            );


        // Hashtags.
        safe =
            safe.replace(
                /(^|\s)#([a-zA-Z0-9_]+)/g,
                '$1<button type="button" class="freeupper-hashtag-inline" data-action="hashtag" data-tag="$2">#$2</button>'
            );


        // New lines.
        safe =
            safe.replace(
                /\n/g,
                '<br>'
            );


        return safe;
    }


    // ================================================================
    // HELPERS
    // ================================================================

    function escapeHTML(
        value
    ) {

        return String(
            value ?? ''
        )
            .replace(
                /&/g,
                '&amp;'
            )
            .replace(
                /</g,
                '&lt;'
            )
            .replace(
                />/g,
                '&gt;'
            )
            .replace(
                /"/g,
                '&quot;'
            )
            .replace(
                /'/g,
                '&#039;'
            );
    }


    function escapeAttr(
        value
    ) {

        return escapeHTML(
            value
        );
    }


    function formatCount(
        value
    ) {

        const n =
            Number(value || 0);


        if (
            n >= 1000000
        ) {

            return (
                (n / 1000000)
                    .toFixed(
                        n >= 10000000
                            ? 0
                            : 1
                    ) +
                'M'
            );
        }


        if (
            n >= 1000
        ) {

            return (
                (n / 1000)
                    .toFixed(
                        n >= 10000
                            ? 0
                            : 1
                    ) +
                'K'
            );
        }


        return String(
            n
        );
    }


    function formatRelativeTime(
        timestamp
    ) {

        const time =
            new Date(
                timestamp
            ).getTime();


        if (
            !Number.isFinite(
                time
            )
        ) {

            return '';
        }


        const seconds =
            Math.floor(
                (
                    Date.now() -
                    time
                ) / 1000
            );


        if (
            seconds < 60
        ) {

            return 'now';
        }


        const minutes =
            Math.floor(
                seconds / 60
            );


        if (
            minutes < 60
        ) {

            return `${minutes}m`;
        }


        const hours =
            Math.floor(
                minutes / 60
            );


        if (
            hours < 24
        ) {

            return `${hours}h`;
        }


        const days =
            Math.floor(
                hours / 24
            );


        if (
            days < 7
        ) {

            return `${days}d`;
        }


        return new Date(
            time
        ).toLocaleDateString(
            undefined,
            {
                month: 'short',
                day: 'numeric'
            }
        );
    }


    function createAvatarFallback(
        name
    ) {

        const letter =
            String(
                name ||
                'A'
            )
                .trim()
                .charAt(0)
                .toUpperCase();


        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
                <rect width="100%" height="100%" rx="50" fill="#7C3AED"/>
                <text x="50%" y="55%" text-anchor="middle"
                      font-family="Arial"
                      font-size="42"
                      fill="white">${letter}</text>
            </svg>`
        )}`;
    }


    function showToast(
        message
    ) {

        if (
            typeof window.showToast ===
            'function'
        ) {

            window.showToast(
                message
            );

            return;
        }


        console.log(
            message
        );
    }


    // ================================================================
    // PUBLIC API
    // ================================================================

    window.FreeUpperRender = {

        renderFeed,

        renderFeedItem,

        showLoading,

        hideLoading,

        showEmpty,

        hideEmpty,

        showError,

        hideError
    };

})();
