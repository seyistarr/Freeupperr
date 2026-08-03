// =====================================================================
// video-render.js – Connects posts to the Sound system + shared text‑card templates
// =====================================================================
//
// Single source of truth for:
//   - resolving a post's sound_id, fetching/caching sound metadata,
//     rendering the "🎵 title · @creator" pill/disc markup used under videos,
//     and handling the tap → sound.html navigation.
//   - Text‑card templates (shared between studio.html editor and
//     video.html renderer, so a card looks identical in both).
//
// Any page rendering video cards (video.html, profile grids, feed cards)
// should call into window.VideoRender instead of re‑implementing this.
//
// DEPENDENCIES: sounds.js (window.SoundsAPI) must load before this file.
// =====================================================================

(function() {
    'use strict';

    if (!window.SoundsAPI) {
        console.error('video-render.js: SoundsAPI missing. Ensure sounds.js loads before this file.');
        return;
    }

    // ─── Simple in-memory cache so the same sound isn't re-fetched
    //     for every card in a feed that shares it. ──────────────────
    const _soundCache = new Map(); // soundId -> resolved meta object | Promise

    // ─── Text-card templates (shared between studio.html editor and
    //     video.html renderer, so a card looks identical in both) ──────
    const TXT_TEMPLATES = [
        { id:'neon',     name:'Neon',     cat:'Trending', color:'#e879f9', font:'900', shadow:'0 0 16px #e879f9,0 0 40px #9333ea', draw:'_tplNeon' },
        { id:'sunset',   name:'Sunset',   cat:'Trending', color:'#fff',    font:'900', shadow:'0 3px 20px rgba(0,0,0,.4)', draw:'_tplSunset' },
        { id:'gold',     name:'Gold',     cat:'Glow',     color:'#ffd700', font:'900', shadow:'0 0 18px #ffd700,0 0 50px #b8860b', draw:'_tplGold' },
        { id:'aura',     name:'Aura',     cat:'Glow',     color:'#fff',    font:'900', shadow:'0 0 14px #fff,0 0 40px rgba(255,255,255,.5)', draw:'_tplAura' },
        { id:'notebook', name:'Notebook', cat:'Paper',    color:'#1e293b', font:'800', shadow:'none', draw:'_tplNotebook' },
        { id:'sticky',   name:'Sticky',   cat:'Paper',    color:'#374151', font:'800', shadow:'none', draw:'_tplSticky' },
        { id:'darkq',    name:'Dark',     cat:'Quote',    color:'#f5f5f5', font:'800', shadow:'none', draw:'_tplDark' },
        { id:'cleanq',   name:'Clean',    cat:'Quote',    color:'#111',    font:'900', shadow:'none', draw:'_tplClean' },
        { id:'aurora',   name:'Aurora',   cat:'Art',      color:'#fff',    font:'900', shadow:'0 2px 20px rgba(0,0,0,.4)', draw:'_tplAurora' },
        { id:'ocean',    name:'Ocean',    cat:'Art',      color:'#fff',    font:'900', shadow:'0 2px 16px rgba(0,0,0,.3)', draw:'_tplOcean' },
        { id:'midnight', name:'Midnight', cat:'Dark',     color:'#c4b5fd', font:'700', shadow:'none', draw:'_tplMidnight' },
        { id:'galaxy',   name:'Galaxy',   cat:'Dark',     color:'#c4b5fd', font:'800', shadow:'0 0 14px rgba(196,181,253,.5)', draw:'_tplGalaxy' },
        { id:'pastel',   name:'Pastel',   cat:'Dream',    color:'#4c1d6b', font:'900', shadow:'none', draw:'_tplPastel' },
        { id:'cotton',   name:'Cotton',   cat:'Dream',    color:'#5c1a6e', font:'900', shadow:'none', draw:'_tplCotton' },
        { id:'whitemin', name:'White',    cat:'Minimal',  color:'#111',    font:'900', shadow:'none', draw:'_tplWhite' },
        { id:'blackmin', name:'Black',    cat:'Minimal',  color:'#f5f5f5', font:'900', shadow:'none', draw:'_tplBlack' },
        { id:'confetti', name:'Confetti', cat:'Happy',    color:'#1a0a2e', font:'900', shadow:'none', draw:'_tplConfetti' },
        { id:'rainbow',  name:'Rainbow',  cat:'Happy',    color:'#fff',    font:'900', shadow:'0 2px 12px rgba(0,0,0,.3)', draw:'_tplRainbow' },
    ];

    function _tplNeon(ctx,W,H,t){ctx.fillStyle='#0d0020';ctx.fillRect(0,0,W,H);const g=ctx.createRadialGradient(W*.5,H*.5,0,W*.5,H*.5,W*.7);g.addColorStop(0,'rgba(147,51,234,.35)');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}
    function _tplSunset(ctx,W,H,t){const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,'#ff6b6b');g.addColorStop(.5,'#ffa500');g.addColorStop(1,'#ff2d55');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);const sy=H*.35+Math.sin(t*.5)*H*.03;const sg=ctx.createRadialGradient(W*.5,sy,0,W*.5,sy,W*.3);sg.addColorStop(0,'rgba(255,255,200,.4)');sg.addColorStop(1,'transparent');ctx.fillStyle=sg;ctx.fillRect(0,0,W,H);}
    function _tplGold(ctx,W,H,t){ctx.fillStyle='#0a0600';ctx.fillRect(0,0,W,H);const a=.3+.15*Math.sin(t*.7);const g=ctx.createRadialGradient(W*.5,H*.4,0,W*.5,H*.4,W*.6);g.addColorStop(0,`rgba(255,215,0,${a})`);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}
    function _tplAura(ctx,W,H,t){ctx.fillStyle='#050510';ctx.fillRect(0,0,W,H);const a=.18+.08*Math.sin(t*.6);const g=ctx.createRadialGradient(W*.5,H*.4,0,W*.5,H*.4,W*.65);g.addColorStop(0,`rgba(255,255,255,${a})`);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}
    function _tplNotebook(ctx,W,H,t){ctx.fillStyle='#fdf8f0';ctx.fillRect(0,0,W,H);ctx.strokeStyle='rgba(180,200,255,.35)';ctx.lineWidth=.8;for(let y=20;y<H;y+=14){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}ctx.strokeStyle='rgba(255,100,100,.4)';ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(18,0);ctx.lineTo(18,H);ctx.stroke();}
    function _tplSticky(ctx,W,H,t){ctx.fillStyle='#ffe566';ctx.fillRect(0,0,W,H);ctx.fillStyle='rgba(0,0,0,.06)';ctx.fillRect(4,H-6,W-4,6);ctx.fillRect(W-6,4,6,H-4);}
    function _tplDark(ctx,W,H,t){ctx.fillStyle='#111118';ctx.fillRect(0,0,W,H);ctx.fillStyle='rgba(255,255,255,.04)';ctx.font=`bold ${W*.55}px serif`;ctx.fillText('"',W*.04,H*.45);}
    function _tplClean(ctx,W,H,t){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);ctx.fillStyle='rgba(0,0,0,.06)';ctx.font=`bold ${W*.5}px serif`;ctx.fillText('"',W*.04,H*.42);}
    function _tplAurora(ctx,W,H,t){ctx.fillStyle='#020c18';ctx.fillRect(0,0,W,H);[['#00ffa3',H*.3],['#7b2fff',H*.5],['#25f4ee',H*.2]].forEach(([col,cy],i)=>{const wave=cy+30*Math.sin(t*.5+i*1.5);const g=ctx.createLinearGradient(0,wave-60,0,wave+60);g.addColorStop(0,'transparent');g.addColorStop(.5,col+'55');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,wave-60,W,120);});}
    function _tplOcean(ctx,W,H,t){const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,'#0072ff');g.addColorStop(1,'#00c6ff');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}
    function _tplMidnight(ctx,W,H,t){ctx.fillStyle='#06061a';ctx.fillRect(0,0,W,H);for(let i=0;i<20;i++){const sx=(Math.sin(i*137)*W+W)%W;const sy=(Math.cos(i*97)*H*.6+H*.1);const sa=.2+.5*Math.abs(Math.sin(t*.3+i));ctx.fillStyle=`rgba(180,140,255,${sa})`;ctx.beginPath();ctx.arc(sx,sy,.6,0,Math.PI*2);ctx.fill();}}
    function _tplGalaxy(ctx,W,H,t){ctx.fillStyle='#03001e';ctx.fillRect(0,0,W,H);const cg=ctx.createRadialGradient(W*.5,H*.4,0,W*.5,H*.4,W*.15);cg.addColorStop(0,'rgba(255,220,255,.25)');cg.addColorStop(1,'transparent');ctx.fillStyle=cg;ctx.fillRect(0,0,W,H);}
    function _tplPastel(ctx,W,H,t){const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,'#fce4ec');g.addColorStop(.5,'#e1bee7');g.addColorStop(1,'#b3e5fc');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}
    function _tplCotton(ctx,W,H,t){const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,'#fbc2eb');g.addColorStop(.5,'#a6c1ee');g.addColorStop(1,'#ffecd2');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}
    function _tplWhite(ctx,W,H,t){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);ctx.fillStyle='rgba(0,0,0,.08)';ctx.fillRect(W*.2,H*.82,W*.6,1.5);}
    function _tplBlack(ctx,W,H,t){ctx.fillStyle='#111111';ctx.fillRect(0,0,W,H);ctx.fillStyle='rgba(255,255,255,.06)';ctx.fillRect(W*.2,H*.82,W*.6,1.5);}
    function _tplConfetti(ctx,W,H,t){const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,'#ffe0f6');g.addColorStop(1,'#fff0e0');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);const cols=['#fe2c55','#ffb800','#25f4ee','#a259ff','#2dce89'];for(let i=0;i<20;i++){const cx=((Math.sin(i*157+t*.7)*W*2+W))%W;const cy=((t*35*(1+(i%3)*.4)+i*H*.12))%H;ctx.fillStyle=cols[i%5];ctx.beginPath();ctx.arc(cx,cy,3,0,Math.PI*2);ctx.fill();}}
    function _tplRainbow(ctx,W,H,t){const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,'#ff6b6b');g.addColorStop(.2,'#ffa500');g.addColorStop(.4,'#ffe600');g.addColorStop(.6,'#2dce89');g.addColorStop(.8,'#25f4ee');g.addColorStop(1,'#a259ff');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}

    const _TPL_DRAW_FNS = {
        _tplNeon, _tplSunset, _tplGold, _tplAura, _tplNotebook, _tplSticky,
        _tplDark, _tplClean, _tplAurora, _tplOcean, _tplMidnight, _tplGalaxy,
        _tplPastel, _tplCotton, _tplWhite, _tplBlack, _tplConfetti, _tplRainbow,
    };

    function getTemplate(templateId) {
        return TXT_TEMPLATES.find(t => t.id === templateId) || TXT_TEMPLATES[0];
    }

    function drawTemplateBackground(templateId, ctx, w, h, t) {
        const tpl = getTemplate(templateId);
        const fn = _TPL_DRAW_FNS[tpl.draw];
        if (fn) fn(ctx, w, h, t);
        return tpl;
    }

    // ─── Utilities for sound rendering ──────────────────────────────────

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    function fmtNum(n) {
        n = n || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(n);
    }

    // ─── Resolve the sound_id for a post ────────────────────────────
    // NOW: ONLY returns a real sound_id from the posts table.
    // No fallback/synthetic IDs are invented. If there's no sound_id,
    // returns null.
    function resolveSoundId(post) {
        if (!post) return null;
        return post.sound_id || null;
    }

    // ─── Fetch (and cache) sound metadata for display ───────────────
    // Returns { id, title, creatorHandle, artUrl } or null if the
    // sound can't be resolved (no sound_id in the post, or no row in
    // the sounds table).
    async function getSoundMetaForPost(post) {
        const soundId = resolveSoundId(post);
        if (!soundId) return null;

        if (_soundCache.has(soundId)) {
            return _soundCache.get(soundId);
        }

        const fetchPromise = (async () => {
            try {
                const sound = await SoundsAPI.loadSound(soundId);
                if (sound) {
                    const handle = sound.creator
                        ? '@' + (sound.creator.username || sound.creator.displayName || 'user')
                        : '';
                    const meta = {
                        id: sound.id,
                        title: sound.title || 'Original sound',
                        creatorHandle: handle,
                        artUrl: sound.artUrl || '',
                    };
                    _soundCache.set(soundId, meta);
                    return meta;
                }
            } catch (e) {
                console.warn('getSoundMetaForPost: SoundsAPI.loadSound failed', e);
            }
            // Sound not found – cache null so we don't retry
            _soundCache.set(soundId, null);
            return null;
        })();

        _soundCache.set(soundId, fetchPromise);
        return fetchPromise;
    }

    function clearSoundCache() {
        _soundCache.clear();
    }

    // ─── Navigation ───────────────────────────────────────────────────
    function openSoundPage(soundId) {
        if (!soundId) return;
        if (window.Router && typeof window.Router.openSound === 'function') {
            window.Router.openSound(soundId);
        } else {
            window.location.href = 'sound.html?id=' + encodeURIComponent(soundId);
        }
    }

    async function openSoundPageForPost(post) {
        const meta = await getSoundMetaForPost(post);
        if (meta) openSoundPage(meta.id);
    }

    // ─── Render: sound pill (the "🎵 title · @handle" bar under a video) ──
    function renderSoundPillHTML(meta, idx) {
        if (!meta) return '';
        const label = meta.creatorHandle
            ? `${escapeHtml(meta.title)} · ${escapeHtml(meta.creatorHandle)}`
            : escapeHtml(meta.title);
        return `
            <div class="v-music-tag" onclick="event.stopPropagation(); VideoRender.openSoundPage('${meta.id}')" title="View sound details">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                <span class="sound-label">${label}</span>
            </div>`;
    }

    // ─── Render: sound disc (the small spinning circular art icon) ──────
    function renderSoundDiscHTML(meta, creatorFallbackSeed) {
        if (!meta) return '';
        const art = meta.artUrl || '';
        const seed = encodeURIComponent(meta.title || creatorFallbackSeed || 'sound');
        return `
            <div class="v-disc-wrap" onclick="event.stopPropagation(); VideoRender.openSoundPage('${meta.id}')" title="View sound details">
                <div class="v-disc">
                    <img src="${art}" alt="sound" onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}'">
                </div>
                <div class="v-disc-note">
                    <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
            </div>`;
    }

    // ─── Hydrate: attach a post's resolved sound meta into a card's DOM ──
    // Convenience helper for pages that build cards synchronously (with
    // a placeholder) and want to fill in the real sound title/handle
    // once the async lookup resolves, without re-rendering the whole card.
    async function hydrateSoundLabel(post, labelEl) {
        if (!labelEl) return;
        const meta = await getSoundMetaForPost(post);
        if (!meta) {
            labelEl.textContent = 'Original sound';
            return;
        }
        labelEl.textContent = meta.creatorHandle
            ? `${meta.title} · ${meta.creatorHandle}`
            : meta.title;
        labelEl.closest('[data-sound-target]')?.setAttribute('data-sound-id', meta.id);
    }

    // ─── EXPOSE PUBLIC API ────────────────────────────────────────────
    window.VideoRender = {
        // Sound
        resolveSoundId,
        getSoundMetaForPost,
        clearSoundCache,
        openSoundPage,
        openSoundPageForPost,
        renderSoundPillHTML,
        renderSoundDiscHTML,
        hydrateSoundLabel,

        // Text‑card templates (shared)
        TXT_TEMPLATES,
        getTemplate,
        drawTemplateBackground,
    };

})();
