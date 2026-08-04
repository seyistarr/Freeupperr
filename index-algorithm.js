/* =====================================================================
   index-algorithm.js
   FreeUpper For You Feed Ranking Engine
   =====================================================================

   Works with:
      window.PostsAPI
      index-feed.js
      index-interactions.js
      index-render.js

   Supports:
      - Text posts
      - Images
      - Videos
      - Multiple media
      - Reposts
      - Sounds
      - Tags
      - Categories
      - Creator affinity
      - Following
      - Engagement
      - Recency
      - Personalization
      - Seen-post suppression
      - Hidden posts
      - Not-interested posts
      - Diversity
      - Exploration
===================================================================== */

(function () {
    'use strict';

    const CONFIG = {

        // Number of posts the algorithm should finally return.
        DEFAULT_LIMIT: 20,

        // Maximum age before freshness becomes very weak.
        FRESHNESS_HALF_LIFE_HOURS: 30,

        // Don't show same post repeatedly during one session.
        MAX_RECENT_SEEN: 250,

        // Don't let one creator dominate a feed.
        MAX_SAME_CREATOR_IN_WINDOW: 3,

        // Don't let one content type dominate everything.
        MAX_SAME_MEDIA_TYPE_IN_WINDOW: 6,

        // Small exploration percentage.
        EXPLORATION_RATE: 0.12,

        // Number of posts before re-diversification.
        DIVERSITY_WINDOW: 8
    };


    // ================================================================
    // DEFAULT USER PROFILE
    // ================================================================

    function createDefaultProfile() {

        return {

            followingIds: new Set(),

            likedTopics: {},
            viewedTopics: {},
            skippedTopics: {},

            interactedAuthors: {},

            seenPostIds: new Set(),

            hiddenPostIds: new Set(),

            notInterestedPostIds: new Set(),

            likedCreators: new Set(),

            viewedCreators: new Set(),

            preferredMediaTypes: {},

            preferredCategories: {},

            preferredSounds: {},

            preferredTags: {}
        };
    }


    // ================================================================
    // NORMALIZE PROFILE
    // ================================================================

    function normalizeProfile(profile) {

        const base =
            createDefaultProfile();

        profile =
            profile || {};


        function makeSet(value) {

            if (value instanceof Set) {
                return value;
            }

            if (Array.isArray(value)) {
                return new Set(value);
            }

            return new Set();
        }


        return {

            ...base,
            ...profile,

            followingIds:
                makeSet(profile.followingIds),

            seenPostIds:
                makeSet(profile.seenPostIds),

            hiddenPostIds:
                makeSet(profile.hiddenPostIds),

            notInterestedPostIds:
                makeSet(profile.notInterestedPostIds),

            likedCreators:
                makeSet(profile.likedCreators),

            viewedCreators:
                makeSet(profile.viewedCreators),

            likedTopics:
                profile.likedTopics || {},

            viewedTopics:
                profile.viewedTopics || {},

            skippedTopics:
                profile.skippedTopics || {},

            interactedAuthors:
                profile.interactedAuthors || {},

            preferredMediaTypes:
                profile.preferredMediaTypes || {},

            preferredCategories:
                profile.preferredCategories || {},

            preferredSounds:
                profile.preferredSounds || {},

            preferredTags:
                profile.preferredTags || {}
        };
    }


    // ================================================================
    // NORMALIZE POST
    // ================================================================

    function normalizePost(input) {

        const post =
            input?.post || input;

        if (!post) {
            return null;
        }


        const media =
            Array.isArray(post.media)
                ? post.media
                : [];


        let mediaType =
            post.mediaType ||
            media[0]?.type ||
            'text';


        mediaType =
            String(mediaType).toLowerCase();


        if (
            !media.length &&
            (!post.content || !post.description)
        ) {
            mediaType = 'text';
        }


        const tags =
            Array.isArray(post.tags)
                ? post.tags
                : [];


        return {

            ...post,

            id:
                post.id,

            user_id:
                post.user_id,

            timestamp:
                post.timestamp ||
                post.created_at ||
                new Date().toISOString(),

            media,

            mediaType,

            tags,

            category:
                post.category ||
                'General',

            views:
                Number(post.views || 0),

            likes:
                Number(post.likes || 0),

            comments:
                Number(post.comments || 0),

            repostCount:
                Number(post.repostCount || 0),

            bookmarkCount:
                Number(post.bookmarkCount || 0),

            shareCount:
                Number(post.shareCount || 0),

            feedType:
                input?.feedType ||
                'post',

            sortTime:
                input?.sortTime ||
                post.timestamp
        };
    }


    // ================================================================
    // FRESHNESS
    // ================================================================

    function calculateFreshness(post) {

        const created =
            new Date(
                post.timestamp
            ).getTime();


        if (!Number.isFinite(created)) {
            return 0.25;
        }


        const ageMs =
            Math.max(
                0,
                Date.now() - created
            );


        const ageHours =
            ageMs / 3600000;


        const halfLife =
            CONFIG.FRESHNESS_HALF_LIFE_HOURS;


        return Math.pow(
            0.5,
            ageHours / halfLife
        );
    }


    // ================================================================
    // ENGAGEMENT QUALITY
    // ================================================================

    function calculateEngagement(post) {

        const views =
            Math.max(
                1,
                post.views
            );


        const likes =
            post.likes;


        const comments =
            post.comments;


        const reposts =
            post.repostCount;


        const bookmarks =
            post.bookmarkCount;


        const shares =
            post.shareCount;


        const weightedActions =
            (
                likes * 1 +
                comments * 3 +
                reposts * 4 +
                bookmarks * 3 +
                shares * 5
            );


        const rate =
            weightedActions /
            views;


        // Compress extremely high values.
        return Math.min(
            1,
            Math.log1p(
                rate * 100
            ) / Math.log1p(100)
        );
    }


    // ================================================================
    // PERSONAL ENGAGEMENT
    // ================================================================

    function calculatePersonalSignal(
        post,
        profile
    ) {

        let score = 0;


        // ------------------------------------------------------------
        // Following
        // ------------------------------------------------------------

        if (
            profile.followingIds.has(
                post.user_id
            )
        ) {

            score += 0.25;
        }


        // ------------------------------------------------------------
        // Creator affinity
        // ------------------------------------------------------------

        const author =
            profile.interactedAuthors[
                post.user_id
            ];


        if (author) {

            const positive =
                Number(
                    author.likes || 0
                ) +
                Number(
                    author.comments || 0
                ) * 2 +
                Number(
                    author.reposts || 0
                ) * 2 +
                Number(
                    author.shares || 0
                ) * 3 +
                Number(
                    author.views || 0
                ) * 0.1;


            const negative =
                Number(
                    author.skips || 0
                ) * 2;


            score += Math.min(
                0.4,
                Math.max(
                    -0.3,
                    (positive - negative) /
                    30
                )
            );
        }


        // ------------------------------------------------------------
        // Category
        // ------------------------------------------------------------

        const category =
            String(
                post.category ||
                'General'
            ).toLowerCase();


        score += Math.min(
            0.15,
            Number(
                profile.preferredCategories[
                    category
                ] || 0
            ) * 0.02
        );


        // ------------------------------------------------------------
        // Media type
        // ------------------------------------------------------------

        score += Math.min(
            0.12,
            Number(
                profile.preferredMediaTypes[
                    post.mediaType
                ] || 0
            ) * 0.02
        );


        // ------------------------------------------------------------
        // Tags
        // ------------------------------------------------------------

        for (
            const tag
            of post.tags
        ) {

            const clean =
                String(tag)
                    .replace(/^#/, '')
                    .toLowerCase();


            const tagScore =
                Number(
                    profile.preferredTags[
                        clean
                    ] || 0
                );


            score += Math.min(
                0.03,
                tagScore * 0.005
            );
        }


        // ------------------------------------------------------------
        // Sound
        // ------------------------------------------------------------

        if (
            post.sound_id
        ) {

            score += Math.min(
                0.1,
                Number(
                    profile.preferredSounds[
                        post.sound_id
                    ] || 0
                ) * 0.02
            );
        }


        return Math.max(
            -0.5,
            Math.min(
                1,
                score
            )
        );
    }


    // ================================================================
    // CONTENT TYPE QUALITY
    // ================================================================

    function calculateContentTypeScore(
        post
    ) {

        if (
            post.mediaType === 'video'
        ) {

            return 0.08;
        }


        if (
            post.mediaType === 'image'
        ) {

            return 0.04;
        }


        if (
            post.mediaType === 'text'
        ) {

            return 0.03;
        }


        return 0;
    }


    // ================================================================
    // REPOST SIGNAL
    // ================================================================

    function calculateRepostSignal(
        post
    ) {

        if (
            post.feedType !== 'repost'
        ) {
            return 0;
        }


        // Reposts get a boost but should
        // not overwhelm original posts.
        return 0.08;
    }


    // ================================================================
    // AUTHOR QUALITY
    // ================================================================

    function calculateAuthorQuality(
        post
    ) {

        let score = 0;


        if (
            post.profile?.verified ||
            post.profile?.verified_status ===
                'verified'
        ) {

            score += 0.04;
        }


        return score;
    }


    // ================================================================
    // PENALTIES
    // ================================================================

    function calculatePenalties(
        post,
        profile
    ) {

        let penalty = 0;


        if (
            profile.notInterestedPostIds.has(
                post.id
            )
        ) {

            penalty += 10;
        }


        if (
            profile.hiddenPostIds.has(
                post.id
            )
        ) {

            penalty += 10;
        }


        if (
            profile.skippedTopics
        ) {

            const category =
                String(
                    post.category ||
                    ''
                ).toLowerCase();


            penalty += Math.min(
                0.5,
                Number(
                    profile.skippedTopics[
                        category
                    ] || 0
                ) * 0.02
            );
        }


        return penalty;
    }


    // ================================================================
    // SCORE ONE POST
    // ================================================================

    function scorePost(
        input,
        profile
    ) {

        const post =
            normalizePost(input);


        if (!post?.id) {
            return null;
        }


        profile =
            normalizeProfile(
                profile
            );


        const freshness =
            calculateFreshness(
                post
            );


        const engagement =
            calculateEngagement(
                post
            );


        const personal =
            calculatePersonalSignal(
                post,
                profile
            );


        const contentType =
            calculateContentTypeScore(
                post
            );


        const repost =
            calculateRepostSignal(
                post
            );


        const author =
            calculateAuthorQuality(
                post
            );


        const penalty =
            calculatePenalties(
                post,
                profile
            );


        /*
         * Final score.
         *
         * This is intentionally not based only
         * on likes. Watch behavior, recency,
         * creator affinity and engagement quality
         * all matter.
         */

        const score =
            (
                freshness * 0.27 +
                engagement * 0.24 +
                personal * 0.28 +
                contentType * 0.05 +
                repost * 0.04 +
                author * 0.04
            ) - penalty;


        return {

            ...input,

            post,

            score,

            signals: {

                freshness,

                engagement,

                personal,

                contentType,

                repost,

                author,

                penalty
            }
        };
    }


    // ================================================================
    // DIVERSITY
    // ================================================================

    function diversify(
        scored,
        limit
    ) {

        const result = [];

        const creatorCounts =
            new Map();

        const typeCounts =
            new Map();


        const remaining =
            [...scored];


        while (
            remaining.length &&
            result.length < limit
        ) {

            let selectedIndex =
                -1;


            let selectedScore =
                -Infinity;


            for (
                let i = 0;
                i < remaining.length;
                i++
            ) {

                const item =
                    remaining[i];


                const post =
                    item.post;


                const creator =
                    post.user_id ||
                    'unknown';


                const type =
                    post.mediaType ||
                    'text';


                const creatorCount =
                    creatorCounts.get(
                        creator
                    ) || 0;


                const typeCount =
                    typeCounts.get(
                        type
                    ) || 0;


                let diversityPenalty =
                    0;


                if (
                    creatorCount >=
                    CONFIG.MAX_SAME_CREATOR_IN_WINDOW
                ) {

                    diversityPenalty += 0.35;
                }


                if (
                    typeCount >=
                    CONFIG.MAX_SAME_MEDIA_TYPE_IN_WINDOW
                ) {

                    diversityPenalty += 0.12;
                }


                // Avoid repeated content types
                // inside immediate sequence.
                const recent =
                    result.slice(
                        -3
                    );


                if (
                    recent.some(
                        r =>
                            r.post.mediaType ===
                            type
                    )
                ) {

                    diversityPenalty +=
                        0.04;
                }


                const adjusted =
                    item.score -
                    diversityPenalty;


                if (
                    adjusted >
                    selectedScore
                ) {

                    selectedScore =
                        adjusted;

                    selectedIndex =
                        i;
                }
            }


            if (
                selectedIndex === -1
            ) {
                break;
            }


            const selected =
                remaining.splice(
                    selectedIndex,
                    1
                )[0];


            result.push(
                selected
            );


            const creator =
                selected.post.user_id ||
                'unknown';


            const type =
                selected.post.mediaType ||
                'text';


            creatorCounts.set(
                creator,
                (
                    creatorCounts.get(
                        creator
                    ) || 0
                ) + 1
            );


            typeCounts.set(
                type,
                (
                    typeCounts.get(
                        type
                    ) || 0
                ) + 1
            );
        }


        return result;
    }


    // ================================================================
    // MAIN RANK FUNCTION
    // ================================================================

    function rankFeed(
        candidates = [],
        profile = {},
        options = {}
    ) {

        profile =
            normalizeProfile(
                profile
            );


        const limit =
            Number(
                options.limit ||
                CONFIG.DEFAULT_LIMIT
            );


        const allowSeen =
            options.allowSeen === true;


        const scored = [];


        for (
            const input
            of candidates
        ) {

            const post =
                normalizePost(
                    input
                );


            if (!post?.id) {
                continue;
            }


            // --------------------------------------------------------
            // Hard filtering
            // --------------------------------------------------------

            if (
                post.is_hidden === true
            ) {
                continue;
            }


            if (
                profile.hiddenPostIds.has(
                    post.id
                )
            ) {
                continue;
            }


            if (
                profile.notInterestedPostIds.has(
                    post.id
                )
            ) {
                continue;
            }


            if (
                !allowSeen &&
                profile.seenPostIds.has(
                    post.id
                )
            ) {
                continue;
            }


            const result =
                scorePost(
                    input,
                    profile
                );


            if (result) {
                scored.push(
                    result
                );
            }
        }


        // ------------------------------------------------------------
        // Sort by score
        // ------------------------------------------------------------

        scored.sort(
            (a, b) =>
                b.score -
                a.score
        );


        // ------------------------------------------------------------
        // Exploration
        //
        // A small number of lower-ranked posts
        // can be introduced so FreeUpper learns
        // about new creators/content.
        // ------------------------------------------------------------

        const explorationRate =
            Number(
                options.explorationRate ??
                CONFIG.EXPLORATION_RATE
            );


        if (
            explorationRate > 0 &&
            scored.length > limit
        ) {

            const explorationCount =
                Math.max(
                    1,
                    Math.floor(
                        limit *
                        explorationRate
                    )
                );


            const poolStart =
                Math.floor(
                    scored.length * 0.4
                );


            const pool =
                scored.slice(
                    poolStart
                );


            for (
                let i = 0;
                i < explorationCount;
                i++
            ) {

                if (!pool.length) {
                    break;
                }


                const randomIndex =
                    Math.floor(
                        Math.random() *
                        pool.length
                    );


                const randomItem =
                    pool.splice(
                        randomIndex,
                        1
                    )[0];


                if (!randomItem) {
                    continue;
                }


                const currentIndex =
                    scored.indexOf(
                        randomItem
                    );


                if (
                    currentIndex !== -1
                ) {

                    scored.splice(
                        currentIndex,
                        1
                    );
                }


                scored.push(
                    randomItem
                );
            }
        }


        // ------------------------------------------------------------
        // Diversity
        // ------------------------------------------------------------

        const diversified =
            diversify(
                scored,
                limit
            );


        return diversified.map(
            item => ({
                ...item.post,

                _algorithmScore:
                    item.score,

                _algorithmSignals:
                    item.signals,

                _feedType:
                    item.feedType ||
                    item.post.feedType ||
                    'post',

                _sortTime:
                    item.sortTime ||
                    item.post.sortTime
            })
        );
    }


    // ================================================================
    // RECORD INTERACTION
    // ================================================================

    function recordFeedInteraction(
        profile,
        post,
        action
    ) {

        profile =
            normalizeProfile(
                profile
            );


        if (!post) {
            return profile;
        }


        const postId =
            post.id;


        const authorId =
            post.user_id;


        // ------------------------------------------------------------
        // Seen
        // ------------------------------------------------------------

        if (
            action === 'impression' ||
            action === 'view'
        ) {

            profile.seenPostIds.add(
                postId
            );
        }


        // ------------------------------------------------------------
        // Creator stats
        // ------------------------------------------------------------

        if (
            authorId
        ) {

            if (
                !profile.interactedAuthors[
                    authorId
                ]
            ) {

                profile.interactedAuthors[
                    authorId
                ] = {};
            }


            const author =
                profile.interactedAuthors[
                    authorId
                ];


            author[action] =
                Number(
                    author[action] || 0
                ) + 1;


            if (
                action === 'like'
            ) {

                profile.likedCreators.add(
                    authorId
                );
            }


            if (
                action === 'view'
            ) {

                profile.viewedCreators.add(
                    authorId
                );
            }
        }


        // ------------------------------------------------------------
        // Category
        // ------------------------------------------------------------

        const category =
            String(
                post.category ||
                'General'
            ).toLowerCase();


        if (
            action === 'like' ||
            action === 'comment' ||
            action === 'repost' ||
            action === 'share' ||
            action === 'save' ||
            action === 'view' ||
            action === 'complete'
        ) {

            profile.preferredCategories[
                category
            ] =
                Number(
                    profile.preferredCategories[
                        category
                    ] || 0
                ) + 1;
        }


        // ------------------------------------------------------------
        // Media type
        // ------------------------------------------------------------

        const mediaType =
            post.mediaType ||
            'text';


        if (
            action === 'like' ||
            action === 'comment' ||
            action === 'repost' ||
            action === 'share' ||
            action === 'save' ||
            action === 'complete'
        ) {

            profile.preferredMediaTypes[
                mediaType
            ] =
                Number(
                    profile.preferredMediaTypes[
                        mediaType
                    ] || 0
                ) + 1;
        }


        // ------------------------------------------------------------
        // Tags
        // ------------------------------------------------------------

        if (
            Array.isArray(
                post.tags
            )
        ) {

            for (
                const tag
                of post.tags
            ) {

                const clean =
                    String(tag)
                        .replace(/^#/, '')
                        .toLowerCase();


                if (!clean) {
                    continue;
                }


                if (
                    action === 'like' ||
                    action === 'comment' ||
                    action === 'share' ||
                    action === 'repost' ||
                    action === 'save' ||
                    action === 'complete'
                ) {

                    profile.preferredTags[
                        clean
                    ] =
                        Number(
                            profile.preferredTags[
                                clean
                            ] || 0
                        ) + 1;
                }
            }
        }


        // ------------------------------------------------------------
        // Sound
        // ------------------------------------------------------------

        if (
            post.sound_id
        ) {

            if (
                action === 'like' ||
                action === 'complete' ||
                action === 'save'
            ) {

                profile.preferredSounds[
                    post.sound_id
                ] =
                    Number(
                        profile.preferredSounds[
                            post.sound_id
                        ] || 0
                    ) + 1;
            }
        }


        // ------------------------------------------------------------
        // Skip
        // ------------------------------------------------------------

        if (
            action === 'skip'
        ) {

            profile.skippedTopics[
                category
            ] =
                Number(
                    profile.skippedTopics[
                        category
                    ] || 0
                ) + 1;
        }


        // ------------------------------------------------------------
        // Not interested
        // ------------------------------------------------------------

        if (
            action === 'not_interested'
        ) {

            profile.notInterestedPostIds.add(
                postId
            );
        }


        // ------------------------------------------------------------
        // Hide
        // ------------------------------------------------------------

        if (
            action === 'hide'
        ) {

            profile.hiddenPostIds.add(
                postId
            );
        }


        // ------------------------------------------------------------
        // Limit memory
        // ------------------------------------------------------------

        while (
            profile.seenPostIds.size >
            CONFIG.MAX_RECENT_SEEN
        ) {

            const first =
                profile.seenPostIds
                    .values()
                    .next()
                    .value;

            profile.seenPostIds.delete(
                first
            );
        }


        return profile;
    }


    // ================================================================
    // PUBLIC API
    // ================================================================

    window.FreeUpperAlgorithm = {

        rankFeed,

        scorePost,

        recordFeedInteraction,

        normalizeProfile,

        normalizePost,

        calculateFreshness,

        calculateEngagement
    };

})();
