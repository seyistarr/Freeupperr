'use strict';
const galleryMode = document.body.hasAttribute('data-gallery-viewer');
const galleryParams = new URLSearchParams(location.search);
let galleryItems = [];
let galleryPlaybackHold=false;
let galleryPendingRestore=null;
let galleryAccountEpoch=0;


        const SITE_URL = window.location.origin;
        let _curIdx = 0;
        let _toastTimer = null;
        let feedMode = 'foryou';
        const MUTE_PREF_KEY = 'freeupper_video_muted';
        let userMutePreference = localStorage.getItem(MUTE_PREF_KEY) === 'true';
        let _soundBlocked = false;
        let _swallowTap = false;

        function setMutePreference(muted) {
            userMutePreference = muted;
            localStorage.setItem(MUTE_PREF_KEY, muted ? 'true' : 'false');
        }

        let commentSortMode = 'top';
        let _progressHideTimer = {};
        let expandedThreads = new Map();
        let replyTarget = null;
        let currentPostId = null;
        let _shareIdx = 0;
        const preparedVideoShareUrls = new Map();
        let videoPosts = [];
        const retainedVideo = window.FreeUpperScreen?.takeSnapshot();
        let retainedVideoTime = retainedVideo?.currentTime || 0;
        let retainedYouTubeSeek = retainedVideoTime;

        let ytState = {};
        let ytInfo = {};
        let ytWindows = {};


        // ─── CAROUSEL DOTS: sit centered directly beneath the image ───
        function positionImgDots(idx) {
            const wrap = document.getElementById('mediaWrap-' + idx);
            const dots = document.getElementById('imgDots-' + idx);
            const track = document.getElementById('imgTrack-' + idx);
            if (!wrap || !dots || !track) return;
            const slide = track.children[parseInt(track.dataset.idx, 10) || 0];
            if (!slide || !slide.naturalWidth) return;
            const W = wrap.clientWidth, H = wrap.clientHeight;
            const renderedH = Math.min(H, W * slide.naturalHeight / slide.naturalWidth);
            let top = (H + renderedH) / 2 + 12;
            top = Math.min(top, H - 210);
            dots.style.bottom = 'auto';
            dots.style.top = top + 'px';
        }
        window.addEventListener('resize', () => positionImgDots(_curIdx));

        // ─── COMMENT IMAGE UPLOAD ───
        const COMMENT_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
        const COMMENT_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
        let commentMedia = null;

        function handleCommentMediaSelect(input) {
            const file = input.files && input.files[0];
            if (!file) return;
            if (!COMMENT_MEDIA_TYPES.includes(file.type)) {
                showToast(window.fuT('Only JPG, PNG or WebP images'));
                input.value = '';
                return;
            }
            if (file.size > COMMENT_MEDIA_MAX_BYTES) {
                showToast(window.fuT('Image must be under 10MB'));
                input.value = '';
                return;
            }
            if (commentMedia) URL.revokeObjectURL(commentMedia.url);
            commentMedia = { file, url: URL.createObjectURL(file) };
            renderCommentMediaPreview();
        }

        function renderCommentMediaPreview() {
            const box = document.getElementById('commentMediaPreview');
            const img = document.getElementById('commentMediaPreviewImg');
            if (!box || !img) return;
            if (commentMedia) {
                img.src = commentMedia.url;
                box.style.display = 'block';
            } else {
                img.removeAttribute('src');
                box.style.display = 'none';
            }
        }

        function clearCommentMedia() {
            if (commentMedia) URL.revokeObjectURL(commentMedia.url);
            commentMedia = null;
            const input = document.getElementById('commentMediaInput');
            if (input) input.value = '';
            renderCommentMediaPreview();
        }

        function buildCommentMedia(c, cls) {
            if (!c || !c.imageUrl) return '';
            return '<img class="' + cls + '" src="' + escapeHtml(c.imageUrl) +
                '" loading="lazy" alt="" onclick="event.stopPropagation(); openCommentImageViewer(this.currentSrc || this.src)">';
        }

        function openCommentImageViewer(url) {
            const nodes = document.querySelectorAll('#comments-list .comment-media, #comments-list .reply-media');
            const urls = [];
            nodes.forEach(n => {
                const u = n.currentSrc || n.src;
                if (u && !urls.includes(u)) urls.push(u);
            });
            if (!urls.includes(url)) urls.unshift(url);

            const viewer = document.getElementById('commentImageViewer');
            const track = document.getElementById('civTrack');
            track.innerHTML = urls.map(u =>
                '<div class="civ-slide" onclick="if(event.target===this)closeCommentImageViewer()">' +
                '<img src="' + escapeHtml(u) + '" alt="" draggable="false"></div>'
            ).join('');
            viewer.classList.toggle('multi', urls.length > 1);
            viewer.classList.add('show');
            const start = urls.indexOf(url);
            requestAnimationFrame(() => {
                track.scrollLeft = start * track.clientWidth;
                updateCivCount();
            });
        }

        function updateCivCount() {
            const track = document.getElementById('civTrack');
            const el = document.getElementById('civCount');
            if (!track || !el) return;
            const total = track.children.length;
            const i = Math.round(track.scrollLeft / (track.clientWidth || 1)) + 1;
            el.textContent = total > 1 ? (i + ' / ' + total) : '';
        }

        function civStep(dir) {
            const track = document.getElementById('civTrack');
            track.scrollBy({ left: dir * track.clientWidth, behavior: 'smooth' });
        }

        function closeCommentImageViewer() {
            document.getElementById('commentImageViewer').classList.remove('show');
        }

        document.addEventListener('keydown', function(e) {
            const viewer = document.getElementById('commentImageViewer');
            if (!viewer || !viewer.classList.contains('show')) return;
            if (e.key === 'Escape') closeCommentImageViewer();
            if (e.key === 'ArrowRight') civStep(1);
            if (e.key === 'ArrowLeft') civStep(-1);
        });

        function isSplitLayout() {
            return window.matchMedia('(min-width: 768px)').matches;
        }

        // ─── FOLLOW / BOOKMARK STATE ────────────────────────────────
        let followingSet = new Set();
        let bookmarksSet = new Set();

        async function loadFollows() {
            const user = getCurrentUser();
            if (!user || !user.isLoggedIn) { followingSet = new Set(); return; }
            try {
                const { data, error } = await window.sb.from('follows').select('following_id').eq('follower_id', user.id);
                if (!error) followingSet = new Set(data.map(f => f.following_id));
            } catch (e) { console.warn('loadFollows error:', e); }
        }

        async function loadBookmarks() {
            const user = getCurrentUser();
            if (!user || !user.isLoggedIn) { bookmarksSet = new Set(); return; }
            try {
                const { data, error } = await window.sb.from('bookmarks').select('post_id').eq('user_id', user.id);
                if (!error) bookmarksSet = new Set(data.map(b => b.post_id));
            } catch (e) { console.warn('loadBookmarks error:', e); }
        }

        function isFollowing(userId) { return followingSet.has(userId); }
        function isBookmarked(postId) { return bookmarksSet.has(postId); }

        // ─── HELPERS ──────────────────────────────────────────────────

        function showToast(msg) {
            const el = document.getElementById('toast');
            el.textContent = msg;
            el.classList.add('show');
            clearTimeout(_toastTimer);
            _toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
        }

        function openStudio() {
            (window.FreeUpperScreen?.navigationWindow || window).location.href = 'studio.html';
        }

        function fmtNum(n) {
            if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
            if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
            return String(n);
        }

        function hashify(text) {
            if (window.Hashtags && typeof window.Hashtags.hashifyHtml === 'function') {
                return window.Hashtags.hashifyHtml(escapeHtml(text));
            }
            return escapeHtml(text).replace(/#(\w+)/g, '<span class="hashtag-link">#$1</span>');
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        }

        function formatRelativeTime(iso) {
            const parsed = window.FreeUpperTime.parseTimestamp(iso);
            if (!parsed) return '';
            const d = parsed;
            const diff = Date.now() - d;
            const m = Math.floor(diff / 60000);
            if (m < 1) return 'Just now';
            if (m < 60) return m + 'm';
            const h = Math.floor(m / 60);
            if (h < 24) return h + 'h';
            const day = Math.floor(h / 24);
            if (day < 7) return day + 'd';
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        function getCurrentUser() {
            if (window.AuthUser && typeof window.AuthUser.getCurrentUser === 'function') {
                return window.AuthUser.getCurrentUser();
            }
            if (typeof window.getCurrentUser === 'function') {
                return window.getCurrentUser();
            }
            return { id: 'guest', isLoggedIn: false, displayName: 'Guest', avatar: '' };
        }

        function goToProfile(userId) {
            if (!userId) return;
            window.Router.openProfile(userId);
        }

        function openSoundPage(idx) {
            if(galleryMode){window.GallerySession?.sound(videoPosts[idx]?.soundId);return;}
            const v = videoPosts[idx];
            if (!v) return;
            if (!v.soundId) return;
            if (window.VideoRender) {
                VideoRender.openSoundPage(v.soundId);
            } else {
                (window.FreeUpperScreen?.navigationWindow || window).location.href = 'sound.html?id=' + encodeURIComponent(v.soundId);
            }
        }

        function renderCaptionWithMentionsAndTags(text, mentions) {
            if (!text) return '';
            let html = escapeHtml(text);
            if (window.Mentions && typeof window.Mentions.renderMentions === 'function') {
                html = window.Mentions.renderMentions(html, mentions || []);
            }
            html = hashify(html);
            return html;
        }

        // ─── YOUTUBE HELPERS ────────────────────────────────────────
        function ytPostMessage(idx, func, args) {
            args = args || [];
            const iframe = document.getElementById('yt-' + idx);
            if (!iframe || !iframe.contentWindow) return;
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
        }

        function _showYtPauseIcon(idx, isPlaying) {
            const icon = document.getElementById('pauseIcon-' + idx);
            if (!icon) return;
            icon.querySelector('svg').innerHTML = isPlaying ?
                '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>' :
                '<polygon points="5 3 19 12 5 21 5 3"/>';
            _showPauseIcon(icon);
        }

        function initYtListener(idx) {
            const iframe = document.getElementById('yt-' + idx);
            if (!iframe || !iframe.contentWindow) return;
            ytWindows[idx] = iframe.contentWindow;
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'yt-' + idx }), '*');
        }

        function updateYtProgressUI(idx, currentTime, duration) {
            if (!duration) return;
            const pct = (currentTime / duration) * 100;
            const fill = document.getElementById('progFill-' + idx);
            const thumb = document.getElementById('progThumb-' + idx);
            if (fill) fill.style.width = pct + '%';
            if (thumb) thumb.style.setProperty('--pct', pct + '%');
        }

        function toggleYtControls(idx) {
            if (!ytState[idx]) ytState[idx] = { muted: userMutePreference, playing: true };
            const state = ytState[idx];
            if (state.playing) {
                ytPostMessage(idx, 'pauseVideo');
                state.playing = false;
                _showYtPauseIcon(idx, false);
            } else {
                ytPostMessage(idx, 'playVideo');
                state.playing = true;
                _showYtPauseIcon(idx, true);
            }
        }

        window.addEventListener('message', function(event) {
            if (typeof event.data !== 'string') return;
            let data;
            try { data = JSON.parse(event.data); } catch (e) { return; }
            if (!data || data.event !== 'infoDelivery' || !data.info) return;
            let idx = null;
            for (const k in ytWindows) {
                if (ytWindows[k] === event.source) { idx = k; break; }
            }
            if (idx === null) return;
            const info = data.info;
            if(retainedYouTubeSeek>0 && Number(idx)===_curIdx && info.duration>0){ytPostMessage(idx,'seekTo',[retainedYouTubeSeek,true]);retainedYouTubeSeek=0;}
            if (typeof info.currentTime === 'number' && typeof info.duration === 'number' && info.duration > 0) {
                ytInfo[idx] = { currentTime: info.currentTime, duration: info.duration };
                updateYtProgressUI(idx, info.currentTime, info.duration);
            }
        });

        // ─── LOAD VIDEO POSTS ──────────────────────────────────────

        const protectedVideoBlobUrls = new Set();
        let protectedVideoAuthGeneration = 0;
        let protectedVideoReload = false;
        let protectedVideoRefreshPending = false;
        function clearProtectedVideoMedia() {
            protectedVideoAuthGeneration++;
            for (const url of protectedVideoBlobUrls) {
                document.querySelectorAll('video, img').forEach(element => {
                    if (element.src === url) {
                        if (element.tagName === 'VIDEO') element.pause();
                        element.removeAttribute('src');
                        if (element.tagName === 'VIDEO') element.load();
                    }
                });
                window.FreeUpperProtectedMedia?.release(url);
            }
            protectedVideoBlobUrls.clear();
        }
        window.FreeUpperScreen?.register({
            suspend() {
                const video=document.getElementById('vid-'+_curIdx);
                if(video && video.readyState>0)retainedVideoTime=video.currentTime;
                else if(ytInfo[_curIdx]?.currentTime)retainedVideoTime=ytInfo[_curIdx].currentTime;
                document.querySelectorAll('video').forEach(v=>{v.pause();clearInterval(v._progTimer);});
                Object.keys(ytState).forEach(i=>pauseCard(Number(i)));
                window.VideoRender?.stopSoundPlayback?.();
                clearProtectedVideoMedia();
            },
            resume() {
                window.dispatchEvent(new Event('fu-video-resume'));
                queueMicrotask(()=>restoreProtectedVideoCards().catch(()=>{}));
                const video=document.getElementById('vid-'+_curIdx);
                // Pausing normally preserves the native timeline. Re-seeking an
                // already-correct frame is unnecessary and can reset WebKit media.
                if(video && retainedVideoTime && Math.abs(video.currentTime-retainedVideoTime)>0.01)video.currentTime=retainedVideoTime;
                // Playback follows the existing card observer and user controls.
            },
            snapshot() {
                const video=document.getElementById('vid-'+_curIdx);
                return {controls:{},postId:document.getElementById('card-'+_curIdx)?.dataset.postId || videoPosts[_curIdx]?.id,currentTime:video?.currentTime || ytInfo[_curIdx]?.currentTime || retainedVideoTime,feedMode,order:videoPosts.map(v=>v.id)};
            },
            dispose() { clearProtectedVideoMedia(); }
        });
        window.addEventListener('pagehide', clearProtectedVideoMedia);
        window.sb?.auth?.onAuthStateChange?.((event) => {
            if (['SIGNED_OUT', 'USER_UPDATED', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) {
                const hadProtected = protectedVideoBlobUrls.size > 0;
                if(galleryMode && ['SIGNED_OUT','SIGNED_IN','USER_UPDATED'].includes(event)){
                    galleryAccountEpoch++;galleryPlaybackHold=true;
                    document.querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});
                    document.getElementById('feedTrack')?.replaceChildren();videoPosts=[];
                }
                clearProtectedVideoMedia();
                if (hadProtected || galleryMode) setTimeout(refreshProtectedVideoFeed, 0);
            }
        });
        async function refreshProtectedVideoFeed() {
            if (document.hidden || protectedVideoRefreshPending) return;
            protectedVideoRefreshPending = true;
            try { await refreshVideos(true); }
            finally { protectedVideoRefreshPending = false; }
        }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                protectedVideoReload = protectedVideoBlobUrls.size > 0;
                clearProtectedVideoMedia();
            } else if (protectedVideoReload) {
                protectedVideoReload = false;
                refreshProtectedVideoFeed().catch(() => {});
            }
        });
        async function authorizeVideoMedia(videoEntries) {
                const protectedEntries = videoEntries.filter(v => v.protectedAssetId);
                const generation = protectedVideoAuthGeneration;
                await Promise.all(protectedEntries.map(async v => {
                    const resolved = [];
                    try {
                        const client = window.FreeUpperProtectedMedia;
                        if (!client) throw Error('Protected media unavailable');
                        const media = v.postData.media;
                        for (const item of media) {
                            if (!item.protected || !item.assetId) throw Error('Invalid protected media');
                            resolved.push(await client.asset(item.assetId, item.type));
                        }
                        const posterId = media[0]?.thumbnailAssetId;
                        const poster = posterId ? await client.asset(posterId, 'image') : '';
                        if (poster) resolved.push(poster);
                        if (generation !== protectedVideoAuthGeneration) throw Error('Session changed');
                        v.src = resolved[0];
                        v.poster = poster || (v.mediaType === 'image' ? resolved[0] : '');
                        if (v.mediaType === 'image') v.images = resolved.slice(0, media.length);
                        for (const url of resolved) protectedVideoBlobUrls.add(url);
                    } catch (_) {
                        for (const url of resolved) window.FreeUpperProtectedMedia?.release(url);
                        v.src = ''; v.poster = ''; v.images = [];
                    }
                }));
        }
        async function restoreProtectedVideoCards() {
            const entries=videoPosts.filter((v,i)=>(!galleryMode || i===_curIdx) && v.protectedAssetId && !protectedVideoBlobUrls.has(v.src));
            if(!entries.length)return;
            await authorizeVideoMedia(entries);
            if(window.FreeUpperScreen && !window.FreeUpperScreen.isActive()){clearProtectedVideoMedia();return;}
            for(const v of entries){
                const card=document.querySelector('.v-card[data-post-id="'+CSS.escape(String(v.id))+'"]');
                if(!card)continue;
                const index=Number(card.dataset.idx);
                const video=card.querySelector('video');
                if(video){
                    if(v.src){video.src=v.src;video.poster=v.poster;video.addEventListener('loadedmetadata',()=>{if(index===_curIdx)video.currentTime=retainedVideoTime;},{once:true});}
                }else{
                    card.querySelectorAll('.v-media-wrap img').forEach((img,i)=>{if(v.images?.[i])img.src=v.images[i];});
                }
            }
        }
        async function loadVideoPosts() {
            const expectedAccountEpoch=galleryAccountEpoch;
            clearProtectedVideoMedia();
            try {
                const feedItems = galleryMode ? (galleryItems = await window.GalleryAPI.items(galleryParams.get('owner'),galleryParams.get('tab')||'posts')) : await window.PostsAPI.loadFeedWithReposts(0, 20, 'studio');
                const currentUser = getCurrentUser();

                const mapEntryToVideoPost = (entry) => {
                    const post = entry.post;
                    const profile = post.profile || {};
                    const author = window.getAuthorFromProfile(profile);
                    const isOwn = post.user_id === currentUser.id;
                    const isYouTube = post.mediaUrl && (post.mediaUrl.includes('youtube.com/embed') || post.mediaUrl
                        .includes('youtu.be'));
                    const ytId = isYouTube ? post.mediaUrl.match(/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1] ||
                        post.mediaUrl.match(/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] : null;

                    const mediaType = post.mediaType || 'text';
                    const protectedAsset = Array.isArray(post.media)
                        ? post.media.find(m => m.protected && m.assetId &&
                            m.type === mediaType) : null;
                    // Protected assets have no public mediaUrl. Resolve them
                    // only through the authenticated media endpoint below.
                    if (post.protectedMedia && !protectedAsset) return null;

                    // ─── Validate video posts have a real mediaUrl ───
                    const mediaUrl = typeof post.mediaUrl === 'string'
                        ? post.mediaUrl.trim()
                        : '';
                    if (mediaType === 'video' && !mediaUrl && !protectedAsset) {
                        console.warn('[video] Video post has no mediaUrl:', post.id);
                        return null;
                    }

                    let images = null;
                    if (mediaType === 'image') {
                        if (Array.isArray(post.media) && post.media.length > 0) {
                            images = post.media.filter(m => m.type !== 'video').map(m => m.url);
                            if (images.length === 0 && post.mediaUrl) images = [post.mediaUrl];
                        } else if (post.mediaUrl) {
                            images = [post.mediaUrl];
                        }
                    }

                    const soundId = post.sound_id || null;
                    const soundTitle =
                        post.sound_title ||
                        post.audio_track ||
                        'Original Audio · ' + author.name;
                    const soundArt = post.sound_art || author.avatar ||
                        'https://api.dicebear.com/7.x/avataaars/svg?seed=' + author.name;

                    const isTextPost = mediaType === 'text';
                    const tagsLine = (post.tags && post.tags.length) ? post.tags.map(t => '#' + t).join(' ') : '';
                    const textBody = isTextPost ? (post.content || post.title || '') : '';
                    let fullCaption;
                    if (isTextPost) {
                        fullCaption = tagsLine;
                    } else {
                        const defaultTitles = ['Video', 'Photo', 'Photo Carousel'];
                        const t = (post.title || '').trim();
                        const c = (post.content || '').trim();
                        const parts = [];
                        if (t && !defaultTitles.includes(t) && t !== c && !c.startsWith(t)) parts.push(t);
                        if (c) parts.push(c);
                        if (tagsLine) parts.push(tagsLine);
                        fullCaption = parts.join('\n');
                    }

                    return {
                        id: post.id,
                        src: protectedAsset ? '' : mediaUrl,
                        protectedAssetId: protectedAsset?.assetId || null,
                        poster: post.thumbnailUrl || (mediaType === 'image' ? mediaUrl : '') || '',
                        creator: author.name,
                        handle: isOwn ? '@' + (currentUser.username || 'me') : '@' + (profile.username || author.name
                            .toLowerCase()),
                        verified: author.verified,
                        avatar: author.avatar,
                        isOwn: isOwn,
                        caption: fullCaption,
                        textBody: textBody,
                        sound: soundTitle,
                        soundImg: soundArt,
                        soundId: soundId,
                        likes: post.likes || 0,
                        comments: post.comments || 0,
                        reposts: post.repostCount || 0,
                        bookmarks: post.bookmarkCount || 0,
                        shares: post.shareCount || 0,
                        liked: post.likedByMe || false,
                        saved: isBookmarked(post.id),
                        following: false,
                        authorId: post.user_id,
                        postData: post,
                        isYouTube: isYouTube,
                        ytId: ytId,
                        mediaType: mediaType,
                        short_code: post.short_code || post.shortCode || null,
                        images: images,
                        textTemplateId: post.textTemplateId || null,
                        timestamp: post.timestamp || post.date || null,
                        profile: post.profile,
                        myRepost: post.myRepost || false,
                        myRepostText: post.myRepostText || '',
                        myRepostTime: post.myRepostTime || null,
                        mentions: post.mentions || [],
                        commentsHidden: post.commentsHidden || false,
                    };
                };

                // A shared post may be absent from the first 20 feed results.
                // Fetch it explicitly, then pass it through the same card mapper.
                const sharedId = new URLSearchParams(window.location.search).get('post');
                if (!galleryMode && sharedId && !feedItems.some(entry => String(entry.post?.id) === sharedId) &&
                    window.PostsAPI?.loadPostById) {
                    try {
                        const sharedPost = await window.PostsAPI.loadPostById(sharedId);
                        if (sharedPost && !sharedPost.is_hidden && !sharedPost.is_deleted) {
                            if (sharedPost.mediaType === 'video' || sharedPost.mediaType === 'image' || sharedPost.mediaType === 'text') {
                                feedItems.unshift({ post: sharedPost });
                            }
                        }
                    } catch (error) {
                        console.warn('Unable to load shared post', error);
                    }
                }
                const videoEntries = feedItems.map(mapEntryToVideoPost).filter(Boolean);
                if (!galleryMode) await authorizeVideoMedia(videoEntries);
                const seen = new Set();
                const deduped = [];
                for (const v of videoEntries) {
                    if (!galleryMode && v.protectedAssetId && !v.src) continue;
                    if (!seen.has(v.id)) {
                        seen.add(v.id);
                        deduped.push(v);
                    }
                }
                return galleryMode && expectedAccountEpoch!==galleryAccountEpoch ? [] : deduped;
            } catch (err) {
                console.error('Failed to load video posts:', err);
                showToast(window.fuT('Error loading videos'));
                return [];
            }
        }

        // ─── SOUND-OWNER HYDRATION (post-render, non-blocking) ─────
        async function hydrateSoundOwnersForCurrentFeed() {
            if (!window.VideoRender || typeof window.VideoRender.getSoundMetaForPost !== 'function') return;

            const cards = Array.from(document.querySelectorAll('.v-card'));
            if (!cards.length) return;

            await Promise.all(cards.map(async (card) => {
                const postId = card.dataset.postId;
                if (!postId) return;

                const v = videoPosts.find(p => String(p.id) === String(postId));
                if (!v || !v.soundId) return;

                try {
                    const soundMeta = await window.VideoRender.getSoundMetaForPost(v.postData || v);
                    if (!soundMeta) return;

                    const ownerAvatar = soundMeta.creatorAvatarUrl || '';
                    if (ownerAvatar) v.soundImg = ownerAvatar;
                    v.sound = soundMeta.creatorHandle
                        ? `${soundMeta.title} · ${soundMeta.creatorHandle}`
                        : soundMeta.title;

                    const discImg = card.querySelector('.v-disc img');
                    if (discImg && ownerAvatar) {
                        discImg.src = ownerAvatar;
                    }

                    const pillLabel = card.querySelector('.v-music-tag .sound-label');
                    if (pillLabel) {
                        pillLabel.textContent = v.sound;
                    }
                } catch (e) {
                    console.warn('Sound owner hydration failed for post', postId, e);
                }
            }));
        }

        // ─── BUILD COMPACT REPOST LABEL ────────────────────────────

        function buildVideoRepostLabel(postId) {
            const ctx = window.PostsAPI.getFeedContext(postId);
            if (!ctx || !ctx.repost) return '';

            const reposters = ctx.repost.items;
            const count = reposters.length;
            const first = reposters[0];
            if (!first) return '';

            let text = count === 1 ?
                `${first.user.display_name} reposted` :
                `${count} people reposted`;

            return `
                <div class="v-repost-compact" onclick="event.stopPropagation(); openRepostersSheet('${postId}')">
                    <img class="rep-avatar" src="${first.user.avatar_url || ''}" alt="${first.user.display_name}"
                         onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${first.user.display_name}'">
                    <span class="rep-text">${text}</span>
                    <svg class="rep-icon" viewBox="0 0 24 24">
                        <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                        <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                    </svg>
                </div>
            `;
        }

        function openRepostersSheet(postId) {
            const ctx = window.PostsAPI.getFeedContext(postId);
            if (!ctx || !ctx.repost) return;
            const items = ctx.repost.items;
            const list = document.getElementById('moreList');
            list.innerHTML = items.map(r => `
                <button class="more-follow-row" onclick="goToProfile('${r.user.id}')">
                    <img class="more-follow-avatar" src="${r.user.avatar_url || ''}" alt="${r.user.display_name}"
                         onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${r.user.display_name}'">
                    <div>
                        <div class="more-row-lbl">${escapeHtml(r.user.display_name)}</div>
                        ${r.comment ? `<div class="more-row-sub">${escapeHtml(r.comment)}</div>` : ''}
                        <div class="more-row-sub" style="font-size:10px;color:var(--muted2);">${formatRelativeTime(r.time)}</div>
                    </div>
                </button>
            `).join('');
            document.getElementById('moreSheet').classList.add('open');
            document.getElementById('backdrop').classList.add('open');
        }

        // ─── FIT VIDEO: portrait videos fill the phone screen ────────
        function fitVideo(vid) {
            if (!vid || !vid.videoWidth || !vid.videoHeight) return;
            vid.classList.toggle('v-fill', vid.videoWidth / vid.videoHeight <= 0.7);
        }
        window.fitVideo = fitVideo;

        // ─── BUILD MEDIA HTML ─────────────────────────────────────────

        function buildMediaHtml(v, i) {
            if (v.mediaType === 'video') {
                const hintHtml = '';
                if (v.isYouTube && v.ytId) {
                    return `
                    <div class="v-media-wrap" id="mediaWrap-${i}">
                        <iframe class="v-yt-iframe" id="yt-${i}" src="https://www.youtube.com/embed/${v.ytId}?autoplay=1&loop=1&playlist=${v.ytId}&mute=${userMutePreference ? 1 : 0}&controls=0&modestbranding=1&rel=0&showinfo=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}" allow="autoplay; encrypted-media" allowfullscreen onload="initYtListener(${i})"></iframe>
                        <div class="v-tap-yt" id="tapYt-${i}" onclick="toggleYtControls(${i})"></div>
                        ${hintHtml}
                        <div class="v-upload-badge" id="uploadBadge-${i}" onclick="event.stopPropagation(); openStudio()">
                            <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </div>
                    </div>`;
                }
                return `
                <div class="v-media-wrap" id="mediaWrap-${i}">
                    <video
                        class="v-video"
                        id="vid-${i}"
                        src="${escapeHtml(galleryMode ? '' : (v.src || ''))}"
                        poster="${escapeHtml(v.poster || '')}"
                        playsinline
                        webkit-playsinline
                        loop
                        preload="${galleryMode ? 'none' : 'metadata'}"
                        disablepictureinpicture
                        disableremoteplayback
                        controlslist="nodownload noplaybackrate noremoteplayback"
                        onloadedmetadata="fitVideo(this)"
                    ></video>
                    ${hintHtml}
                    <div class="v-upload-badge" id="uploadBadge-${i}" onclick="event.stopPropagation(); openStudio()">
                        <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </div>
                    <div class="v-tap" id="tap-${i}" onclick="handleCardTap(event,${i})"></div>
                </div>`;
            }

            if (v.mediaType === 'image') {
                const slides = v.images.map(src => `<img class="v-img-slide" src="${src}" alt="" draggable="false" onload="positionImgDots(${i})">`).join('');
                const dots = v.images.length > 1 ?
                    `<div class="v-img-dots" id="imgDots-${i}">${v.images.map((_, di) => `<div class="dot ${di === 0 ? 'active' : ''}"></div>`).join('')}</div>` :
                    '';
                return `
                <div class="v-media-wrap" id="mediaWrap-${i}">
                    ${dots}
                    <div class="v-img-track" id="imgTrack-${i}" data-count="${v.images.length}" data-idx="0"
                         onpointerdown="imgDragStart(event,${i})">
                        ${slides}
                    </div>
                </div>`;
            }

            const tpl = window.VideoRender ? VideoRender.getTemplate(v.textTemplateId) : { color: '#fff', font: '800', shadow: 'none' };
            const body = v.textBody || '';
            const len = body.length;
            const fs = len <= 40 ? 34 : len <= 90 ? 28 : len <= 150 ? 24 : 20;
            return `
            <div class="v-media-wrap" id="mediaWrap-${i}">
                <canvas class="v-text-card-canvas" id="txcCanvas-${i}" onclick="handleCardTap(event,${i})"
                        style="position:absolute;inset:0;width:100%;height:100%;display:block;"></canvas>
                <div class="v-text-card-overlay" onclick="handleCardTap(event,${i})"
                     style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:90px 56px 170px;">
                    <p style="font-size:${fs}px;font-weight:${tpl.font};color:${tpl.color};text-shadow:${tpl.shadow};line-height:1.35;text-align:center;white-space:pre-wrap;word-break:break-word;max-height:100%;overflow:hidden;">${escapeHtml(body)}</p>
                </div>
            </div>`;
        }

        // ─── BUILD CARD ──────────────────────────────────────────────

        function buildCard(v, i) {
            const profile = v.profile || {};
            const author = window.getAuthorFromProfile(profile);
            const displayName = author.name;
            const shortDisplayName = Array.from(displayName).length > 15 ? Array.from(displayName).slice(0, 15).join('') + '…' : displayName;
            const username = author.username || '';
            const shortUsername = Array.from(username).length > 5 ? Array.from(username).slice(0, 5).join('') + '…' : username;
            const avatar = author.avatar;
            const verifiedStatus = author.verified_status;

            const likeClass = v.liked ? 'v-action-btn liked' : 'v-action-btn';
            const saveClass = v.saved ? 'v-action-btn saved' : 'v-action-btn';
            const captionHtml = renderCaptionWithMentionsAndTags(v.caption, v.mentions || []);
            const timeStr = formatRelativeTime(v.timestamp);
            const mediaHtml = buildMediaHtml(v, i);
            const repostLabel = buildVideoRepostLabel(v.id);

            const isTextPost = v.mediaType === 'text';

            const scrubberHtml = v.mediaType === 'video' ? `
                <div class="v-progress" id="prog-${i}" onpointerdown="startScrub(event,${i})">
                    <div class="v-progress-fill" id="progFill-${i}" style="width:0%"></div>
                    <div class="v-progress-thumb" id="progThumb-${i}"></div>
                </div>
                <button class="v-mute-btn" id="muteBtn-${i}" onclick="event.stopPropagation(); toggleMute(${i})" aria-label="Mute or unmute">${muteIconSvg(userMutePreference)}</button>
            ` : '';

            return `
            <div class="v-card" id="card-${i}" data-idx="${i}" data-post-id="${v.id}" data-author-id="${v.authorId}">
                ${mediaHtml}
                <div
                    class="v-skeleton"
                    id="skel-${i}"
                    style="${isTextPost ? 'display:none;' : ''}"
                >
                    <div class="v-skeleton-pulse"></div>
                </div>
                <div class="v-grad-top"></div>
                <div class="v-grad-bot"></div>
                <div class="v-pause-icon" id="pauseIcon-${i}">
                    <svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                </div>

                <div class="v-actions">
                    <div class="v-action">
                        <button class="${likeClass}" id="likeBtn-${i}" onclick="toggleLike(${i})">
                            <svg id="likeIco-${i}" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                        </button>
                        <span class="v-action-lbl" id="likeCount-${i}">${fmtNum(v.likes)}</span>
                    </div>
                    <div class="v-action">
                        <button class="v-action-btn ${v.commentsHidden ? 'comments-off' : ''}" onclick="openComments(${i})">
                            ${v.commentsHidden
                                ? '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><line x1="3" y1="21" x2="21" y2="3" stroke="#f87171"/></svg>'
                                : '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'
                            }
                        </button>
                        <span class="v-action-lbl" id="commentCountLbl-${i}">${fmtNum(v.comments)}</span>
                    </div>
                    <div class="v-action">
                        <button class="v-action-btn" onclick="openShare(${i})">
                            <svg viewBox="0 0 24 24">
                                <line x1="22" y1="2" x2="11" y2="13"/>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                            </svg>
                        </button>
                        <span class="v-action-lbl" id="shareCount-${i}">${fmtNum(v.shares || 0)}</span>
                    </div>
                    <div class="v-action">
                        <button class="${saveClass}" id="saveBtn-${i}" onclick="toggleSave(${i})">
                            <svg id="saveIco-${i}" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                        </button>
                        <span class="v-action-lbl" id="saveCount-${i}">${fmtNum(v.bookmarks)}</span>
                    </div>
                    <div class="v-action">
                        <button class="v-action-btn" onclick="toggleClearDisplay(${i})">
                            <svg viewBox="0 0 24 24"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                        </button>
                    </div>
                    ${ v.soundId ? `
                    <div class="v-disc-wrap" onclick="event.stopPropagation(); openSoundPage(${i})" title="View sound details">
                        <div class="v-disc">
                            <img src="${v.soundImg || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + v.creator}" alt="sound" onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${v.creator}'">
                        </div>
                        <div class="v-disc-note">
                            <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                        </div>
                    </div>` : '' }
                </div>

                <div class="v-info">
                    ${repostLabel}
                    <div class="v-user-row">
                        <div class="v-avatar-wrap" onclick="event.stopPropagation(); goToProfile('${v.authorId}')">
                            <img
                                data-author-avatar
                                class="v-avatar"
                                src="${avatar}"
                                alt="${displayName}"
                                onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${displayName}'"
                            >
                            <div
                                class="v-plus-badge ${v.isOwn || v.following ? 'hidden' : ''}"
                                id="followDot-${i}"
                                onclick="event.stopPropagation(); toggleFollow(${i})"
                            >+</div>
                        </div>
                        <div class="v-user-meta">
                            <div
                                class="v-creator"
                                onclick="event.stopPropagation(); goToProfile('${v.authorId}')"
                            >
                                <span data-author-name class="v-creator-name" title="${escapeHtml(displayName)}">${escapeHtml(shortDisplayName)}</span>
                                <span data-author-badge-wrapper>
                                    ${window.getVerifiedBadgeHTML
                                        ? window.getVerifiedBadgeHTML(verifiedStatus)
                                        : ''}
                                </span>
                                ${username ? `<span data-author-handle class="v-creator-handle" title="@${escapeHtml(username)}">@${escapeHtml(shortUsername)}</span>` : ''}
                            </div>
                            <div class="v-post-time">${timeStr}</div>
                        </div>
                    </div>
                    ${
                        !isTextPost && captionHtml
                            ? `<div class="v-desc-container">
                                <p
                                    class="v-caption clamped"
                                    id="cap-${i}"
                                    onscroll="handleCaptionScroll(this)"
                                >${captionHtml}</p>
                                <button
                                    class="v-see-more"
                                    id="seeMore-${i}"
                                    onclick="toggleCaption(${i})"
                                 data-i18n=&#115;&#101;&#101;&#32;&#109;&#111;&#114;&#101;>see more</button>
                            </div>`
                            : ''
                    }
                    ${
                        !isTextPost && v.soundId
                            ? `<div
                                class="v-music-tag"
                                onclick="event.stopPropagation(); openSoundPage(${i})"
                                title="View sound details"
                            >
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="white"
                                    stroke-width="2"
                                >
                                    <path d="M9 18V5l12-2v13"/>
                                    <circle cx="6" cy="18" r="3"/>
                                    <circle cx="18" cy="16" r="3"/>
                                </svg>
                                <span class="sound-label">
                                    ${escapeHtml(v.sound)}
                                </span>
                            </div>`
                            : ''
                    }
                </div>

                ${scrubberHtml}
            </div>
            `;
        }

        // ─── BUILD FEED ──────────────────────────────────────────────

        function buildEligibleFeed(mode) {
            if(galleryMode)return videoPosts;
            const isEligible = (v) => {
                if (mode === 'following') {
                    return isFollowing(v.authorId);
                }
                return true;
            };
            const eligible = videoPosts.filter(isEligible);
            const seen = new Set();
            return eligible.filter(v => {
                if (seen.has(v.id)) return false;
                seen.add(v.id);
                return true;
            });
        }

        function startTextCardAnimation(canvas, templateId) {
            let t = Math.random() * 10;

            function frame() {
                if (!canvas.isConnected) return;
                if (window.FreeUpperScreen && !window.FreeUpperScreen.isActive()) {
                    const resume=()=>{window.removeEventListener('fu-video-resume',resume);if(canvas.isConnected)requestAnimationFrame(frame);};
                    window.addEventListener('fu-video-resume',resume,{once:true});return;
                }
                const w = canvas.clientWidth,
                    h = canvas.clientHeight;
                if (canvas.width !== w) canvas.width = w;
                if (canvas.height !== h) canvas.height = h;
                t += 0.02;
                if (window.VideoRender) {
                    VideoRender.drawTemplateBackground(templateId, canvas.getContext('2d'), w, h, t);
                }
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
        }

        let feedObserver=null;
        function buildFeed(list) {
            feedObserver?.disconnect();
            const posts = list || buildEligibleFeed(feedMode);
            const track = document.getElementById('feedTrack');
            const emptyState = document.getElementById('emptyState');
            if (!track || !emptyState) {
                console.error('[video] Feed container not found');
                return;
            }
            if (!posts || posts.length === 0) {
                track.innerHTML = '';
                emptyState.style.display = 'flex';
                return;
            }
            emptyState.style.display = 'none';
            document.querySelectorAll('.v-video').forEach(video => {
                try {
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                } catch (e) {}
            });
            track.innerHTML = '';
            posts.forEach(v => {
                v.following = isFollowing(v.authorId);
            });
            posts.forEach((v, i) => {
                try {
                    const cardHtml = buildCard(v, i);
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = cardHtml.trim();
                    const card = wrapper.firstElementChild;
                    if (!card) {
                        console.error(
                            '[video] buildCard returned no element',
                            v.id
                        );
                        return;
                    }
                    track.appendChild(card);

                    const soundLabelEl = card.querySelector('.sound-label');
                    if (soundLabelEl && window.VideoRender) {
                        VideoRender.hydrateSoundLabel(v.postData || v, soundLabelEl).catch(() => {});
                    }

                    const txcCanvas = card.querySelector('.v-text-card-canvas');
                    if (txcCanvas && window.VideoRender) {
                        startTextCardAnimation(txcCanvas, v.textTemplateId);
                    }
                } catch (err) {
                    console.error(
                        '[video] Failed to build card for post',
                        v && v.id,
                        err
                    );
                }
            });
            const io = feedObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    const idx = parseInt(
                        entry.target.dataset.idx,
                        10
                    );
                    if (Number.isNaN(idx)) return;
                    if (
                        entry.isIntersecting &&
                        entry.intersectionRatio >= 0.6
                    ) {
                        onCardActive(idx);
                    } else {
                        pauseCard(idx);
                    }
                });
            }, {
                threshold: [0, 0.6, 1]
            });
            posts.forEach((_, i) => {
                const card = document.querySelector(
                    '#card-' + i
                );
                if (!card) return;
                card.dataset.idx = i;
                io.observe(card);
            });
            requestAnimationFrame(() => {
                if (posts.length > 0) {
                    onCardActive(_curIdx);
                }
            });
            requestAnimationFrame(() => {
                posts.forEach((_, i) => {
                    const cap = document.getElementById('cap-' + i);
                    const btn = document.getElementById('seeMore-' + i);
                    if (
                        cap &&
                        btn &&
                        cap.scrollHeight > cap.clientHeight + 2
                    ) {
                        btn.style.display = 'inline-block';
                    }
                });
            });
            if (typeof hydrateSoundOwnersForCurrentFeed === 'function') {
                hydrateSoundOwnersForCurrentFeed();
            }
        }

        // ─── PAUSE / ACTIVE / SCRUB / TAP ──────────────────────────

        function pauseCard(idx) {
            const v = videoPosts[idx];
            if (!v) return;
            if (v.mediaType !== 'video') {
                if (window.VideoRender && typeof VideoRender.stopSoundPlayback === 'function') {
                    VideoRender.stopSoundPlayback();
                }
                return;
            }
            if (v.isYouTube) {
                ytPostMessage(idx, 'pauseVideo');
                if (ytState[idx]) ytState[idx].playing = false;
            } else {
                const vid = document.getElementById('vid-' + idx);
                if (vid) vid.pause();
            }
        }

        // WebKit can reset paused, looping media to zero when seeking in an iframe.
        // Disable looping only for the seek, then restore the original behavior.
        function seekGalleryTime(video, time) {
            const target = Math.min(Math.max(0, Number(time) || 0), video.duration || Number(time) || 0);
            if (Math.abs(video.currentTime - target) < .001) return;
            const looping = video.loop;
            const finish = () => {
                video.loop = looping;
                video.removeEventListener('seeked', finish);
                video.removeEventListener('error', finish);
            };
            video.loop = false;
            video.addEventListener('seeked', finish, {once:true});
            video.addEventListener('error', finish, {once:true});
            try { video.currentTime = target; } catch (_) { finish(); }
        }

        async function onCardActive(idx) {
            if(galleryMode && (idx<0 || idx>=videoPosts.length))return;

            if (window.FreeUpperScreen && !window.FreeUpperScreen.isActive()) return;
            if (!galleryMode && idx === _curIdx && idx !== 0) return;
            pauseCard(_curIdx);
            _curIdx = idx;
            const v = videoPosts[idx];
            if (!v) return;
            currentPostId = v.id;
            if(galleryMode && v.soundId && window.GalleryAPI){try{await window.GalleryAPI.ensureSound(v.soundId);}catch(_){v.soundUnavailable=true;}}
            if(_curIdx!==idx)return;

            if(galleryMode){
                galleryParams.set('post',v.id);history.replaceState({...history.state,galleryVideo:v.id},'',location.pathname+'?'+galleryParams);
                parent.postMessage({type:'fu-gallery-post',post:v.id},location.origin);
                document.querySelectorAll('.v-video').forEach((el,i)=>{if(i!==idx){el.pause();el.removeAttribute('src');el.load();}});
                for(const entry of videoPosts){if(entry!==v&&entry.protectedAssetId){for(const url of [entry.src,entry.poster]){protectedVideoBlobUrls.delete(url);window.FreeUpperProtectedMedia?.release(url);}entry.src='';entry.poster='';}}
                if(v.protectedAssetId&&!protectedVideoBlobUrls.has(v.src))await authorizeVideoMedia([v]);
                if(_curIdx!==idx || document.hidden || window.FreeUpperScreen?.isActive?.()===false)return;
                const el=document.getElementById('vid-'+idx);if(el){
                    const pending=galleryPendingRestore?.post===v.id?galleryPendingRestore:null;
                    if(pending)el.preload='metadata';
                    if(el.getAttribute('src')!==v.src)el.src=v.src;
                    el.poster=v.poster;
                    if(pending){const seek=()=>{if(galleryPendingRestore!==pending||_curIdx!==idx)return;seekGalleryTime(el,pending.time);el.muted=pending.muted??userMutePreference;el.pause();galleryPendingRestore=null;};if(el.readyState)seek();else el.addEventListener('loadedmetadata',seek,{once:true});}
                }
                let end=document.getElementById('galleryEnd');if(!end){end=document.createElement('div');end.id='galleryEnd';end.className='gallery-end';document.body.append(end);}end.textContent=idx===videoPosts.length-1?'End of Gallery':'';
            }


            if (isSplitLayout() && document.getElementById('commentSheet').classList.contains('open')) {
                populateComments(idx);
            }

            if (window.PostsAPI && window.PostsAPI.incrementView) {
                window.PostsAPI.incrementView(v.id);
            }

            if (v.mediaType !== 'video') {
                ytState[idx] = null;
                const sk = document.getElementById('skel-' + idx);
                if (sk) sk.style.display = 'none';
                if (window.VideoRender && typeof VideoRender.playSoundForPost === 'function') {
                    VideoRender.playSoundForPost(v.postData || v);
                }
                return;
            }

            ytState[idx] = { muted: v.soundUnavailable || userMutePreference, playing: true };

            if (v.isYouTube) {
                const iframe = document.getElementById('yt-' + idx);
                if (iframe) {
                    const src = iframe.src.split('?')[0];
                    iframe.src = src +
                        '?autoplay=1&loop=1&playlist=' + v.ytId +
                        '&mute=' + (userMutePreference ? '1' : '0') +
                        '&controls=0&modestbranding=1&rel=0&showinfo=0&enablejsapi=1&origin=' +
                        encodeURIComponent(window.location.origin);
                }
                const sk = document.getElementById('skel-' + idx);
                if (sk) sk.style.display = 'none';
                return;
            }

            const vid = document.getElementById('vid-' + idx);
            if (!vid) return;
            const sk = document.getElementById('skel-' + idx);
            if (sk) sk.style.display = 'none';

            vid.muted = v.soundUnavailable || userMutePreference;
            if(galleryMode && galleryPlaybackHold){vid.pause();return;}
            const playPromise = vid.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {
                    vid.muted = true;
                    _soundBlocked = true;
                    vid.play().catch(() => {});
                    updateMuteButtons(true);
                });
            }
            updateMuteButtons(vid.muted);

            if (vid._progTimer) clearInterval(vid._progTimer);
            vid._progTimer = setInterval(() => updateProgress(idx), 250);
            showProgress(idx);
        }

        function updateProgress(idx) {
            const vid = document.getElementById('vid-' + idx);
            if (!vid || !vid.duration) return;
            const pct = (vid.currentTime / vid.duration) * 100;
            const fill = document.getElementById('progFill-' + idx);
            const thumb = document.getElementById('progThumb-' + idx);
            if (fill) fill.style.width = pct + '%';
            if (thumb) thumb.style.setProperty('--pct', pct + '%');
        }

        function hideAllUnmuteHints() {
            document.querySelectorAll('.v-unmute-hint').forEach(function(el) { el.classList.remove('show'); });
        }

        function unmuteCurrentVideo(idx) {
            if(videoPosts[idx]?.soundUnavailable)return;
            setMutePreference(false);
            hideAllUnmuteHints();
            const vid = document.getElementById('vid-' + idx);
            if (!vid) return;
            if(videoPosts[idx]?.soundUnavailable)return;
            vid.muted = false;
            vid.removeAttribute('muted');
            vid.play().catch(err => {
                console.warn('[video] Unmute/play failed:', err);
            });
            showToast(window.fuT('Sound on 🔊'));
        }

        function muteIconSvg(muted) {
            return muted
                ? '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
                : '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
        }

        function updateMuteButtons(muted) {
            document.querySelectorAll('.v-mute-btn').forEach(b => { b.innerHTML = muteIconSvg(muted); });
        }

        function applyMuteToCard(idx, muted) {
            const v = videoPosts[idx];
            if (!v) return;
            if (v.isYouTube) {
                ytPostMessage(idx, muted ? 'mute' : 'unMute');
                if (ytState[idx]) ytState[idx].muted = muted;
                return;
            }
            const vid = document.getElementById('vid-' + idx);
            if (vid) vid.muted = v.soundUnavailable || muted;
        }

        function toggleMute(idx) {
            const v = videoPosts[idx];
            if (!v) return;
            const vid = document.getElementById('vid-' + idx);
            if(v.soundUnavailable){showToast('Sound unavailable');applyMuteToCard(idx,true);return;}
            const currentlyMuted = v.isYouTube ? userMutePreference : (vid ? vid.muted : userMutePreference);
            const next = !currentlyMuted;
            setMutePreference(next);
            _soundBlocked = false;
            applyMuteToCard(idx, next);
            updateMuteButtons(next);
        }

        document.addEventListener('pointerdown', function(e) {
            if (!_soundBlocked || userMutePreference) return;
            if (e.target.closest && e.target.closest('.v-mute-btn')) return;
            _soundBlocked = false;
            _swallowTap = true;
            setTimeout(() => { _swallowTap = false; }, 450);
            applyMuteToCard(_curIdx, false);
            updateMuteButtons(false);
        }, true);

        let _scrubIdx = null;
        let _scrubWasPlaying = false;

        function _pctFromEvent(e, idx) {
            const prog = document.getElementById('prog-' + idx);
            if (!prog) return 0;
            const rect = prog.getBoundingClientRect();
            const clientX = e.clientX !== undefined ? e.clientX :
                (e.touches && e.touches[0] ? e.touches[0].clientX : rect.left);
            return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        }

        function seekToPct(idx, pct) {
            const v = videoPosts[idx];
            if (!v) return;
            if (v.isYouTube) {
                const info = ytInfo[idx];
                if (!info || !info.duration) return;
                const time = pct * info.duration;
                ytPostMessage(idx, 'seekTo', [time, true]);
                updateYtProgressUI(idx, time, info.duration);
            } else {
                const vid = document.getElementById('vid-' + idx);
                if (!vid || !vid.duration) return;
                vid.currentTime = pct * vid.duration;
                updateProgress(idx);
            }
        }

        function startScrub(e, idx) {
            e.stopPropagation();
            _scrubIdx = idx;
            showProgress(idx);
            const v = videoPosts[idx];
            if (v && !v.isYouTube) {
                const vid = document.getElementById('vid-' + idx);
                _scrubWasPlaying = vid && !vid.paused;
                if (vid) vid.pause();
            }
            const prog = document.getElementById('prog-' + idx);
            if (prog && prog.setPointerCapture && e.pointerId !== undefined) {
                try { prog.setPointerCapture(e.pointerId); } catch (err) {}
            }
            seekToPct(idx, _pctFromEvent(e, idx));
            document.addEventListener('pointermove', onScrubMove);
            document.addEventListener('pointerup', endScrub);
            document.addEventListener('pointercancel', endScrub);
        }

        function onScrubMove(e) {
            if (_scrubIdx === null) return;
            e.preventDefault();
            seekToPct(_scrubIdx, _pctFromEvent(e, _scrubIdx));
        }

        function endScrub(e) {
            if (_scrubIdx === null) return;
            const idx = _scrubIdx;
            const v = videoPosts[idx];
            if (v && !v.isYouTube && _scrubWasPlaying) {
                const vid = document.getElementById('vid-' + idx);
                if (vid) vid.play().catch(() => {});
            }
            _scrubIdx = null;
            document.removeEventListener('pointermove', onScrubMove);
            document.removeEventListener('pointerup', endScrub);
            document.removeEventListener('pointercancel', endScrub);
        }

        let _tapTimer = null;

        function handleCardTap(e, idx) {
            galleryPlaybackHold=false;
            showProgress(idx);
            if (_swallowTap) return;

            if (_tapTimer) {
                clearTimeout(_tapTimer);
                _tapTimer = null;
                const exited = exitClearDisplay();
                if (!exited) spawnCardHeart(e, idx);
                return;
            }
            _tapTimer = setTimeout(() => {
                _tapTimer = null;
                if (videoPosts[idx].mediaType === 'video') pauseToggle(idx);
            }, 220);
        }

        function pauseToggle(idx) {
            const vid = document.getElementById('vid-' + idx);
            const icon = document.getElementById('pauseIcon-' + idx);
            if (!vid) return;
            if (vid.paused) {
                vid.play();
                icon.querySelector('svg').innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
            } else {
                vid.pause();
                icon.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
            }
            _showPauseIcon(icon);
        }

        function _showPauseIcon(icon) {
            icon.classList.remove('hide');
            icon.classList.add('show');
            setTimeout(() => {
                icon.classList.remove('show');
                icon.classList.add('hide');
                setTimeout(() => icon.classList.remove('hide'), 200);
            }, 700);
        }

        function spawnCardHeart(e, idx) {
            if (!videoPosts[idx].liked) toggleLike(idx);
            const card = document.getElementById('card-' + idx);
            const burst = document.createElement('div');
            burst.className = 'heart-burst';
            const rect = card.getBoundingClientRect();
            burst.style.left = (e.clientX - rect.left) + 'px';
            burst.style.top = (e.clientY - rect.top) + 'px';
            burst.innerHTML =
                '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
            card.appendChild(burst);
            setTimeout(() => burst.remove(), 600);
        }

        function showProgress(idx) {
            const prog = document.getElementById('prog-' + idx);
            if (!prog) return;
            prog.classList.add('visible');
            clearTimeout(_progressHideTimer[idx]);
            _progressHideTimer[idx] = setTimeout(() => prog.classList.remove('visible'), 3000);
        }

        // ─── TOGGLE CLEAR DISPLAY ──────────────────────────────────

        let _clearDisplayActive = false;

        function toggleClearDisplay(idx) {
            window.FUSound?.interaction?.('tap');
            _clearDisplayActive = !_clearDisplayActive;
            document.body.classList.toggle('clear-display', _clearDisplayActive);
            if (_clearDisplayActive) showClearDisplayHint(idx);
        }

        function showClearDisplayHint(idx) {
            const card = document.getElementById('card-' + idx);
            if (!card) return;
            let hint = card.querySelector('.clear-display-hint');
            if (!hint) {
                hint = document.createElement('div');
                hint.className = 'clear-display-hint';
                hint.textContent = window.fuT('Double-tap to exit clean view');
                card.appendChild(hint);
            }
            hint.classList.add('show');
            setTimeout(() => hint.classList.remove('show'), 2200);
        }

        function exitClearDisplay() {
            if (!_clearDisplayActive) return false;
            _clearDisplayActive = false;
            document.body.classList.remove('clear-display');
            return true;
        }

        // ─── IMAGE CAROUSEL DRAG ────────────────────────────────────

        let _imgDrag = null;

        function imgDragStart(e, idx) {
            const track = document.getElementById('imgTrack-' + idx);
            if (!track) return;
            const count = parseInt(track.dataset.count, 10);
            if (count <= 1) { handleCardTap(e, idx); return; }
            _imgDrag = {
                idx, track, startX: e.clientX,
                curSlide: parseInt(track.dataset.idx, 10) || 0,
                width: track.parentElement.clientWidth,
                currentX: 0, moved: false
            };
            track.classList.add('dragging');
            track.setPointerCapture?.(e.pointerId);
            track.addEventListener('pointermove', imgDragMove);
            track.addEventListener('pointerup', imgDragEnd);
            track.addEventListener('pointercancel', imgDragEnd);
        }

        function imgDragMove(e) {
            if (!_imgDrag) return;
            const dx = e.clientX - _imgDrag.startX;
            if (Math.abs(dx) > 6) _imgDrag.moved = true;
            _imgDrag.currentX = dx;
            const base = -_imgDrag.curSlide * _imgDrag.width;
            _imgDrag.track.style.transform = `translateX(${base + dx}px)`;
        }

        function imgDragEnd(e) {
            if (!_imgDrag) return;
            const { idx, track, currentX, curSlide, width, moved } = _imgDrag;
            const count = parseInt(track.dataset.count, 10);
            track.classList.remove('dragging');
            track.removeEventListener('pointermove', imgDragMove);
            track.removeEventListener('pointerup', imgDragEnd);
            track.removeEventListener('pointercancel', imgDragEnd);

            let next = curSlide;
            if (Math.abs(currentX) > width * 0.18) {
                next = currentX < 0 ? Math.min(count - 1, curSlide + 1) : Math.max(0, curSlide - 1);
            }
            track.style.transition = 'transform .3s cubic-bezier(.4,0,.2,1)';
            track.style.transform = `translateX(${-next * width}px)`;
            track.dataset.idx = next;
            setTimeout(() => { track.style.transition = ''; }, 320);

            document.querySelectorAll('#imgDots-' + idx + ' .dot').forEach((d, di) => d.classList.toggle('active', di === next));
            positionImgDots(idx);

            if (!moved) handleCardTap(e, idx);
            _imgDrag = null;
        }

        // ─── CAPTION CLAMP / EXPAND ─────────────────────────────────

        function toggleCaption(idx) {
            const cap = document.getElementById('cap-' + idx);
            const btn = document.getElementById('seeMore-' + idx);
            if (!cap || !btn) return;
            if (cap.classList.contains('clamped')) {
                cap.classList.remove('clamped');
                cap.classList.add('expanded');
                btn.textContent = window.fuT('see less');
                requestAnimationFrame(() => handleCaptionScroll(cap));
            } else {
                cap.classList.remove('expanded');
                cap.classList.add('clamped');
                btn.textContent = window.fuT('see more');
                cap.scrollTop = 0;
                cap.style.removeProperty('--fade-top');
                cap.style.removeProperty('--fade-bottom');
            }
        }

        function handleCaptionScroll(el) {
            const topFade = Math.min(24, el.scrollTop);
            const maxScroll = el.scrollHeight - el.clientHeight;
            const distFromBottom = maxScroll - el.scrollTop;
            const bottomFade = maxScroll > 0 ? Math.min(24, distFromBottom) : 0;
            el.style.setProperty('--fade-top', topFade + 'px');
            el.style.setProperty('--fade-bottom', bottomFade + 'px');
        }

        // ─── FEED TAB SWITCHING ─────────────────────────────────────

        function switchFeedTab(mode) {
            if (mode === feedMode) return;
            feedMode = mode;
            document.querySelectorAll('.vt-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
            const filtered = buildEligibleFeed(mode);
            if (filtered.length === 0 && mode === 'following') {
                showToast(window.fuT('No posts from people you follow'));
                const all = buildEligibleFeed('foryou');
                buildFeed(all);
                return;
            }
            buildFeed(filtered);
        }

        // ─── SHARED SHEET LOGIC ─────────────────────────────────────

        function attachSheetDrag(id, wholeSheet) {
            const sheet = document.getElementById(id);
            if (!sheet) return;
            const zones = wholeSheet ? [sheet] :
                [sheet.querySelector('.sheet-handle'), sheet.querySelector('.sheet-hdr')];
            let startY = 0, dy = 0, dragging = false, pid = null;

            zones.forEach(z => {
                if (!z) return;
                z.style.touchAction = 'none';
                z.addEventListener('pointerdown', e => {
                    if (!sheet.classList.contains('open')) return;
                    startY = e.clientY; dy = 0; dragging = true; pid = e.pointerId;
                });
            });

            window.addEventListener('pointermove', e => {
                if (!dragging || e.pointerId !== pid) return;
                dy = Math.max(0, e.clientY - startY);
                if (dy > 6) {
                    sheet.style.transition = 'none';
                    sheet.style.transform = 'translateY(' + dy + 'px)';
                }
            });

            const end = e => {
                if (!dragging || e.pointerId !== pid) return;
                dragging = false;
                if (dy > 6) {
                    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
                    sheet.addEventListener('click', stop, { capture: true, once: true });
                    setTimeout(() => sheet.removeEventListener('click', stop, true), 300);
                }
                sheet.style.transition = '';
                const shouldClose = dy > 100 || dy > sheet.offsetHeight * 0.25;
                if (shouldClose) closeSheet(id);
                sheet.style.transform = '';
                dy = 0;
            };
            window.addEventListener('pointerup', end);
            window.addEventListener('pointercancel', end);
        }

        function openSheet(id) {
            document.getElementById('backdrop').classList.add('open');
            document.getElementById(id).classList.add('open');
            if (id !== 'commentSheet') {
                const v = videoPosts[_curIdx];
                if (v && v.mediaType === 'video' && !v.isYouTube) {
                    const vid = document.getElementById('vid-' + _curIdx);
                    if (vid) vid.pause();
                }
            }
        }

        function closeSheet(id) {
            if (id === 'commentSheet') {
                closeCommentsSheet(_curIdx);
                return;
            }
            document.getElementById(id).classList.remove('open');
            const anyOpen = document.querySelectorAll('.sheet.open:not(.comments-split)').length > 0;
            if (!anyOpen) {
                document.getElementById('backdrop').classList.remove('open');
                const v = videoPosts[_curIdx];
                if (v && v.mediaType === 'video' && !v.isYouTube) {
                    const vid = document.getElementById('vid-' + _curIdx);
                    if (vid) vid.play().catch(() => {});
                }
            }
        }

        function closeAllSheets() {
            if (document.getElementById('commentSheet').classList.contains('open')) {
                closeCommentsSheet(_curIdx);
            }
            document.querySelectorAll('.sheet.open').forEach(s => s.classList.remove('open'));
            document.getElementById('backdrop').classList.remove('open', 'comments-mode');
            const v = videoPosts[_curIdx];
            if (v && v.mediaType === 'video' && !v.isYouTube) {
                const vid = document.getElementById('vid-' + _curIdx);
                if (vid) vid.play().catch(() => {});
            }
        }

        // ─── COMMENT SHEET ─────────────────────────────────────────

        const COMMENTS_PREVIEW_SIZE = 220;
        const COMMENTS_PREVIEW_TOP = 70;

        function openCommentsSheet(idx) {
            const sheet = document.getElementById('commentSheet');

            if (isSplitLayout()) {
                sheet.classList.remove('tiktok-sheet');
                sheet.classList.add('comments-split', 'open');
                document.getElementById('mainScroll').classList.add('split-open');
                setTimeout(() => positionImgDots(idx), 320);
                return;
            }

            sheet.classList.remove('comments-split');
            const card = document.getElementById('card-' + idx);
            const wrap = document.getElementById('mediaWrap-' + idx);
            if (!wrap) return;

            const rect = wrap.getBoundingClientRect();
            wrap.classList.add('comments-shrink-init');
            wrap.style.top = rect.top + 'px';
            wrap.style.left = rect.left + 'px';
            wrap.style.width = rect.width + 'px';
            wrap.style.height = rect.height + 'px';
            void wrap.offsetHeight;

            const targetLeft = (window.innerWidth - COMMENTS_PREVIEW_SIZE) / 2;
            requestAnimationFrame(() => {
                wrap.style.top = COMMENTS_PREVIEW_TOP + 'px';
                wrap.style.left = targetLeft + 'px';
                wrap.style.width = COMMENTS_PREVIEW_SIZE + 'px';
                wrap.style.height = COMMENTS_PREVIEW_SIZE + 'px';
                wrap.style.borderRadius = '16px';
            });

            if (card) card.classList.add('comments-active');
            document.getElementById('backdrop').classList.add('open', 'comments-mode');
            sheet.classList.add('open', 'tiktok-sheet');
        }

        function closeCommentsSheet(idx) {
            const sheet = document.getElementById('commentSheet');

            if (sheet.classList.contains('comments-split')) {
                sheet.classList.remove('open');
                document.getElementById('mainScroll').classList.remove('split-open');
                setTimeout(() => positionImgDots(_curIdx), 320);
                return;
            }

            const targetIdx = (idx !== undefined) ? idx : _curIdx;
            const card = document.getElementById('card-' + targetIdx);
            const wrap = document.getElementById('mediaWrap-' + targetIdx);
            if (wrap) {
                wrap.style.top = '';
                wrap.style.left = '';
                wrap.style.width = '';
                wrap.style.height = '';
                wrap.style.borderRadius = '';
                wrap.classList.remove('comments-shrink-init');
            }
            if (card) card.classList.remove('comments-active');
            sheet.classList.remove('open', 'tiktok-sheet');
            document.getElementById('backdrop').classList.remove('open', 'comments-mode');
        }

        async function loadSimilarPosts(postId) {
            const section = document.getElementById('similarPostsSection');
            const scroll = document.getElementById('similarPostsScroll');
            if (!section || !scroll || !window.PostsAPI || typeof window.PostsAPI.findSimilarPosts !== 'function') return;

            try {
                let similar = await window.PostsAPI.findSimilarPosts(postId, 8);
                similar = (similar || []).filter(p => p.thumbnailUrl || (p.mediaType === 'image' && p.mediaUrl));
                if (!similar || !similar.length) {
                    section.style.display = 'none';
                    return;
                }
                scroll.innerHTML = similar.map(p =>
                    '<div class="similar-post-card" onclick="closeCommentsSheet(); Router && Router.openVideo ? Router.openVideo(\'' +
                    p.id + '\') : ((window.FreeUpperScreen?.navigationWindow || window).location.href=\'/videos?id=' + p.id + '\')">' +
                    '<img src="' + (p.thumbnailUrl || p.mediaUrl || '') + '" alt="" loading="lazy">' +
                    '</div>'
                ).join('');
                section.style.display = 'block';
            } catch (err) {
                console.warn('loadSimilarPosts failed:', err);
                section.style.display = 'none';
            }
        }

        // ─── COMMENTS ───────────────────────────────────────────────

        function renderCommentsHTML(comments, postId, visibleCount) {
            const topLevel = comments.filter(c => c.parentId === null);
            if (topLevel.length === 0) {
                return '<p style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Be the first to comment.</p>';
            }
            const shown = topLevel.slice(0, visibleCount);
            const hidden = topLevel.length - visibleCount;
            let html = shown.map(c => renderCommentThread(c, comments, postId)).join('');
            if (hidden > 0) {
                html += '<button class="view-replies-btn load-more-comments-btn" onclick="loadMoreComments(\'' + postId +
                    '\')">' +
                    'View ' + hidden + ' more comment' + (hidden > 1 ? 's' : '') + ' ⌄' +
                    '</button>';
            }
            return html;
        }

        function renderCommentThread(comment, allComments, postId) {
            const profile = comment.profile || {};
            const author = window.getAuthorFromProfile(profile);
            const username = author.name;
            const avatar = author.avatar;
            const verifiedStatus = author.verified_status;
            const replies = getAllDescendants(comment.id, allComments);
            const total = replies.length;
            const hasReplies = total > 0;
            const expandedCount = expandedThreads.get(comment.id) || 0;
            const post = videoPosts.find(p => p.id === postId);
            const isCreator = post && comment.userId === post.authorId;
            const currentUser = getCurrentUser();
            const isMine = currentUser && currentUser.id === comment.userId;
            const isPostOwner = post && currentUser && post.authorId === currentUser.id;
            const isPinned = !!comment.pinned;
            const edited = !!comment.edited;

            const commentTextHtml = renderCaptionWithMentionsAndTags(comment.message, comment.mentions || []);

            let repliesHtml = '';
            if (hasReplies && expandedCount === 0) {
                repliesHtml = '<button class="view-replies-btn" onclick="expandReplies(\'' + comment.id + '\',\'' + postId +
                    '\')">' +
                    'View ' + total + ' repl' + (total > 1 ? 'ies' : 'y') + ' ⌄' +
                    '</button>';
            } else if (hasReplies) {
                const shownReplies = replies.slice(0, expandedCount);
                const remaining = total - expandedCount;
                repliesHtml = '<div class="replies-thread">' +
                    shownReplies.map(r => renderReplyItem(r, allComments, postId)).join('') +
                    '</div>';
                if (remaining > 0) {
                    repliesHtml += '<button class="view-replies-btn" onclick="expandReplies(\'' + comment.id + '\',\'' +
                        postId + '\')">' +
                        'See ' + remaining + ' more repl' + (remaining > 1 ? 'ies' : 'y') + ' ⌄' +
                        '</button>';
                } else {
                    repliesHtml += '<button class="hide-replies-btn" onclick="collapseReplies(\'' + comment.id + '\',\'' +
                        postId + '\')">' +
                        'Hide replies ⌃' +
                        '</button>';
                }
            }
            const likeCount = comment.likeCount || 0;
            const isLiked = !!comment.likedByMe;
            const avatarHtml = avatar ? '<img src="' + avatar + '" alt="">' : username.charAt(0).toUpperCase();
            const avatarClass = avatar ? 'comment-avatar has-image' : 'comment-avatar';
            const badgeHtml = window.getVerifiedBadgeHTML ? window.getVerifiedBadgeHTML(verifiedStatus) : '';
            const pinnedBadgeHtml = isPinned ? '<span class="comment-pinned-badge">📌 Pinned</span>' : '';
            const editedTagHtml = ''; // Keep edit history internal; do not display an edited badge.

            const showMenu = isMine || isPostOwner || !isMine;

            return '<div class="comment-item" data-comment-id="' + comment.id + '" data-author-id="' + author.id + '">' +
                '<div class="' + avatarClass + '" data-username="' + escapeHtml(username) +
                '" onclick="goToProfile(\'' + author.id + '\')">' + avatarHtml + '</div>' +
                '<div class="comment-body">' +
                '<div class="comment-username-row">' +
                pinnedBadgeHtml +
                (isCreator ? '<span class="creator-lbl">Creator</span>' : '') +
                '<span data-author-name class="comment-username" onclick="goToProfile(\'' + author.id +
                '\')" style="cursor:pointer;">@' + escapeHtml(username) + '</span>' +
                '<span data-author-badge-wrapper>' + badgeHtml + '</span>' +
                '<span class="comment-time">' + formatRelativeTime(comment.edited && comment.updatedAt ? comment.updatedAt : comment.time) + editedTagHtml + '</span>' +
                '</div>' +
                '<div class="comment-text" data-cid="' + comment.id + '" data-edit-message="' + escapeHtml(cleanReplyEditText(comment.message, '')) + '">' + commentTextHtml + '</div>' +
                buildCommentMedia(comment, 'comment-media') +
                '<button class="comment-reply-btn" onclick="replyToComment(\'' + comment.id + '\',\'' + escapeHtml(
                    username) + '\')">Reply</button>' +
                repliesHtml +
                '</div>' +
                '<div class="comment-side-actions">' +
                '<button class="comment-like-btn ' + (isLiked ? 'liked' : '') +
                '" onclick="toggleCommentLikeUI(this, \'' + comment.id + '\')">' +
                '<svg class="like-heart" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                '<span class="like-count">' + (likeCount > 0 ? likeCount : '') + '</span>' +
                '</button>' +
                (showMenu ? '<button class="comment-menu-btn" onclick="openCommentActionsMenu(event, \'' + comment.id +
                    '\', ' + String(isMine) + ', ' + String(isPostOwner) + ', ' + String(isPinned) +
                ')">⋯</button>' : '') +
                '</div>' +
                '</div>';
        }

        function renderReplyItem(reply, allComments, postId) {
            const profile = reply.profile || {};
            const author = window.getAuthorFromProfile(profile);
            const username = author.name;
            const avatar = author.avatar;
            const verifiedStatus = author.verified_status;
            const parent = allComments.find(c => c.id === reply.parentId);
            const parentName = parent ? (window.getAuthorFromProfile(parent.profile || {}).name || '') : '';
            const mention = (parentName && parentName !== username) ?
                '<span style="color:var(--p);font-weight:500;">@' + escapeHtml(parentName) + '</span> ' : '';
            const post = videoPosts.find(p => p.id === postId);
            const isCreator = post && reply.userId === post.authorId;
            const currentUser = getCurrentUser();
            const isMine = currentUser && currentUser.id === reply.userId;
            const isPostOwner = post && currentUser && post.authorId === currentUser.id;
            const edited = !!reply.edited;
            const likeCount = reply.likeCount || 0;
            const isLiked = !!reply.likedByMe;
            const avatarHtml = avatar ? '<img src="' + avatar + '" alt="">' : username.charAt(0).toUpperCase();
            const avatarClass = avatar ? 'reply-avatar-dot has-image' : 'reply-avatar-dot';
            const badgeHtml = window.getVerifiedBadgeHTML ? window.getVerifiedBadgeHTML(verifiedStatus) : '';
            const replyTextHtml = renderCaptionWithMentionsAndTags(cleanReplyEditText(reply.message, parentName), reply.mentions || []);
            const editedTagHtml = ''; // Keep edit history internal; do not display an edited badge.

            return '<div class="reply-item" data-comment-id="' + reply.id + '" data-author-id="' + author.id + '">' +
                '<div class="' + avatarClass + '" data-username="' + escapeHtml(username) +
                '" onclick="goToProfile(\'' + author.id + '\')">' + avatarHtml + '</div>' +
                '<div class="reply-body">' +
                '<div data-author-name class="reply-username" onclick="goToProfile(\'' + author.id +
                '\')" style="cursor:pointer;">' +
                (isCreator ? '<span class="creator-lbl">Creator</span>' : '') +
                '@' + escapeHtml(username) +
                '<span data-author-badge-wrapper>' + badgeHtml + '</span>' +
                '</div>' +
                '<div class="comment-text reply-text" data-cid="' + reply.id + '" data-edit-message="' + escapeHtml(cleanReplyEditText(reply.message, parentName)) + '">' + mention + replyTextHtml + editedTagHtml + '</div>' +
                buildCommentMedia(reply, 'reply-media') +
                '<div class="reply-meta">' +
                '<span class="reply-time">' + formatRelativeTime(reply.edited && reply.updatedAt ? reply.updatedAt : reply.time) + '</span>' +
                '<button class="reply-reply-btn" onclick="replyToComment(\'' + reply.id + '\',\'' + escapeHtml(
                    username) + '\')">Reply</button>' +
                '<button class="reply-like-btn ' + (isLiked ? 'liked' : '') +
                '" onclick="toggleCommentLikeUI(this, \'' + reply.id + '\')">' +
                '<svg class="like-heart" viewBox="0 0 24 24" width="12" height="12"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                '<span class="like-count">' + (likeCount > 0 ? likeCount : '') + '</span>' +
                '</button>' +
                (isMine || isPostOwner ? '<button class="reply-menu-btn" onclick="openCommentActionsMenu(event, \'' +
                    reply.id + '\', ' + String(isMine) + ', ' + String(isPostOwner) + ', false)">⋯</button>' : '') +
                '</div>' +
                '</div>' +
                '</div>';
        }

        function getAllDescendants(pid, comments) {
            const result = [];
            const direct = comments.filter(c => c.parentId === pid);
            for (const c of direct) {
                result.push(c);
                result.push(...getAllDescendants(c.id, comments));
            }
            return result;
        }

        function getCommentsVisible() {
            const cv = localStorage.getItem('freeupper_comments_visible');
            return cv ? JSON.parse(cv) : {};
        }

        function setCommentsVisible(postId, count) {
            const cv = getCommentsVisible();
            cv[postId] = count;
            localStorage.setItem('freeupper_comments_visible', JSON.stringify(cv));
        }

        function getVisibleComments(postId) {
            return getCommentsVisible()[postId] || 5;
        }

        async function addComment(postId, parentId, message, mentions, imageUrl) {
            try {
                const comment = await window.PostsAPI.addComment(postId, parentId, message, mentions || [], imageUrl || '');
                const v = videoPosts.find(p => p.id === postId);
                if (v) v.comments = (v.comments || 0) + 1;
                return comment;
            } catch (err) {
                console.error('addComment error:', err);
                showToast(err.message || 'Failed to post comment', 'r');
                throw err;
            }
        }

        async function refreshCommentsList(postId) {
            const container = document.getElementById('comments-list');
            if (!container) return;

            try {
                const comments = await window.PostsAPI.loadComments(postId);
                const sorted = [...comments].sort((a, b) => {
                    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
                    if (commentSortMode === 'newest') return new Date(b.time) - new Date(a.time);
                    return (b.likeCount || 0) - (a.likeCount || 0);
                });
                const visibleCount = getVisibleComments(postId);
                container.innerHTML = renderCommentsHTML(sorted, postId, visibleCount);
            } catch (err) {
                console.warn('Failed to load comments:', err);
                container.innerHTML =
                    '<p style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Could not load comments.</p>';
            }
        }

        async function toggleCommentLikeUI(btn, commentId) {
            window.FUSound?.interaction?.('like');
            const wasLiked = btn.classList.contains('liked');
            const countEl = btn.querySelector('.like-count');
            let count = parseInt(countEl.textContent || '0') || 0;

            btn.classList.toggle('liked', !wasLiked);
            count = wasLiked ? Math.max(0, count - 1) : count + 1;
            countEl.textContent = count > 0 ? count : '';

            try {
                const result = await window.PostsAPI.toggleCommentLike(commentId);
                btn.classList.toggle('liked', result.liked);
                countEl.textContent = result.count > 0 ? result.count : '';
            } catch (err) {
                btn.classList.toggle('liked', wasLiked);
                countEl.textContent = count === 0 ? '' : (wasLiked ? count + 1 : count - 1) || '';
                showToast(err.message || 'Like failed', 'r');
            }
        }

        function replyToComment(commentId, username) {
            replyTarget = { commentId, username };
            updateReplyContextUI();
            document.getElementById('commentInput').focus();
            document.getElementById('commentInput').placeholder = 'Reply to @' + username + '...';
            showToast('Replying to @' + username);
        }

        function cancelReply() {
            replyTarget = null;
            updateReplyContextUI();
            document.getElementById('commentInput').placeholder = 'Add a comment…';
            document.getElementById('commentInput').value = '';
        }

        function updateReplyContextUI() {
            const banner = document.getElementById('reply-context-banner');
            const usernameEl = document.getElementById('reply-context-username');
            if (replyTarget) {
                banner.classList.add('show');
                usernameEl.textContent = '@' + replyTarget.username;
            } else {
                banner.classList.remove('show');
                usernameEl.textContent = '';
            }
        }

        async function expandReplies(commentId, postId) {
            const current = expandedThreads.get(commentId) || 0;
            const nextCount = current === 0 ? 4 : current + 5;
            expandedThreads.set(commentId, nextCount);
            refreshCommentsList(postId);
        }

        function collapseReplies(commentId, postId) {
            expandedThreads.delete(commentId);
            refreshCommentsList(postId);
        }

        function loadMoreComments(postId) {
            const current = getVisibleComments(postId);
            setCommentsVisible(postId, current + 5);
            refreshCommentsList(postId);
        }

        function toggleSortMenu() {
            let menu = document.getElementById('sortMenuPopover');
            if (menu) { menu.remove(); return; }
            menu = document.createElement('div');
            menu.id = 'sortMenuPopover';
            menu.innerHTML = '' +
                '<button class="sort-option ' + (commentSortMode === 'top' ? 'active' : '') +
                '" data-mode="top">Top comments</button>' +
                '<button class="sort-option ' + (commentSortMode === 'newest' ? 'active' : '') +
                '" data-mode="newest">Newest comments</button>' +
                '';
            document.getElementById('commentSheet').appendChild(menu);
            menu.querySelectorAll('.sort-option').forEach(btn => {
                btn.onclick = () => {
                    commentSortMode = btn.dataset.mode;
                    menu.remove();
                    refreshCommentsList(currentPostId);
                    showToast(commentSortMode === 'top' ? 'Sorted by: Top comments' : 'Sorted by: Newest');
                };
            });
            setTimeout(() => {
                document.addEventListener('pointerdown', function closeMenu(ev) {
                    if (!menu.contains(ev.target)) {
                        menu.remove();
                        document.removeEventListener('pointerdown', closeMenu);
                    }
                }, { capture: true, once: true });
            }, 0);
        }

        function applyCommentBarLockState(isOff) {
            const row = document.querySelector('.comment-inp-row');
            const input = document.getElementById('commentInput');
            const sendBtn = document.getElementById('comment-send');
            if (!row || !input || !sendBtn) return;
            row.classList.toggle('comments-locked', !!isOff);
            input.disabled = !!isOff;
            input.placeholder = isOff ? 'Comments are turned off for this post' : 'Add a comment…';
            if (isOff) input.value = '';
        }

        function openCommentActionsMenu(event, commentId, isMine, isPostOwner, isPinned) {
            event.stopPropagation();
            document.querySelectorAll('.comment-actions-menu, .reply-actions-menu').forEach(m => m.remove());

            const menu = document.createElement('div');
            menu.className = 'comment-actions-menu';

            let buttonsHtml = '';
            if (isMine) {
                buttonsHtml += '<button data-action="edit" data-i18n=&#69;&#100;&#105;&#116;>Edit</button>';
            }
            if (isMine || isPostOwner) {
                buttonsHtml += '<button data-action="delete" class="danger" data-i18n=&#68;&#101;&#108;&#101;&#116;&#101;>Delete</button>';
            }
            if (isPostOwner) {
                buttonsHtml += '<button data-action="pin">' + (isPinned ? 'Unpin' : 'Pin comment') + '</button>';
            }
            if (!isMine) {
                buttonsHtml += '<button data-action="report" class="danger" data-i18n=&#82;&#101;&#112;&#111;&#114;&#116;>Report</button>';
            }
            menu.innerHTML = buttonsHtml;

            document.body.appendChild(menu);
            const rect = event.target.getBoundingClientRect();
            const menuWidth = 170;
            let left = rect.left - menuWidth + rect.width;
            if (left < 8) left = 8;
            if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
            menu.style.left = left + 'px';
            menu.style.top = (rect.bottom + 6) + 'px';

            menu.querySelectorAll('button').forEach(btn => {
                btn.onclick = () => {
                    const action = btn.dataset.action;
                    menu.remove();
                    if (action === 'edit') startEditComment(commentId);
                    else if (action === 'delete') confirmDeleteComment(commentId);
                    else if (action === 'pin') togglePinCommentUI(commentId);
                    else if (action === 'report') reportCommentUI(commentId);
                };
            });

            setTimeout(() => {
                document.addEventListener('pointerdown', function closeMenu(ev) {
                    if (!menu.contains(ev.target)) {
                        menu.remove();
                        document.removeEventListener('pointerdown', closeMenu);
                    }
                }, { capture: true, once: true });
            }, 0);
        }

        function cleanReplyEditText(text, parentName) {
                let value = String(text || '').trim();
                const name = String(parentName || '').replace(/^@/, '').trim();
                if (name) {
                    while (value.toLowerCase().startsWith(('@' + name).toLowerCase()) && (!value[name.length + 1] || /\s/.test(value[name.length + 1]))) {
                        value = value.slice(name.length + 1).trimStart();
                    }
                }
                return value.replace(/(?:\s*\(edited\))+\s*$/gi, '').trim();
            }
            function startEditComment(commentId) {
            const el = document.querySelector('.comment-text[data-cid="' + commentId + '"]') || document.querySelector('.reply-item[data-comment-id="' + commentId + '"] .reply-text');
            if (!el) return;
            const originalHtml = el.innerHTML;
            const originalText = el.getAttribute('data-edit-message') ?? el.textContent.replace(/\s*\(edited\)\s*$/i, '').trim();

            el.innerHTML =
                '<div class="comment-edit-box">' +
                '<textarea rows="2">' + escapeHtml(originalText) + '</textarea>' +
                '<div class="comment-edit-actions">' +
                '<button class="comment-edit-save" data-i18n=&#83;&#97;&#118;&#101;>Save</button>' +
                '<button class="comment-edit-cancel" data-i18n=&#67;&#97;&#110;&#99;&#101;&#108;>Cancel</button>' +
                '</div>' +
                '</div>';

            const textarea = el.querySelector('textarea');
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);

            el.querySelector('.comment-edit-cancel').onclick = () => {
                el.innerHTML = originalHtml;
            };

            el.querySelector('.comment-edit-save').onclick = async () => {
                const newText = textarea.value.trim();
                if (!newText) return showToast(window.fuT('Comment cannot be empty.'), 'o');
                try {
                    await window.PostsAPI.editComment(commentId, newText);
                    showToast(window.fuT('Comment updated'), 'g');
                    refreshCommentsList(currentPostId);
                } catch (err) {
                    showToast(err.message || 'Failed to edit comment', 'r');
                    el.innerHTML = originalHtml;
                }
            };
        }

        function confirmDeleteComment(commentId) {
            if (!confirm(window.fuT('Delete this comment? This cannot be undone.'))) return;
            window.PostsAPI.deleteComment(commentId)
                .then(() => {
                    showToast(window.fuT('Comment deleted'), 'g');
                    const v = videoPosts.find(p => p.id === currentPostId);
                    if (v) {
                        v.comments = Math.max(0, (v.comments || 1) - 1);
                        const countEl = document.getElementById('commentCount');
                        if (countEl) window.fuCommentsCount(countEl, v.comments);
                    }
                    refreshCommentsList(currentPostId);
                })
                .catch(err => showToast(err.message || 'Failed to delete comment', 'r'));
        }

        function togglePinCommentUI(commentId) {
            window.PostsAPI.togglePinComment(commentId)
                .then(({ pinned }) => {
                    showToast(pinned ? 'Comment pinned' : 'Comment unpinned', 'g');
                    refreshCommentsList(currentPostId);
                })
                .catch(err => showToast(err.message || 'Failed to pin comment', 'r'));
        }

        function reportCommentUI(commentId) {
            const reason = prompt('Why are you reporting this comment?', 'Inappropriate content');
            if (reason === null) return;
            window.PostsAPI.reportComment(commentId, reason || 'Inappropriate content')
                .then(() => showToast(window.fuT('Comment reported'), 'g'))
                .catch(err => showToast(err.message || 'Failed to report comment', 'r'));
        }

        function populateComments(idx) {
            const v = videoPosts[idx];
            if (!v) return;
            currentPostId = v.id;
            const countEl = document.getElementById('commentCount');
            if (countEl) window.fuCommentsCount(countEl, v.comments);
            replyTarget = null;
            updateReplyContextUI();
            clearCommentMedia();
            const input = document.getElementById('commentInput');
            if (input) input.value = '';

            const user = getCurrentUser();
            const avatarEl = document.getElementById('commentUserAvatar');
            if (avatarEl) {
                avatarEl.src = user.avatar;
                avatarEl.onerror = function() { this.style.display = 'none'; };
            }

            const isOwner = !!v.isOwn;
            const locked = !!v.commentsHidden && !isOwner;
            applyCommentBarLockState(locked);

            loadSimilarPosts(v.id);

            if (locked) {
                const list = document.getElementById('comments-list');
                if (list) {
                    list.innerHTML = '<div class="comments-off-illustration">' +
                        '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><line x1="3" y1="21" x2="21" y2="3"/></svg>' +
                        '<p>Comments are turned off</p>' +
                        '<span>The creator has limited who can reply to this post.</span>' +
                        '</div>';
                }
            } else {
                refreshCommentsList(v.id);
            }
        }

        function openComments(idx) {
            window.FUSound?.interaction?.('comment');
            populateComments(idx);
            openCommentsSheet(idx);
        }

        async function submitCommentFromBar() {
            window.FUSound?.interaction?.('comment');
            const input = document.getElementById('commentInput');
            if (input.disabled) return;
            const message = input.value.trim();
            if (!message && !commentMedia) return showToast(window.fuT('Comment cannot be empty.'));

            let mentions = [];
            if (window.Mentions && typeof window.Mentions.extractMentions === 'function') {
                mentions = window.Mentions.extractMentions(input);
            } else {
                for (const m of message.matchAll(/@(\w+)/g)) {
                    if (m[1]) mentions.push(m[1]);
                }
            }

            const parentId = replyTarget ? replyTarget.commentId : null;
            const submitBtn = document.querySelector('.comment-send');
            if (submitBtn) submitBtn.disabled = true;

            try {
                let imageUrl = '';
                if (commentMedia) {
                    showToast(window.fuT('Uploading image…'));
                    try {
                        imageUrl = await window.AuthUser.uploadCommentMedia(commentMedia.file) || '';
                    } catch (e) { imageUrl = ''; }
                    if (!imageUrl) {
                        showToast(window.fuT('Image upload failed'));
                        return;
                    }
                }

                await addComment(currentPostId, parentId, message, mentions, imageUrl);

                input.value = '';
                replyTarget = null;
                updateReplyContextUI();
                input.placeholder = 'Add a comment…';
                clearCommentMedia();
                refreshCommentsList(currentPostId);
                showToast(parentId ? 'Reply posted' : 'Comment posted');

                const v = videoPosts.find(p => p.id === currentPostId);
                if (v) {
                    const countEl = document.getElementById('commentCount');
                    if (countEl) window.fuCommentsCount(countEl, v.comments);
                    const idx = videoPosts.indexOf(v);
                    const lbl = document.getElementById('commentCountLbl-' + idx);
                    if (lbl) lbl.textContent = fmtNum(v.comments);
                }
            } catch (e) {
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        }

        // ─── LIKE / SAVE / FOLLOW ──────────────────────────────────

        async function toggleLike(idx) {
            const v = videoPosts[idx];
            if (!v) return;
            window.FUSound?.interaction?.('like');
            if (v.baseLikes === undefined) v.baseLikes = Math.max(0, v.likes - (v.liked ? 1 : 0));

            const wasLiked = v.liked;
            v.liked = !v.liked;
            v.likes = v.baseLikes + (v.liked ? 1 : 0);
            updateLikeUI(idx, v);

            try {
                const result = await window.PostsAPI.toggleLike(v.id);
                v.baseLikes = Math.max(0, result.count - (result.liked ? 1 : 0));
                v.liked = result.liked;
                v.likes = v.baseLikes + (v.liked ? 1 : 0);
                updateLikeUI(idx, v);
            } catch (err) {
                v.liked = wasLiked;
                v.likes = v.baseLikes + (v.liked ? 1 : 0);
                updateLikeUI(idx, v);
                showToast(err.message || 'Like failed', 'r');
            }
        }

        function updateLikeUI(idx, v) {
            const btn = document.getElementById('likeBtn-' + idx);
            const lbl = document.getElementById('likeCount-' + idx);
            if (btn) btn.classList.toggle('liked', v.liked);
            if (lbl) lbl.textContent = fmtNum(v.likes);
        }

        async function toggleSave(idx) {
            window.FUSound?.interaction?.('save');
            const v = videoPosts[idx];
            const user = getCurrentUser();
            if (!user || !user.isLoggedIn) { showToast(window.fuT('Please sign in to save'), 'o'); return; }

            const wasSaved = v.saved;
            const prevCount = v.bookmarks;
            v.saved = !wasSaved;
            v.bookmarks = prevCount + (v.saved ? 1 : -1);
            updateSaveUI(idx, v);

            try {
                if (wasSaved) {
                    await window.sb.from('bookmarks').delete().eq('user_id', user.id).eq('post_id', v.id);
                    bookmarksSet.delete(v.id);
                } else {
                    await window.sb.from('bookmarks').insert({ user_id: user.id, post_id: v.id });
                    bookmarksSet.add(v.id);
                }
                showToast(v.saved ? 'Saved to Bookmarks ✓' : 'Removed from Bookmarks');
            } catch (err) {
                v.saved = wasSaved;
                v.bookmarks = prevCount;
                updateSaveUI(idx, v);
                showToast(err.message || 'Save failed', 'r');
            }
        }

        function updateSaveUI(idx, v) {
            const btn = document.getElementById('saveBtn-' + idx);
            const lbl = document.getElementById('saveCount-' + idx);
            if (btn) btn.classList.toggle('saved', v.saved);
            if (lbl) lbl.textContent = fmtNum(v.bookmarks);
        }

        async function toggleFollowUser(userId) {
            const user = getCurrentUser();
            if (!user || !user.isLoggedIn) { showToast(window.fuT('Please sign in to follow')); return false; }
            const currently = isFollowing(userId);
            try {
                if (currently) {
                    await window.sb.from('follows').delete().eq('follower_id', user.id).eq('following_id', userId);
                    followingSet.delete(userId);
                } else {
                    await window.sb.from('follows').insert({ follower_id: user.id, following_id: userId });
                    followingSet.add(userId);
                }
                return !currently;
            } catch (err) {
                showToast(err.message, 'r');
                return currently;
            }
        }

        function toggleFollow(idx) {
            window.FUSound?.interaction?.('follow');
            const v = videoPosts[idx];
            if (!v.authorId || v.isOwn) return showToast("You can't follow yourself");
            toggleFollowUser(v.authorId).then(newState => {
                v.following = newState;
                const dot = document.getElementById('followDot-' + idx);
                if (dot) dot.classList.toggle('hidden', newState || v.isOwn);
                showToast(newState ? 'Following ✓' : 'Unfollowed');
            });
        }

        function toggleFollowFromMore(idx) {
            window.FUSound?.interaction?.('follow');
            const v = videoPosts[idx];
            if (!v.authorId || v.isOwn) return showToast("You can't follow yourself");
            toggleFollowUser(v.authorId).then(newState => {
                v.following = newState;
                const dot = document.getElementById('followDot-' + idx);
                if (dot) dot.classList.toggle('hidden', newState || v.isOwn);
                showToast(newState ? 'Following ✓' : 'Unfollowed');
                const lbl = document.getElementById('moreFollowLbl');
                if (lbl) lbl.textContent = newState ? 'Following' : 'Follow';
            });
        }

        // ─── REPOST OPERATIONS ──────────────────────────────────────

        async function toggleRepost(idx, comment) {
            const v = videoPosts[idx];
            if (!v) return;
            window.FUSound?.interaction?.('repost');

            const wasReposted = v.myRepost;
            const prevText = v.myRepostText;
            const prevTime = v.myRepostTime;
            const prevCount = v.reposts;

            v.myRepost = !wasReposted;
            v.myRepostText = v.myRepost ? (comment || '') : '';
            v.myRepostTime = v.myRepost ? new Date().toISOString() : null;
            v.reposts = prevCount + (v.myRepost ? 1 : -1);

            try {
                const result = await window.PostsAPI.toggleRepostAPI(v.id, comment || '');
                v.myRepost = result.reposted;
                v.myRepostText = result.comment || '';
                v.myRepostTime = result.time;
                v.reposts = result.count;
                showToast(v.myRepost ? 'Reposted ✓' : 'Repost undone');
                window.PostsAPI.clearFeedContext();
                const fresh = await loadVideoPosts();
                videoPosts = fresh;
                let filtered = buildEligibleFeed(feedMode);
                if (filtered.length === 0) filtered = buildEligibleFeed('foryou');
                buildFeed(filtered);
            } catch (err) {
                v.myRepost = wasReposted;
                v.myRepostText = prevText;
                v.myRepostTime = prevTime;
                v.reposts = prevCount;
                showToast(err.message || 'Repost failed', 'r');
            }
        }

        function submitRepost() {
            const idx = _shareIdx;
            const comment = document.getElementById('repostComment').value.trim();
            const words = comment.split(/\s+/).filter(Boolean);
            if (words.length > 20) {
                return showToast(window.fuT('Repost comment must be 20 words or fewer'));
            }
            toggleRepost(idx, comment);
            document.getElementById('repostComment').value = '';
            const counter = document.getElementById('repostWordCount');
            if (counter) counter.textContent = window.fuT('0 / 20 words');
            closeSheet('repostSheet');
        }

        function submitQuote() {
            const idx = _shareIdx;
            const comment = document.getElementById('quoteComment').value.trim();
            if (!comment) return showToast(window.fuT('Add a thought before posting'));
            toggleRepost(idx, comment);
            document.getElementById('quoteComment').value = '';
            closeSheet('quoteSheet');
        }

        function enforceWordLimit(el, maxWords) {
            let words = el.value.trim().split(/\s+/).filter(Boolean);
            if (words.length > maxWords) {
                el.value = words.slice(0, maxWords).join(' ');
                words = words.slice(0, maxWords);
            }
            const counter = document.getElementById('repostWordCount');
            if (counter) counter.textContent = words.length + ' / ' + maxWords + ' words';
        }

        // ─── SHARE SHEET ────────────────────────────────────────────

        function recordShareForPost(idx) {
            const v = videoPosts[idx];
            if (!v) return;
            const user = getCurrentUser();
            if (!user || !user.isLoggedIn) return;

            window.PostsAPI.recordShare(v.id)
                .then(({ count }) => {
                    v.shares = count;
                    const lbl = document.getElementById('shareCount-' + idx);
                    if (lbl) lbl.textContent = fmtNum(count);
                })
                .catch(err => console.warn('recordShare failed:', err));
        }

        function openShare(idx) {
            window.FUSound?.interaction?.('share');
            _shareIdx = idx;
            const v = videoPosts[idx];
            if (v?.id) {
                const id = v.id;
                preparedVideoShareUrls.set(id, getPostUrl(idx));
                const sharePost = { ...v, media_type: v.mediaType || v.media_type || 'text' };
                Promise.resolve(galleryMode ? getPostUrl(idx) : window.Router?.resolvePostShareUrl?.(sharePost, '/videos')).then(resolved => {
                    if (resolved) preparedVideoShareUrls.set(id, resolved);
                }).catch(() => {});
            }
            const nativeBtn = document.getElementById('nativeShareBtn');
            if (nativeBtn) nativeBtn.style.display = navigator.share ? 'flex' : 'none';
            const thumb = document.getElementById('sharePreviewThumb');
            const cap = document.getElementById('sharePreviewCaption');
            const handle = document.getElementById('sharePreviewHandle');
            if (thumb) {
                const mediaType = v.mediaType || v.media_type || 'text';
                const directImage = v.poster || v.thumbnailUrl || v.thumbnail_url ||
                    (mediaType === 'image' ? v.src : '');
                const previewCode = v.short_code || v.shortCode || v.postData?.short_code;
                const fallback = '/freeupper.png';
                const setThumb = (url) => {
                    thumb.onerror = () => { thumb.onerror = null; thumb.src = fallback; };
                    thumb.src = url || fallback;
                };
                if (mediaType === 'text') {
                    if (previewCode) {
                        setThumb('/api/post-text-og?style=video&code=' + encodeURIComponent(previewCode));
                    } else {
                        // Render the post itself when no short-code OG image is available.
                        const canvas = document.createElement('canvas');
                        canvas.width = 360; canvas.height = 450;
                        const ctx = canvas.getContext('2d');
                        const palette = {
                            darkq: ['#111118','#f5f5f5'], blackmin: ['#111111','#f5f5f5'],
                            cleanq: ['#ffffff','#111111'], whitemin: ['#ffffff','#111111'],
                            sticky: ['#ffe566','#374151'], neon: ['#0d0020','#e879f9'],
                            sunset: ['#ff6b6b','#ffffff'], gold: ['#0a0600','#ffd700'],
                            aura: ['#050510','#ffffff'], notebook: ['#fdf8f0','#1e293b'],
                            aurora: ['#020c18','#ffffff'], ocean: ['#0072ff','#ffffff'],
                            midnight: ['#06061a','#c4b5fd'], galaxy: ['#03001e','#c4b5fd'],
                            pastel: ['#fce4ec','#4c1d6b'], cotton: ['#fbc2eb','#5c1a6e']
                        };
                        const id = String(v.textTemplateId || v.postData?.text_template_id || 'darkq').toLowerCase();
                        const colors = palette[id] || palette.darkq;
                        ctx.fillStyle = colors[0]; ctx.fillRect(0,0,360,450);
                        ctx.fillStyle = colors[1]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                        const message = String(v.textBody || v.caption || 'FreeUpper post').trim();
                        let rows = [];
                        let size = 39;
                        for (; size >= 16; size -= 2) {
                            ctx.font = '800 ' + size + 'px system-ui, sans-serif';
                            rows = [];
                            for (const paragraph of message.split(/\n/)) {
                                let line = '';
                                for (const word of paragraph.split(/\s+/)) {
                                    const next = line ? line + ' ' + word : word;
                                    if (line && ctx.measureText(next).width > 318) { rows.push(line); line = word; }
                                    else line = next;
                                }
                                rows.push(line);
                            }
                            if (rows.length * size * 1.18 <= 390 && rows.every(x => ctx.measureText(x).width <= 330)) break;
                        }
                        const lineHeight = size * 1.18;
                        rows.forEach((line, i) => ctx.fillText(line, 180, 225 + (i - (rows.length - 1) / 2) * lineHeight, 330));
                        setThumb(canvas.toDataURL('image/png'));
                    }
                } else if (mediaType === 'video' && !directImage) {
                    const src = String(v.src || '');
                    const cloudinary = src.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.*)$/);
                    if (cloudinary) {
                        const path = cloudinary[2].replace(/\.[^/.?#]+(?=\?|$)/, '.jpg');
                        setThumb(cloudinary[1] + 'so_1,w_360,h_450,c_fill/' + path);
                    } else if (v.ytId) {
                        setThumb('https://img.youtube.com/vi/' + encodeURIComponent(v.ytId) + '/hqdefault.jpg');
                    } else if (src) {
                        // Extract a frame for same-origin/CORS-enabled videos without a poster.
                        const video = document.createElement('video');
                        video.crossOrigin = 'anonymous'; video.muted = true; video.preload = 'auto';
                        video.onloadeddata = () => { try { video.currentTime = Math.min(1, Math.max(0, (video.duration || 1) / 2)); } catch {} };
                        video.onseeked = () => {
                            try {
                                const canvas = document.createElement('canvas');
                                canvas.width = 180; canvas.height = 225;
                                canvas.getContext('2d').drawImage(video, 0, 0, 180, 225);
                                if (_shareIdx === idx) setThumb(canvas.toDataURL('image/jpeg', .8));
                            } catch { if (_shareIdx === idx) setThumb(fallback); }
                            video.removeAttribute('src'); video.load();
                        };
                        video.onerror = () => { if (_shareIdx === idx) setThumb(fallback); };
                        setThumb(fallback); video.src = src;
                    } else setThumb(fallback);
                } else setThumb(directImage);
            }
            if (cap) cap.textContent = (v.caption || v.textBody || '').split('\n')[0].slice(0, 60);
            if (handle) handle.textContent = v.handle || '';
            const delRow = document.getElementById('deletePostRow');
            if (delRow) delRow.style.display = v.isOwn ? 'flex' : 'none';
            openSheet('shareSheet');
        }

        function getPostUrl(idx) {
            const post = videoPosts && videoPosts[idx];
            const id = post && post.id;
            return window.Router?.getPostShareUrl({ ...post, media_type: post?.mediaType || post?.media_type || 'video' }, 'video.html') || SITE_URL + '/videos?post=' + encodeURIComponent(id || '');
        }

        function getPostTitle(idx) {
            const post = videoPosts && videoPosts[idx];
            return (post && (post.caption || post.textBody)) || 'Check this out on Freeupper';
        }

        async function shareAction(type) {
            const idx = _shareIdx;
            const url = getPostUrl(idx);
            const title = getPostTitle(idx);
            const text = title + ' — ' + url;
            if (navigator.vibrate) navigator.vibrate(8);

            const shareTypes = ['native', 'copy', 'whatsapp', 'twitter', 'telegram', 'facebook', 'instagram'];
            if (shareTypes.includes(type)) {
                recordShareForPost(idx);
            }

            switch (type) {
                case 'native':
                    try { await navigator.share({ title, text: title, url }); } catch (e) { return; }
                    closeSheet('shareSheet');
                    return;
                case 'copy': {
                    const btn = document.getElementById('copyLinkBtn');
                    const lbl = document.getElementById('copyLbl');
                    try {
                        const shareUrl = preparedVideoShareUrls.get(videoPosts[idx]?.id) || url;
                        if (!galleryMode && !/^https:\/\/[^/]+\/[pv]\/[A-Za-z0-9_-]{6,16}$/.test(shareUrl)) {
                            const current = videoPosts[idx];
                            if (current?.id) {
                                const sharePost = { ...current, media_type: current.mediaType || current.media_type || 'text' };
                                Promise.resolve(window.Router?.resolvePostShareUrl?.(sharePost, '/videos'))
                                    .then(resolved => { if (resolved) preparedVideoShareUrls.set(current.id, resolved); })
                                    .catch(() => {});
                            }
                            showToast(window.fuT('Preparing short link. Please try again in a moment.'));
                            return;
                        }
                        // Copy immediately in the tap handler; avoid losing iOS user activation.
                        if (navigator.clipboard?.writeText && window.isSecureContext) {
                            await navigator.clipboard.writeText(shareUrl);
                        } else {
                            const field = document.createElement('textarea');
                            field.value = shareUrl;
                            field.style.cssText = 'position:fixed;left:-9999px;top:0';
                            document.body.appendChild(field);
                            field.focus(); field.select();
                            const copied = document.execCommand('copy');
                            field.remove();
                            if (!copied) throw new Error('Clipboard unavailable');
                        }
                        if (btn) btn.classList.add('copied');
                        if (lbl) lbl.textContent = window.fuT('Copied ✓');
                        showToast(window.fuT('Link copied 🔗'));
                        setTimeout(() => {
                            if (btn) btn.classList.remove('copied');
                            if (lbl) lbl.textContent = window.fuT('Copy link');
                        }, 2000);
                    } catch (e) {
                        window.prompt('Copy this post link:', preparedVideoShareUrls.get(videoPosts[idx]?.id) || url);
                    }
                    return;
                }
                case 'whatsapp':
                    closeSheet('shareSheet');
                    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
                    return;
                case 'twitter':
                    closeSheet('shareSheet');
                    window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(title) + '&url=' +
                        encodeURIComponent(url), '_blank');
                    return;
                case 'telegram':
                    closeSheet('shareSheet');
                    window.open('https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(
                        title), '_blank');
                    return;
                case 'facebook':
                    closeSheet('shareSheet');
                    window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url), '_blank');
                    return;
                case 'instagram':
                    closeSheet('shareSheet');
                    if (navigator.share) {
                        try { await navigator.share({ title, url }); } catch (e) {}
                    } else {
                        showToast(window.fuT('Open Instagram app to share'));
                    }
                    return;
                case 'repost':
                    closeSheet('shareSheet');
                    openSheet('repostSheet');
                    return;
                case 'quote':
                    closeSheet('shareSheet');
                    openSheet('quoteSheet');
                    return;
                case 'download':
                    await downloadVideo(idx);
                    closeSheet('shareSheet');
                    return;
                case 'delete':
                    await deleteCurrentPost(idx);
                    return;
            }
        }

        async function deleteCurrentPost(idx) {
            const v = videoPosts[idx];
            if (!v) return;
            if (!v.isOwn) {
                showToast(window.fuT('You can only delete your own posts'));
                return;
            }
            if (!window.PostsAPI || typeof window.PostsAPI.deletePost !== 'function') {
                showToast(window.fuT('Delete unavailable — please refresh'));
                return;
            }
            const ok = confirm(window.fuT('Move this post to Recently Deleted for 7 days? Restore or delete permanently at /recently-deleted.html.'));
            if (!ok) return;

            showToast(window.fuT('Deleting…'));

            try {
                await window.PostsAPI.deletePost(v.id);
                closeAllSheets();
                videoPosts = videoPosts.filter(p => p.id !== v.id);
                let filtered = buildEligibleFeed(feedMode);
                if (filtered.length === 0 && feedMode === 'following') {
                    feedMode = 'foryou';
                    document.querySelectorAll('.vt-tab').forEach(t =>
                        t.classList.toggle('active', t.dataset.tab === 'foryou'));
                    filtered = buildEligibleFeed('foryou');
                }
                buildFeed(filtered);
                showToast(window.fuT('Post deleted ✓'));
            } catch (err) {
                console.error('Delete post error:', err);
                showToast(err.message || 'Failed to delete post');
            }
        }

        async function downloadVideo(idx) {
            const v = videoPosts[idx];
            const lbl = document.getElementById('saveVideoLbl');
            const btn = document.getElementById('saveVideoBtn');
            if (btn) btn.disabled = true;
            let dots = 0;
            const anim = setInterval(() => {
                dots = (dots + 1) % 4;
                if (lbl) lbl.textContent = 'Downloading' + '.'.repeat(dots);
            }, 350);
            try {
                const res = await fetch(v.src);
                if (!res.ok) throw new Error('Network error');
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'freeupper-' + v.id + '.mp4';
                a.click();
                URL.revokeObjectURL(a.href);
                clearInterval(anim);
                if (lbl) lbl.textContent = window.fuT('Save Video');
                showToast(window.fuT('Downloaded successfully ✓'));
            } catch (e) {
                clearInterval(anim);
                if (lbl) lbl.textContent = window.fuT('Save Video');
                showToast(window.fuT('Download failed'));
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        // ─── MORE OPTIONS ──────────────────────────────────────────

        function openMore(idx) {
            const list = document.getElementById('moreList');
            const v = videoPosts[idx];
            const author = window.getAuthorFromProfile(v.profile || {});
            const followRow = v.isOwn ? '' :
                '<button class="more-follow-row" id="moreFollowRow" onclick="toggleFollowFromMore(' + idx + ')">' +
                '<img class="more-follow-avatar" src="' + author.avatar +
                '" alt="' + author.name +
                '" onerror="this.src=\'https://api.dicebear.com/7.x/avataaars/svg?seed=' + author.name + '\'">' +
                '<div>' +
                '<div class="more-row-lbl" id="moreFollowLbl">' + (v.following ? 'Following' : 'Follow') + ' ' + author
                .name + '</div>' +
                '<div class="more-row-sub">' + v.handle + '</div>' +
                '</div>' +
                '</button>';

            const commentsToggleRow = v.isOwn ?
                '<button class="more-toggle-row" onclick="toggleCommentsFromMore(' + idx + ')">' +
                '<svg class="more-row-ico" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
                '<div><div class="more-row-lbl" id="moreCommentsLbl">' + (v.commentsHidden ? 'Turn On Comments' : 'Turn Off Comments') + '</div></div>' +
                '</button>' : '';

            const soundRow = v.soundId ?
                '<button class="more-row" onclick="moreAction(\'View sound: ' + escapeHtml(v.sound) + '\'); openSoundPage(' +
                idx + ')">' +
                '<svg class="more-row-ico" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
                '<div><div class="more-row-lbl">View sound</div><div class="more-row-sub">' + escapeHtml(v.sound) +
                '</div></div>' +
                '</button>' : '';

            const otherRows = '' +
                '<button class="more-row" onclick="moreAction(\'Not interested in this video\')">' +
                '<svg class="more-row-ico" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
                '<div><div class="more-row-lbl" data-i18n=&#78;&#111;&#116;&#32;&#105;&#110;&#116;&#101;&#114;&#101;&#115;&#116;&#101;&#100;>Not interested</div></div>' +
                '</button>' +
                '<button class="more-row" onclick="moreAction(\'Find similar videos\')">' +
                '<svg class="more-row-ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
                '<div><div class="more-row-lbl">Find similar videos</div></div>' +
                '</button>' +
                '<button class="more-row" onclick="moreAction(\'Save video\')">' +
                '<svg class="more-row-ico" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                '<div><div class="more-row-lbl">Save video</div></div>' +
                '</button>' +
                '<button class="more-row" onclick="moreAction(\'Copy link to video\')">' +
                '<svg class="more-row-ico" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
                '<div><div class="more-row-lbl" data-i18n=&#67;&#111;&#112;&#121;&#32;&#108;&#105;&#110;&#107;>Copy link</div></div>' +
                '</button>' +
                '<button class="more-row danger" onclick="moreAction(\'Report video\')">' +
                '<svg class="more-row-ico" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>' +
                '<div><div class="more-row-lbl">Report video</div></div>' +
                '</button>';

            list.innerHTML = followRow + commentsToggleRow + soundRow + otherRows;

            openSheet('moreSheet');
        }

        function toggleCommentsFromMore(idx) {
            const v = videoPosts[idx];
            if (!v || !v.isOwn) return;
            const newVal = !v.commentsHidden;
            window.PostsAPI.toggleCommentsHidden(v.id, newVal)
                .then(function(res) {
                    v.commentsHidden = res.commentsHidden;
                    const lbl = document.getElementById('moreCommentsLbl');
                    if (lbl) lbl.textContent = v.commentsHidden ? 'Turn On Comments' : 'Turn Off Comments';
                    const card = document.getElementById('card-' + idx);
                    if (card) {
                        const btn = card.querySelector('[onclick="openComments(' + idx + ')"]');
                        if (btn) {
                            btn.classList.toggle('comments-off', v.commentsHidden);
                            btn.innerHTML = v.commentsHidden ?
                                '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><line x1="3" y1="21" x2="21" y2="3" stroke="#f87171"/></svg>' :
                                '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
                        }
                    }
                    showToast(v.commentsHidden ? 'Comments turned off' : 'Comments turned on');
                    closeSheet('moreSheet');
                })
                .catch(function(err) { showToast(err.message || 'Failed to update', 'r'); });
        }

        function moreAction(label) {
            closeSheet('moreSheet');
            showToast(label);
        }

        // ─── DEEP-LINK ──────────────────────────────────────────────

        function jumpToSharedPost() {
            if(galleryMode){const id=galleryParams.get('post');const index=videoPosts.findIndex(v=>v.id===id);if(index<0){document.getElementById('feedTrack').replaceChildren();showToast('Video unavailable');return;}_curIdx=index;document.getElementById('card-'+index)?.scrollIntoView({block:'start',behavior:'instant'});onCardActive(index);return;}

            const params = new URLSearchParams(window.location.search);
            const postId = params.get('post');
            if (!postId) return;
            const idx = videoPosts.findIndex(v => String(v.id) === postId);
            if (idx > -1) {
                // Build the same ordered list used by the share link so card indices match.
                const eligible = buildEligibleFeed(feedMode);
                const cardIndex = eligible.findIndex(v => String(v.id) === postId);
                if (cardIndex === -1) {
                    buildFeed([videoPosts[idx], ...eligible.filter(v => String(v.id) !== postId)]);
                }
                const targetIndex = cardIndex === -1 ? 0 : cardIndex;
                const card = document.getElementById('card-' + targetIndex);
                if (card) card.scrollIntoView({ block: 'start' });
            } else {
                showToast(window.fuT('This post is unavailable or private'));
            }
        }

        // ─── REFRESH ──────────────────────────────────────────────

        async function refreshVideos(silent = false) {
            if(galleryMode){const restoring=!!galleryPendingRestore;const id=videoPosts[_curIdx]?.id||galleryParams.get('post');const time=document.getElementById('vid-'+_curIdx)?.currentTime||0;galleryParams.set('post',id);videoPosts=await loadVideoPosts();buildFeed(videoPosts);jumpToSharedPost();const v=document.getElementById('vid-'+_curIdx);if(v&&!restoring)v.addEventListener('loadedmetadata',()=>{seekGalleryTime(v,time);},{once:true});return;}

            if (!silent) showToast(window.fuT('Refreshing videos…'));
            try {
                const fresh = await loadVideoPosts();
                videoPosts = fresh;
                let filtered = buildEligibleFeed(feedMode);
                if (filtered.length === 0) filtered = buildEligibleFeed('foryou');
                buildFeed(filtered);
                if (!silent) showToast(window.fuT('Videos refreshed ✓'));
                jumpToSharedPost();
            } catch (err) {
                showToast(window.fuT('Refresh failed, using cached data'));
                let filtered = buildEligibleFeed(feedMode);
                if (filtered.length === 0) filtered = buildEligibleFeed('foryou');
                if (filtered.length === 0 && videoPosts.length === 0) {
                    const track = document.getElementById('feedTrack');
                    const emptyState = document.getElementById('emptyState');
                    if (track) track.innerHTML = '';
                    if (emptyState) emptyState.style.display = 'flex';
                } else {
                    buildFeed(filtered);
                }
            }
        }

        // ─── REALTIME SUBSCRIPTIONS ──────────────────────────────

        let repostRefreshSubscribed=false;
        function setupRealtime(managed = false) {
            if (!managed && window.FreeUpperScreen) return window.FreeUpperScreen.realtime('video',()=>setupRealtime(true));
            if (!window.sb) return;

            window.sb.channel('profile-updates')
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' },
                    (payload) => {
                        const updated = payload.new;
                        if (typeof window.updateAuthorUI === 'function') {
                            window.updateAuthorUI(updated);
                        }
                        videoPosts = videoPosts.map(v => {
                            if (v.authorId === updated.id) {
                                v.profile = { ...v.profile, ...updated };
                            }
                            return v;
                        });
                    })
                .subscribe();

            const _me = getCurrentUser();
            if (_me && _me.isLoggedIn) {
                window.sb.channel('follow-changes')
                    .on('postgres_changes', {
                        event: '*', schema: 'public', table: 'follows',
                        filter: `follower_id=eq.${_me.id}`
                    }, () => {
                        loadFollows().then(() => {
                            videoPosts = videoPosts.map(v => ({ ...v, following: isFollowing(v.authorId) }));
                            videoPosts.forEach((v, i) => {
                                const dot = document.getElementById('followDot-' + i);
                                if (dot) dot.classList.toggle('hidden', v.following || v.isOwn);
                            });
                        });
                    })
                    .subscribe();
            }

            window.sb.channel('comment-like-changes')
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comments' },
                    (payload) => {
                        const updated = payload.new;
                        document.querySelectorAll('[data-comment-id="' + updated.id + '"] .like-count').forEach(el => {
                            el.textContent = updated.like_count > 0 ? updated.like_count : '';
                        });
                    })
                .subscribe();

            let _refreshDebounce = null;
            if (window.PostsAPI && window.PostsAPI.subscribe && !repostRefreshSubscribed) {
                repostRefreshSubscribed=true;
                window.PostsAPI.subscribe(() => {
                    clearTimeout(_refreshDebounce);
                    _refreshDebounce = setTimeout(() => {
                        if(window.FreeUpperScreen && !window.FreeUpperScreen.isActive())return;
                        const track = document.getElementById('feedTrack');
                        if (_curIdx === 0 && track.scrollTop < 10) {
                            refreshVideos();
                        } else {
                            showToast(window.fuT('New reposts available — pull to refresh'));
                        }
                    }, 3000);
                });
            }
        }

        // ─── INIT ──────────────────────────────────────────────────

        async function init() {

            function updateNavAvatar() {
                const user = getCurrentUser();
                document.querySelectorAll('.side-av, .nav-av').forEach(el => {
                    el.src = user.avatar;
                    el.onerror = function() { this.style.display = 'none'; };
                });
            }
            updateNavAvatar();

            attachSheetDrag('shareSheet', true);
            attachSheetDrag('moreSheet', false);
            attachSheetDrag('repostSheet', false);
            attachSheetDrag('quoteSheet', false);

            await Promise.all([loadFollows(), loadBookmarks()]);

            const fresh = await loadVideoPosts();
            videoPosts = fresh;
            if(!galleryMode && retainedVideo){
                feedMode=retainedVideo.feedMode || feedMode;
                const order=new Map((retainedVideo.order || []).map((id,i)=>[id,i]));
                videoPosts.sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999));
            }
            let filtered = buildEligibleFeed(feedMode);
            if (filtered.length === 0) filtered = buildEligibleFeed('foryou');
            buildFeed(filtered);
            jumpToSharedPost();
            if(retainedVideo?.postId && !new URLSearchParams(location.search).has('post')){
                const index=filtered.findIndex(v=>v.id===retainedVideo.postId);
                if(index>=0){
                    _curIdx=index;
                    document.getElementById('card-'+index)?.scrollIntoView({behavior:'instant'});
                    const video=document.getElementById('vid-'+index);
                    if(video){const seek=()=>{video.currentTime=retainedVideoTime;};if(video.readyState)seek();else video.addEventListener('loadedmetadata',seek,{once:true});}
                }
            }
            window.FreeUpperScreen?.ready();

            setupRealtime();

            document.getElementById('commentInput').addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitCommentFromBar();
                }
            });

            const track = document.getElementById('feedTrack');
            const indicator = document.getElementById('ptrIndicator');
            let startY = 0;
            let isPulling = false;
            let pullOffset = 0;

            track.addEventListener('touchstart', function(e) {
                if (!galleryMode && track.scrollTop === 0) {
                    startY = e.touches[0].clientY;
                    isPulling = true;
                    pullOffset = 0;
                } else {
                    isPulling = false;
                }
            }, { passive: true });

            track.addEventListener('touchmove', function(e) {
                if (isPulling && track.scrollTop === 0) {
                    const delta = e.touches[0].clientY - startY;
                    if (delta > 0) {
                        pullOffset = delta;
                        if (delta > 100) {
                            indicator.classList.add('show');
                            indicator.innerHTML = '<span class="spinner"></span> Release to refresh';
                        } else {
                            indicator.classList.remove('show');
                            indicator.innerHTML = '<span class="spinner"></span> Pull to refresh';
                        }
                    }
                }
            }, { passive: true });

            track.addEventListener('touchend', function(e) {
                if (isPulling && pullOffset > 100) {
                    indicator.innerHTML = '<span class="spinner"></span> Refreshing…';
                    refreshVideos();
                } else {
                    indicator.classList.remove('show');
                }
                isPulling = false;
                pullOffset = 0;
            }, { passive: true });

            console.log('Freeupper Video Feed · portrait videos fill screen · sound owner hydrated async ✓');
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }

        // ─── EXPOSE GLOBALLY ──────────────────────────────────────
        window.toggleLike = toggleLike;
        window.toggleSave = toggleSave;
        window.toggleFollow = toggleFollow;
        window.toggleFollowFromMore = toggleFollowFromMore;
        window.toggleCaption = toggleCaption;
        window.handleCaptionScroll = handleCaptionScroll;
        window.handleCardTap = handleCardTap;
        window.startScrub = startScrub;
        window.openComments = openComments;
        window.openShare = openShare;
        window.openMore = openMore;
        window.moreAction = moreAction;
        window.shareAction = shareAction;
        window.submitCommentFromBar = submitCommentFromBar;
        window.replyToComment = replyToComment;
        window.cancelReply = cancelReply;
        window.toggleCommentLikeUI = toggleCommentLikeUI;
        window.expandReplies = expandReplies;
        window.collapseReplies = collapseReplies;
        window.loadMoreComments = loadMoreComments;
        window.toggleSortMenu = toggleSortMenu;
        window.switchFeedTab = switchFeedTab;
        window.closeSheet = closeSheet;
        window.closeAllSheets = closeAllSheets;
        window.initYtListener = initYtListener;
        window.toggleYtControls = toggleYtControls;
        window.toggleMute = toggleMute;
        window.submitRepost = submitRepost;
        window.submitQuote = submitQuote;
        window.downloadVideo = downloadVideo;
        window.goToProfile = goToProfile;
        window.enforceWordLimit = enforceWordLimit;
        window.refreshVideos = refreshVideos;
        window.toggleClearDisplay = toggleClearDisplay;
        window.imgDragStart = imgDragStart;
        window.openRepostersSheet = openRepostersSheet;
        window.openStudio = openStudio;
        window.recordShareForPost = recordShareForPost;
        window.toggleCommentsFromMore = toggleCommentsFromMore;
        window.applyCommentBarLockState = applyCommentBarLockState;
        window.openSoundPage = openSoundPage;
        window.loadSimilarPosts = loadSimilarPosts;
        window.openCommentActionsMenu = openCommentActionsMenu;
        window.startEditComment = startEditComment;
        window.confirmDeleteComment = confirmDeleteComment;
        window.togglePinCommentUI = togglePinCommentUI;
        window.reportCommentUI = reportCommentUI;
        window.renderCommentThread = renderCommentThread;
        window.renderReplyItem = renderReplyItem;
        window.deleteCurrentPost = deleteCurrentPost;
        window.handleCommentMediaSelect = handleCommentMediaSelect;
        window.clearCommentMedia = clearCommentMedia;
        window.openCommentImageViewer = openCommentImageViewer;
        window.closeCommentImageViewer = closeCommentImageViewer;
        window.civStep = civStep;
        window.updateCivCount = updateCivCount;
        window.positionImgDots = positionImgDots;
        window.populateComments = populateComments;
        window.fitVideo = fitVideo;

window.FreeUpperVideoPlayer={
 snapshot(){return {post:videoPosts[_curIdx]?.id,time:document.getElementById('vid-'+_curIdx)?.currentTime||0,muted:userMutePreference};},
 pause(){galleryPlaybackHold=true;document.querySelectorAll('video').forEach(v=>v.pause());window.VideoRender?.stopSoundPlayback();},
 async restore(state){galleryPlaybackHold=true;galleryPendingRestore=state;const selected=videoPosts.findIndex(p=>p.id===state?.post);if(selected>=0)_curIdx=selected;await refreshVideos(true);},
 dispose(){galleryPendingRestore=null;feedObserver?.disconnect();this.pause();clearProtectedVideoMedia();document.querySelectorAll('video').forEach(v=>{v.removeAttribute('src');v.load();});}
};

window.addEventListener('fu-content-change',async event=>{
 if(event.detail?.kind!=='post')return;
 const index=videoPosts.findIndex(p=>p.id===event.detail.id);if(index<0)return;
 const post=await window.PostsAPI.loadPostById(event.detail.id,{requireLive:true}).catch(()=>null);
 if(!post){await refreshVideos(true);return;}
 const v=videoPosts[index];Object.assign(v,{postData:post,liked:post.likedByMe,saved:post.bookmarkedByMe,likes:post.likes,reposts:post.repostCount,bookmarks:post.bookmarkCount});
 document.getElementById('likeCount-'+index)?.replaceChildren(document.createTextNode(fmtNum(v.likes||0)));
 document.getElementById('saveCount-'+index)?.replaceChildren(document.createTextNode(fmtNum(v.bookmarks||0)));
 document.querySelector('#card-'+index+' .v-action-btn')?.classList.toggle('liked',!!v.liked);
});
