// =====================================================================
// index-algorithm.js
// FreeUpper Ranking Engine — v4.0.0
// =====================================================================
//
// PURPOSE
// -----------------------------------------------------------------
// This file decides the ORDER of posts in the "For You" feed.
//
// It does NOT:
//   - fetch posts from Supabase (posts.js does that)
//   - render HTML (index.html's buildCard/buildPostHTML does that)
//   - handle clicks (index-interactions does that)
//
// It DOES:
//   - infer topics from post text (no category field required)
//   - score posts using freshness + engagement + interest affinity
//   - learn from user behavior over time (likes, comments, shares, watches)
//   - handle brand-new users with zero signal (cold start)
//   - avoid showing too many posts from the same creator in a row
//   - remember what's already been shown (seen penalty)
//
// DEPENDENCIES: none. Pure functions + one small internal state object.
// It does not touch window.sb directly — index-feed.js / index.html
// will pass in the profile and persist any changes.
//
// =====================================================================

(function () {
  'use strict';

  // ===================================================================
  // 1. TOPIC TAXONOMY (your 30-interest list)
  // ===================================================================
  const TAXONOMY = [
    'trending','entertainment','comedy','lifestyle','relationships','motivation','stories',
    'football','basketball','tennis','boxing','other_sports',
    'music','movies','celebrities','gaming','anime',
    'technology','ai','programming','business','entrepreneurship','finance','career','education',
    'fashion','food','travel','fitness','photography','art','african_culture','news',
    'faith','family','personal_dev','community'
  ];

  // ===================================================================
  // 2. KEYWORD → TOPIC MAP (Layer 1/2 content understanding)
  // ===================================================================
  // This is intentionally simple and fast — pure string matching,
  // runs client-side, costs nothing. It's the thing that lets a post
  // with NO category field still get correctly routed to interested
  // users. This can later be swapped for a real NLP/vision model
  // without changing anything downstream.
  // ===================================================================
  const KEYWORD_MAP = {
    football: ['football','soccer','goal','messi','ronaldo','arsenal','chelsea','man utd','man city','liverpool','premier league','la liga','uefa','champions league','epl','naija football'],
    basketball: ['basketball','nba','dunk','lebron','curry','playoffs'],
    tennis: ['tennis','wimbledon','grand slam','djokovic','nadal'],
    boxing: ['boxing','mma','ufc','knockout','fight night','sparring'],
    other_sports: ['athletics','olympics','marathon','cricket','rugby'],
    music: ['music','song','album','beat','afrobeat','amapiano','lyrics','concert','remix','singer','rapper','producer'],
    movies: ['movie','film','netflix','cinema','trailer','tv series','nollywood','hollywood'],
    celebrities: ['celebrity','celeb','famous','red carpet','paparazzi'],
    gaming: ['gaming','gamer','ps5','xbox','fortnite','valorant','call of duty','esports','fifa game'],
    anime: ['anime','manga','naruto','one piece','otaku','waifu'],
    technology: ['tech','gadget','iphone','android','software','app','device','smartphone'],
    ai: ['ai','artificial intelligence','chatgpt','machine learning','llm','openai','gemini'],
    programming: ['code','coding','javascript','python','developer','programming','github','api','frontend','backend'],
    business: ['business','startup','company','market','brand','ceo'],
    entrepreneurship: ['entrepreneur','hustle','founder','side hustle','startup idea'],
    finance: ['finance','money','stocks','crypto','bitcoin','investing','naira','forex','savings'],
    career: ['job','career','interview','resume','cv','hiring','linkedin','promotion'],
    education: ['school','university','exam','lecture','study','jamb','waec','student','campus','lasu','unilag'],
    fashion: ['fashion','outfit','style','makeup','skincare','beauty','ankara','fit check'],
    food: ['food','recipe','cooking','chef','jollof','meal','restaurant','amala'],
    travel: ['travel','trip','vacation','flight','tourist','japa','abroad'],
    fitness: ['gym','workout','fitness','training','abs','cardio'],
    photography: ['photo','camera','photography','photoshoot','lens'],
    art: ['art','drawing','painting','design','creative','artist','sketch'],
    faith: ['god','pray','church','jesus','faith','bible','quran','sermon','worship','ministry'],
    comedy: ['lol','funny','comedy','skit','meme','joke','laugh','hilarious'],
    relationships: ['relationship','love','crush','breakup','dating','marriage','situationship','heartbreak'],
    news: ['breaking','news','politics','government','election','tinubu','senate'],
    african_culture: ['naija','nigeria','africa','culture','tribal','yoruba','igbo','hausa','ankara','owambe'],
    family: ['family','mom','dad','sibling','kids','parent'],
    motivation: ['motivation','inspire','mindset','discipline','grind','success story'],
    lifestyle: ['lifestyle','vlog','daily life','routine','aesthetic'],
    stories: ['storytime','my story','true story','confession'],
    personal_dev: ['self improvement','growth','habits','productivity','journaling'],
    community: ['community','together','support each other','giveback'],
    trending: ['trending','viral','fyp','challenge']
  };

  // ===================================================================
  // 3. TUNABLE WEIGHTS
  // ===================================================================
  const CONFIG = {
    FRESHNESS_WEIGHT: 25,
    LIKE_WEIGHT: 3,
    COMMENT_WEIGHT: 4,
    REPOST_WEIGHT: 3.5,
    SHARE_WEIGHT: 5,
    VIEW_WEIGHT: 1,
    AFFINITY_WEIGHT: 22,       // only applied if user has interest signal
    CREATOR_AFFINITY_WEIGHT: 12,
    SEEN_PENALTY: 9,
    REPEAT_CREATOR_PENALTY: 7, // avoid same creator flooding the feed
    ALREADY_LIKED_PENALTY: 2,
    LEARNING_RATE: 0.08,       // how fast behavior shifts the interest vector
    DECAY: 0.995,              // slow forgetting so old interests don't get stuck forever
    MIN_INTEREST: 0,
    MAX_INTEREST: 1
  };

  // ===================================================================
  // 4. INTERNAL SESSION STATE
  // ===================================================================
  // This lives only in memory for the current page session. The
  // *persisted* interest vector lives on profile.interests (Supabase),
  // and index-feed.js is responsible for loading/saving that — this
  // file just operates on whatever object it's handed.
  // ===================================================================
  const session = {
    seenIds: new Set(),
    recentCreators: []   // rolling window used for repeat-creator penalty
  };

  // ===================================================================
  // 5. HELPERS
  // ===================================================================
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function getLikeCount(post) {
    // Your index.html sometimes reads post.likes, sometimes post.reactions.like
    if (post.reactions && typeof post.reactions.like === 'number') {
      return post.reactions.like;
    }
    return safeNumber(post.likes);
  }

  function getCommentCount(post) {
    // Some places you store an array of comment objects, others a number
    if (Array.isArray(post.comments)) {
      return post.comments.filter(c => c.approved !== false).length;
    }
    return safeNumber(post.comments);
  }

  function ageHours(timestamp) {
    const time = new Date(timestamp || Date.now()).getTime();
    if (!Number.isFinite(time)) return 24;
    return Math.max(0, (Date.now() - time) / (1000 * 60 * 60));
  }

  // ===================================================================
  // 6. TOPIC INFERENCE
  // ===================================================================
  // Combines title + content + description + explicit tags into one
  // blob and matches against KEYWORD_MAP. Explicit tags (if the user
  // did type one) are trusted directly if they match a taxonomy key.
  // ===================================================================
  function inferTopicsFromText(text) {
    if (!text) return [];
    const lower = String(text).toLowerCase();
    const found = [];
    for (const topic in KEYWORD_MAP) {
      const keywords = KEYWORD_MAP[topic];
      for (let i = 0; i < keywords.length; i++) {
        if (lower.includes(keywords[i])) {
          found.push(topic);
          break;
        }
      }
    }
    return found;
  }

  function getPostTopics(post) {
    // Cache on the post object itself so we don't re-run regex matching
    // every time the feed re-sorts (e.g. on realtime updates).
    if (post._topics) return post._topics;

    const textParts = [
      post.title,
      post.content,
      post.description
    ].filter(Boolean).join(' ');

    let topics = inferTopicsFromText(textParts);

    // Trust explicit tags too, if the tag text matches a known topic key
    // or partially matches a taxonomy label.
    if (Array.isArray(post.tags)) {
      post.tags.forEach(tag => {
        const clean = String(tag).toLowerCase().replace(/^#/, '').trim();
        if (TAXONOMY.includes(clean) && !topics.includes(clean)) {
          topics.push(clean);
        }
      });
    }

    // Legacy: if a post still has a category field set to something
    // useful, fold it in too (backward compatible, never required).
    if (post.category && typeof post.category === 'string') {
      const cat = post.category.toLowerCase().trim();
      if (TAXONOMY.includes(cat) && !topics.includes(cat)) {
        topics.push(cat);
      }
    }

    post._topics = topics;
    return topics;
  }

  // ===================================================================
  // 7. SCORING
  // ===================================================================
  function freshnessScore(post) {
    const hours = ageHours(post.timestamp || post.date);
    return 1 / Math.pow(1 + hours / 12, 0.65);
  }

  function engagementScore(post) {
    const likes = getLikeCount(post);
    const comments = getCommentCount(post);
    const reposts = safeNumber(post.repostCount);
    const shares = safeNumber(post.shareCount);
    const views = safeNumber(post.views);

    return (
      Math.log1p(likes) * CONFIG.LIKE_WEIGHT +
      Math.log1p(comments) * CONFIG.COMMENT_WEIGHT +
      Math.log1p(reposts) * CONFIG.REPOST_WEIGHT +
      Math.log1p(shares) * CONFIG.SHARE_WEIGHT +
      Math.log1p(views) * CONFIG.VIEW_WEIGHT
    );
  }

  function affinityScore(post, interests) {
    const topics = getPostTopics(post);
    if (!topics.length) return 0;
    const total = topics.reduce((sum, t) => sum + (interests[t] || 0), 0);
    return total / topics.length; // average interest across matched topics, 0–1
  }

  function creatorAffinityScore(post, creatorScores) {
    if (!post.user_id) return 0;
    return creatorScores.get(post.user_id) || 0;
  }

  function seenPenalty(post) {
    return session.seenIds.has(post.id) ? CONFIG.SEEN_PENALTY : 0;
  }

  function repeatCreatorPenalty(post, index, windowPosts) {
    if (!post.user_id) return 0;
    const nearby = windowPosts.slice(
      Math.max(0, index - 5),
      Math.min(windowPosts.length, index + 5)
    );
    const sameCreatorCount = nearby.filter(p => p.user_id === post.user_id).length;
    return sameCreatorCount > 2 ? CONFIG.REPEAT_CREATOR_PENALTY : 0;
  }

  // ===================================================================
  // 8. MAIN SCORE FUNCTION
  // ===================================================================
  // interests       -> { football: 0.9, music: 0.4, ... } from profile.interests
  // creatorScores   -> Map<userId, number 0-1> built from past interactions
  // hasSignal       -> whether the user has ANY interest/behavior data yet
  // ===================================================================
  function scorePost(post, index, windowPosts, interests, creatorScores, hasSignal) {
    if (!post || !post.id) return -Infinity;
    if (post.is_hidden) return -Infinity;

    let score = 0;
    score += freshnessScore(post) * CONFIG.FRESHNESS_WEIGHT;
    score += engagementScore(post);

    // Cold start: brand-new users with zero interest data and zero
    // interaction history get a purely freshness + engagement feed —
    // NOT a flat/broken affinity multiplier that silently does nothing.
    if (hasSignal) {
      score += affinityScore(post, interests) * CONFIG.AFFINITY_WEIGHT;
      score += creatorAffinityScore(post, creatorScores) * CONFIG.CREATOR_AFFINITY_WEIGHT;
    }

    score -= seenPenalty(post);
    score -= repeatCreatorPenalty(post, index, windowPosts);

    if (post.likedByMe) {
      score -= CONFIG.ALREADY_LIKED_PENALTY;
    }

    return score;
  }

  // ===================================================================
  // 9. RANK — the function index.html / index-feed.js will call
  // ===================================================================
  // posts        -> array of post objects (already loaded from posts.js)
  // profile      -> { interests: {...} } or null/undefined for guests
  // creatorScores-> optional Map<userId, number>, defaults to empty
  // ===================================================================
  function rank(posts, profile, creatorScores) {
    if (!Array.isArray(posts) || !posts.length) return [];

    const interests = (profile && profile.interests) ? profile.interests : {};
    const hasInterestData = Object.keys(interests).length > 0;
    const hasBehaviorData = creatorScores && creatorScores.size > 0;
    const hasSignal = hasInterestData || hasBehaviorData;
    const scores = creatorScores || new Map();

    const scored = posts.map((post, index) => ({
      post,
      score: scorePost(post, index, posts, interests, scores, hasSignal)
    })).filter(entry => entry.score !== -Infinity);

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.post.timestamp || 0) - new Date(a.post.timestamp || 0);
    });

    return scored.map(entry => entry.post);
  }

  // ===================================================================
  // 10. BEHAVIORAL LEARNING
  // ===================================================================
  // Call this whenever the user does something meaningful with a post.
  // It mutates and RETURNS a new interests object — it does NOT write
  // to Supabase itself. index-interactions.js / index-feed.js decides
  // when/how to persist it (e.g. debounced).
  // ===================================================================
  const INTERACTION_WEIGHTS = {
    like: 1,
    unlike: -0.6,
    comment: 1.5,
    share: 2,
    repost: 2,
    bookmark: 1.5,
    watch_complete: 1.2,   // finished watching a video
    watch_partial: 0.3,    // watched some of it
    skip: -0.5,            // scrolled past very fast
    hide: -1.5,             // "not interested"
    follow_creator: 1.8
  };

  function updateInterests(existingInterests, post, interactionType) {
    const interests = { ...(existingInterests || {}) };
    const weight = INTERACTION_WEIGHTS[interactionType] || 0;
    if (!weight) return interests;

    const topics = getPostTopics(post);
    if (!topics.length) return interests;

    const delta = weight * CONFIG.LEARNING_RATE;

    topics.forEach(topic => {
      const current = interests[topic] !== undefined ? interests[topic] : 0.3;
      const decayed = current * CONFIG.DECAY;
      interests[topic] = clamp(decayed + delta, CONFIG.MIN_INTEREST, CONFIG.MAX_INTEREST);
    });

    return interests;
  }

  // ===================================================================
  // 11. CREATOR AFFINITY LEARNING
  // ===================================================================
  // Tracks how much the user engages with specific creators, separate
  // from topic-level interest. Kept in-memory per session; index-feed.js
  // can persist this too if you want it to survive reloads.
  // ===================================================================
  function updateCreatorScore(creatorScores, userId, interactionType) {
    if (!userId) return creatorScores;
    const map = creatorScores || new Map();
    const weight = INTERACTION_WEIGHTS[interactionType] || 0;
    if (!weight) return map;

    const current = map.get(userId) || 0;
    const next = clamp(current * CONFIG.DECAY + weight * CONFIG.LEARNING_RATE, 0, 1);
    map.set(userId, next);
    return map;
  }

  // ===================================================================
  // 12. SEEN TRACKING
  // ===================================================================
  function markSeen(postId) {
    if (!postId) return;
    session.seenIds.add(postId);
    if (session.seenIds.size > 3000) {
      const first = session.seenIds.values().next().value;
      session.seenIds.delete(first);
    }
  }

  function markManySeen(ids) {
    (ids || []).forEach(markSeen);
  }

  function hasSeen(postId) {
    return session.seenIds.has(postId);
  }

  function resetSeen() {
    session.seenIds.clear();
  }

  // ===================================================================
  // 13. UTILITY — inspect why a post scored the way it did
  // ===================================================================
  // Useful for debugging in console: FreeUpperAlgorithm.explain(post, profile)
  // ===================================================================
  function explain(post, profile, creatorScores) {
    const interests = (profile && profile.interests) ? profile.interests : {};
    const scores = creatorScores || new Map();
    const hasSignal = Object.keys(interests).length > 0 || scores.size > 0;
    return {
      topics: getPostTopics(post),
      freshness: freshnessScore(post) * CONFIG.FRESHNESS_WEIGHT,
      engagement: engagementScore(post),
      affinity: hasSignal ? affinityScore(post, interests) * CONFIG.AFFINITY_WEIGHT : 'cold-start (skipped)',
      creatorAffinity: hasSignal ? creatorAffinityScore(post, scores) * CONFIG.CREATOR_AFFINITY_WEIGHT : 'cold-start (skipped)',
      seenPenalty: seenPenalty(post),
      finalScore: scorePost(post, 0, [post], interests, scores, hasSignal)
    };
  }

  // ===================================================================
  // 14. PUBLIC API
  // ===================================================================
  window.FreeUpperAlgorithm = {
    TAXONOMY,
    rank,
    scorePost,
    getPostTopics,
    inferTopicsFromText,
    updateInterests,
    updateCreatorScore,
    markSeen,
    markManySeen,
    hasSeen,
    resetSeen,
    explain
  };

  console.log('✅ FreeUpper Algorithm v4.0.0 loaded — category-independent, topic-inferring, cold-start-aware.');
})();
