// Blocking head script: resolve the preference before any page surfaces can paint.
(function () {
  'use strict';
  if (window.applyTheme) return;
  const root = document.documentElement;
  const key = 'freeupper_theme';
  const valid = value => value === 'dark' || value === 'light';
  const read = () => { try { return localStorage.getItem(key); } catch (_) { return null; } };
  let theme = valid(read()) ? read() : 'dark';
  let ready = false;
  let timer;
  let colorAnimations = [];
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  root.classList.add('theme-initializing');

  function syncThemeColorMeta() {
    const color = theme === 'dark' ? '#000000' : '#ffffff';
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
      if (meta.content !== color) meta.content = color;
    });
  }
  function applyTheme(next, persist = true) {
    if (!valid(next)) return;
    if (persist && read() !== next) {
      try { localStorage.setItem(key, next); } catch (_) {}
    }
    if (root.getAttribute('data-theme') === next && theme === next) return;
    // Pin text/icon colors to explicit endpoints while backgrounds and borders
    // use CSS transitions. Animating inherited color on every descendant with
    // CSS would restart child transitions on each parent animation frame.
    const animate = ready && !motion.matches;
    const properties = ['color', 'fill', 'stroke'];
    const nodes = animate && typeof root.animate === 'function'
      ? [root, ...document.querySelectorAll('body, body *')]
      : [];
    const before = nodes.map(node => {
      const style = getComputedStyle(node);
      return properties.map(property => style[property]);
    });
    colorAnimations.forEach(animation => animation.cancel());
    colorAnimations = [];
    if (animate) {
      root.classList.add('theme-changing');
      // Install the transition rules before changing the target colors.
      void root.offsetWidth;
      clearTimeout(timer);
      timer = setTimeout(() => {
        root.classList.remove('theme-changing');
        colorAnimations = [];
      }, 280);
    }
    theme = next;
    root.setAttribute('data-theme', next);
    root.style.colorScheme = next;
    root.style.backgroundColor = next === 'dark' ? '#000000' : '#ffffff';
    syncThemeColorMeta();
    // Read every target before starting animations: inherited values must all
    // resolve against the new theme, rather than an ancestor's animated color.
    const after = nodes.map(node => {
      const style = getComputedStyle(node);
      return properties.map(property => style[property]);
    });
    const startTime = nodes.length ? document.timeline.currentTime : null;
    nodes.forEach((node, index) => {
      const from = {}, to = {};
      properties.forEach((property, part) => {
        if (before[index][part] !== after[index][part]) {
          from[property] = before[index][part];
          to[property] = after[index][part];
        }
      });
      if (!Object.keys(to).length) return;
      const animation = node.animate([from, to], {
        duration: 225, easing: 'cubic-bezier(.4, 0, .2, 1)'
      });
      animation.startTime = startTime;
      colorAnimations.push(animation);
    });
    document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: next } }));
  }
  window.applyTheme = applyTheme;
  window.getCurrentTheme = () => theme;
  window.toggleTheme = () => applyTheme(theme === 'dark' ? 'light' : 'dark');
  window.syncThemeColorMeta = syncThemeColorMeta;
  // Initial application is silent and never transitions.
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'dark' ? '#000000' : '#ffffff';
  syncThemeColorMeta();
  function reconcile() { applyTheme(valid(read()) ? read() : 'dark', false); }
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) reconcile();
  });
  window.addEventListener('pageshow', reconcile);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconcile();
  });
  document.addEventListener('DOMContentLoaded', () => {
    syncThemeColorMeta();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.remove('theme-initializing');
      ready = true;
    }));
  }, { once: true });
  motion.addEventListener('change', () => {
    if (motion.matches) {
      clearTimeout(timer);
      colorAnimations.forEach(animation => animation.cancel());
      colorAnimations = [];
      root.classList.remove('theme-changing');
    }
  });
})();
