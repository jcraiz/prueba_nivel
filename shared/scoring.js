/**
 * JCAH Shared Scoring Utilities
 * Provides: CEFR level mapping, Writing Score, section scoring
 */
const JCAHScoring = (() => {

  const _constants = (typeof JCAHScoringConstants !== 'undefined')
    ? JCAHScoringConstants
    : (typeof require !== 'undefined' ? (() => { try { return require('./scoring-constants.js'); } catch (_) { return null; } })() : null);

  const normalizeText = (_constants && _constants.normalizeText) || function(text) {
    if (text === undefined || text === null) return '';
    return String(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  };

  const CEFR_LEVELS = (_constants && _constants.CEFR_LEVELS) || [
    { key: 'A0',  label: 'A0',  cssClass: 'chip-a0',  min:  0, max: 10 },
    { key: 'A1',  label: 'A1',  cssClass: 'chip-a1',  min: 10, max: 20 },
    { key: 'A1+', label: 'A1+', cssClass: 'chip-a1p', min: 20, max: 30 },
    { key: 'A2',  label: 'A2',  cssClass: 'chip-a2',  min: 30, max: 40 },
    { key: 'A2+', label: 'A2+', cssClass: 'chip-a2p', min: 40, max: 50 },
    { key: 'B1',  label: 'B1',  cssClass: 'chip-b1',  min: 50, max: 60 },
    { key: 'B1+', label: 'B1+', cssClass: 'chip-b1p', min: 60, max: 70 },
    { key: 'B2',  label: 'B2',  cssClass: 'chip-b2',  min: 70, max: 80 },
    { key: 'B2+', label: 'B2+', cssClass: 'chip-b2p', min: 80, max: 90 },
    { key: 'C1',  label: 'C1',  cssClass: 'chip-c1',  min: 90, max: 100 },
  ];

  const mapPercentageToLevel = (_constants && _constants.mapPercentageToLevel) || function(score) {
    if (typeof score !== 'number' || isNaN(score)) return null;
    const s = Math.max(0, Math.min(100, score));
    if (s <= 10) return 'A0';
    if (s <= 20) return 'A1';
    if (s <= 30) return 'A1+';
    if (s <= 40) return 'A2';
    if (s <= 50) return 'A2+';
    if (s <= 60) return 'B1';
    if (s <= 70) return 'B1+';
    if (s <= 80) return 'B2';
    if (s <= 90) return 'B2+';
    return 'C1';
  };

  const SPEAKING_LEVEL_MAP = (_constants && _constants.SPEAKING_LEVEL_MAP) || {
    'A0': 0, 'A1': 15, 'A1+': 25, 'A2': 35, 'A2+': 45, 'B1': 55, 'B1+': 65, 'B2': 75, 'B2+': 85, 'C1': 95
  };

  const PASSING_SCORE_DEFAULT = (_constants && _constants.PASSING_SCORE_DEFAULT) || 70;
  const WRITING_WEIGHTS = (_constants && _constants.WRITING_WEIGHTS) || { vocab: 0.5, grammar: 0.5 };
  const OVERALL_WEIGHTS = (_constants && _constants.OVERALL_WEIGHTS) || { withoutSpeaking: 3, withSpeaking: 4 };

  /**
   * Get CEFR level info for a given percentage score (0-100)
   * @param {number} pct - percentage 0..100
   * @returns {{ key, label, cssClass, min, max }}
   */
  function cefrForPct(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) {
      return { key: 'N/A', label: 'Incomplete', cssClass: 'chip-muted', min: 0, max: 0 };
    }
    const lvlKey = mapPercentageToLevel(Number(pct));
    return CEFR_LEVELS.find(l => l.key === lvlKey) || CEFR_LEVELS[0];
  }

  /**
   * Get CEFR level index (0 = A0, 9 = C1)
   */
  function cefrIndex(pct) {
    const lvl = cefrForPct(pct);
    return CEFR_LEVELS.findIndex(l => l.key === lvl.key);
  }

  /**
   * Render a CEFR level chip element (returns HTML string)
   * @param {number} pct
   * @param {boolean} [large=false]
   */
  function cefrChipHtml(pct, large = false) {
    const lvl = cefrForPct(pct);
    const sz = large ? 'style="font-size:1.1em;padding:5px 14px"' : '';
    return `<span class="chip chip-cefr ${lvl.cssClass}" ${sz}>${lvl.label}</span>`;
  }

  /**
   * Render CEFR chip from a level key string (used by speaking results)
   * @param {string} key — e.g. 'B1', 'A2+'
   */
  function cefrChipFromKey(key, large = false) {
    const lvl = CEFR_LEVELS.find(l => l.key === key) || (key === 'N/A' ? { key: 'N/A', label: 'N/A', cssClass: 'chip-muted' } : CEFR_LEVELS[0]);
    const sz = large ? 'style="font-size:1.1em;padding:5px 14px"' : '';
    return `<span class="chip chip-cefr ${lvl.cssClass}" ${sz}>${lvl.label}</span>`;
  }

  /* -------------------------------------------------------
     Section Scoring
  ------------------------------------------------------- */

  /* -------------------------------------------------------
     Synchronous Pure-JS SHA-256 for Mode A Hashed Key Verification
  ------------------------------------------------------- */
  function sha256Sync(ascii) {
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    const mathPow = Math.pow; const maxWord = mathPow(2, 32); let i, j; let result = '';
    const words = [];
    let utf8 = typeof unescape !== 'undefined' ? unescape(encodeURIComponent(ascii)) : Buffer.from(ascii).toString('binary');
    const asciiBitLength = utf8.length * 8;
    let hash = []; const k = []; let primeCounter = 0; const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    utf8 += '\x80';
    while (utf8.length % 64 - 56) utf8 += '\x00';
    for (i = 0; i < utf8.length; i++) {
      j = utf8.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength | 0);
    for (j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const oldHash = hash.slice(0);
      for (i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
              w[i - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
            ) | 0
          );
        const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
        hash.pop();
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  /**
   * Score a single question answer with detailed points breakdown.
   * Matching questions count 1 point per pair (e.g. 4 pairs = 4 points total, 3 pairs = 3 points total).
   * Standard questions (mc, tf, fb, mr) count 1 point total.
   * @param {object} q - question object
   * @param {*} answer - student's answer
   * @returns {{ earned: number, possible: number, isCorrect: boolean }}
   */
  function scoreQuestionDetailed(q, answer) {
    if (!q) return { earned: 0, possible: 1, isCorrect: false };

    // Delegate to JCAHAnswerService if available (supports Mode B external answer lookup)
    if (typeof JCAHAnswerService !== 'undefined' && JCAHAnswerService.scoreQuestionDetailed && JCAHAnswerService.getAnswer && JCAHAnswerService.getAnswer(q.id)) {
      return JCAHAnswerService.scoreQuestionDetailed(q, answer);
    }

    const hasPlainCorrect = (q.correct !== undefined && q.correct !== null) ||
                            (Array.isArray(q.pairs) && q.pairs.length > 0 && q.pairs.some(p => p && p.right));

    if (!hasPlainCorrect) {
      // Check for obfuscated Mode A secureKeyMap
      const examObj = (typeof window !== 'undefined' && (window.__JCAH_EXAM__ || window.__JCAH_EXAM__)) || {};
      const keyMap = examObj.secureKeyMap || q.secureKeyMap || q._secureKeyMap;
      const salt = examObj.examSalt || examObj._salt || q.examSalt || '';
      const sec = keyMap && keyMap[q.id];

      if (sec) {
        if (sec.type === 'mc' || sec.type === 'tf') {
          if (answer === null || answer === undefined || answer === '') return { earned: 0, possible: 1, isCorrect: false };
          const norm = String(answer).trim().toLowerCase();
          const h = sha256Sync(`jcah_${salt}_${norm}`);
          const isCorrect = (h === sec.hash);
          return { earned: isCorrect ? 1 : 0, possible: 1, isCorrect };
        } else if (sec.type === 'fb') {
          if (answer === null || answer === undefined || answer === '') return { earned: 0, possible: 1, isCorrect: false };
          const norm = String(answer).trim().toLowerCase();
          const h = sha256Sync(`jcah_${salt}_${norm}`);
          const isCorrect = Array.isArray(sec.hashes) && sec.hashes.includes(h);
          return { earned: isCorrect ? 1 : 0, possible: 1, isCorrect };
        } else if (sec.type === 'mr') {
          if (!Array.isArray(answer) || answer.length === 0) return { earned: 0, possible: 1, isCorrect: false };
          const rawGiven = Array.from(new Set(answer.map(a => sha256Sync(`jcah_${salt}_${String(a).trim().toLowerCase()}`)))).filter(Boolean);
          const expHashes = Array.from(new Set(sec.hashes || [])).filter(Boolean);
          let correctHashes = 0;
          rawGiven.forEach(h => {
            if (expHashes.includes(h)) correctHashes++;
          });
          const excess = Math.max(0, rawGiven.length - expHashes.length);
          const rawEarned = expHashes.length > 0 ? (correctHashes - excess) / expHashes.length : 0;
          const earned = Math.max(0, Number(rawEarned.toFixed(4)));
          const isCorrect = (earned === 1 && rawGiven.length === expHashes.length);
          return { earned, possible: 1, isCorrect };
        } else if (sec.type === 'matching') {
          const pairsHashes = sec.pairsHashes || {};
          const keys = Object.keys(pairsHashes);
          let matchCount = 0;
          if (answer && typeof answer === 'object') {
            keys.forEach(leftKey => {
              const trimmedKey = String(leftKey).trim();
              const userRight = String(answer[trimmedKey] !== undefined ? answer[trimmedKey] : (answer[leftKey] || '')).trim().toLowerCase();
              const h = sha256Sync(`jcah_${salt}_${userRight}`);
              if (h === pairsHashes[leftKey]) matchCount++;
            });
          }
          const earned = keys.length > 0 ? Number((matchCount / keys.length).toFixed(4)) : 0;
          return {
            earned,
            possible: 1,
            isCorrect: (matchCount === keys.length && keys.length > 0)
          };
        }
      }
    }

    if (q.type === 'matching') {
      let pairsToTest = q.pairs;
      if (!Array.isArray(pairsToTest) && Array.isArray(q.correct)) pairsToTest = q.correct;
      if (!Array.isArray(pairsToTest) && typeof q.correct === 'string') {
        try {
          const parsed = JSON.parse(q.correct);
          if (Array.isArray(parsed)) pairsToTest = parsed;
        } catch (_) {}
      }
      if (!Array.isArray(pairsToTest)) pairsToTest = [];
      let matchCount = 0;
      if (answer && typeof answer === 'object' && pairsToTest.length > 0) {
        const normAnswer = {};
        for (const ak in answer) {
          normAnswer[normalizeText(ak)] = normalizeText(answer[ak]);
        }
        pairsToTest.forEach(p => {
          const lKey = String(p.left || '').trim();
          const normLKey = normalizeText(lKey);
          const exp = normalizeText(p.right || '');
          const given = normAnswer[normLKey] !== undefined ? normAnswer[normLKey] : normalizeText(answer[lKey] !== undefined ? answer[lKey] : (answer[p.left] || ''));
          if (given === exp && exp.length > 0) {
            matchCount++;
          }
        });
      }
      const earned = pairsToTest.length > 0 ? Number((matchCount / pairsToTest.length).toFixed(4)) : 0;
      return {
        earned,
        possible: 1,
        isCorrect: (matchCount === pairsToTest.length && pairsToTest.length > 0)
      };
    }

    // Single-point questions (mc, tf, fb, mr)
    if (answer === null || answer === undefined || answer === '') {
      return { earned: 0, possible: 1, isCorrect: false };
    }

    let isCorrect = false;
    switch (q.type) {
      case 'mc':
      case 'tf':
        isCorrect = (normalizeText(answer) === normalizeText(q.correct));
        break;
      case 'fb': {
        const a = normalizeText(answer);
        const accepted = Array.isArray(q.correct) ? q.correct : [q.correct];
        isCorrect = accepted.some(c => normalizeText(c) === a);
        break;
      }
      case 'mr': {
        if (!Array.isArray(answer)) {
          return { earned: 0, possible: 1, isCorrect: false };
        }
        let expected = [];
        if (Array.isArray(q.correct)) {
          expected = q.correct;
        } else if (typeof q.correct === 'string') {
          try {
            const parsed = JSON.parse(q.correct);
            if (Array.isArray(parsed)) expected = parsed;
            else expected = q.correct.split(',').map(s => s.trim());
          } catch (_) {
            expected = q.correct.split(',').map(s => s.trim());
          }
        }
        const given = Array.from(new Set(answer.map(s => normalizeText(s)).filter(Boolean)));
        const expSorted = Array.from(new Set(expected.map(s => normalizeText(s)).filter(Boolean)));
        if (expSorted.length === 0) return { earned: 0, possible: 1, isCorrect: false };
        let correctCount = 0;
        given.forEach(v => {
          if (expSorted.includes(v)) correctCount++;
        });
        const excess = Math.max(0, given.length - expSorted.length);
        const rawEarned = (correctCount - excess) / expSorted.length;
        const earned = Math.max(0, Number(rawEarned.toFixed(4)));
        const isCorrect = (earned === 1 && given.length === expSorted.length);
        return { earned, possible: 1, isCorrect };
      }
      default:
        isCorrect = false;
        break;
    }

    return { earned: isCorrect ? 1 : 0, possible: 1, isCorrect };
  }

  /**
   * Score a single question answer
   * @param {object} q - question object
   * @param {*} answer - student's answer
   * @returns {boolean} correct
   */
  function scoreQuestion(q, answer) {
    return scoreQuestionDetailed(q, answer).isCorrect;
  }

  /**
   * Score a full section
   * Section percentage = (Correct points / Total scored points) * 100
   * Matching exercises count 1 point per pair individually.
   * Keeps full precision on a 0-100 scale.
   * @param {Array} questions - question objects
   * @param {object} answers - { [questionId]: answer }
   * @returns {{ correct: number, total: number, pct: number, rawPct: number, hasConfiguredQuestions: boolean, error?: string }}
   */
  function scoreSection(questions, answers) {
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return {
        correct: 0,
        total: 0,
        pct: 0,
        rawPct: 0,
        hasConfiguredQuestions: false,
        error: 'Section has zero configured questions'
      };
    }
    let correct = 0;
    let total = 0;
    const ansMap = answers || {};
    for (const q of questions) {
      const qScore = scoreQuestionDetailed(q, ansMap[q.id]);
      correct += qScore.earned;
      total += qScore.possible;
    }
    const rawPct = total > 0 ? (correct / total) * 100 : 0;
    const pct = Number(rawPct.toFixed(2));
    return {
      correct,
      total,
      pct,
      rawPct,
      hasConfiguredQuestions: true
    };
  }

  /**
   * Calculate Writing percentage: W = (V + G) / 2
   * Vocabulary and grammar have equal weight within writing,
   * even if they contain different numbers of questions.
   * @param {number} vocabPct - Vocabulary percentage (0..100)
   * @param {number} grammarPct - Grammar percentage (0..100)
   * @returns {number|null} Writing percentage on a 0..100 scale with full precision
   */
  function writingScore(vocabPct, grammarPct) {
    if (typeof vocabPct !== 'number' || isNaN(vocabPct) || typeof grammarPct !== 'number' || isNaN(grammarPct)) {
      return null;
    }
    return (vocabPct + grammarPct) / 2;
  }

  /**
   * Identifies and references the existing variable that stores the final numeric speaking score.
   * Do not convert speaking level label into a number.
   * Do not use level-band midpoints, minimums, or maximums.
   * Do not recalculate or average individual speaking responses.
   * @param {object} attempt
   * @returns {number|null} Exact numeric score if present, else null
   */
  function getExistingSpeakingScore(attempt) {
    if (!attempt) return null;
    const sr = attempt.speakingResults;
    if (sr && typeof sr === 'object') {
      const keys = ['numericScore', 'score', 'speakingScore', 'overallScore', 'speakingPercentage', 'speakingPct', 'pct'];
      for (const k of keys) {
        if (typeof sr[k] === 'number' && !isNaN(sr[k])) return sr[k];
      }
      for (const k of keys) {
        if (typeof sr[k] === 'string' && sr[k].trim() !== '' && !isNaN(Number(sr[k]))) return Number(sr[k]);
      }
      if (sr.overallLevel === 'A0') {
        return 0;
      }
    }
    const attKeys = ['speakingScore', 'speakingNumericScore', 'speakingPct', 'speakingPercentage'];
    for (const k of attKeys) {
      if (typeof attempt[k] === 'number' && !isNaN(attempt[k])) return attempt[k];
    }
    for (const k of attKeys) {
      if (typeof attempt[k] === 'string' && attempt[k].trim() !== '' && !isNaN(Number(attempt[k]))) return Number(attempt[k]);
    }
    if (attempt.speakingLevel === 'A0') {
      return 0;
    }
    return null;
  }

  /**
   * Obsolete speaking level -> percentage mapping (deprecated).
   * Maintained solely for backward compatibility with external callers,
   * but never used by the authoritative aggregation engine.
   */
  function speakingPctForLevel(level) {
    return 0;
  }

  /**
   * Calculate final ESL score according to exam version:
   *  - Without speaking: (W + R + L) / 3
   *  - With speaking:    (W + R + L + S) / 4
   * Each skill has equal weight. Full precision is preserved.
   * @param {number} writingPct
   * @param {number} readingPct
   * @param {number} listeningPct
   * @param {number|null} [speakingScore=null] - existing numeric speaking score S
   * @param {object} [options] - { examIncludesSpeaking: boolean }
   * @returns {number|null} unrounded overall percentage on 0..100 scale, or null if incomplete/mismatch
   */
  function overallScore(writingPct, readingPct, listeningPct, speakingScore, options) {
    const opts = options || {};
    const includesSpeaking = (opts.examIncludesSpeaking !== undefined)
      ? Boolean(opts.examIncludesSpeaking)
      : (speakingScore !== undefined && speakingScore !== null);

    if (typeof writingPct !== 'number' || isNaN(writingPct) ||
        typeof readingPct !== 'number' || isNaN(readingPct) ||
        typeof listeningPct !== 'number' || isNaN(listeningPct)) {
      return null;
    }

    if (includesSpeaking) {
      if (speakingScore === null || speakingScore === undefined || isNaN(speakingScore)) {
        return null; // required but missing -> incomplete
      }
      if (speakingScore < 0 || speakingScore > 100) {
        return null; // scale mismatch
      }
      return (writingPct + readingPct + listeningPct + speakingScore) / 4;
    }
    return (writingPct + readingPct + listeningPct) / 3;
  }

  /**
   * Authoritative ESL Exam Scoring Engine for both exam versions:
   * without speaking and with speaking.
   *
   * 1. Section percentages on 0–100 scale: Correct / Total * 100
   * 2. Writing: W = (V + G) / 2
   * 3. Reading and Listening: R and L percentages
   * 4. Speaking: References existing numeric score S directly (confirming 0–100 scale)
   * 5. Overall score:
   *    - Without speaking: (W + R + L) / 3
   *    - With speaking: (W + R + L + S) / 4
   * 6. Final level: Continuous CEFR mapping with full unrounded precision; displayed rounded to 2 decimals
   * 7. Reporting & Validation:
   *    - Speaking inclusion determined strictly from exam configuration
   *    - Missing speaking when required marks overall as incomplete
   *    - Numeric score of 0 is valid
   *    - Zero configured questions or missing sections flagged rather than treated as valid zero scores
   *    - Unanswered questions within configured sections preserved as 0 correct
   *
   * @param {object} attempt
   * @param {object} [exam]
   * @param {object} [options]
   * @returns {object} Full validated score report
   */
  function computeAllScores(attempt, exam, options) {
    const opts = options || {};
    const validationErrors = [];

    // 1. Determine whether speaking is included from the exam's configuration,
    //    NOT from whether a speaking score happens to exist.
    const examIncludesSpeaking = (attempt && attempt.examIncludesSpeaking !== undefined)
      ? Boolean(attempt.examIncludesSpeaking)
      : Boolean(exam && exam.speaking && exam.speaking.enabled !== false && (exam.speaking.parts === undefined || Number(exam.speaking.parts) > 0));

    // 2. Resolve section question arrays
    let rQuestions = (attempt && Array.isArray(attempt.readingQuestions) && attempt.readingQuestions.length > 0)
      ? attempt.readingQuestions
      : (attempt && attempt.selectedReadingItems || []).flatMap(it => (it && Array.isArray(it.questions)) ? it.questions : []);

    let lQuestions = (attempt && Array.isArray(attempt.listeningQuestions) && attempt.listeningQuestions.length > 0)
      ? attempt.listeningQuestions
      : (attempt && attempt.selectedListeningItems || []).flatMap(it => (it && Array.isArray(it.questions)) ? it.questions : []);

    // 3. Calculate Section Percentages
    const vocab = scoreSection(attempt ? attempt.vocabQuestions : null, attempt ? (attempt.vocabAnswers || {}) : {});
    const grammar = scoreSection(attempt ? attempt.grammarQuestions : null, attempt ? (attempt.grammarAnswers || {}) : {});
    const reading = scoreSection(rQuestions, attempt ? (attempt.readingAnswers || {}) : {});
    const listening = scoreSection(lQuestions, attempt ? (attempt.listeningAnswers || {}) : {});

    // 4. Validate sections
    // Flag missing section results, invalid scores, and sections with zero configured questions
    // rather than treating them as valid zero scores.
    let hasZeroConfiguredQuestions = false;
    if (!vocab.hasConfiguredQuestions || vocab.total === 0) {
      hasZeroConfiguredQuestions = true;
      validationErrors.push('Vocabulary section has zero configured questions.');
    }
    if (!grammar.hasConfiguredQuestions || grammar.total === 0) {
      hasZeroConfiguredQuestions = true;
      validationErrors.push('Grammar section has zero configured questions.');
    }
    if (!reading.hasConfiguredQuestions || reading.total === 0) {
      hasZeroConfiguredQuestions = true;
      validationErrors.push('Reading section has zero configured questions.');
    }
    if (!listening.hasConfiguredQuestions || listening.total === 0) {
      hasZeroConfiguredQuestions = true;
      validationErrors.push('Listening section has zero configured questions.');
    }

    const vocabularyPercentage = vocab.hasConfiguredQuestions && vocab.total > 0 ? (vocab.correct / vocab.total) * 100 : null;
    const grammarPercentage = grammar.hasConfiguredQuestions && grammar.total > 0 ? (grammar.correct / grammar.total) * 100 : null;
    const writingPercentage = (vocabularyPercentage !== null && grammarPercentage !== null)
      ? (vocabularyPercentage + grammarPercentage) / 2
      : null;
    const readingPercentage = reading.hasConfiguredQuestions && reading.total > 0 ? (reading.correct / reading.total) * 100 : null;
    const listeningPercentage = listening.hasConfiguredQuestions && listening.total > 0 ? (listening.correct / listening.total) * 100 : null;

    // 5. Existing Numeric Speaking Score (S)
    const existingSpeaking = getExistingSpeakingScore(attempt);
    let speakingPercentage = null;
    let scaleMismatch = false;
    let missingSpeaking = false;

    if (examIncludesSpeaking) {
      if (existingSpeaking === null || existingSpeaking === undefined || isNaN(existingSpeaking)) {
        missingSpeaking = true;
        validationErrors.push('Speaking section is required by exam configuration, but its numeric score is missing.');
      } else {
        const sNum = Number(existingSpeaking);
        if (sNum < 0 || sNum > 100) {
          scaleMismatch = true;
          validationErrors.push(`Speaking score scale mismatch: numeric score (${sNum}) is outside the expected 0–100 scale.`);
        } else {
          speakingPercentage = sNum;
        }
      }
    }

    // 6. Incomplete / Invalid Status Check
    const isIncomplete = hasZeroConfiguredQuestions || missingSpeaking || scaleMismatch;

    // 7. Calculate Final Overall Percentage
    let overallPercentage = null;
    if (!isIncomplete) {
      if (examIncludesSpeaking) {
        overallPercentage = (writingPercentage + readingPercentage + listeningPercentage + speakingPercentage) / 4;
      } else {
        overallPercentage = (writingPercentage + readingPercentage + listeningPercentage) / 3;
      }
    }

    // 8. Map to level (unrounded overall percentage to level; display rounded to 2 decimals)
    const finalLevel = overallPercentage !== null ? mapPercentageToLevel(overallPercentage) : null;
    const displayedOverall = overallPercentage !== null ? Number(overallPercentage.toFixed(2)) : null;
    const passingScore = (attempt && attempt.passingScore !== undefined && !isNaN(Number(attempt.passingScore)))
      ? Number(attempt.passingScore)
      : 70;
    const passed = (overallPercentage !== null) ? overallPercentage >= passingScore : false;

    const speakingLvl = (attempt && attempt.speakingResults && attempt.speakingResults.overallLevel)
      ? String(attempt.speakingResults.overallLevel)
      : (speakingPercentage !== null ? mapPercentageToLevel(speakingPercentage) : 'N/A');

    return {
      vocab: {
        correct: vocab.correct,
        total: vocab.total,
        pct: vocabularyPercentage !== null ? Number(vocabularyPercentage.toFixed(2)) : 0,
        rawPct: vocabularyPercentage !== null ? vocabularyPercentage : 0,
      },
      grammar: {
        correct: grammar.correct,
        total: grammar.total,
        pct: grammarPercentage !== null ? Number(grammarPercentage.toFixed(2)) : 0,
        rawPct: grammarPercentage !== null ? grammarPercentage : 0,
      },
      reading: {
        correct: reading.correct,
        total: reading.total,
        pct: readingPercentage !== null ? Number(readingPercentage.toFixed(2)) : 0,
        rawPct: readingPercentage !== null ? readingPercentage : 0,
      },
      listening: {
        correct: listening.correct,
        total: listening.total,
        pct: listeningPercentage !== null ? Number(listeningPercentage.toFixed(2)) : 0,
        rawPct: listeningPercentage !== null ? listeningPercentage : 0,
      },
      writingScore: writingPercentage !== null ? Number(writingPercentage.toFixed(2)) : null,
      writingPercentage,
      writingCefr: writingPercentage !== null ? cefrForPct(writingPercentage) : cefrForPct(null),
      readingCefr: readingPercentage !== null ? cefrForPct(readingPercentage) : cefrForPct(null),
      listeningCefr: listeningPercentage !== null ? cefrForPct(listeningPercentage) : cefrForPct(null),
      examIncludesSpeaking,
      speakingIncluded: examIncludesSpeaking && !missingSpeaking && !scaleMismatch,
      speakingScore: speakingPercentage,
      speakingPercentage,
      speakingPct: speakingPercentage,
      speakingLevel: speakingLvl,
      overall: displayedOverall,
      overallPercentage,
      overallScore: displayedOverall,
      overallFormatted: displayedOverall !== null ? displayedOverall.toFixed(2) : 'Incomplete',
      overallCefr: overallPercentage !== null ? cefrForPct(overallPercentage) : cefrForPct(null),
      finalLevel,
      passed,
      isIncomplete,
      isValid: !isIncomplete,
      scaleMismatch,
      status: isIncomplete ? (scaleMismatch ? 'invalid' : 'incomplete') : 'complete',
      errors: validationErrors,
    };
  }

  /* -------------------------------------------------------
     Timer Formatting
  ------------------------------------------------------- */
  function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [
      h > 0 ? String(h).padStart(2, '0') : null,
      String(m).padStart(2, '0'),
      String(s).padStart(2, '0'),
    ].filter(Boolean).join(':');
  }

  /* -------------------------------------------------------
     CEFR Scale HTML (for results screen)
  ------------------------------------------------------- */
  function cefrScaleHtml(currentKey) {
    const segs = CEFR_LEVELS.map((lvl, i) => {
      const isActive = lvl.key === currentKey;
      const ranges = [
        '0–10%', '11–20%', '21–30%', '31–40%',
        '41–50%', '51–60%', '61–70%', '71–80%',
        '81–90%', '91–100%'
      ];
      return `
        <div class="cefr-scale-seg ${isActive ? 'active' : ''}" style="background:var(--cefr-${lvl.cssClass.replace('chip-','')})">
          <span class="cefr-scale-label">${lvl.label}</span>
          ${isActive ? '<div class="cefr-scale-needle">▼</div>' : ''}
          <span class="cefr-scale-range">${ranges[i]}</span>
        </div>`;
    }).join('');
    return `<div class="cefr-scale">${segs}</div>`;
  }

  /* -------------------------------------------------------
     Input Sanitization & Safe HTML / Attribute Escaping
  ------------------------------------------------------- */
  function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    if (/^\s*javascript:/i.test(s)) return '#';
    return s
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sanitizeHtml(dirtyHtml) {
    if (!dirtyHtml || typeof dirtyHtml !== 'string') return '';
    let clean = dirtyHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    const ALLOWED_TAGS = new Set([
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
      'ol', 'ul', 'li', 'span', 'a', 'div', 'sub', 'sup', 'hr'
    ]);
    const ALLOWED_ATTRS = new Set(['class', 'target', 'rel']);

    if (typeof DOMParser !== 'undefined') {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<body>${clean}</body>`, 'text/html');
        function cleanNode(parent) {
          const children = Array.from(parent.childNodes);
          for (const node of children) {
            if (node.nodeType === 1) { // ELEMENT_NODE
              const tagName = node.tagName.toLowerCase();
              if (tagName === 'font') {
                while (node.firstChild) {
                  parent.insertBefore(node.firstChild, node);
                }
                parent.removeChild(node);
                cleanNode(parent);
                return;
              }
              if (!ALLOWED_TAGS.has(tagName)) {
                const textNode = doc.createTextNode(node.textContent || '');
                parent.replaceChild(textNode, node);
                continue;
              }
              const attrs = Array.from(node.attributes);
              for (const attr of attrs) {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on')) {
                  node.removeAttribute(attr.name);
                } else if (tagName === 'a' && name === 'href') {
                  const val = attr.value.trim().toLowerCase();
                  if (val.startsWith('javascript:') || val.startsWith('data:') || val.startsWith('vbscript:')) {
                    node.removeAttribute(attr.name);
                  }
                } else if (name === 'style') {
                  const val = attr.value.trim().toLowerCase();
                  if (val.includes('javascript:') || val.includes('expression(') || val.includes('vbscript:') || val.includes('url(')) {
                    node.removeAttribute(attr.name);
                  }
                } else if (!ALLOWED_ATTRS.has(name)) {
                  node.removeAttribute(attr.name);
                }
              }
              cleanNode(node);
            }
          }
        }
        cleanNode(doc.body);
        return doc.body.innerHTML;
      } catch (_) {}
    }

    return clean
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
      .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
      .replace(/<object\b[\s\S]*?<\/object>/gi, '')
      .replace(/<embed\b[\s\S]*?<\/embed>/gi, '')
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/\s+on\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
      .replace(/(href\s*=\s*['"]?)\s*javascript:[^'">]*/gi, '$1#')
      .replace(/style\s*=\s*['"][^'"]*(?:javascript:|expression\(|url\()[^'"]*['"]/gi, '')
      .replace(/style\s*=\s*[^>\s]*(?:javascript:|expression\(|url\()[^>\s]*/gi, '')
      .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tag, rest) => {
        if (!ALLOWED_TAGS.has(tag.toLowerCase())) return '';
        const safeRest = rest
          .replace(/\s+on\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
          .replace(/style\s*=\s*['"][^'"]*(?:javascript:|expression\(|url\()[^'"]*['"]/gi, '');
        return `<${match.startsWith('</') ? '/' : ''}${tag}${safeRest}>`;
      });
  }

  /**
   * Compute a collision-free, question-associated filename for a listening bank item.
   * Format: sound/listening_p{part}_v{version}_q{start-end}[_{cleanBase}].{ext}
   * Extracted to / loaded from a dedicated 'sound' directory in the root of the generated exam.
   * E.g.:
   * - Part 1, Version 1, 10 questions: sound/listening_p1_v1_q1-10.mp3
   * - Part 1, Version 2, 10 questions, uploaded "dialogue.mp3": sound/listening_p1_v2_q1-10_dialogue.mp3
   * - Part 2, Version 1, 10 questions: sound/listening_p2_v1_q11-20.mp3
   */
  function computeCanonicalAudioFilename(bank, bIdx, item, iIdx, allBanks, uploadedFilename = '') {
    const partNum = (bank && bank.bankNumber) || (bIdx + 1);
    const versionNum = (iIdx !== undefined && iIdx !== null && !isNaN(iIdx)) ? (Number(iIdx) + 1) : ((item && item.itemNumber) || 1);

    // Calculate sequential question range across listening banks
    let qStart = 1;
    if (Array.isArray(allBanks)) {
      for (let prevIdx = 0; prevIdx < bIdx; prevIdx++) {
        const prevBank = allBanks[prevIdx];
        const prevItem = (prevBank && Array.isArray(prevBank.items) && prevBank.items[0]) || null;
        const prevCount = (prevItem && Array.isArray(prevItem.questions)) ? prevItem.questions.length : 0;
        qStart += prevCount;
      }
    }
    const thisCount = (item && Array.isArray(item.questions)) ? item.questions.length : 0;
    const qEnd = thisCount > 0 ? (qStart + thisCount - 1) : qStart;
    const qStr = thisCount <= 1 ? `q${qStart}` : `q${qStart}-${qEnd}`;

    // Determine extension and clean base name
    const rawCandidate = String(uploadedFilename || item?.originalAudioFilename || item?.audioFilename || '').trim();
    let ext = 'mp3';
    let base = '';

    if (rawCandidate) {
      const lastDot = rawCandidate.lastIndexOf('.');
      if (lastDot > 0 && lastDot < rawCandidate.length - 1) {
        const candidateExt = rawCandidate.slice(lastDot + 1).toLowerCase();
        if (/^(mp3|wav|ogg|m4a|aac|webm)$/.test(candidateExt)) {
          ext = candidateExt;
          base = rawCandidate.slice(0, lastDot);
        } else {
          base = rawCandidate;
        }
      } else {
        base = rawCandidate;
      }
    }

    // Clean base: remove prior canonical prefixes if any, and invalid characters
    base = base
      .replace(/^sound\//i, '')
      .replace(/^listening_p\d+_v\d+(_q[\d\-]+)?_?/i, '')
      .replace(/^recording_\d+_?/i, '')
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();

    // If base is empty or generic (e.g. 'audio', 'recording', 'sound', 'track'), omit it
    if (!base || base === 'audio' || base === 'recording' || base === 'sound' || base === 'track' || base === 'mp3') {
      return `sound/listening_p${partNum}_v${versionNum}_${qStr}.${ext}`;
    }

    return `sound/listening_p${partNum}_v${versionNum}_${qStr}_${base}.${ext}`;
  }

  /* -------------------------------------------------------
     Public API
  ------------------------------------------------------- */
  return {
    normalizeText,
    sha256Sync,
    CEFR_LEVELS,
    cefrForPct,
    cefrIndex,
    cefrChipHtml,
    cefrChipFromKey,
    mapPercentageToLevel,
    getExistingSpeakingScore,
    scoreQuestion,
    scoreQuestionDetailed,
    scoreSection,
    writingScore,
    overallScore,
    speakingPctForLevel,
    computeAllScores,
    formatTime,
    cefrScaleHtml,
    escapeAttr,
    sanitizeHtml,
    computeCanonicalAudioFilename,
  };
})();

if (typeof window !== 'undefined') {
  window.JCAHScoring = JCAHScoring;
  window.computeCanonicalAudioFilename = JCAHScoring.computeCanonicalAudioFilename;
}
if (typeof module !== 'undefined') module.exports = JCAHScoring;

