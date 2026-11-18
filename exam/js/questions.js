/**
 * JCAH Exam Delivery — Question Renderer & Answer Collector
 * Supports 5 question types: mc, tf, fb, mr, matching.
 */
const JCAHQuestions = (() => {

  /**
   * Render a stack of question cards
   * @param {Array} questions - array of question objects
   * @param {object} answers - current answers object { [qId]: answer }
   * @param {object} flags - flagged questions object { [qId]: true }
   * @param {string} sectionKey - e.g. 'vocab', 'grammar', 'reading_0', 'listening_0'
   * @returns {string} HTML string
   */
  function renderQuestionStack(questions, answers, flags, sectionKey) {
    if (!questions || questions.length === 0) {
      return `<div class="p-6 text-center text-muted">No questions available in this section.</div>`;
    }

    return questions.map((q, idx) => {
      const qId = q.id;
      const currentAns = answers[qId];
      // Flag key is just qId — consistent with attempt.flaggedQuestions storage
      const isFlagged = !!(flags && flags[qId]);
      const isAnswered = currentAns !== undefined && currentAns !== null && currentAns !== '' &&
                         (!Array.isArray(currentAns) || currentAns.length > 0) &&
                         (typeof currentAns !== 'object' || Object.keys(currentAns).length > 0);

      let cardClasses = 'exam-q-card notranslate';
      if (isAnswered) cardClasses += ' answered';
      if (isFlagged) cardClasses += ' flagged';

      return `
        <div class="${cardClasses}" id="qcard-${qId}" translate="no">
          <div class="q-card-top">
            <span class="q-number-chip">Question ${idx + 1}</span>
            <button type="button" class="flag-btn ${isFlagged ? 'active' : ''}"
                    id="flagbtn-${qId}"
                    onclick="JCAHQuestions.toggleFlag('${qId}')"
                    aria-label="${isFlagged ? 'Marked for review' : 'Mark for review'}"
                    aria-pressed="${isFlagged}"
                    title="${isFlagged ? 'Marked for review' : 'Mark for review'}">
              ${isFlagged ? `${getIcon('flag', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px;fill:currentColor"')} Marked for review` : `${getIcon('flag', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px"')} Mark for review`}
            </button>
          </div>

          <div class="q-text">${escapeHtml(q.text)}</div>

          <div class="q-options-container">
            ${renderQuestionInput(q, currentAns, sectionKey)}
          </div>
        </div>`;
    }).join('');
  }

  /**
   * Render input elements for specific question type
   */
  function renderQuestionInput(q, currentAns, sectionKey, isLocked) {
    const qId = q.id;
    const dis = isLocked ? ' disabled' : '';
    const ro = isLocked ? ' readonly' : '';

    switch (q.type) {
      case 'mc': {
        const opts = q.options || [];
        return opts.map((opt, oi) => {
          const inputId = `opt_${qId}_${oi}`;
          const checked = String(currentAns) === String(opt);
          const letter = String.fromCharCode(65 + oi);
          return `
            <label for="${inputId}" class="option-label ${checked ? 'selected' : ''} ${isLocked ? 'locked-label' : ''}" tabindex="0">
              <input type="radio" id="${inputId}" name="q_${qId}" value="${escapeHtml(opt)}" ${checked ? 'checked' : ''}${dis}
                     onchange="JCAHQuestions.handleInput('${qId}', this.value)">
              <span class="option-letter" aria-hidden="true">${letter}</span>
              <span class="option-text">${escapeHtml(opt)}</span>
              ${oi < 9 ? `<span class="v6-key-hint" aria-hidden="true">[${oi + 1}]</span>` : ''}
            </label>`;
        }).join('');
      }

      case 'tf': {
        const isTrue = String(currentAns) === 'true';
        const isFalse = String(currentAns) === 'false';
        return `
          <div class="flex gap-3 tf-options-row">
            <label for="opt_${qId}_true" class="option-label tf-option ${isLocked ? 'locked-label' : ''}" style="flex:1" tabindex="0">
              <input type="radio" id="opt_${qId}_true" name="q_${qId}" value="true" ${isTrue ? 'checked' : ''}${dis}
                     onchange="JCAHQuestions.handleInput('${qId}', 'true')">
              <span class="option-letter" aria-hidden="true">T</span>
              <span class="option-text">True</span>
            </label>
            <label for="opt_${qId}_false" class="option-label tf-option ${isLocked ? 'locked-label' : ''}" style="flex:1" tabindex="0">
              <input type="radio" id="opt_${qId}_false" name="q_${qId}" value="false" ${isFalse ? 'checked' : ''}${dis}
                     onchange="JCAHQuestions.handleInput('${qId}', 'false')">
              <span class="option-letter" aria-hidden="true">F</span>
              <span class="option-text">False</span>
            </label>
          </div>`;
      }

      case 'fb': {
        const val = typeof currentAns === 'string' ? currentAns : '';
        return `
          <input type="text" id="fb_${qId}" aria-label="Answer for question ${escapeHtml(qId)}" class="fb-input" value="${escapeHtml(val)}" placeholder="Type your answer here..." ${ro}${dis}
                 oninput="JCAHQuestions.handleInput('${qId}', this.value)">`;
      }

      case 'mr': {
        const opts = q.options || [];
        const selectedArr = Array.isArray(currentAns) ? currentAns : [];
        return opts.map((opt, oi) => {
          const inputId = `mr_${qId}_${oi}`;
          const checked = selectedArr.includes(opt);
          const letter = String.fromCharCode(65 + oi);
          return `
            <label for="${inputId}" class="option-label mr-option ${isLocked ? 'locked-label' : ''}" tabindex="0">
              <input type="checkbox" id="${inputId}" name="q_${qId}" value="${escapeHtml(opt)}" ${checked ? 'checked' : ''}${dis}
                     onchange="JCAHQuestions.handleMRChange('${qId}')">
              <span class="option-letter mr-letter" aria-hidden="true">${letter}</span>
              <span class="option-text">${escapeHtml(opt)}</span>
            </label>`;
        }).join('');
      }

      case 'matching': {
        const pairs = q.pairs || [];
        const currentMap = (currentAns && typeof currentAns === 'object') ? currentAns : {};
        const rightChoices = getOrShuffleMatchingChoices(q);

        return `
          <div class="matching-container" id="matching-${qId}">
            ${pairs.map((p, pi) => {
              const rawLeft = String(p.left || '');
              const selectedVal = currentMap[rawLeft] || '';
              const selectId = `matching_${qId}_${pi}`;
              return `
                <div class="matching-row" data-matching-left="${escapeHtml(rawLeft)}">
                  <div class="matching-left">${escapeHtml(rawLeft)}</div>
                  <span style="color:var(--clr-text-muted)">→</span>
                  <select id="${selectId}" aria-label="Matching selection for ${escapeHtml(rawLeft)}" class="matching-select" ${dis}
                          onchange="JCAHQuestions.handleMatchingChange('${qId}', this)">
                    <option value="">-- Select --</option>
                    ${rightChoices.map(rc => `
                      <option value="${escapeHtml(rc)}" ${String(selectedVal) === String(rc) ? 'selected' : ''}>
                        ${escapeHtml(rc)}
                      </option>`).join('')}
                  </select>
                </div>`;
            }).join('')}
          </div>`;
      }

      default:
        return `<div class="text-error">Unknown question type: ${q.type}</div>`;
    }
  }

  /**
   * Fisher-Yates array shuffle helper
   */
  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Get or generate shuffled right-side choices for a matching question.
   * Guarantees that the options presented in dropdowns are shuffled and not in answer-key order.
   */
  function getOrShuffleMatchingChoices(q) {
    if (!q) return [];
    const pairs = Array.isArray(q.pairs) ? q.pairs : [];
    const originalRights = pairs.map(p => String(p.right || '').trim()).filter(s => s.length > 0);

    // 1. Check if valid pre-shuffled choices already exist on the question
    let candidate = null;
    if (Array.isArray(q.shuffledRight) && q.shuffledRight.some(s => String(s || '').trim().length > 0)) {
      candidate = q.shuffledRight;
    } else if (Array.isArray(q.shuffledRightChoices) && q.shuffledRightChoices.some(s => String(s || '').trim().length > 0)) {
      candidate = q.shuffledRightChoices;
    } else if (Array.isArray(q.rightChoices) && q.rightChoices.some(s => String(s || '').trim().length > 0)) {
      candidate = q.rightChoices;
    }

    if (candidate && candidate.length > 0) {
      const cleanCandidate = candidate.map(s => String(s || '').trim()).filter(s => s.length > 0);
      const isIdenticalToUnshuffled = originalRights.length > 1 &&
        cleanCandidate.length === originalRights.length &&
        cleanCandidate.every((val, idx) => val === originalRights[idx]) &&
        new Set(originalRights).size > 1;

      if (!isIdenticalToUnshuffled) {
        return cleanCandidate;
      }
    }

    // 2. Build and shuffle from available options pool
    let pool = (candidate && candidate.length > 0) ? candidate : originalRights;
    pool = pool.map(s => String(s || '').trim()).filter(s => s.length > 0);

    if (pool.length <= 1) {
      q.shuffledRight = pool;
      q.shuffledRightChoices = pool;
      q.rightChoices = pool;
      return pool;
    }

    let shuffled = shuffleArray(pool);
    const hasDistinct = new Set(pool).size > 1;
    let attempts = 0;
    while (hasDistinct && attempts < 10 && shuffled.every((v, i) => v === pool[i])) {
      shuffled = shuffleArray(pool);
      attempts++;
    }
    if (hasDistinct && shuffled.every((v, i) => v === pool[i])) {
      shuffled = [...pool.slice(1), pool[0]];
    }

    // Cache on question object for stable dropdown choices across re-renders
    q.shuffledRight = shuffled;
    q.shuffledRightChoices = shuffled;
    q.rightChoices = shuffled;
    return shuffled;
  }

  // Registry for callbacks
  let _onAnswerCb = null;
  let _onFlagCb = null;

  function registerCallbacks(onAnswer, onFlag) {
    _onAnswerCb = onAnswer;
    _onFlagCb = onFlag;
  }

  function handleInput(qId, val) {
    if (_onAnswerCb) _onAnswerCb(qId, val);
  }

  function handleMRChange(qId) {
    // Query checkboxes by question input name so it works regardless of DOM layout (single-question or stacked)
    const checkedBoxes = document.querySelectorAll(`input[type="checkbox"][name="q_${qId}"]:checked`);
    const allBoxes = document.querySelectorAll(`input[type="checkbox"][name="q_${qId}"]`);
    allBoxes.forEach(cb => {
      const lbl = cb.closest('label');
      if (lbl) lbl.classList.toggle('selected', cb.checked);
    });
    const vals = Array.from(checkedBoxes).map(cb => cb.value);
    if (_onAnswerCb) _onAnswerCb(qId, vals);
  }

  // selectEl is the <select> DOM element that was changed
  function handleMatchingChange(qId, selectEl) {
    const container = (selectEl && selectEl.closest('.matching-container')) ||
                      document.getElementById(`matching-${qId}`) ||
                      document.getElementById(`qcard-${qId}`);
    if (!container) return;
    const rows = container.querySelectorAll('.matching-row');
    const mapping = {};
    rows.forEach(row => {
      // Read the left key from the data attribute set at render time
      const leftKey = (row.getAttribute('data-matching-left') || '').trim();
      const sel = row.querySelector('.matching-select');
      if (leftKey && sel && sel.value) {
        mapping[leftKey] = sel.value;
      }
    });
    if (_onAnswerCb) _onAnswerCb(qId, mapping);
  }

  /**
   * Toggle flag on a question card.
   * Calls _onFlagCb(qId) — the app determines the new state and updates the DOM.
   */
  function toggleFlag(qId) {
    if (_onFlagCb) _onFlagCb(qId);
  }

  /**
   * Render a single question card (Stitch 2026 UX)
   */
  function renderSingleQuestionCard(q, idx, total, answers, flags, sectionKey, extraOpts) {
    if (!q) {
      return `<div class="p-6 text-center text-muted">No question available.</div>`;
    }

    const qId = q.id;
    const currentAns = answers ? answers[qId] : undefined;
    const isFlagged = !!(flags && flags[qId]);
    const isAnswered = currentAns !== undefined && currentAns !== null && currentAns !== '' &&
                       (!Array.isArray(currentAns) || currentAns.length > 0) &&
                       (typeof currentAns !== 'object' || Object.keys(currentAns).length > 0);
    const isLocked = Boolean(extraOpts && extraOpts.isLocked);
    const isAdaptive = Boolean(extraOpts && extraOpts.isAdaptive);
    const qNum = (extraOpts && extraOpts.questionNumber !== undefined) ? extraOpts.questionNumber : (idx + 1);
    const markedCount = (extraOpts && extraOpts.markedCount !== undefined) ? extraOpts.markedCount : 0;
    const markedMax = (extraOpts && extraOpts.markedMax !== undefined) ? extraOpts.markedMax : 2;

    const typeLabels = {
      mc: 'Multiple Choice',
      tf: 'True / False',
      fb: 'Fill in the Blank',
      mr: 'Multiple Response',
      matching: 'Matching'
    };
    const typeLabel = typeLabels[q.type] || 'Question';

    return `
      <div class="v6-exam-slide-card">
        <div class="stitch-q-meta-bar v6-exam-slide-topbar">
          <div class="stitch-q-title-group">
            <span class="v6-slide-index-pill">SLIDE ${qNum}${total ? ` / ${total}` : ''}</span>
            <span class="stitch-q-number">Question ${qNum}</span>
            <span class="stitch-q-badge">${q.marks || 1} Point${(q.marks || 1) === 1 ? '' : 's'} · ${typeLabel}</span>
            ${q.type === 'mc' && !isLocked ? `<span class="v6-keys-active-pill" title="Press keys 1-4 on your keyboard to select an option">Keys [1]-[4] Active</span>` : ''}
            ${isLocked ? `<span class="chip chip-neutral text-xs fw-700" style="margin-left:6px">Locked</span>` : ''}
          </div>
          <div class="flex items-center gap-2">
            ${isAdaptive ? `<span class="text-xs text-muted" style="font-weight:600" id="marked-counter-${qId}">Marked: ${markedCount} of ${markedMax}</span>` : ''}
            <button type="button" class="stitch-flag-btn ${isFlagged ? 'active' : ''}"
                    id="flagbtn-${qId}"
                    onclick="JCAHQuestions.toggleFlag('${qId}')"
                    ${isLocked ? 'disabled' : ''}
                    aria-label="${isFlagged ? 'Marked for review' : 'Mark for review'}"
                    aria-pressed="${isFlagged}"
                    title="${isFlagged ? 'Marked for review' : 'Mark for review'}">
              ${isFlagged ? `${getIcon('flag', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px;fill:currentColor"')} Marked for review` : `${getIcon('flag', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px"')} Flag Slide [F]`}
            </button>
          </div>
        </div>

        <div class="stitch-stem-card exam-q-card notranslate ${isAnswered ? 'answered' : ''} ${isFlagged ? 'flagged' : ''} ${isLocked ? 'locked' : ''}" id="qcard-${qId}" translate="no">
          <div class="stitch-stem-text q-text">${escapeHtml(q.text)}</div>
        </div>

        <div class="q-options-container stitch-options-stack">
          ${renderQuestionInput(q, currentAns, sectionKey, isLocked)}
        </div>
      </div>
    `;
  }

  /**
   * Update flag button and card appearance in-place (called by exam-app after state update)
   */
  function updateFlagDisplay(qId, isFlagged, counterText) {
    const card = document.getElementById(`qcard-${qId}`);
    const btn = document.getElementById(`flagbtn-${qId}`);
    if (card) {
      card.classList.toggle('flagged', isFlagged);
    }
    if (btn) {
      btn.classList.toggle('active', isFlagged);
      btn.setAttribute('aria-pressed', String(isFlagged));
      btn.setAttribute('aria-label', isFlagged ? 'Marked for review' : 'Mark for review');
      btn.setAttribute('title', isFlagged ? 'Marked for review' : 'Mark for review');
      btn.innerHTML = isFlagged ? `${getIcon('flag', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px;fill:currentColor"')} Marked for review` : `${getIcon('flag', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px"')} Mark for review`;
    }
    const counterEl = document.getElementById(`marked-counter-${qId}`);
    if (counterEl && counterText !== undefined) {
      counterEl.textContent = counterText;
    }
    const pill = document.getElementById(`qpill-${qId}`);
    if (pill) {
      pill.classList.toggle('flagged', isFlagged);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    renderQuestionStack,
    renderSingleQuestionCard,
    registerCallbacks,
    handleInput,
    handleMRChange,
    handleMatchingChange,
    toggleFlag,
    updateFlagDisplay,
  };
})();

if (typeof window !== 'undefined') {
  window.JCAHQuestions = JCAHQuestions;
}
if (typeof module !== 'undefined') module.exports = JCAHQuestions;

