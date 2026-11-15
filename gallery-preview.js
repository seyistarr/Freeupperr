// One observer and one decoder owner per grid. No catalogue audio in previews.
(function () {
  class GalleryPreviews {
    constructor(root) {
      this.root = root;
      this.visible = new Map();
      this.active = null;
      this.disposed = false;
      this.revision = 0;
      this.blob = null;
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            this.visible.set(
              e.target,
              e.isIntersecting ? e.intersectionRatio : 0,
            );
          this.choose();
        },
        { threshold: [0, 0.6, 0.8, 1] },
      );
      this.preferences = () => this.choose();
      this.reduced.addEventListener?.('change',this.preferences);
      navigator.connection?.addEventListener?.('change',this.preferences);
      this.visibility = () => (document.hidden ? this.pause() : this.choose());
      document.addEventListener("visibilitychange", this.visibility);
      root
        .querySelectorAll("video[data-preview-src]")
        .forEach((v) => this.observer.observe(v));
    }
    choose() {
      if (
        this.disposed ||
        document.hidden ||
        this.reduced.matches ||
        navigator.connection?.saveData ||
        window.FreeUpperScreen?.isActive?.() === false
      ) {
        this.pause();
        return;
      }
      const candidates = [...this.visible]
        .filter(([v, r]) => r >= 0.6 && v.isConnected)
        .sort((a, b) => b[1] - a[1]);
      const next = candidates[0]?.[0];
      if (next === this.active) return;
      this.pause();
      if (!next) return;
      if (!next.dataset.previewSrc && !next.dataset.previewAsset) return;
      this.active = next;
      next.muted = true;
      next.playsInline = true;
      const revision = this.revision;
      Promise.resolve(
        next.dataset.previewAsset
          ? window.FreeUpperProtectedMedia.asset(
              next.dataset.previewAsset,
              "video",
            )
          : next.dataset.previewSrc,
      )
        .then((src) => {
          if (
            this.disposed ||
            this.active !== next ||
            revision !== this.revision
          ) {
            if (next.dataset.previewAsset)
              window.FreeUpperProtectedMedia.release(src);
            return;
          }
          if (next.dataset.previewAsset) this.blob = src;
          next.src = src;
          return window.FreeUpperInlineVideo.play(next);
        })
        .catch(() => {
          if (this.active === next) this.pause();
        });
    }
    pause() {
      this.revision++;
      if (this.blob) {
        window.FreeUpperProtectedMedia?.release(this.blob);
        this.blob = null;
      }
      const old = this.active;
      this.active = null;
      if (old) {
        window.FreeUpperInlineVideo.pause(old);
        old.removeAttribute("src");
        old.load();
      }
    }
    dispose() {
      this.disposed = true;
      this.pause();
      this.observer.disconnect();
      this.reduced.removeEventListener?.('change',this.preferences);
      navigator.connection?.removeEventListener?.('change',this.preferences);
      document.removeEventListener("visibilitychange", this.visibility);
      this.visible.clear();
    }
  }
  window.GalleryPreviews = GalleryPreviews;
})();
