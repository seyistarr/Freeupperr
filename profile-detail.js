// Preserve the Profile document while reusing the existing index post/market renderer.
(function () {
    'use strict';
    window.createProfileDetailNavigation = function (options) {
        const main = document.getElementById('mainScroll');
        const base = new URL(location.href);
        base.searchParams.delete('profilePost');
        base.searchParams.delete('profileProduct');
        const overlay = document.createElement('section');
        overlay.id = 'profileDetail';
        overlay.hidden = true;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Content detail');
        overlay.innerHTML = '<div class="profile-detail-status"><button type="button" aria-label="Back to profile">← Back</button><p role="status">Loading…</p></div>';
        const style = document.createElement('style');
        style.textContent = `
            #profileDetail{position:fixed;inset:0;z-index:20000;background:transparent;color:var(--text)}
            #profileDetail[data-state="ready"]{background:var(--bg)}
            #profileDetail[hidden]{display:none}
            #profileDetail iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:var(--bg);visibility:hidden}
            .profile-detail-status{position:absolute;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 24px);box-sizing:border-box;max-width:440px;margin:0 auto;padding:16px;display:flex;align-items:center;gap:16px;border:1px solid var(--brd);border-radius:16px;background:var(--bg3);color:var(--text);box-shadow:0 8px 30px rgba(0,0,0,.18)}
            .profile-detail-status[hidden]{display:none}
            .profile-detail-status p{margin:0;font-size:14px;line-height:1.4}
            .profile-detail-status button{flex-shrink:0;background:var(--bg3);color:var(--text);border:1px solid var(--brd);border-radius:20px;padding:10px 16px;cursor:pointer}
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        const status = overlay.querySelector('.profile-detail-status');
        let frame = null, current = null, currentDetail = null, ready = false, failed = false, scroll = 0, focus = null;
        let booted = false, version = 0, viewer = options.getViewer?.(), rendered = null;
        const cache = new Map(), requests = new Map();
        function resetViewer() {
            ++version;cache.clear();requests.clear();frame?.remove();frame=null;booted=false;rendered=null;
            current=null;currentDetail=null;ready=false;failed=false;viewer=options.getViewer?.();
            if(history.state?.fuProfileDetail && history.state.fuProfileDetail.viewer!==viewer)history.replaceState({fuProfileBase:base.href},'',base);
            overlay.hidden=true;main.inert=false;
        }
        function makeFrame(detail, shell = false) {
            frame?.remove();booted=false;rendered=null;
            frame=document.createElement('iframe');frame.title=detail.kind==='product'?'Listing detail':'Post detail';
            frame.allow='autoplay; fullscreen; encrypted-media; picture-in-picture';frame.allowFullscreen=true;
            frame.src=shell ? '/index.html?from=profile-overlay&profileShell=1' : '/index.html?'+(detail.kind==='product'?'product=':'post=')+encodeURIComponent(detail.id)+'&from=profile-overlay';
            frame.addEventListener('error',event=>{if(event.currentTarget!==frame)return;failed=true;paint();status.querySelector('p').textContent='Could not load this content. Go back and try again.';});
            overlay.appendChild(frame);
        }
        function refreshPost(id, scope) {
            if (requests.has(id)) return requests.get(id);
            const revision=frame?.contentWindow?.ProfilePostRenderer?.revision || 0;
            const epoch=version;
            const request=Promise.resolve().then(()=>options.loadPost(id)).then(post=>{
                if(scope!==options.getViewer() || scope!==viewer || epoch!==version)return;
                if(post && revision!==(frame?.contentWindow?.ProfilePostRenderer?.revision || 0))return;
                cache.set(id,post || null);
                if(post) options.sync?.({posts:[post]});
                if(!post) options.revoke?.(id);
                if(currentDetail?.kind!=='post'||currentDetail.id!==id)return;
                if(!post){++version;frame?.contentWindow?.ProfilePostRenderer?.clear();ready=true;failed=true;paint();status.querySelector('p').textContent='This content is unavailable or private.';}
                else if(booted){
                    if(rendered===id)frame.contentWindow.ProfilePostRenderer.refresh(post,scope,revision);
                    else renderCached(post);
                }
            }).catch(()=>{
                if(scope!==viewer || epoch!==version)return;
                cache.set(id,null);
                if(currentDetail?.id===id){frame?.contentWindow?.ProfilePostRenderer?.clear();ready=true;failed=true;paint();status.querySelector('p').textContent='Could not verify this post. Go back and try again.';}
            }).finally(()=>{if(requests.get(id)===request)requests.delete(id);});
            requests.set(id,request);return request;
        }
        function renderCached(post) {
            if(!booted || !post || overlay.hidden)return;
            const accepted=frame.contentWindow.ProfilePostRenderer.open(post,viewer);
            ready=true;failed=!accepted;rendered=accepted?post.id:null;paint();
            sendVisibility(true);
        }
        function warm() {
            if(!options.getPost || frame)return;
            viewer=options.getViewer();makeFrame({kind:'post'},true);
        }
        function paint() {
            const available = ready && !failed;
            // Keep Profile visible until the existing renderer has meaningful content.
            overlay.dataset.state = available ? 'ready' : failed ? 'error' : 'loading';
            overlay.setAttribute('aria-busy', String(!ready && !failed));
            status.hidden = available;
            frame.style.visibility = available ? 'visible' : 'hidden';
        }
        function sendVisibility(visible) {
            try{const screen=frame?.contentWindow?.FreeUpperScreen;if(visible && (!window.FreeUpperScreen || window.FreeUpperScreen.isActive()))screen?.resume();else screen?.suspend();}catch(_){}
            frame?.contentWindow?.postMessage({type:'fu-profile-detail-visibility',visible,theme:document.documentElement.dataset.theme},location.origin);
        }
        function show(detail, retry = false) {
            currentDetail = detail;
            if (overlay.hidden) { scroll = main.scrollTop; focus = document.activeElement; }
            overlay.hidden = false;
            main.inert = true;
            const key = detail.kind + ':' + detail.id;
            const fast=detail.kind==='post' && options.getPost;
            if(fast){
                if(viewer!==options.getViewer())resetViewer();
                currentDetail=detail;overlay.hidden=false;main.inert=true;
                if(!frame || !frame.src.includes('profileShell=1'))makeFrame(detail,true);
                if(current!==key || failed){ready=false;failed=false;}
                current=key;
                const post=cache.has(detail.id)?cache.get(detail.id):options.getPost(detail.id);
                if(post){cache.set(detail.id,post);if(rendered!==detail.id || !ready)renderCached(post);}
                refreshPost(detail.id,viewer);
            }else if (current !== key || (failed && retry)) {
                makeFrame(detail);current=key;ready=false;failed=false;
            }
            paint();
            status.querySelector('p').textContent = failed ? 'This content is unavailable or private.' : 'Loading…';
            sendVisibility(true);
            if (!ready || failed) status.querySelector('button').focus();
        }
        function hide() {
            sendVisibility(false);
            overlay.hidden = true;
            main.inert = false;
            const behavior = main.style.scrollBehavior;
            main.style.scrollBehavior = 'auto';
            main.scrollTop = scroll;
            main.style.scrollBehavior = behavior;
            if (focus?.isConnected) focus.focus({preventScroll:true});
        }
        function back() { if (!overlay.hidden) history.back(); }
        status.querySelector('button').addEventListener('click', back);
        function open(kind, id, push = true) {
            if (!id || !['post','product'].includes(kind)) return;
            if (!overlay.hidden && current === kind + ':' + id) return;
            const detail = {kind,id,profile:base.href,viewer:options.getViewer?.()};
            if (push) {
                history.replaceState({...history.state,fuProfileBase:base.href},'',base.href);
                const url = new URL(base);
                url.searchParams.set(kind === 'product' ? 'profileProduct' : 'profilePost',id);
                history.pushState({fuProfileDetail:detail},'',url);
            }
            show(detail,true);
        }
        const message = e => {
            if (e.origin !== location.origin || e.source !== frame?.contentWindow) return;
            if(e.data?.type==='fu-profile-detail-boot'){
                booted=true;
                if(currentDetail?.kind==='post' && !overlay.hidden){
                    const post=cache.has(currentDetail.id)?cache.get(currentDetail.id):options.getPost(currentDetail.id);
                    renderCached(post);
                }
                return;
            }
            if (e.data?.type === 'fu-profile-detail-ready') {
                ready = true; failed = !e.data.available;
                if (!overlay.hidden) show(currentDetail);
                sendVisibility(!overlay.hidden);
            } else if (e.data?.type === 'fu-profile-detail-back') back();
            else if (e.data?.type === 'fu-profile-detail-state') options.sync?.(e.data);
            else if (e.data?.type === 'fu-profile-detail-follow') options.followChanged?.(e.data.userId);
        };
        window.addEventListener('message',message);
        return {
            open,warm,resetViewer,
            setProfile() {
                // Profile-to-profile navigation retains this document and renderer,
                // but details and history must now belong to the new profile URL.
                ++version;requests.clear();cache.clear();sendVisibility(false);
                frame?.contentWindow?.ProfilePostRenderer?.clear();
                current=null;currentDetail=null;rendered=null;ready=false;failed=false;
                overlay.hidden=true;main.inert=false;
                base.href=location.href;
                base.searchParams.delete('profilePost');
                base.searchParams.delete('profileProduct');
            },
            invalidate(id=currentDetail?.id) {
                ++version;requests.clear();cache.clear();if(!id)return;cache.set(id,null);rendered=null;
                frame?.contentWindow?.ProfilePostRenderer?.clear();ready=false;failed=false;
                if(!overlay.hidden)paint();
                refreshPost(id,viewer);
            },
            restore() {
                const params = new URL(location.href).searchParams;
                const id = params.get('profilePost') || params.get('profileProduct');
                if (id) open(params.has('profileProduct')?'product':'post',id,false);
            },
            popstate(e) {
                if (e.state?.fuProfileDetail?.profile === base.href) { if(options.getViewer && e.state.fuProfileDetail.viewer!==options.getViewer()){resetViewer();return true;} show(e.state.fuProfileDetail); return true; }
                if (e.state?.fuProfileBase === base.href) { hide(); return true; }
                return false;
            },
            destroy() { sendVisibility(false);window.removeEventListener('message',message);frame?.remove();overlay.remove();style.remove();main.inert=false; }
        };
    };
})();
