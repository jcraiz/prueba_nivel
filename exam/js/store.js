/**
 * Lucide SVG Icons for Exam Platform
 * Standardized inline SVG icons with stroke-width 2 and currentColor.
 * Matches the Lucide icon library used in Author Studio.
 */
const createSvg = (name, innerPaths, extraAttrs = '') => `
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-${name}" ${extraAttrs}>${innerPaths}</svg>`.trim();

const EXAM_ICONS = {
  settings: createSvg('settings', '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  bookOpen: createSvg('book-open', '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  fileText: createSvg('file-text', '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/>'),
  headphones: createSvg('headphones', '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>'),
  mic: createSvg('mic', '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>'),
  lock: createSvg('lock', '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  check: createSvg('check', '<polyline points="20 6 9 17 4 12"/>'),
  checkCircle: createSvg('check-circle', '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  xCircle: createSvg('x-circle', '<circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/>'),
  alertTriangle: createSvg('alert-triangle', '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>'),
  info: createSvg('info', '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  upload: createSvg('upload', '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>'),
  download: createSvg('download', '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
  lightbulb: createSvg('lightbulb', '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
  award: createSvg('award', '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>'),
  x: createSvg('x', '<line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/>'),
  volume2: createSvg('volume-2', '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
  laptop: createSvg('laptop', '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>'),
  camera: createSvg('camera', '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>'),
  scale: createSvg('scale', '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>'),
  clock: createSvg('clock', '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  building: createSvg('building-2', '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>'),
  barChart: createSvg('bar-chart-2', '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>'),
  hourglass: createSvg('hourglass', '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>'),
  flag: createSvg('flag', '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>'),
  play: createSvg('play', '<polygon points="6 3 20 12 6 21 6 3"/>'),
  pause: createSvg('pause', '<rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/>'),
  square: createSvg('square', '<rect width="18" height="18" x="3" y="3" rx="2"/>'),
  circle: createSvg('circle', '<circle cx="12" cy="12" r="10"/>'),
  circleDot: createSvg('circle-dot', '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>'),
  maximize: createSvg('maximize', '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>'),
  minimize: createSvg('minimize', '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>'),
  skipForward: createSvg('skip-forward', '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>')
};

function getIcon(name, extraAttrs = '') {
  if (typeof window !== 'undefined' && window.ICONS && window.ICONS[name]) {
    if (!extraAttrs) return window.ICONS[name];
    return window.ICONS[name].replace('<svg ', `<svg ${extraAttrs} `);
  }
  if (EXAM_ICONS[name]) {
    if (!extraAttrs) return EXAM_ICONS[name];
    return EXAM_ICONS[name].replace('<svg ', `<svg ${extraAttrs} `);
  }
  return '';
}

if (typeof window !== 'undefined') {
  window.ICONS = Object.assign({}, EXAM_ICONS, window.ICONS || {});
  window.getIcon = getIcon;
}

/**
 * JCAH Exam Delivery — Attempt Persistence Store
 * Manages attempt creation, bank item locking, answer state, and reload recovery.
 */
const JCAHAttemptStore = (() => {

  const ATTEMPT_KEY_PREFIX = 'jcah_attempt_';

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
   * Initialize or resume an attempt for a given exam
   * @param {object} exam - loaded exam object
   * @param {object} studentInfo - { name, id, email }
   * @returns {object} attempt record
   */
  function initAttempt(exam, studentInfo) {
    const storageKey = ATTEMPT_KEY_PREFIX + exam.id;
    let existing = null;

    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) existing = JSON.parse(raw);
    } catch (e) {
      console.warn('Could not read attempt from storage:', e);
    }

    // If active attempt exists and matches student, resume it
    if (existing && existing.status === 'in_progress' && existing.studentId === studentInfo.id) {
      const activeRank = studentInfo.occupation || studentInfo.position || studentInfo.rank || studentInfo.userRank || studentInfo.studentRank || existing.occupation || existing.position || existing.userRank || existing.studentRank || 'N/A';
      existing.position = activeRank;
      existing.occupation = activeRank;
      existing.userRank = activeRank;
      existing.studentRank = activeRank;
      existing.rank = activeRank;
      return existing;
    }

    const assignedRank = studentInfo.occupation || studentInfo.position || studentInfo.rank || studentInfo.userRank || studentInfo.studentRank || 'N/A';

    // Otherwise, create a brand new attempt and lock item selections
    const attempt = {
      id: 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      examId: exam.id,
      examVersion: exam.version || 1,
      studentName: studentInfo.name,
      studentFirstName: studentInfo.firstName || studentInfo.name || '',
      studentLastName: studentInfo.lastName || '',
      position: assignedRank,
      occupation: assignedRank,
      studentRank: assignedRank,
      userRank: assignedRank,
      rank: assignedRank,
      studentId: studentInfo.id,
      studentEmail: studentInfo.email,
      startedAt: new Date().toISOString(),
      submittedAt: null,
      status: 'in_progress',
      terminationReason: null,
      timeRemainingSeconds: (exam.timerMinutes || 90) * 60,
      currentSectionIdx: 0,

      // Locked Vocab & Grammar question selections (Placement mode: exactly 12 items: 3 A1, 3 A2, 3 B1, 3 B2)
      vocabQuestions: exam.examType === 'placement'
        ? selectPlacementQuestions(exam.vocabulary.questions, exam.vocabulary.shuffleOptions)
        : selectQuestions(exam.vocabulary.questions, exam.vocabulary.displayCount, exam.vocabulary.shuffleOptions),
      grammarQuestions: exam.examType === 'placement'
        ? selectPlacementQuestions(exam.grammar.questions, exam.grammar.shuffleOptions)
        : selectQuestions(exam.grammar.questions, exam.grammar.displayCount, exam.grammar.shuffleOptions),

      // Locked Reading bank item selections (Placement mode evaluates Part 1 only)
      selectedReadingItems: (Array.isArray(exam.readingBanks) ? (exam.examType === 'placement' ? exam.readingBanks.slice(0, 1) : exam.readingBanks) : (exam.reading ? [exam.reading] : [])).map((bank, i) => selectBankItem(bank, `reading_${i}`)),

      // Locked Listening bank item selections (Placement mode evaluates Part 1 only)
      selectedListeningItems: (Array.isArray(exam.listeningBanks) ? (exam.examType === 'placement' ? exam.listeningBanks.slice(0, 1) : exam.listeningBanks) : (exam.listening ? [exam.listening] : [])).map((bank, i) => selectBankItem(bank, `listening_${i}`)),

      // Flat Question Lists for Section Scoring & Reports
      readingQuestions: [],
      listeningQuestions: [],

      // Student answers
      vocabAnswers: {},
      grammarAnswers: {},
      readingAnswers: {},
      listeningAnswers: {},

      // Audio playback tracking: { itemKey: playCount }
      audioPlayCounts: {},

      // Flagged questions: { "sectionKey-questionId": true }
      flaggedQuestions: {},

      // Speaking results
      speakingResults: null,

      // Passing score threshold (from exam configuration, default 70%)
      passingScore: exam.passingScore || 70,

      // Violations log
      violations: [],

      // Computed scores on submit
      scores: null,
    };

    // Flatten all reading & listening questions for scoring
    if (Array.isArray(attempt.selectedReadingItems)) {
      attempt.readingQuestions = attempt.selectedReadingItems.flatMap(it => (it && Array.isArray(it.questions)) ? it.questions : []);
    }
    if (Array.isArray(attempt.selectedListeningItems)) {
      attempt.listeningQuestions = attempt.selectedListeningItems.flatMap(it => (it && Array.isArray(it.questions)) ? it.questions : []);
    }

    saveAttempt(attempt);
    return attempt;
  }

  /**
   * Stratified question selection for Placement Test:
   * Exactly 12 questions: 3 from A1, 3 from A2, 3 from B1, 3 from B2.
   * Shuffles options / pairs as requested.
   */
  function selectPlacementQuestions(bankQuestions, shuffleOptions) {
    if (!bankQuestions || bankQuestions.length === 0) return [];
    const buckets = { A1: [], A2: [], B1: [], B2: [] };
    const others = [];

    bankQuestions.forEach(q => {
      if (!q) return;
      const rawLvl = String(q.level || 'A2').toUpperCase().trim().replace('+', '');
      if (buckets[rawLvl]) {
        buckets[rawLvl].push(q);
      } else {
        others.push(q);
      }
    });

    const chosen = [];
    const targetLevels = ['A1', 'A2', 'B1', 'B2'];
    targetLevels.forEach(lvl => {
      const pool = shuffleArray(buckets[lvl]);
      const picked = pool.slice(0, 3);
      chosen.push(...picked);
    });

    // Fallback if any bucket had fewer than 3 items: fill up to 12 from others or remaining pool
    if (chosen.length < 12) {
      const chosenIds = new Set(chosen.map(q => q.id));
      const remaining = shuffleArray(bankQuestions.filter(q => q && !chosenIds.has(q.id)));
      const needed = 12 - chosen.length;
      chosen.push(...remaining.slice(0, needed));
    }

    // Format and shuffle options
    return chosen.map((q, idx) => {
      const copy = { ...q, id: q.id || ('q_placement_' + idx + '_' + Math.random().toString(36).substr(2, 6)) };
      if (shuffleOptions && (copy.type === 'mc' || copy.type === 'mr') && copy.options) {
        copy.options = shuffleArray(copy.options);
      }
      if (copy.type === 'matching' && Array.isArray(copy.pairs) && copy.pairs.length > 0) {
        if (shuffleOptions) {
          copy.pairs = shuffleArray(copy.pairs);
        }
        const shuffledList = shuffleMatchingChoices(copy);
        copy.shuffledRight = shuffledList;
        copy.shuffledRightChoices = shuffledList;
        copy.rightChoices = shuffledList;
      }
      return copy;
    });
  }

  /**
   * Select questions from bank with optional shuffle
   */
  function selectQuestions(bankQuestions, count, shuffleOptions) {
    if (!bankQuestions || bankQuestions.length === 0) return [];
    let selected = shuffleArray(bankQuestions).slice(0, count || bankQuestions.length);
    selected = selected.map((q, idx) => {
      const copy = { ...q, id: q.id || ('q_vocab_gram_' + idx + '_' + Math.random().toString(36).substr(2, 6)) };

      // Shuffle MC/MR option order when requested
      if (shuffleOptions && (copy.type === 'mc' || copy.type === 'mr') && copy.options) {
        copy.options = shuffleArray(copy.options);
      }

      // Matching: ALWAYS shuffle right-side choices (unshuffled = trivially reveals the answer order)
      if (copy.type === 'matching' && Array.isArray(copy.pairs) && copy.pairs.length > 0) {
        if (shuffleOptions) {
          copy.pairs = shuffleArray(copy.pairs); // also shuffle left-side order if requested
        }

        const shuffledList = shuffleMatchingChoices(copy);
        copy.shuffledRight = shuffledList;
        copy.shuffledRightChoices = shuffledList;
        copy.rightChoices = shuffledList;
      }

      return copy;
    });
    return selected;
  }

  /**
   * Helper to extract and shuffle matching options ensuring non-trivial order
   */
  function shuffleMatchingChoices(q) {
    let rightItems = [];
    if (Array.isArray(q.shuffledRight) && q.shuffledRight.some(s => String(s || '').trim().length > 0)) {
      rightItems = q.shuffledRight.filter(s => String(s || '').trim().length > 0);
    } else if (Array.isArray(q.shuffledRightChoices) && q.shuffledRightChoices.some(s => String(s || '').trim().length > 0)) {
      rightItems = q.shuffledRightChoices.filter(s => String(s || '').trim().length > 0);
    } else if (Array.isArray(q.rightChoices) && q.rightChoices.some(s => String(s || '').trim().length > 0)) {
      rightItems = q.rightChoices.filter(s => String(s || '').trim().length > 0);
    } else if (Array.isArray(q.pairs)) {
      rightItems = q.pairs.map(p => String(p.right || '').trim()).filter(s => s.length > 0);
    }

    if (rightItems.length <= 1) return rightItems;

    let shuffled = shuffleArray(rightItems);
    const hasDistinct = new Set(rightItems).size > 1;
    let attempts = 0;
    while (hasDistinct && attempts < 10 && shuffled.every((v, i) => v === rightItems[i])) {
      shuffled = shuffleArray(rightItems);
      attempts++;
    }
    if (hasDistinct && shuffled.every((v, i) => v === rightItems[i])) {
      shuffled = [...rightItems.slice(1), rightItems[0]];
    }
    return shuffled;
  }

  /**
   * Pick 1 item from a bank with multi-version randomization at attempt start
   */
  function selectBankItem(bank, logTag) {
    if (!bank || !Array.isArray(bank.items) || bank.items.length === 0) return null;

    // Filter to items that contain actual question content, passage text/html, or audio
    const withContent = bank.items.filter(it => it && (
      (Array.isArray(it.questions) && it.questions.length > 0) ||
      (it.passageText && String(it.passageText).trim().length > 0) ||
      (it.passageHtml && String(it.passageHtml).trim().length > 0) ||
      it.audioFilename ||
      it.audioDataUrl ||
      it.audioBase64
    ));

    const pool = withContent.length > 0 ? withContent : bank.items;
    if (pool.length === 0) return null;

    // If author has multiple explicitly published items, randomize between them.
    // If only 1 item is flagged 'published' while multiple valid candidate items exist
    // (the common scenario where item 1 was published by template but items 2 & 3 were newly added),
    // treat all valid pool items as available versions so candidates receive randomized variants.
    const published = pool.filter(it => it.status === 'published');
    const itemsToPickFrom = (published.length > 1 || (published.length === 1 && pool.length === 1))
      ? published
      : pool;

    const picked = itemsToPickFrom[Math.floor(Math.random() * itemsToPickFrom.length)];
    const clone = JSON.parse(JSON.stringify(picked));
    if (clone.questions) {
      clone.questions = clone.questions.map((q, idx) => {
        const copy = {
          ...q,
          id: q.id || (`q_${logTag}_${idx}_` + Math.random().toString(36).substr(2, 6))
        };

        // Matching: ALWAYS generate a freshly shuffled right-side choices list
        if (copy.type === 'matching' && Array.isArray(copy.pairs) && copy.pairs.length > 0) {
          const shuffledList = shuffleMatchingChoices(copy);
          copy.shuffledRight = shuffledList;
          copy.shuffledRightChoices = shuffledList;
          copy.rightChoices = shuffledList;
        }

        return copy;
      });
    }
    return clone;
  }

  /**
   * Save attempt state to localStorage
   */
  function saveAttempt(attempt) {
    try {
      const storageKey = ATTEMPT_KEY_PREFIX + attempt.examId;
      localStorage.setItem(storageKey, JSON.stringify(attempt));
    } catch (e) {
      console.error('Failed to save attempt to localStorage:', e);
    }
  }

  /**
   * Get active attempt if one exists
   */
  function loadAttempt(examId) {
    try {
      const raw = localStorage.getItem(ATTEMPT_KEY_PREFIX + examId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Load current active or most recent attempt
   */
  function loadCurrentAttempt(examId) {
    const targetId = examId || (typeof window !== 'undefined' && window.__JCAH_EXAM__ && window.__JCAH_EXAM__.id) || 'default';
    const att = loadAttempt(targetId);
    if (att) return att;
    if (typeof localStorage !== 'undefined') {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(ATTEMPT_KEY_PREFIX)) {
            const raw = localStorage.getItem(key);
            if (raw) return JSON.parse(raw);
          }
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Offline Submission Outbox (resilience against prolonged disconnection)
   */
  const OUTBOX_KEY = 'jcah_outbox';

  function savePendingSubmission(attempt) {
    if (!attempt || !attempt.id || typeof localStorage === 'undefined') return;
    try {
      const outbox = getPendingSubmissions();
      const existingIdx = outbox.findIndex(item => item.id === attempt.id);
      if (existingIdx >= 0) {
        outbox[existingIdx] = attempt;
      } else {
        outbox.push(attempt);
      }
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
      console.log(`[JCAHAttemptStore] Attempt ${attempt.id} saved to offline outbox (${outbox.length} pending).`);
    } catch (e) {
      console.warn('[JCAHAttemptStore] Failed to save pending submission to outbox:', e);
    }
  }

  function getPendingSubmissions() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(OUTBOX_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function removePendingSubmission(attemptId) {
    if (!attemptId || typeof localStorage === 'undefined') return;
    try {
      const outbox = getPendingSubmissions().filter(item => item.id !== attemptId);
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    } catch (_) {}
  }

  function clearAttempt(examId) {
    localStorage.removeItem(ATTEMPT_KEY_PREFIX + examId);
  }

  return {
    initAttempt,
    saveAttempt,
    loadAttempt,
    loadCurrentAttempt,
    clearAttempt,
    selectBankItem,
    savePendingSubmission,
    getPendingSubmissions,
    removePendingSubmission,
  };
})();

if (typeof window !== 'undefined') {
  window.JCAHAttemptStore = JCAHAttemptStore;
  window.JCAHStore = JCAHAttemptStore;
}
if (typeof module !== 'undefined') module.exports = JCAHAttemptStore;

