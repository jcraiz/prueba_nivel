/**
 * JCAH Exam Delivery — Listening Audio Player Controller
 * Enforces per-item play limits and handles basic/advanced controls.
 * - Limited plays (playLimit > 0): Pause interaction is disabled (Audio can only be played or stopped).
 * - Unlimited plays (playLimit == 0): Pause button is active and visible.
 */
const JCAHAudio = (() => {

  const escapeAttr = (str) => {
    if (typeof JCAHScoring !== 'undefined' && JCAHScoring.escapeAttr) {
      return JCAHScoring.escapeAttr(str);
    }
    if (str === null || str === undefined) return '';
    const s = String(str);
    if (/^\s*javascript:/i.test(s)) return '#';
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  function isAdvancedPlayer(itemKey) {
    return !!document.getElementById(`audio-seek-${itemKey}`);
  }

  function resolveAudioSrc(item) {
    if (!item) return '';
    if (item.audioDataUrl && item.audioDataUrl !== '[INDEXEDDB_PERSISTED]' && (item.audioDataUrl.startsWith('data:audio/') || item.audioDataUrl.startsWith('blob:'))) {
      return item.audioDataUrl;
    }
    if (item.audioBase64 && item.audioBase64 !== '[INDEXEDDB_PERSISTED]' && item.audioBase64.startsWith('data:audio/')) {
      return item.audioBase64;
    }
    let target = item.audioFilename || item.audioDataUrl || '';
    if (target && target !== '[INDEXEDDB_PERSISTED]') {
      if (target.startsWith('data:') || target.startsWith('blob:') || target.startsWith('http://') || target.startsWith('https://')) {
        return target;
      }
      // Clean leading ./ or exam/
      let clean = target.replace(/^\.\//, '').replace(/^exam\//, '');
      if (clean.startsWith('sound/')) {
        return clean;
      }
      return 'sound/' + clean;
    }
    return '';
  }

  /**
   * Render listening item audio player widget
   * @param {object} item - listening bank item
   * @param {number} currentPlays - number of plays used so far
   * @param {string} itemKey - unique key for item e.g. 'listening_0'
   * @returns {string} HTML string
   */
  function renderPlayerWidget(item, currentPlays, itemKey) {
    const playLimit = item.playLimit || 0;
    const limitReached = playLimit > 0 && currentPlays >= playLimit;

    let limitText = playLimit > 0 ? `${currentPlays} of ${playLimit} plays used` : `Played ${currentPlays} times (unlimited)`;
    if (limitReached) limitText = `${getIcon('alertTriangle', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px;color:var(--clr-error)"')} Play limit reached (${playLimit}/${playLimit})`;

    const audioSrc = resolveAudioSrc(item);

    if (item.playerType === 'advanced') {
      return `
        <div class="audio-widget-card" id="audio-widget-${itemKey}" role="region" aria-label="Listening audio player">
          <div class="flex items-center justify-between mb-3">
            <span class="label-sm">Listening Audio</span>
            <span class="play-count-badge" id="audio-badge-${itemKey}">${limitText}</span>
          </div>

          ${item.visualAidDataUrl ? `
            <div class="mb-3">
              <img src="${escapeAttr(item.visualAidDataUrl)}" alt="Listening visual aid" style="max-width:100%;max-height:220px;object-fit:contain;border-radius:var(--radius);border:1px solid var(--clr-border)">
            </div>` : ''}

          <audio id="audio-elem-${itemKey}" src="${escapeAttr(audioSrc)}" aria-label="Listening audio track" style="display:none"></audio>

          <div class="audio-controls-row">
            <button type="button" class="audio-play-btn" id="audio-play-${itemKey}"
                    onclick="JCAHAudio.togglePlay('${itemKey}', ${playLimit})"
                    aria-label="Play assessment audio" ${limitReached ? 'disabled' : ''}>
              ${getIcon('play', 'width="16" height="16"')}
            </button>

            <div class="flex-1 flex-col gap-1">
              <input type="range" id="audio-seek-${itemKey}" min="0" max="100" value="0" style="width:100%"
                     oninput="JCAHAudio.handleSeek('${itemKey}')"
                     aria-label="Playback position" ${limitReached ? 'disabled' : ''}>
              <div class="flex justify-between text-xs text-muted font-mono">
                <span id="audio-time-${itemKey}">00:00</span>
                <span id="audio-dur-${itemKey}">--:--</span>
              </div>
            </div>

            <button type="button" class="btn btn-ghost btn-sm" id="audio-stop-${itemKey}" onclick="JCAHAudio.stopAudio('${itemKey}', ${playLimit})"
                    aria-label="Stop audio" ${limitReached ? 'disabled' : ''}>
              ${getIcon('square', 'width="14" height="14"')} Stop
            </button>
          </div>
        </div>`;
    }

    // Default: Basic player (Play / Stop only)
    return `
      <div class="audio-widget-card" id="audio-widget-${itemKey}" role="region" aria-label="Listening audio player">
        <div class="flex items-center justify-between mb-3">
          <span class="label-sm">Listening Audio</span>
          <span class="play-count-badge" id="audio-badge-${itemKey}">${limitText}</span>
        </div>

        ${item.visualAidDataUrl ? `
          <div class="mb-3">
            <img src="${escapeAttr(item.visualAidDataUrl)}" alt="Listening visual aid" style="max-width:100%;max-height:220px;object-fit:contain;border-radius:var(--radius);border:1px solid var(--clr-border)">
          </div>` : ''}

        <audio id="audio-elem-${itemKey}" src="${escapeAttr(audioSrc)}" aria-label="Listening audio track" style="display:none"></audio>

        <div class="audio-controls-row">
          <button type="button" class="btn btn-primary btn-lg" id="audio-play-${itemKey}"
                  onclick="JCAHAudio.togglePlay('${itemKey}', ${playLimit})"
                  aria-label="Play assessment audio" ${limitReached ? 'disabled' : ''}>
            ${getIcon('play', 'width="18" height="18"')} Play Audio
          </button>
          <button type="button" class="btn btn-ghost btn-lg" id="audio-stop-${itemKey}" onclick="JCAHAudio.stopAudio('${itemKey}', ${playLimit})"
                  aria-label="Stop audio" ${limitReached ? 'disabled' : ''}>
            ${getIcon('square', 'width="18" height="18"')} Stop
          </button>
        </div>
      </div>`;
  }

  // Registry for tracking active audio instances
  const _activeAudio = {};
  let _onPlayCountIncrementCb = null;

  function setPlayCountCallback(cb) {
    _onPlayCountIncrementCb = cb;
  }

  function togglePlay(itemKey, playLimit) {
    const audio = document.getElementById(`audio-elem-${itemKey}`);
    const playBtn = document.getElementById(`audio-play-${itemKey}`);
    if (!audio) return;

    const isUnlimited = (!playLimit || playLimit <= 0);
    const currentPlays = _activeAudio[itemKey]?.plays || 0;

    // Check if audio is currently playing
    if (!audio.paused) {
      if (isUnlimited) {
        // Unlimited plays: Pause is active and permitted
        audio.pause();
        if (playBtn) {
          playBtn.innerHTML = isAdvancedPlayer(itemKey) ? getIcon('play', 'width="16" height="16"') : `${getIcon('play', 'width="18" height="18"')} Play Audio`;
        }
        if (_activeAudio[itemKey]) _activeAudio[itemKey].isCounting = false;
      } else {
        // Limited plays: Pause is disabled — audio can only be stopped or played
        return;
      }
      return;
    }

    // Audio is paused/stopped: Attempt to play
    if (!isUnlimited && currentPlays >= playLimit) {
      disableWidget(itemKey, playLimit);
      return;
    }

    // Stop any other currently playing audio
    stopAllAudio();

    audio.play().then(() => {
      if (!_activeAudio[itemKey]) {
        _activeAudio[itemKey] = { plays: currentPlays, isCounting: false };
      }

      // Increment count when playback begins
      if (!_activeAudio[itemKey].isCounting) {
        _activeAudio[itemKey].plays += 1;
        _activeAudio[itemKey].isCounting = true;
        if (_onPlayCountIncrementCb) _onPlayCountIncrementCb(itemKey, _activeAudio[itemKey].plays);
        updateBadge(itemKey, _activeAudio[itemKey].plays, playLimit);
      }

      if (isUnlimited) {
        // Unlimited: Show active Pause button
        if (playBtn) {
          playBtn.innerHTML = isAdvancedPlayer(itemKey) ? getIcon('pause', 'width="16" height="16"') : `${getIcon('pause', 'width="18" height="18"')} Pause`;
          playBtn.disabled = false;
        }
      } else {
        // Limited plays: Disable pause interaction, show Playing state with play button disabled
        if (playBtn) {
          playBtn.innerHTML = isAdvancedPlayer(itemKey) ? getIcon('play', 'width="16" height="16"') : `${getIcon('play', 'width="18" height="18"')} Playing...`;
          playBtn.disabled = true;
        }
      }
    }).catch(err => {
      console.warn('Audio playback failed initial attempt:', err);
      const curSrc = audio.getAttribute('src') || '';
      if (curSrc && !curSrc.startsWith('data:') && !curSrc.startsWith('blob:') && !audio._hasRetriedFallback) {
        audio._hasRetriedFallback = true;
        // Fallback chain: sound/filename <-> filename <-> exam/sound/filename <-> exam/filename
        const cleanName = curSrc.replace(/^(?:exam\/|sound\/|\.\/)+/i, '');
        let fallbackSrc = curSrc.startsWith('sound/') ? cleanName : ('sound/' + cleanName);
        if (fallbackSrc === curSrc) {
          fallbackSrc = curSrc.startsWith('exam/') ? curSrc.replace(/^exam\//, '') : ('exam/' + curSrc);
        }
        audio.src = fallbackSrc;
        audio.play().then(() => {
          if (!_activeAudio[itemKey]) _activeAudio[itemKey] = { plays: currentPlays, isCounting: false };
          if (!_activeAudio[itemKey].isCounting) {
            _activeAudio[itemKey].plays += 1;
            _activeAudio[itemKey].isCounting = true;
            if (_onPlayCountIncrementCb) _onPlayCountIncrementCb(itemKey, _activeAudio[itemKey].plays);
            updateBadge(itemKey, _activeAudio[itemKey].plays, playLimit);
          }
          if (isUnlimited) {
            if (playBtn) {
              playBtn.innerHTML = isAdvancedPlayer(itemKey) ? getIcon('pause', 'width="16" height="16"') : `${getIcon('pause', 'width="18" height="18"')} Pause`;
              playBtn.disabled = false;
            }
          } else {
            if (playBtn) {
              playBtn.innerHTML = isAdvancedPlayer(itemKey) ? getIcon('play', 'width="16" height="16"') : `${getIcon('play', 'width="18" height="18"')} Playing...`;
              playBtn.disabled = true;
            }
          }
        }).catch(err2 => console.error('Audio fallback failed:', err2));
      }
    });

    // Bind timeupdate for seekbar
    audio.ontimeupdate = () => {
      const seek = document.getElementById(`audio-seek-${itemKey}`);
      const timeEl = document.getElementById(`audio-time-${itemKey}`);
      const durEl = document.getElementById(`audio-dur-${itemKey}`);
      if (seek && audio.duration) {
        seek.value = (audio.currentTime / audio.duration) * 100;
      }
      if (timeEl) timeEl.textContent = formatSecs(audio.currentTime);
      if (durEl && audio.duration) durEl.textContent = formatSecs(audio.duration);
    };

    audio.onended = () => {
      if (_activeAudio[itemKey]) _activeAudio[itemKey].isCounting = false;
      const playsCount = _activeAudio[itemKey]?.plays || 0;
      if (!isUnlimited && playsCount >= playLimit) {
        disableWidget(itemKey, playLimit);
      } else {
        if (playBtn) {
          playBtn.innerHTML = isAdvancedPlayer(itemKey) ? getIcon('play', 'width="16" height="16"') : `${getIcon('play', 'width="18" height="18"')} Play Audio`;
          playBtn.disabled = false;
        }
      }
    };
  }

  function handleSeek(itemKey) {
    const audio = document.getElementById(`audio-elem-${itemKey}`);
    const seek = document.getElementById(`audio-seek-${itemKey}`);
    if (audio && seek && audio.duration) {
      audio.currentTime = (seek.value / 100) * audio.duration;
    }
  }

  function stopAudio(itemKey, playLimit) {
    const audio = document.getElementById(`audio-elem-${itemKey}`);
    const playBtn = document.getElementById(`audio-play-${itemKey}`);
    const seek = document.getElementById(`audio-seek-${itemKey}`);
    const timeEl = document.getElementById(`audio-time-${itemKey}`);

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (seek) seek.value = 0;
    if (timeEl) timeEl.textContent = '00:00';
    if (_activeAudio[itemKey]) _activeAudio[itemKey].isCounting = false;

    const isUnlimited = (!playLimit || playLimit <= 0);
    const playsCount = _activeAudio[itemKey]?.plays || 0;

    if (!isUnlimited && playsCount >= playLimit) {
      disableWidget(itemKey, playLimit);
    } else {
      if (playBtn) {
        playBtn.innerHTML = isAdvancedPlayer(itemKey) ? getIcon('play', 'width="16" height="16"') : `${getIcon('play', 'width="18" height="18"')} Play Audio`;
        playBtn.disabled = false;
      }
    }
  }

  function stopAllAudio() {
    document.querySelectorAll('audio').forEach(a => {
      a.pause();
      a.currentTime = 0;
    });
    document.querySelectorAll('.audio-play-btn').forEach(btn => {
      btn.innerHTML = getIcon('play', 'width="16" height="16"');
      btn.disabled = false;
    });
    document.querySelectorAll('[id^="audio-play-"]').forEach(btn => {
      if (btn.classList.contains('btn')) {
        btn.innerHTML = `${getIcon('play', 'width="18" height="18"')} Play Audio`;
        btn.disabled = false;
      }
    });
    Object.keys(_activeAudio).forEach(k => {
      if (_activeAudio[k]) _activeAudio[k].isCounting = false;
    });
  }

  function updateBadge(itemKey, plays, limit) {
    const badge = document.getElementById(`audio-badge-${itemKey}`);
    if (!badge) return;
    if (limit > 0) {
      if (plays >= limit) {
        badge.innerHTML = `${getIcon('alertTriangle', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px;color:var(--clr-error)"')} Play limit reached (${limit}/${limit})`;
        badge.style.color = 'var(--clr-error)';
      } else {
        badge.textContent = `${plays} of ${limit} plays used`;
      }
    } else {
      badge.textContent = `Played ${plays} times (unlimited)`;
    }
  }

  function disableWidget(itemKey, limit) {
    const playBtn = document.getElementById(`audio-play-${itemKey}`);
    const seek = document.getElementById(`audio-seek-${itemKey}`);
    if (playBtn) playBtn.disabled = true;
    if (seek) seek.disabled = true;
    updateBadge(itemKey, limit, limit);
  }

  function formatSecs(seconds) {
    if (isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  return {
    renderPlayerWidget,
    setPlayCountCallback,
    togglePlay,
    handleSeek,
    stopAudio,
    stopAllAudio,
  };
})();

if (typeof window !== 'undefined') {
  window.JCAHAudio = JCAHAudio;
}
if (typeof module !== 'undefined') module.exports = JCAHAudio;
