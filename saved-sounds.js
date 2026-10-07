/* ═══════════════════════════════════════════════════════════════
   FREEUPPER — SAVED SOUNDS
   Uses SoundsAPI as the single source of truth.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  let savedSounds = [];
  let previewAudio = null;
  let activePreviewId = null;
  let activePreviewButton = null;

  const $ = (selector) => document.querySelector(selector);

  function escape(value) {
    if (typeof window.escapeHtml === 'function') {
      return window.escapeHtml(String(value ?? ''));
    }

    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showMessage(message) {
    if (typeof window.showToast === 'function') {
      window.showToast(message);
      return;
    }

    const toast = $('#toast');

    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  function getSoundArt(sound) {
    const creator = sound?.creator || {};

    return (
      sound?.artUrl ||
      creator.avatarUrl ||
      null
    );
  }

  function getCreatorName(sound) {
    const creator = sound?.creator || {};

    if (creator.username) {
      return `@${creator.username}`;
    }

    return creator.displayName || '';
  }

  function getSoundPlaceholder(sound) {
    const title = sound?.title || 'sound';

    return `
      <div
        class="saved-sound-art saved-sound-music-icon"
        aria-label="${escape(title)}"
      >
        ♪
      </div>
    `;
  }

  function renderSoundArtwork(sound) {
    const art = getSoundArt(sound);

    if (!art) {
      return getSoundPlaceholder(sound);
    }

    return `
      <img
        class="saved-sound-art"
        src="${escape(art)}"
        alt=""
        loading="lazy"
        onerror="
          this.style.display='none';
          this.nextElementSibling.style.display='flex';
        "
      >

      <div
        class="saved-sound-art saved-sound-music-icon"
        style="display:none;"
        aria-hidden="true"
      >
        ♪
      </div>
    `;
  }

  function stopPreview() {
    if (previewAudio) {
      previewAudio.pause();

      try {
        previewAudio.currentTime = 0;
      } catch (_) {}
    }

    if (activePreviewButton) {
      activePreviewButton.textContent = '▶';
      activePreviewButton.setAttribute(
        'aria-label',
        'Play sound'
      );
    }

    previewAudio = null;
    activePreviewId = null;
    activePreviewButton = null;
  }

  function togglePreview(sound, button) {
    if (!sound?.id) return;

    if (!sound.audioUrl) {
      showMessage('This sound cannot be previewed');
      return;
    }

    /*
     * Same sound:
     * pause/resume instead of creating another Audio object.
     */
    if (
      previewAudio &&
      activePreviewId === sound.id
    ) {
      if (previewAudio.paused) {
        previewAudio.play()
          .then(() => {
            button.textContent = 'Ⅱ';
            button.setAttribute(
              'aria-label',
              'Pause sound'
            );
          })
          .catch(() => {
            showMessage('Unable to play this sound');
          });
      } else {
        previewAudio.pause();

        button.textContent = '▶';
        button.setAttribute(
          'aria-label',
          'Play sound'
        );
      }

      return;
    }

    // Only one sound can play at a time.
    stopPreview();

    const audio = new Audio(sound.audioUrl);

    previewAudio = audio;
    activePreviewId = sound.id;
    activePreviewButton = button;

    button.textContent = 'Ⅱ';
    button.setAttribute(
      'aria-label',
      'Pause sound'
    );

    audio.addEventListener('ended', () => {
      if (activePreviewButton === button) {
        button.textContent = '▶';
        button.setAttribute(
          'aria-label',
          'Play sound'
        );
      }

      previewAudio = null;
      activePreviewId = null;
      activePreviewButton = null;
    });

    audio.addEventListener('error', () => {
      if (activePreviewButton === button) {
        button.textContent = '▶';
        button.setAttribute(
          'aria-label',
          'Play sound'
        );
      }

      previewAudio = null;
      activePreviewId = null;
      activePreviewButton = null;

      showMessage('Unable to play this sound');
    });

    audio.play().catch((error) => {
      console.error(
        'Saved sound preview failed:',
        error
      );

      stopPreview();
      showMessage('Unable to play this sound');
    });
  }

  async function loadSavedSounds() {
    const list =
      $('#savedSoundsList') ||
      $('#soundList') ||
      $('#saved-sounds-list');

    if (list) {
      list.innerHTML = `
        <div class="sound-empty">
          Loading saved sounds…
        </div>
      `;
    }

    try {
      if (
        !window.SoundsAPI ||
        typeof window.SoundsAPI.loadSavedSounds !== 'function'
      ) {
        throw new Error(
          'SoundsAPI.loadSavedSounds() is unavailable'
        );
      }

      savedSounds =
        await window.SoundsAPI.loadSavedSounds();

      savedSounds = Array.isArray(savedSounds)
        ? savedSounds
        : [];

      renderSavedSounds();

    } catch (error) {
      console.error(
        'Saved Sounds load error:',
        error
      );

      if (list) {
        list.innerHTML = `
          <div class="sound-empty">
            Couldn't load your saved sounds.
            Please try again.
          </div>
        `;
      }
    }
  }

  function renderSavedSounds() {
    const list =
      $('#savedSoundsList') ||
      $('#soundList') ||
      $('#saved-sounds-list');

    if (!list) return;

    if (!savedSounds.length) {
      list.innerHTML = `
        <div class="sound-empty saved-sounds-empty">
          <div class="saved-sounds-empty-icon">♪</div>

          <div class="saved-sounds-empty-title">
            No saved sounds yet
          </div>

          <div class="saved-sounds-empty-text">
            Sounds you save will appear here.
          </div>
        </div>
      `;

      updateSavedCount(0);
      return;
    }

    updateSavedCount(savedSounds.length);

    list.innerHTML = savedSounds.map((sound) => {
      const creatorName =
        getCreatorName(sound);

      const safeSound =
        JSON.stringify(sound)
          .replace(/\\/g, '\\\\')
          .replace(/'/g, '&#39;');

      return `
        <div
          class="saved-sound-item"
          data-sound-id="${escape(sound.id)}"
        >

          <div class="saved-sound-art-wrap">
            ${renderSoundArtwork(sound)}
          </div>

          <div class="saved-sound-info">

            <div class="saved-sound-title">
              ${escape(
                sound.title || 'Original sound'
              )}
            </div>

            ${
              creatorName
                ? `
                  <div class="saved-sound-creator">
                    ${escape(creatorName)}
                  </div>
                `
                : ''
            }

          </div>

          <div class="saved-sound-actions">

            <button
              type="button"
              class="saved-sound-play"
              aria-label="Play sound"
              onclick='SavedSounds.togglePreview(${safeSound}, this)'
            >
              ▶
            </button>

            <button
              type="button"
              class="saved-sound-use"
              onclick='SavedSounds.useSound(${safeSound})'
            >
              Use
            </button>

            <button
              type="button"
              class="saved-sound-remove"
              aria-label="Remove saved sound"
              onclick='SavedSounds.removeSound(${safeSound.id ? JSON.stringify(sound.id) : "null"}, this)'
            >
              ×
            </button>

          </div>

        </div>
      `;
    }).join('');
  }

  function updateSavedCount(count) {
    const selectors = [
      '#savedSoundsCount',
      '#soundCount',
      '[data-saved-sounds-count]'
    ];

    for (const selector of selectors) {
      const element = $(selector);

      if (element) {
        element.textContent = String(count);
        break;
      }
    }
  }

  async function removeSound(soundId, button) {
    if (!soundId) return;

    stopPreview();

    const item = button?.closest(
      '.saved-sound-item'
    );

    if (button) {
      button.disabled = true;
    }

    try {
      if (
        !window.SoundsAPI ||
        typeof window.SoundsAPI.unsaveSound !== 'function'
      ) {
        throw new Error(
          'SoundsAPI.unsaveSound() is unavailable'
        );
      }

      await window.SoundsAPI.unsaveSound(soundId);

      savedSounds =
        savedSounds.filter(
          sound => sound.id !== soundId
        );

      if (item) {
        item.remove();
      }

      updateSavedCount(savedSounds.length);

      if (!savedSounds.length) {
        renderSavedSounds();
      }

      showMessage('Sound removed from saved sounds');

    } catch (error) {
      console.error(
        'Remove saved sound error:',
        error
      );

      if (button) {
        button.disabled = false;
      }

      showMessage(
        'Could not remove this sound'
      );
    }
  }

  function useSound(sound) {
    if (!sound?.id) {
      showMessage('Unable to use this sound');
      return;
    }

    stopPreview();

    /*
     * Pass the sound to Studio using its ID.
     * Studio will load the authoritative Sound
     * record through SoundsAPI.
     */
    const url =
      `studio.html?sound=${encodeURIComponent(sound.id)}`;

    window.location.href = url;
  }

  function openSound(soundId) {
    if (!soundId) return;

    window.location.href =
      `sound.html?id=${encodeURIComponent(soundId)}`;
  }

  function bindSearch() {
    const input =
      $('#savedSoundsSearch') ||
      $('#soundSearchInput');

    if (!input) return;

    let timer = null;

    input.addEventListener('input', () => {
      clearTimeout(timer);

      timer = setTimeout(() => {
        const query =
          input.value.trim().toLowerCase();

        if (!query) {
          renderSavedSounds();
          return;
        }

        const filtered =
          savedSounds.filter(sound => {
            const creator =
              sound.creator || {};

            const title =
              String(
                sound.title || ''
              ).toLowerCase();

            const artist =
              String(
                sound.artistName || ''
              ).toLowerCase();

            const username =
              String(
                creator.username || ''
              ).toLowerCase();

            const displayName =
              String(
                creator.displayName || ''
              ).toLowerCase();

            return (
              title.includes(query) ||
              artist.includes(query) ||
              username.includes(query) ||
              displayName.includes(query)
            );
          });

        renderFilteredSounds(filtered);
      }, 200);
    });
  }

  function renderFilteredSounds(sounds) {
    const list =
      $('#savedSoundsList') ||
      $('#soundList') ||
      $('#saved-sounds-list');

    if (!list) return;

    if (!sounds.length) {
      list.innerHTML = `
        <div class="sound-empty">
          No saved sounds match your search.
        </div>
      `;
      return;
    }

    /*
     * Temporarily render the filtered collection
     * using the same renderer.
     */
    const original = savedSounds;

    savedSounds = sounds;
    renderSavedSounds();
    savedSounds = original;
  }

  function cleanup() {
    stopPreview();
  }

  /*
   * Public API for the page.
   */
  window.SavedSounds = {
    load: loadSavedSounds,
    render: renderSavedSounds,
    togglePreview,
    stopPreview,
    removeSound,
    useSound,
    openSound
  };

  /*
   * Start once the page has loaded.
   */
  function init() {
    bindSearch();
    loadSavedSounds();
  }

  if (
    document.readyState === 'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );
  } else {
    init();
  }

  window.addEventListener(
    'pagehide',
    cleanup
  );

})();
