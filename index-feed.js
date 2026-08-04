/* =====================================================================
   index-feed.js
   FreeUpper For You Feed Controller
===================================================================== */

(function () {
    'use strict';


    // ================================================================
    // CONFIG
    // ================================================================

    const CONFIG = {

        // How many candidates to fetch.
        CANDIDATE_LIMIT: 100,

        // How many ranked posts to display initially.
        DISPLAY_LIMIT: 20,

        // Pagination increment.
        PAGE_SIZE: 100,

        // Don't load more than this many candidates
        // without user interaction.
        MAX_PAGES: 10,

        // Source:
        // null = composer + studio
        // 'composer' = composer only
        // 'studio' = studio only
        SOURCE: null
    };


    // ================================================================
    // STATE
    // ================================================================

    const state = {

        initialized: false,

        loading: false,

        loadingMore: false,

        hasMore: true,

        offset: 0,

        candidates: [],

        rankedPosts: [],

        displayedPosts: [],

        profile: null,

        currentSource:
            CONFIG.SOURCE,

        pageCount: 0,

        seenInCurrentFeed:
            new Set(),

        error: null
    };


    // ================================================================
    // INIT
    // ================================================================

    async function init(options = {}) {

        if (
            state.initialized
        ) {
            return state;
        }


        state.currentSource =
            options.source ??
            CONFIG.SOURCE;


        state.profile =
            loadAlgorithmProfile();


        state.initialized = true;


        await refresh();


        setupInfiniteScroll();


        return state;
    }


    // ================================================================
    // LOAD PROFILE
    // ================================================================

    function loadAlgorithmProfile() {

        if (
            window.FreeUpperInteractions &&
            typeof window.FreeUpperInteractions
                .getCurrentFeedProfile ===
                'function'
        ) {

            return window.FreeUpperInteractions
                .getCurrentFeedProfile();
        }


        // Compatibility with the interaction
        // implementation previously created.
        if (
            window.getFeedInteractionProfile &&
            typeof window.getFeedInteractionProfile ===
                'function'
        ) {

            return window.getFeedInteractionProfile();
        }


        return {

            followingIds: [],

            likedTopics: {},
            viewedTopics: {},
            skippedTopics: {},

            interactedAuthors: {},

            seenPostIds: [],

            hiddenPostIds: [],

            notInterestedPostIds: []
        };
    }


    // ================================================================
    // REFRESH
    // ================================================================

    async function refresh() {

        if (
            state.loading
        ) {
            return;
        }


        state.loading = true;

        state.error = null;


        try {

            state.offset = 0;

            state.pageCount = 0;

            state.hasMore = true;

            state.candidates = [];

            state.rankedPosts = [];

            state.displayedPosts = [];

            state.seenInCurrentFeed.clear();


            if (
                window.FreeUpperRender
            ) {

                window.FreeUpperRender
                    .showLoading();
            }


            await loadCandidates();


            rankAndRender();


        } catch (error) {

            console.error(
                'FreeUpper feed refresh error:',
                error
            );


            state.error =
                error;


            if (
                window.FreeUpperRender
            ) {

                window.FreeUpperRender
                    .showError(
                        error
                    );
            }

        } finally {

            state.loading = false;
        }
    }


    // ================================================================
    // LOAD CANDIDATES
    // ================================================================

    async function loadCandidates() {

        if (
            !window.PostsAPI
        ) {

            throw new Error(
                'PostsAPI is not available.'
            );
        }


        if (
            state.pageCount >=
            CONFIG.MAX_PAGES
        ) {

            state.hasMore = false;

            return;
        }


        state.loadingMore = true;


        try {

            const result =
                await window.PostsAPI
                    .loadFeedWithReposts(
                        state.offset,
                        CONFIG.PAGE_SIZE,
                        state.currentSource
                    );


            if (
                !Array.isArray(
                    result
                )
            ) {

                return;
            }


            if (
                result.length <
                CONFIG.PAGE_SIZE
            ) {

                state.hasMore = false;
            }


            state.offset +=
                CONFIG.PAGE_SIZE;


            state.pageCount++;


            // --------------------------------------------------------
            // Deduplicate
            // --------------------------------------------------------

            const existing =
                new Set(
                    state.candidates.map(
                        item =>
                            item?.post?.id ||
                            item?.id
                    )
                );


            for (
                const item
                of result
            ) {

                const post =
                    item?.post ||
                    item;


                if (!post?.id) {
                    continue;
                }


                if (
                    existing.has(
                        post.id
                    )
                ) {
                    continue;
                }


                existing.add(
                    post.id
                );


                state.candidates.push(
                    item
                );
            }

        } finally {

            state.loadingMore = false;
        }
    }


    // ================================================================
    // RANK
    // ================================================================

    function rankAndRender() {

        if (
            !window.FreeUpperAlgorithm
        ) {

            throw new Error(
                'FreeUpperAlgorithm is not available.'
            );
        }


        state.profile =
            loadAlgorithmProfile();


        const ranked =
            window.FreeUpperAlgorithm
                .rankFeed(
                    state.candidates,
                    state.profile,
                    {
                        limit:
                            CONFIG.DISPLAY_LIMIT
                    }
                );


        state.rankedPosts =
            ranked;


        state.displayedPosts =
            ranked;


        if (
            window.FreeUpperRender
        ) {

            window.FreeUpperRender
                .renderFeed(
                    ranked
                );
        }
    }


    // ================================================================
    // LOAD MORE
    // ================================================================

    async function loadMore() {

        if (
            state.loading ||
            state.loadingMore ||
            !state.hasMore
        ) {

            return;
        }


        await loadCandidates();


        // We want enough candidates to
        // make meaningful ranking decisions.
        if (
            state.candidates.length <
            CONFIG.DISPLAY_LIMIT
        ) {

            return;
        }


        rankAndRender();
    }


    // ================================================================
    // INTERACTION REFRESH
    // ================================================================

    function rerank() {

        state.profile =
            loadAlgorithmProfile();


        rankAndRender();
    }


    // ================================================================
    // REGISTER POST INTERACTION
    // ================================================================

    function recordInteraction(
        post,
        action
    ) {

        if (
            !window.FreeUpperAlgorithm
        ) {
            return;
        }


        state.profile =
            window.FreeUpperAlgorithm
                .recordFeedInteraction(
                    state.profile,
                    post,
                    action
                );


        saveAlgorithmProfile(
            state.profile
        );
    }


    // ================================================================
    // LOCAL PROFILE SAVE
    // ================================================================

    function saveAlgorithmProfile(
        profile
    ) {

        try {

            const serialized = {

                ...profile,

                followingIds:
                    Array.from(
                        profile.followingIds ||
                        []
                    ),

                seenPostIds:
                    Array.from(
                        profile.seenPostIds ||
                        []
                    ),

                hiddenPostIds:
                    Array.from(
                        profile.hiddenPostIds ||
                        []
                    ),

                notInterestedPostIds:
                    Array.from(
                        profile.notInterestedPostIds ||
                        []
                    ),

                likedCreators:
                    Array.from(
                        profile.likedCreators ||
                        []
                    ),

                viewedCreators:
                    Array.from(
                        profile.viewedCreators ||
                        []
                    )
            };


            localStorage.setItem(
                'freeupper_algorithm_profile',
                JSON.stringify(
                    serialized
                )
            );

        } catch (error) {

            console.warn(
                'Could not save algorithm profile:',
                error
            );
        }
    }


    // ================================================================
    // INFINITE SCROLL
    // ================================================================

    let infiniteObserver = null;


    function setupInfiniteScroll() {

        const sentinel =
            document.querySelector(
                '[data-feed-sentinel]'
            );


        if (!sentinel) {
            return;
        }


        if (
            typeof IntersectionObserver ===
            'undefined'
        ) {
            return;
        }


        if (
            infiniteObserver
        ) {

            infiniteObserver.disconnect();
        }


        infiniteObserver =
            new IntersectionObserver(
                entries => {

                    for (
                        const entry
                        of entries
                    ) {

                        if (
                            entry.isIntersecting
                        ) {

                            loadMore();

                            break;
                        }
                    }

                },
                {
                    rootMargin:
                        '800px'
                }
            );


        infiniteObserver.observe(
            sentinel
        );
    }


    // ================================================================
    // CHANGE SOURCE
    // ================================================================

    async function setSource(
        source
    ) {

        if (
            source !== null &&
            source !== 'composer' &&
            source !== 'studio'
        ) {

            source = null;
        }


        state.currentSource =
            source;


        await refresh();
    }


    // ================================================================
    // GET STATE
    // ================================================================

    function getState() {

        return {

            ...state,

            candidates:
                [...state.candidates],

            rankedPosts:
                [...state.rankedPosts],

            displayedPosts:
                [...state.displayedPosts]
        };
    }


    // ================================================================
    // PUBLIC API
    // ================================================================

    window.FreeUpperFeed = {

        init,

        refresh,

        loadMore,

        rerank,

        setSource,

        recordInteraction,

        getState
    };

})();
