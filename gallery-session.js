// Existing sound.html is retained as a detail; no second sound implementation.
(function () {
  let viewerClose = null;
  if (parent === window) {
    const back = document.createElement("button");
    back.className = "gallery-close";
    back.textContent = "×";
    back.setAttribute("aria-label", "Close Gallery");
    back.onclick = () =>
      history.length > 1 ? history.back() : location.assign("/profile");
    document.body.append(back);
    viewerClose = back;
  }
  let detail = null,
    snapshot = null,
    version = 0;
  function soundActive(active) {
    if (viewerClose) {
      viewerClose.hidden = active;
      viewerClose.inert = active;
    }
    if (parent !== window)
      parent.postMessage({type:'fu-gallery-sound',active},location.origin);
  }
  function stop() {
    detail?.frame.contentWindow?.stopAudioPlayback?.();
    detail?.frame.contentWindow?.document
      .querySelectorAll("audio,video")
      .forEach((v) => v.pause());
  }
  async function close() {
    if (!detail) return;
    stop();
    detail.element.remove();
    detail = null;
    soundActive(false);
    const v = ++version;
    await window.FreeUpperVideoPlayer.restore(snapshot);
    if (v !== version) window.FreeUpperVideoPlayer.pause();
  }
  window.GallerySession = {
    async sound(id) {
      if (!id || detail) return;
      try {
        await window.GalleryAPI.ensureSound(id);
      } catch (_) {
        return;
      }
      snapshot = window.FreeUpperVideoPlayer.snapshot();
      window.FreeUpperVideoPlayer.pause();
      const element = document.createElement("div");
      element.className = "gallery-overlay";
      const frame = document.createElement("iframe");
      frame.title = "Sound details";
      frame.src =
        "/sound.html?id=" + encodeURIComponent(id) + "&galleryDetail=1";
      // Keep sound.html's own Back control unobstructed.
      element.append(frame);
      soundActive(true);
      document.body.append(element);
      detail = { element, frame };
      history.pushState({ ...history.state, gallerySound: id }, "");
    },
  };
  window.addEventListener("popstate", (e) => {
    if (!e.state?.gallerySound) close();
  });
  window.addEventListener("pagehide", () => {
    stop();
    window.FreeUpperVideoPlayer?.dispose();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
      window.FreeUpperVideoPlayer?.pause();
    }
  });
  window.addEventListener("message", (e) => {
    if (
      e.origin === location.origin &&
      e.source === detail?.frame.contentWindow &&
      e.data?.type === "fu-sound-back"
    )
      history.back();
  });
})();
