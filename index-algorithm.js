// =====================================================================
// index-algorithm.js
// FreeUpper Ranking Engine — v5.0.0
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
// v5.0.0 CHANGES FROM v4.0.0
// -----------------------------------------------------------------
//   - TAXONOMY expanded from 15 to 36 global categories
//   - KEYWORD_MAP is now two-tier per topic: { strong: [...], phrases: [...] }
//       strong   -> word-boundary matched, safe as standalone signals
//       phrases  -> exact substring matched, only safe as compound phrases
//     (this is what keeps e.g. "Nigeria won the match" out of
//     culture_language, while "Nigerian culture" still matches it)
//   - inferTopicsFromText normalizes hyphens/underscores/apostrophes
//     before matching, so "side-hustle" / "side_hustle" / "side hustle"
//     all resolve the same way
//   - profile.interests entries are now objects: { sources: [...], strength }
//     instead of bare numbers. sources tracks whether a topic came from
//     onboarding, behavior, or both; strength (0-1) is the actual ranking
//     value. Old flat-number entries from before this change are still
//     read correctly (see normalizeInterestEntry) — no data migration
//     required.
//
// DEPENDENCIES: none. Pure functions + one small internal state object.
// It does not touch window.sb directly — index-feed.js / index.html
// will pass in the profile and persist any changes.
//
// =====================================================================

(function () {
  'use strict';

  // ===================================================================
  // 1. TOPIC TAXONOMY (36-category global taxonomy)
  // ===================================================================
  const TAXONOMY = [
    'comedy', 'music', 'dance', 'movies_tv', 'gaming', 'esports', 'sports',
    'politics', 'news_current_events', 'fashion_beauty', 'food_drink',
    'food_culture', 'travel', 'lifestyle', 'relationships', 'family_parenting',
    'health_fitness', 'education', 'science_technology', 'business_finance',
    'careers_jobs', 'art_creativity', 'diy_crafts', 'automotive',
    'pets_animals', 'religion_spirituality', 'self_improvement',
    'culture_language', 'history', 'books_writing', 'photography',
    'nature_outdoors', 'home_garden', 'shopping_products',
    'celebrity_pop_culture', 'podcasts'
  ];

  // ===================================================================
  // 2. KEYWORD -> TOPIC MAP (Layer 1/2 content understanding)
  // ===================================================================
  // Two tiers per topic:
  //   strong   - reliable on their own (word-boundary matched)
  //   phrases  - only reliable as a compound phrase (substring matched)
  // Deliberate rule: no bare country/demonym names anywhere in this map.
  // "Nigeria", "Korean", "American" etc. are too ambiguous standalone —
  // they only count when part of an explicit phrase (see culture_language).
  // ===================================================================
  const KEYWORD_MAP = {
    comedy: { strong: ['comedy', 'skit', 'funny', 'lol', 'meme', 'joke', 'prank', 'hilarious', 'standup', 'satire', 'parody', 'roast'] },
    music: { strong: ['music', 'song', 'album', 'singer', 'rapper', 'producer', 'afrobeats', 'amapiano', 'hip hop', 'r&b', 'reggae', 'dancehall', 'gospel music', 'k pop', 'jazz', 'lyrics', 'remix', 'concert', 'dj'] },
    dance: { strong: ['dance', 'dancing', 'choreography', 'dancer', 'dance challenge'] },
    movies_tv: { strong: ['movie', 'film', 'cinema', 'netflix', 'trailer', 'actor', 'actress', 'nollywood', 'hollywood', 'bollywood', 'anime', 'manga', 'documentary', 'tv series'], phrases: ['tv show'] },
    gaming: { strong: ['gaming', 'gamer', 'ps5', 'ps4', 'xbox', 'playstation', 'nintendo', 'fortnite', 'valorant', 'minecraft', 'roblox', 'fifa', 'efootball'], phrases: ['call of duty'] },
    esports: { strong: ['esports', 'esport', 'pro gamer'], phrases: ['gaming tournament'] },
    sports: { strong: ['football', 'soccer', 'messi', 'ronaldo', 'arsenal', 'chelsea', 'liverpool', 'basketball', 'nba', 'wnba', 'lebron', 'tennis', 'wimbledon', 'boxing', 'mma', 'ufc', 'athletics', 'cricket', 'rugby', 'golf', 'volleyball', 'baseball'], phrases: ['premier league', 'la liga', 'champions league', 'formula 1'] },
    politics: { strong: ['politics', 'political', 'election', 'elections', 'president', 'presidential', 'parliament', 'senate', 'senator', 'congress', 'government', 'democracy', 'politician', 'campaign', 'ballot', 'voting', 'legislation', 'governor', 'mayor', 'minister', 'prime minister', 'candidate', 'opposition'], phrases: ['general election', 'political debate', 'voter registration'] },
    news_current_events: { strong: ['headline', 'headlines'], phrases: ['breaking news', 'current events', 'news update'] },
    fashion_beauty: { strong: ['fashion', 'outfit', 'style', 'makeup', 'skincare', 'beauty', 'ankara', 'hairstyle', 'nails', 'haircare'], phrases: ['fit check'] },
    food_drink: { strong: ['food', 'recipe', 'cooking', 'chef', 'jollof', 'amala', 'restaurant', 'cocktail', 'coffee', 'wine', 'baking'] },
    food_culture: { strong: ['street food'], phrases: ['food culture', 'traditional cuisine', 'food history', 'tea ceremony'] },
    travel: { strong: ['travel', 'trip', 'vacation', 'flight', 'tourist', 'destination', 'backpacking'], phrases: ['places to visit'] },
    lifestyle: { strong: ['lifestyle', 'vlog', 'routine', 'storytime'], phrases: ['daily life', 'my story', 'get ready with me'] },
    relationships: { strong: ['relationship', 'dating', 'boyfriend', 'girlfriend', 'breakup', 'situationship'], phrases: ['my partner'] },
    family_parenting: { strong: ['parenting', 'toddler', 'newborn', 'mom life', 'dad life'], phrases: ['my kids', 'my family'] },
    health_fitness: { strong: ['gym', 'workout', 'fitness', 'training', 'cardio', 'wellness', 'nutrition', 'mental health'] },
    education: { strong: ['school', 'university', 'exam', 'lecture', 'jamb', 'waec', 'student', 'campus', 'scholarship', 'tutorial'] },
    science_technology: { strong: ['science', 'technology', 'gadget', 'chatgpt', 'programming', 'coding', 'developer', 'software', 'space', 'physics'], phrases: ['artificial intelligence'] },
    business_finance: { strong: ['business', 'finance', 'investing', 'entrepreneur', 'startup', 'stocks', 'crypto', 'side hustle'], phrases: ['personal finance'] },
    careers_jobs: { strong: ['job', 'jobs', 'resume', 'hiring'], phrases: ['job search', 'interview tips'] },
    art_creativity: { strong: ['art', 'painting', 'drawing', 'illustration', 'sketch', 'sculpture', 'design'] },
    diy_crafts: { strong: ['diy', 'craft', 'handmade', 'woodworking'], phrases: ['how to make'] },
    automotive: { strong: ['car', 'cars', 'engine', 'suv', 'motorbike', 'motorcycle'], phrases: ['test drive'] },
    pets_animals: { strong: ['dog', 'cat', 'puppy', 'kitten', 'pet', 'animal', 'wildlife', 'vet'] },
    religion_spirituality: { strong: ['church', 'sermon', 'prayer', 'faith', 'quran', 'bible', 'mosque', 'meditation', 'spirituality', 'diwali', 'eid', 'hanukkah', 'kwanzaa'] },
    self_improvement: { strong: ['motivation', 'discipline', 'mindset', 'productivity', 'habits', 'goals'], phrases: ['self improvement', 'success story'] },
    culture_language: { strong: ['yoruba', 'igbo', 'hausa', 'swahili', 'mandarin', 'owambe', 'heritage', 'folklore', 'diaspora', 'indigenous', 'ancestral'], phrases: ['nigerian culture', 'african culture', 'american culture', 'european culture', 'asian culture', 'latin culture', 'indian culture', 'korean culture', 'japanese culture', 'chinese culture', 'arab culture', 'cultural heritage', 'traditional attire', 'cultural festival'] },
    history: { strong: ['history', 'historical', 'archaeology', 'historic'], phrases: ['world war'] },
    books_writing: { strong: ['book', 'books', 'novel', 'author', 'writing', 'poetry', 'poem'], phrases: ['book review', 'book club'] },
    photography: { strong: ['photography', 'photographer', 'photoshoot'], phrases: ['camera gear'] },
    nature_outdoors: { strong: ['hiking', 'camping', 'nature', 'outdoors', 'forest', 'mountains'], phrases: ['national park'] },
    home_garden: { strong: ['gardening', 'garden', 'houseplants'], phrases: ['home decor', 'interior design'] },
    shopping_products: { strong: ['unboxing', 'haul', 'shopping'], phrases: ['product review'] },
    celebrity_pop_culture: { strong: ['celebrity', 'celeb', 'influencer', 'paparazzi'], phrases: ['pop culture', 'red carpet', 'award show', 'celebrity news', 'celebrity gossip'] },
    podcasts: { strong: ['podcast', 'podcaster'], phrases: ['podcast episode'] }
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
    MAX_INTEREST: 1,
    NEW_TOPIC_SEED: 0.3        // starting strength when behavior discovers a topic with no prior entry
  };

  // ===================================================================
  // 4. INTERNAL SESSION STATE
  // ===================================================================
  const session = {
    seenIds: new Set(),
    recentCreators: []
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
    if (post.reactions && typeof post.reactions.like === 'number') {
      return post.reactions.like;
    }
    return safeNumber(post.likes);
  }

  function getCommentCount(post) {
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
  // 5b. INTEREST ENTRY HELPERS
  // ===================================================================
  // Handles both the current shape ({ sources, strength }) and the
  // legacy flat-number shape from before v5.0.0, so no DB migration
  // is required for existing users.
  // ===================================================================
  function normalizeInterestEntry(entry) {
    if (entry === undefined || entry === null) return { sources: [], strength: 0 };
    if (typeof entry === 'number') return { sources: ['onboarding'], strength: entry };
    return {
      sources: Array.isArray(entry.sources) ? entry.sources : [],
      strength: typeof entry.strength === 'number' ? entry.strength : 0
    };
  }

  function getStrength(interests, topic) {
    return normalizeInterestEntry(interests[topic]).strength;
  }

  // ===================================================================
  // 6. TOPIC INFERENCE
  // ===================================================================
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const _keywordRegexCache = new Map();
  function getKeywordRegex(keyword) {
    if (_keywordRegexCache.has(keyword)) return _keywordRegexCache.get(keyword);
    const re = new RegExp('\\b' + escapeRegex(keyword) + '\\b', 'i');
    _keywordRegexCache.set(keyword, re);
    return re;
  }

  function normalizeText(text) {
    return String(text)
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function inferTopicsFromText(text) {
    if (!text) return [];
    const lower = normalizeText(text);
    const found = [];
    for (const topic in KEYWORD_MAP) {
      const { strong = [], phrases = [] } = KEYWORD_MAP[topic];
      let matched = false;
      for (let i = 0; i < strong.length && !matched; i++) {
        if (getKeywordRegex(strong[i]).test(lower)) matched = true;
      }
      if (!matched) {
        for (let i = 0; i < phrases.length && !matched; i++) {
          if (lower.includes(phrases[i])) matched = true;
        }
      }
      if (matched) found.push(topic);
    }
    return found;
  }

  function getPostTopics(post) {
    if (post._topics) return post._topics;

    const textParts = [
      post.title,
      post.content,
      post.description
    ].filter(Boolean).join(' ');

    let topics = inferTopicsFromText(textParts);

    if (Array.isArray(post.tags)) {
      post.tags.forEach(tag => {
        const clean = String(tag).toLowerCase().replace(/^#/, '').trim();
        if (TAXONOMY.includes(clean) && !topics.includes(clean)) {
          topics.push(clean);
        }
      });
    }

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
    const total = topics.reduce((sum, t) => sum + getStrength(interests, t), 0);
    return total / topics.length;
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
  function scorePost(post, index, windowPosts, interests, creatorScores, hasSignal) {
    if (!post || !post.id) return -Infinity;
    if (post.is_hidden) return -Infinity;

    let score = 0;
    score += freshnessScore(post) * CONFIG.FRESHNESS_WEIGHT;
    score += engagementScore(post);

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
  // 9. RANK
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
  const INTERACTION_WEIGHTS = {
    like: 1,
    unlike: -0.6,
    comment: 1.5,
    share: 2,
    repost: 2,
    bookmark: 1.5,
    watch_complete: 1.2,
    watch_partial: 0.3,
    skip: -0.5,
    hide: -1.5,
    follow_creator: 1.8
  };

  // Mutates nothing in place — returns a new interests object.
  // Every touched topic ends up as { sources, strength }: sources gains
  // 'behavior' the first time real engagement confirms it, strength
  // decays slightly before the new delta is applied so a topic that
  // keeps getting interacted with trends up, and one that stops trends
  // back down over time.
  function updateInterests(existingInterests, post, interactionType) {
    const interests = { ...(existingInterests || {}) };
    const weight = INTERACTION_WEIGHTS[interactionType] || 0;
    if (!weight) return interests;

    const topics = getPostTopics(post);
    if (!topics.length) return interests;

    const delta = weight * CONFIG.LEARNING_RATE;

    topics.forEach(topic => {
      const hadExisting = Object.prototype.hasOwnProperty.call(interests, topic);
      const current = normalizeInterestEntry(interests[topic]);
      const baseStrength = hadExisting ? current.strength : CONFIG.NEW_TOPIC_SEED;
      const decayed = baseStrength * CONFIG.DECAY;
      const nextStrength = clamp(decayed + delta, CONFIG.MIN_INTEREST, CONFIG.MAX_INTEREST);

      const sources = current.sources.includes('behavior')
        ? current.sources
        : [...current.sources, 'behavior'];

      interests[topic] = { sources, strength: nextStrength };
    });

    return interests;
  }

  // ===================================================================
  // 11. CREATOR AFFINITY LEARNING
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

  console.log('✅ FreeUpper Algorithm v5.0.0 loaded — 36-category taxonomy, sourced interest strengths, cold-start-aware.');
})();
