// Extends existing Profile panels; identity, header, primary tabs and Market stay owned by Profile.
(function () {
  "use strict";
  let generation = 0,
    preview = null,
    notesFrame = null,
    notesRoot = null,
    context = null,
    viewer = null;
  const categories = new Map();
  const escape = (s) =>
    String(s || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function pause() {
    preview?.dispose();
    preview = null;
    notesFrame?.contentWindow?.ProfileNotesRenderer?.pause();
  }
  function scope() {
    const u = window.AuthUser?.getCurrentUser();
    return u?.isLoggedIn ? u.id : "guest";
  }
  function closeViewer() {
    if (!viewer) return;
    const scroll = viewer.scroll;
    viewer.frame.contentWindow?.FreeUpperVideoPlayer?.dispose();
    viewer.frame.contentWindow?.FreeUpperScreen?.dispose();
    viewer.element.remove();
    viewer = null;
    window.FreeUpperProfileShell?.setOverlay(window, false);
    window.FreeUpperScreen?.ensureCoordinator?.().then((c) =>
      c?.setOverlay(window, false),
    );
    document.querySelectorAll("bottom-nav,side-nav").forEach((n) => {
      n.inert = false;
      n.hidden = false;
    });
    document.body.style.overflow = "";
    const url = new URL(location.href);
    url.searchParams.delete("gallery");
    url.searchParams.delete("galleryOwner");
    url.searchParams.delete("post");
    history.replaceState({ ...history.state, fuGallery: undefined }, "", url);
    if (context)
      render(context).then(() =>
        requestAnimationFrame(() => {
          const main = document.getElementById("mainScroll");
          if (main) main.scrollTop = scroll;
        }),
      );
  }
  function open(owner, tab, post, push = true) {
    pause();
    if (viewer) closeViewer();
    const element = document.createElement("div");
    element.className = "gallery-overlay";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", "Gallery viewer");
    element.setAttribute("aria-modal", "true");
    const frame = document.createElement("iframe");
    frame.title = "Gallery viewer";
    frame.src =
      "/gallery-viewer.html?owner=" +
      encodeURIComponent(owner) + "&tab=" + encodeURIComponent(tab) +
      "&post=" +
      encodeURIComponent(post);
    const close = document.createElement("button");
    close.className = "gallery-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close Gallery");
    close.onclick = () =>
      history.state?.fuGallery ? history.back() : closeViewer();
    element.append(frame, close);
    document.body.append(element);
    viewer = {
      element,
      frame,
      close,
      scope: scope(),
      scroll: document.getElementById("mainScroll")?.scrollTop || 0,
    };
    document.body.style.overflow = "hidden";
    document.querySelectorAll("bottom-nav,side-nav").forEach((n) => {
      n.inert = true;
      n.hidden = true;
    });
    window.FreeUpperScreen?.ensureCoordinator?.().then((c) =>
      c?.setOverlay(window, true),
    );
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set("gallery", "1");
      url.searchParams.set("galleryOwner", owner);
      url.searchParams.set("post", post);
      history.pushState(
        { ...history.state, fuGallery: { owner, tab, post, viewer: scope() } },
        "",
        url,
      );
    }
    frame.focus();
  }
  async function notes(root, posts, version) {
    if (!posts.length) {
      root.innerHTML = '<div class="empty-state"><h3>No Notes yet</h3></div>';
      return;
    }
    if (!notesFrame) {
      notesFrame = document.createElement("iframe");
      notesFrame.className = "profile-notes-frame";
      notesFrame.title = "Profile Notes";
      notesFrame.style.visibility = "hidden";
      notesFrame.src =
        "/index.html?from=profile-overlay&profileShell=1&profileNotes=1";
    }
    notesRoot = root;
    root.replaceChildren(notesFrame);
    const started = Date.now();
    const show = async () => {
      if (Date.now() - started > 15000) {
        root.textContent = "Notes could not load. Please try again.";
        return;
      }
      if (version !== generation) return;
      const bridge = notesFrame.contentWindow?.ProfileNotesRenderer;
      if (bridge && notesFrame.contentWindow?.renderProfileNotes) {
        await bridge.show(posts, scope());
        notesFrame.style.visibility = "visible";
        return;
      }
      if (notesFrame.isConnected) setTimeout(show, 80);
    };
    show();
  }
  async function render(next, offset = 0, accumulated = []) {
    context = next;
    const { container, tab, owner, openPost } = next;
    const route = new URL(location.href);
    if (route.searchParams.has("gallery") && !viewer) {
      open(
        route.searchParams.get("galleryOwner") || owner, tab,
        route.searchParams.get("post"),
        false,
      );
    }
    if (!["posts", "love", "share", "star"].includes(tab)) return false;
    pause();
    const version = ++generation;
    const category =
      categories.get(owner + ":" + tab) ||
      (route.searchParams.get("tab") === tab &&
      route.searchParams.get("content") === "gallery"
        ? "gallery"
        : "notes");
    container.replaceChildren();
    const nav = document.createElement("div");
    nav.className = "profile-content-tabs";
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", tab + " content");
    for (const name of ["notes", "gallery"]) {
      const b = document.createElement("button");
      b.textContent = name === "notes" ? "Notes" : "Gallery";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(name === category));
      b.onclick = () => {
        categories.set(owner + ":" + tab, name);
        const url = new URL(location.href);
        url.searchParams.set("tab", tab);
        url.searchParams.set("content", name);
        history.replaceState(history.state, "", url);
        render(next);
      };
      nav.append(b);
    }
    const root = document.createElement("div");
    container.append(nav, root);
    if (tab === "star" && owner !== scope()) {
      root.innerHTML =
        '<div class="empty-state">Saved content is private.</div>';
      return true;
    }
    root.innerHTML = '<div class="empty-state">Loading…</div>';
    function more(page, items) {
      if (!(page.hasMore ?? page.length >= 24)) return;
      const button = document.createElement("button");
      button.className = "act-btn";
      button.textContent = "Load more";
      button.onclick = () => render(next, page.nextOffset ?? offset + page.length, items);
      root.append(button);
    }
    try {
      if (category === "notes") {
        const page = await GalleryAPI.notes(owner, tab, offset);
        const posts = [...accumulated, ...page];
        if (version === generation) {
          await notes(root, posts, version);
          more(page, posts);
        }
      } else {
        const page = await GalleryAPI.profile(owner, tab, offset);
        const rows = [...accumulated, ...page];
        if (version !== generation) return true;
        root.innerHTML = rows.length
          ? '<div class="grid-3">' +
            rows
              .map((r, i) => {
                const p = r.post;
                const template=document.createElement('template');
                template.innerHTML=next.cardHTML(p);
                const card=template.content.firstElementChild;
                card.removeAttribute('onclick');
                card.dataset.galleryIndex=i;
                card.setAttribute('role','button');card.tabIndex=0;
                card.querySelectorAll('video').forEach(v=>v.remove());
                const video=document.createElement('video');
                video.className='gallery-preview';video.muted=true;video.playsInline=true;video.preload='none';
                video.poster=p.thumbnailUrl||'';
                video.dataset.previewSrc=p.protectedMedia?'':p.mediaUrl;
                video.dataset.previewAsset=p.protectedMedia?p.media?.[0]?.assetId||'':'';
                card.append(video);
                return card.outerHTML;
              })
              .join("") +
            "</div>"
          : '<div class="empty-state"><h3>No Gallery yet</h3></div>';
        root.querySelectorAll("[data-gallery-index]").forEach(
          (b) =>
            (b.onclick = () => {
              const r = rows[Number(b.dataset.galleryIndex)];
              open(owner,tab,r.post.id);
            }),
        );
        root.querySelectorAll('[data-gallery-index]').forEach(b=>b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();b.click();}});
        preview = new window.GalleryPreviews(root);
        more(page, rows);
      }
    } catch (error) {
      if (version === generation)
        root.innerHTML =
          '<div class="empty-state"><h3>Content unavailable</h3><p>Please try again later.</p></div>';
      console.warn("Profile content failed", error);
    }
    return true;
  }
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin) return;
    if (e.source === notesFrame?.contentWindow) {
      if (e.data?.type === "fu-notes-overlay") {
        const visible = !!e.data.visible;
        notesFrame.dataset.overlay = String(visible);
        Object.assign(notesFrame.style, {
          position: visible ? "fixed" : "",
          inset: visible ? "0" : "",
          zIndex: visible ? "21000" : "",
          height: visible
            ? "100dvh"
            : (notesFrame.dataset.height || "180") + "px",
        });
        window.FreeUpperScreen?.ensureCoordinator?.().then((c) =>
          c?.setOverlay(window, visible),
        );
      }
      if (e.data?.type === "fu-notes-height") {
        notesFrame.dataset.height = String(
          Math.min(100000, Math.max(180, Number(e.data.height) || 180)),
        );
        if (notesFrame.dataset.overlay !== "true")
          notesFrame.style.height =
            Math.min(100000, Math.max(180, Number(e.data.height) || 180)) +
            "px";
      }
      if (e.data?.type === "fu-notes-open") context?.openPost(e.data.id);
    }
    if (e.source === viewer?.frame.contentWindow && e.data?.type === 'fu-gallery-sound') {
      const active = e.data.active === true;
      viewer.close.hidden = active;
      viewer.close.inert = active;
      viewer.close.style.display = active ? 'none' : '';
    }
    if (
      e.source === viewer?.frame.contentWindow &&
      e.data?.type === "fu-gallery-post"
    ) {
      const state = history.state?.fuGallery;
      if (state) {
        const url = new URL(location.href);
        url.searchParams.set("post", e.data.post);
        history.replaceState(
          { ...history.state, fuGallery: { ...state, post: e.data.post } },
          "",
          url,
        );
      }
    }
    if (
      e.data?.type === "fu-content-change" &&
      (e.source === notesFrame?.contentWindow ||
        e.source === viewer?.frame.contentWindow) &&
      e.data.detail?.viewer === scope()
    ) {
      window.dispatchEvent(
        new CustomEvent("fu-content-change", { detail: e.data.detail }),
      );
    }
  });
  window.addEventListener("fu-content-change", () => {
    if (context && !viewer) render(context);
  });
  window.addEventListener("popstate", () => {
    const s = history.state?.fuGallery;
    if (s && s.viewer === scope()) {
      if (!viewer) open(s.owner, s.tab, s.post, false);
    } else closeViewer();
  });
  window.addEventListener("pagehide", pause);
  window.sb?.auth?.onAuthStateChange(() => {
    ++generation;
    context = null;
    pause();
    closeViewer();
    notesFrame?.contentWindow?.FreeUpperScreen?.dispose();
    notesFrame?.remove();
    notesFrame = null;
    categories.clear();
  });
  window.FreeUpperScreen?.register({
    suspend: pause,
    resume() {
      if (context && !viewer) render(context);
    },
    dispose() {
      ++generation;
      context = null;
      pause();
      closeViewer();
      notesFrame?.contentWindow?.FreeUpperScreen?.dispose();
      notesFrame?.remove();
      notesFrame = null;
    },
  });
  window.ProfileContent = { render, pause, open, close: closeViewer };
})();
