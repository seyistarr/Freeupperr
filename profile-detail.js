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
        style.textContent = '#profileDetail{position:fixed;inset:0;z-index:20000;background:var(--bg);color:var(--text)}#profileDetail[hidden]{display:none}#profileDetail iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:var(--bg);visibility:hidden}.profile-detail-status{padding:calc(env(safe-area-inset-top,0px) + 16px) 20px calc(env(safe-area-inset-bottom,0px) + 16px)}.profile-detail-status button{background:var(--bg3);color:var(--text);border:1px solid var(--brd);border-radius:20px;padding:10px 16px;cursor:pointer}';
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        const status = overlay.querySelector('.profile-detail-status');
        let frame = null, current = null, currentDetail = null, ready = false, failed = false, scroll = 0, focus = null;
        function sendVisibility(visible) {
            frame?.contentWindow?.postMessage({type:'fu-profile-detail-visibility',visible,theme:document.documentElement.dataset.theme},location.origin);
        }
        function show(detail, retry = false) {
            currentDetail = detail;
            if (overlay.hidden) { scroll = main.scrollTop; focus = document.activeElement; }
            overlay.hidden = false;
            main.inert = true;
            const key = detail.kind + ':' + detail.id;
            if (current !== key || (failed && retry)) {
                frame?.remove(); // One retained detail document, never an accumulating frame cache.
                frame = document.createElement('iframe');
                frame.title = detail.kind === 'product' ? 'Listing detail' : 'Post detail';
                frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
                frame.allowFullscreen = true;
                frame.src = '/index.html?' + (detail.kind === 'product' ? 'product=' : 'post=') + encodeURIComponent(detail.id) + '&from=profile-overlay';
                current = key; ready = false; failed = false;
                frame.addEventListener('error', event => {
                    if (event.currentTarget !== frame) return;
                    failed = true;
                    status.hidden = false;
                    status.querySelector('p').textContent = 'Could not load this content. Go back and try again.';
                });
                overlay.appendChild(frame);
            }
            status.hidden = ready && !failed;
            status.querySelector('p').textContent = failed ? 'This content is unavailable or private.' : 'Loading…';
            frame.style.visibility = ready && !failed ? 'visible' : 'hidden';
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
            const detail = {kind,id,profile:base.href};
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
            open,
            restore() {
                const params = new URL(location.href).searchParams;
                const id = params.get('profilePost') || params.get('profileProduct');
                if (id) open(params.has('profileProduct')?'product':'post',id,false);
            },
            popstate(e) {
                if (e.state?.fuProfileDetail?.profile === base.href) { show(e.state.fuProfileDetail); return true; }
                if (e.state?.fuProfileBase === base.href) { hide(); return true; }
                return false;
            },
            destroy() { sendVisibility(false);window.removeEventListener('message',message);frame?.remove();overlay.remove();style.remove();main.inert=false; }
        };
    };
})();
