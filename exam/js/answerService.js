/**
 * JCAH Exam Generator — Secure Answer Service (Shared)
 */
const JCAHAnswerService = (() => {

  const _constants = (typeof JCAHScoringConstants !== 'undefined')
    ? JCAHScoringConstants
    : (typeof require !== 'undefined' ? (() => { try { return require('../../shared/scoring-constants.js'); } catch (_) { return null; } })() : null);

  const normalizeText = (_constants && _constants.normalizeText) || function (text) {
    if (text === undefined || text === null) return '';
    return String(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  };

  let _mode = 'local'; // 'local' | 'external'
  let _config = {};
  let _exam = null;
  let _answerCache = {}; // { [questionId]: { correct, pairs, type } }
  let _isReady = false;
  let _lastError = null;

  async function initialize(mode = 'local', config = {}, exam = null) {
    _mode = mode === 'external' ? 'external' : 'local';
    _config = config || {};
    _exam = exam || (typeof window !== 'undefined' ? window.__JCAH_EXAM__ : null);
    _answerCache = {};
    _isReady = false;
    _lastError = null;

    if (_mode === 'local') {
      _loadLocalAnswers();
      _isReady = true;
      console.log('[AnswerService] Initialized in Mode A (Local). Answers loaded from exam structure.');
      return { success: true, mode: 'local', count: Object.keys(_answerCache).length };
    } else {
      console.log('[AnswerService] Initialized in Mode B (Server-Graded). Answer key is secured on server; grading occurs authoritatively upon submission.');
      _isReady = true;
      return { success: true, mode: 'external', serverGraded: true, count: 0 };
    }
  }

  function _loadLocalAnswers() {
    if (!_exam) return;
    _answerCache = {};

    if (_exam.vocabulary && Array.isArray(_exam.vocabulary.questions)) {
      _exam.vocabulary.questions.forEach(q => _storeLocalQ(q, 'Vocabulary'));
    }
    if (_exam.grammar && Array.isArray(_exam.grammar.questions)) {
      _exam.grammar.questions.forEach(q => _storeLocalQ(q, 'Grammar'));
    }
    if (Array.isArray(_exam.readingBanks)) {
      _exam.readingBanks.forEach((bank, bIdx) => {
        (bank.items || []).forEach(item => {
          (item.questions || []).forEach(q => _storeLocalQ(q, `Reading Bank ${bank.bankNumber || (bIdx + 1)}`));
        });
      });
    }
    if (Array.isArray(_exam.listeningBanks)) {
      _exam.listeningBanks.forEach((bank, bIdx) => {
        (bank.items || []).forEach(item => {
          (item.questions || []).forEach(q => _storeLocalQ(q, `Listening Bank ${bank.bankNumber || (bIdx + 1)}`));
        });
      });
    }
  }

  function _storeLocalQ(q, sectionName) {
    if (!q || !q.id) return;
    const keyMap = (_exam && (_exam.secureKeyMap || _exam._secureKeyMap)) || {};
    const salt = (_exam && (_exam.examSalt || _exam._salt)) || '';
    _answerCache[q.id] = {
      id: q.id,
      section: sectionName,
      type: q.type,
      correct: q.correct !== undefined ? q.correct : null,
      pairs: q.pairs ? JSON.parse(JSON.stringify(q.pairs)) : null,
      text: q.text || '',
      secureEntry: keyMap[q.id] || null,
      salt: salt
    };
  }

  /**
   * Intentionally inert stub for backward compatibility.
   * In Mode B (server-graded), answers are NEVER fetched to the client bundle.
   * Grading is performed authoritatively on the server upon submission.
   */
  async function fetchExternalAnswers() {
    console.warn('[AnswerService] fetchExternalAnswers is intentionally inert: Mode B enforces authoritative server-side grading upon submission.');
    return { success: false, error: 'Intentionally inert: Mode B performs authoritative server-side grading upon submission.' };
  }

  function getAnswer(questionId, qObj = null) {
    if (!questionId && !qObj) return null;
    const cleanId = String(questionId || '').trim();
    if (cleanId && _answerCache[cleanId]) return _answerCache[cleanId];

    // 1. Case-insensitive key lookup fallback
    if (cleanId) {
      const lowerId = cleanId.toLowerCase();
      for (const key of Object.keys(_answerCache)) {
        if (key.toLowerCase() === lowerId) {
          return _answerCache[key];
        }
      }
    }

    // 2. Question text similarity matching fallback
    if (qObj && qObj.text) {
      const targetText = String(qObj.text).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (targetText.length >= 6) {
        for (const entry of Object.values(_answerCache)) {
          if (entry && entry.text) {
            const entryText = String(entry.text).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            if (entryText && (entryText === targetText || entryText.includes(targetText) || targetText.includes(entryText))) {
              return entry;
            }
          }
        }
      }
    }
    return null;
  }

  function getAllAnswers() {
    return { ..._answerCache };
  }

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

  function scoreQuestionDetailed(q, studentAnswer) {
    if (!q) return { earned: 0, possible: 1, isCorrect: false };

    const entry = getAnswer(q.id, q);
    const correctVal = entry && entry.correct !== undefined && entry.correct !== null ? entry.correct : q.correct;
    const pairsVal = entry && entry.pairs ? entry.pairs : q.pairs;
    const qType = q.type || (entry ? entry.type : 'mc');

    const hasPlainCorrect = correctVal !== undefined && correctVal !== null;
    const hasValidPairs = Array.isArray(pairsVal) && pairsVal.length > 0 && pairsVal.some(p => p && p.right);

    if (!hasPlainCorrect && !hasValidPairs) {
      // Mode A obfuscated answer verification via SHA-256
      const examObj = _exam || (typeof window !== 'undefined' && (window.__JCAH_EXAM__ || window.__JCAH_EXAM__)) || {};
      const keyMap = examObj.secureKeyMap || examObj._secureKeyMap || (entry && entry.secureEntry ? { [q.id]: entry.secureEntry } : null);
      const salt = examObj.examSalt || examObj._salt || (entry && entry.salt) || '';
      const sec = (keyMap && keyMap[q.id]) || (entry && entry.secureEntry);

      if (sec) {
        if (sec.type === 'mc' || sec.type === 'tf') {
          if (studentAnswer === null || studentAnswer === undefined || studentAnswer === '') return { earned: 0, possible: 1, isCorrect: false };
          const norm = String(studentAnswer).trim().toLowerCase();
          const h = sha256Sync(`jcah_${salt}_${norm}`);
          const isCorrect = (h === sec.hash);
          return { earned: isCorrect ? 1 : 0, possible: 1, isCorrect };
        } else if (sec.type === 'fb') {
          if (studentAnswer === null || studentAnswer === undefined || studentAnswer === '') return { earned: 0, possible: 1, isCorrect: false };
          const norm = String(studentAnswer).trim().toLowerCase();
          const h = sha256Sync(`jcah_${salt}_${norm}`);
          const isCorrect = Array.isArray(sec.hashes) && sec.hashes.includes(h);
          return { earned: isCorrect ? 1 : 0, possible: 1, isCorrect };
        } else if (sec.type === 'mr') {
          if (!Array.isArray(studentAnswer) || studentAnswer.length === 0) return { earned: 0, possible: 1, isCorrect: false };
          const rawGiven = Array.from(new Set(studentAnswer.map(a => sha256Sync(`jcah_${salt}_${String(a).trim().toLowerCase()}`)))).filter(Boolean);
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
          if (studentAnswer && typeof studentAnswer === 'object') {
            keys.forEach(leftKey => {
              const trimmedKey = String(leftKey).trim();
              const userRight = String(studentAnswer[trimmedKey] !== undefined ? studentAnswer[trimmedKey] : (studentAnswer[leftKey] || '')).trim().toLowerCase();
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
      return { earned: 0, possible: 1, isCorrect: false };
    }

    if (qType === 'matching') {
      let pairsToTest = pairsVal;
      if (!Array.isArray(pairsToTest) && Array.isArray(correctVal)) pairsToTest = correctVal;
      if (!Array.isArray(pairsToTest) && typeof correctVal === 'string') {
        try {
          const parsed = JSON.parse(correctVal);
          if (Array.isArray(parsed)) pairsToTest = parsed;
        } catch (_) { }
      }
      if (!Array.isArray(pairsToTest)) pairsToTest = [];
      let matchCount = 0;
      if (studentAnswer && typeof studentAnswer === 'object' && pairsToTest.length > 0) {
        pairsToTest.forEach(p => {
          const lKey = String(p.left || '').trim();
          const exp = normalizeText(p.right || '');
          const given = normalizeText(studentAnswer[lKey] !== undefined ? studentAnswer[lKey] : (studentAnswer[p.left] || ''));
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

    if (studentAnswer === null || studentAnswer === undefined || studentAnswer === '') {
      return { earned: 0, possible: 1, isCorrect: false };
    }

    let isCorrect = false;
    switch (qType) {
      case 'mc':
      case 'tf':
        isCorrect = normalizeText(studentAnswer) === normalizeText(correctVal);
        break;

      case 'fb': {
        const a = normalizeText(studentAnswer);
        let accepted = [];
        if (Array.isArray(correctVal)) {
          accepted = correctVal;
        } else if (typeof correctVal === 'string') {
          accepted = correctVal.split(',').map(s => s.trim());
        } else {
          accepted = [correctVal];
        }
        isCorrect = accepted.some(c => normalizeText(c) === a);
        break;
      }

      case 'mr': {
        if (!Array.isArray(studentAnswer)) {
          return { earned: 0, possible: 1, isCorrect: false };
        }
        let expected = [];
        if (Array.isArray(correctVal)) {
          expected = correctVal;
        } else if (typeof correctVal === 'string') {
          try {
            const parsed = JSON.parse(correctVal);
            if (Array.isArray(parsed)) expected = parsed;
            else expected = correctVal.split(',').map(s => s.trim());
          } catch (_) {
            expected = correctVal.split(',').map(s => s.trim());
          }
        }
        const given = Array.from(new Set(studentAnswer.map(s => normalizeText(s)).filter(Boolean)));
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

  function scoreQuestion(q, studentAnswer) {
    return scoreQuestionDetailed(q, studentAnswer).isCorrect;
  }

  function scoreSection(questions, answersMap) {
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return { correct: 0, total: 0, pct: 0, rawPct: 0, hasConfiguredQuestions: false, error: 'Section has zero configured questions' };
    }
    let correct = 0;
    let total = 0;
    const ansMap = answersMap || {};
    for (const q of questions) {
      const qScore = scoreQuestionDetailed(q, ansMap[q.id]);
      correct += qScore.earned;
      total += qScore.possible;
    }
    const rawPct = total > 0 ? (correct / total) * 100 : 0;
    const pct = Number(rawPct.toFixed(2));
    return { correct, total, pct, rawPct, hasConfiguredQuestions: true };
  }

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

  function mapPercentageToLevel(score) {
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
  }

  function computeAllScores(attempt, exam) {
    let rQuestions = (Array.isArray(attempt.readingQuestions) && attempt.readingQuestions.length > 0)
      ? attempt.readingQuestions
      : (attempt.selectedReadingItems || []).flatMap(it => (it && Array.isArray(it.questions)) ? it.questions : []);

    let lQuestions = (Array.isArray(attempt.listeningQuestions) && attempt.listeningQuestions.length > 0)
      ? attempt.listeningQuestions
      : (attempt.selectedListeningItems || []).flatMap(it => (it && Array.isArray(it.questions)) ? it.questions : []);

    if (_mode === 'external' || (exam && exam.answerSource === 'external')) {
      const getPoints = (qList) => (qList || []).reduce((acc, q) => acc + (q && q.type === 'matching' && Array.isArray(q.pairs) && q.pairs.length > 0 ? q.pairs.length : 1), 0);
      const vTotal = getPoints(Array.isArray(attempt.vocabQuestions) ? attempt.vocabQuestions : (exam && exam.vocabulary && exam.vocabulary.questions ? exam.vocabulary.questions : []));
      const gTotal = getPoints(Array.isArray(attempt.grammarQuestions) ? attempt.grammarQuestions : (exam && exam.grammar && exam.grammar.questions ? exam.grammar.questions : []));
      const rTotal = getPoints(rQuestions);
      const lTotal = getPoints(lQuestions);
      return {
        vocab: { pct: 0, score: 0, total: vTotal, rawPct: 0 },
        grammar: { pct: 0, score: 0, total: gTotal, rawPct: 0 },
        reading: { pct: 0, score: 0, total: rTotal, rawPct: 0 },
        listening: { pct: 0, score: 0, total: lTotal, rawPct: 0 },
        writingScore: null,
        overall: null,
        passed: false,
        pendingServerGrading: true,
        serverVerdict: 'pending',
        overallCefr: { key: 'Pending', label: 'Pending', cssClass: 'chip-muted' }
      };
    }

    // Delegate to JCAHScoring if available
    if (typeof JCAHScoring !== 'undefined' && JCAHScoring.computeAllScores) {
      return JCAHScoring.computeAllScores(attempt, exam);
    }

    const validationErrors = [];
    const examIncludesSpeaking = (attempt && attempt.examIncludesSpeaking !== undefined)
      ? Boolean(attempt.examIncludesSpeaking)
      : Boolean(exam && exam.speaking && exam.speaking.enabled !== false && (exam.speaking.parts === undefined || Number(exam.speaking.parts) > 0));

    const vocab = scoreSection(attempt.vocabQuestions, attempt.vocabAnswers || {});
    const grammar = scoreSection(attempt.grammarQuestions, attempt.grammarAnswers || {});
    const reading = scoreSection(rQuestions, attempt.readingAnswers || {});
    const listening = scoreSection(lQuestions, attempt.listeningAnswers || {});

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
    const readingPercentage = reading.hasConfiguredQuestions && reading.total > 0 ? (reading.correct / reading.total) * 100 : null;
    const listeningPercentage = listening.hasConfiguredQuestions && listening.total > 0 ? (listening.correct / listening.total) * 100 : null;

    const scoringHelper = (typeof JCAHScoring !== 'undefined') ? JCAHScoring : null;
    const cefrForPct = scoringHelper ? scoringHelper.cefrForPct : (pct => {
      const lvl = mapPercentageToLevel(pct);
      return { key: lvl || 'A0', label: lvl || 'A0' };
    });

    let effectiveVocabPct = vocabularyPercentage;
    let effectiveGrammarPct = grammarPercentage;
    let vocabCefr = vocabularyPercentage !== null ? cefrForPct(vocabularyPercentage) : cefrForPct(null);
    let grammarCefr = grammarPercentage !== null ? cefrForPct(grammarPercentage) : cefrForPct(null);

    // Adaptive Scoring for Leveled Vocab and Grammar
    if (typeof JCAHAdaptiveEngine !== 'undefined') {
      try {
        if (attempt.vocabQuestions && attempt.vocabQuestions.some(q => q.level)) {
          const vAdapt = JCAHAdaptiveEngine.gradeSectionAdaptively(attempt.vocabQuestions, attempt.vocabAnswers || {}, 'vocab', exam.vocabAdaptive);
          vocabCefr = { key: vAdapt.level, label: vAdapt.level };
          if (typeof vAdapt.score === 'number') {
            effectiveVocabPct = vAdapt.score;
          }
        }
        if (attempt.grammarQuestions && attempt.grammarQuestions.some(q => q.level)) {
          const gAdapt = JCAHAdaptiveEngine.gradeSectionAdaptively(attempt.grammarQuestions, attempt.grammarAnswers || {}, 'grammar', exam.grammarAdaptive);
          grammarCefr = { key: gAdapt.level, label: gAdapt.level };
          if (typeof gAdapt.score === 'number') {
            effectiveGrammarPct = gAdapt.score;
          }
        }
      } catch (_) { }
    }

    const writingPercentage = (effectiveVocabPct !== null && effectiveGrammarPct !== null)
      ? (effectiveVocabPct + effectiveGrammarPct) / 2
      : null;

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

    const isIncomplete = hasZeroConfiguredQuestions || missingSpeaking || scaleMismatch;
    let overallPercentage = null;
    if (!isIncomplete) {
      if (examIncludesSpeaking) {
        overallPercentage = (writingPercentage + readingPercentage + listeningPercentage + speakingPercentage) / 4;
      } else {
        overallPercentage = (writingPercentage + readingPercentage + listeningPercentage) / 3;
      }
    }

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
        pct: effectiveVocabPct !== null ? Number(effectiveVocabPct.toFixed(2)) : 0,
        rawPct: vocabularyPercentage !== null ? vocabularyPercentage : 0,
        cefr: vocabCefr
      },
      grammar: {
        correct: grammar.correct,
        total: grammar.total,
        pct: effectiveGrammarPct !== null ? Number(effectiveGrammarPct.toFixed(2)) : 0,
        rawPct: grammarPercentage !== null ? grammarPercentage : 0,
        cefr: grammarCefr
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
      vocabCefr,
      grammarCefr,
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

  function extractAnswerKeyRows(exam) {
    const targetExam = exam || _exam;
    if (!targetExam) return [];

    const rows = [];

    function formatCorrect(q) {
      if (q.type === 'matching' && Array.isArray(q.pairs)) {
        return q.pairs.map(p => `${p.left} -> ${p.right}`).join(' | ');
      }
      if (Array.isArray(q.correct)) {
        return q.correct.join(', ');
      }
      return q.correct !== undefined && q.correct !== null ? String(q.correct) : '';
    }

    function formatOptions(q) {
      if (q.type === 'matching' && Array.isArray(q.pairs)) {
        return q.pairs.map(p => p.left).join(' | ');
      }
      if (Array.isArray(q.options)) {
        return q.options.join(' | ');
      }
      return '';
    }

    if (targetExam.vocabulary && Array.isArray(targetExam.vocabulary.questions)) {
      targetExam.vocabulary.questions.forEach((q, idx) => {
        rows.push({
          questionId: q.id || `vocab_${idx + 1}`,
          section: 'Vocabulary',
          bankItem: 'Vocabulary Bank',
          questionNumber: idx + 1,
          type: q.type || 'mc',
          level: q.level || '',
          text: q.text || '',
          options: formatOptions(q),
          correctAnswer: formatCorrect(q),
        });
      });
    }

    if (targetExam.grammar && Array.isArray(targetExam.grammar.questions)) {
      targetExam.grammar.questions.forEach((q, idx) => {
        rows.push({
          questionId: q.id || `grammar_${idx + 1}`,
          section: 'Grammar',
          bankItem: 'Grammar Bank',
          questionNumber: idx + 1,
          type: q.type || 'mc',
          level: q.level || '',
          text: q.text || '',
          options: formatOptions(q),
          correctAnswer: formatCorrect(q),
        });
      });
    }

    if (Array.isArray(targetExam.readingBanks)) {
      targetExam.readingBanks.forEach((bank, bIdx) => {
        const bankTitle = bank.name || `Reading Bank ${bank.bankNumber || (bIdx + 1)}`;
        (bank.items || []).forEach((item, iIdx) => {
          const itemTitle = item.title || `Passage ${iIdx + 1}`;
          (item.questions || []).forEach((q, qIdx) => {
            rows.push({
              questionId: q.id || `reading_${bIdx + 1}_${iIdx + 1}_${qIdx + 1}`,
              section: 'Reading',
              bankItem: `${bankTitle} — ${itemTitle}`,
              questionNumber: qIdx + 1,
              type: q.type || 'mc',
              text: q.text || '',
              options: formatOptions(q),
              correctAnswer: formatCorrect(q),
            });
          });
        });
      });
    }

    if (Array.isArray(targetExam.listeningBanks)) {
      targetExam.listeningBanks.forEach((bank, bIdx) => {
        const bankTitle = bank.name || `Listening Bank ${bank.bankNumber || (bIdx + 1)}`;
        (bank.items || []).forEach((item, iIdx) => {
          const itemTitle = item.audioFilename || `Audio ${iIdx + 1}`;
          (item.questions || []).forEach((q, qIdx) => {
            rows.push({
              questionId: q.id || `listening_${bIdx + 1}_${iIdx + 1}_${qIdx + 1}`,
              section: 'Listening',
              bankItem: `${bankTitle} — ${itemTitle}`,
              questionNumber: qIdx + 1,
              type: q.type || 'mc',
              text: q.text || '',
              options: formatOptions(q),
              correctAnswer: formatCorrect(q),
            });
          });
        });
      });
    }

    return rows;
  }

  function downloadAnswerKey(exam, format = 'csv') {
    const targetExam = exam || _exam;
    if (!targetExam) {
      alert('No exam loaded to export answer key.');
      return;
    }

    const rows = extractAnswerKeyRows(targetExam);
    if (rows.length === 0) {
      alert('No questions found in exam to export.');
      return;
    }

    const testId = (targetExam.id || 'exam').replace(/[^a-z0-9]/gi, '_').substring(0, 16);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

    if (format === 'csv') {
      const headers = ['Question ID', 'Section', 'Bank / Passage', 'Q#', 'Type', 'Question Text', 'Options / Distractors', 'Correct Answer'];
      const csvLines = [
        headers.join(','),
        ...rows.map(r => [
          `"${String(r.questionId).replace(/"/g, '""')}"`,
          `"${String(r.section).replace(/"/g, '""')}"`,
          `"${String(r.bankItem).replace(/"/g, '""')}"`,
          r.questionNumber,
          `"${String(r.type).replace(/"/g, '""')}"`,
          `"${String(r.text).replace(/"/g, '""')}"`,
          `"${String(r.options).replace(/"/g, '""')}"`,
          `"${String(r.correctAnswer).replace(/"/g, '""')}"`,
        ].join(','))
      ];

      const csvContent = '\uFEFF' + csvLines.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const filename = `answer_key_${testId}_${timestamp}.csv`;

      if (typeof saveAs !== 'undefined') {
        saveAs(blob, filename);
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } else {
      const xml = _buildExcelXml(rows, targetExam);
      const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const filename = `answer_key_${testId}_${timestamp}.xls`;

      if (typeof saveAs !== 'undefined') {
        saveAs(blob, filename);
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  }

  function _buildExcelXml(rows, exam) {
    const title = exam.title || 'JCAH Exam Answer Key';
    const escapeXml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    let tableXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B0C0D4"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#1B4F8A" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="TitleStyle">
   <Font ss:FontName="Calibri" ss:Size="14" ss:Color="#1B4F8A" ss:Bold="1"/>
  </Style>
  <Style ss:ID="CorrectStyle">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#064E3B" ss:Bold="1"/>
   <Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Answers">
  <Table ss:DefaultRowHeight="20">
   <Column ss:Width="160"/>
   <Column ss:Width="90"/>
   <Column ss:Width="150"/>
   <Column ss:Width="40"/>
   <Column ss:Width="60"/>
   <Column ss:Width="260"/>
   <Column ss:Width="180"/>
   <Column ss:Width="180"/>
   <Row ss:Height="26">
    <Cell ss:MergeAcross="7" ss:StyleID="TitleStyle"><Data ss:Type="String">${escapeXml(title)} — Secure Answer Key</Data></Cell>
   </Row>
   <Row ss:Height="24">
    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">Question ID</Data></Cell>
    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">Section</Data></Cell>
    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">Bank / Passage</Data></Cell>
    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">Q#</Data></Cell>
    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">Type</Data></Cell>
    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">Question Text</Data></Cell>
    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">Options / Distractors</Data></Cell>
    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">Correct Answer</Data></Cell>
   </Row>`;

    rows.forEach(r => {
      tableXml += `
   <Row>
    <Cell><Data ss:Type="String">${escapeXml(r.questionId)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(r.section)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(r.bankItem)}</Data></Cell>
    <Cell><Data ss:Type="Number">${r.questionNumber}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(r.type)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(r.text)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(r.options)}</Data></Cell>
    <Cell ss:StyleID="CorrectStyle"><Data ss:Type="String">${escapeXml(r.correctAnswer)}</Data></Cell>
   </Row>`;
    });

    tableXml += `
  </Table>
 </Worksheet>
</Workbook>`;
    return tableXml;
  }

  function sanitizeExamForClient(exam) {
    if (!exam) return exam;
    const sanitized = JSON.parse(JSON.stringify(exam));

    function sanitizeQuestion(q) {
      if (!q) return;
      delete q.correct;
      if (q.type === 'matching' && Array.isArray(q.pairs)) {
        const pairsClone = JSON.parse(JSON.stringify(q.pairs));
        const rights = pairsClone.map(p => String(p.right || '').trim()).filter(Boolean);
        const shuffled = rights.slice().sort(() => Math.random() - 0.5);
        q.shuffledRightChoices = (Array.isArray(q.shuffledRightChoices) && q.shuffledRightChoices.length > 0)
          ? q.shuffledRightChoices
          : shuffled;
        q.shuffledRight = q.shuffledRightChoices;
        q.rightChoices = q.shuffledRightChoices;
        q.pairs = pairsClone.map(p => ({ left: p.left, right: '' }));
      }
    }

    if (sanitized.vocabulary && Array.isArray(sanitized.vocabulary.questions)) {
      sanitized.vocabulary.questions.forEach(sanitizeQuestion);
    }
    if (sanitized.grammar && Array.isArray(sanitized.grammar.questions)) {
      sanitized.grammar.questions.forEach(sanitizeQuestion);
    }
    if (Array.isArray(sanitized.readingBanks)) {
      sanitized.readingBanks.forEach(bank => {
        (bank.items || []).forEach(item => {
          (item.questions || []).forEach(sanitizeQuestion);
        });
      });
    }
    if (Array.isArray(sanitized.listeningBanks)) {
      sanitized.listeningBanks.forEach(bank => {
        (bank.items || []).forEach(item => {
          (item.questions || []).forEach(sanitizeQuestion);
        });
      });
    }

    return sanitized;
  }

  async function publishAnswerKey(exam, endpoint, sheetName = 'Answers', adminApiKeyOverride) {
    const targetExam = exam || _exam;
    if (!targetExam) return { success: false, error: 'No exam provided' };
    const url = endpoint ||
      (targetExam.examType === 'placement' && targetExam.placementWebhookUrl) ||
      (targetExam.externalAnswerConfig && targetExam.externalAnswerConfig.apiEndpoint) ||
      targetExam.webhookUrl;
    if (!url) return { success: false, error: 'No Webhook URL or API Endpoint configured' };

    const rows = extractAnswerKeyRows(targetExam);
    if (rows.length === 0) return { success: false, error: 'No questions found in exam to publish' };

    const answersPayload = rows.map(r => ({
      id: r.questionId,
      questionId: r.questionId,
      section: r.section,
      bank: r.bankItem,
      qNum: r.questionNumber,
      type: r.type,
      level: r.level || '',
      text: r.text,
      prompt: r.text,
      options: r.options,
      correctAnswer: r.correctAnswer,
      correct: r.correctAnswer
    }));

    // WP1: Admin key must come from author studio context / parameter, never candidate package
    const adminKey = String(
      adminApiKeyOverride ||
      (typeof window !== 'undefined' && (window.__AUTHOR_ADMIN_API_KEY__ || window.localStorage?.getItem('jcah_author_admin_api_key') || window.sessionStorage?.getItem('jcah_author_admin_api_key'))) ||
      targetExam._adminApiKey ||
      targetExam.adminApiKey ||
      (targetExam.externalAnswerConfig && targetExam.externalAnswerConfig.adminApiKey) ||
      (targetExam.reporting && targetExam.reporting.adminApiKey) ||
      ''
    ).trim();

    const resolvedSheetName = (targetExam.examType === 'placement')
      ? 'PlacementAnswers'
      : (sheetName ||
        (targetExam.externalAnswerConfig && targetExam.externalAnswerConfig.sheetName) ||
        (targetExam.externalAnswerConfig && targetExam.externalAnswerConfig.range ? String(targetExam.externalAnswerConfig.range).split('!')[0].trim() : '') ||
        'Answers');

    const sheetId = (targetExam.externalAnswerConfig && (targetExam.externalAnswerConfig.sheetId || targetExam.externalAnswerConfig.spreadsheetId)) || targetExam.sheetId || '';
    const range = (targetExam.examType === 'placement')
      ? 'PlacementAnswers!A2:F'
      : ((targetExam.externalAnswerConfig && targetExam.externalAnswerConfig.range) || (resolvedSheetName + '!A2:E'));

    const payload = {
      action: 'publish_answers',
      sheetName: resolvedSheetName,
      range: range,
      sheetId: sheetId,
      spreadsheetId: sheetId,
      examId: targetExam.id || '',
      examTitle: targetExam.title || '',
      adminApiKey: adminKey,
      adminKey: adminKey,
      apiKey: adminKey,
      answers: answersPayload,
      questions: answersPayload
    };

    // CORS Simple Request: DO NOT set custom headers such as 'X-API-Key'.
    // Google Apps Script Web Apps do not respond to OPTIONS preflight requests!
    // Setting 'X-API-Key' triggers an OPTIONS preflight which fails in browsers,
    // and in no-cors mode, causes modern browsers to throw a TypeError (non-safelisted header).
    // Authentication key is securely delivered in the JSON request body (payload.apiKey).
    const headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    const requestUrl = url;

    try {
      // First attempt: standard CORS POST (works when served over HTTP/HTTPS)
      const resp = await fetch(requestUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });
      if (resp.status === 401) {
        throw new Error('HTTP 401 Unauthorized: The Apps Script Web App is deployed with restricted access. You MUST redeploy with "Who has access: Anyone".');
      }
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.success === false) {
          return {
            success: false,
            code: data.code || (data.error === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'PUBLISH_FAILED'),
            error: data.message || data.error || `Server rejected publish (${data.code || 'UNKNOWN'})`,
            sheetName: resolvedSheetName,
            data
          };
        }
        return { success: true, count: rows.length, sheetName: resolvedSheetName, data };
      }
      throw new Error(`HTTP ${resp.status}`);
    } catch (fetchErr) {
      if (fetchErr.message && fetchErr.message.includes('401')) {
        return {
          success: false,
          error: fetchErr.message
        };
      }
      console.warn('[AnswerService] Standard POST failed, attempting no-cors fallback:', fetchErr);

      // ⚠️ JSONP (GET) cannot carry the answers array payload — do NOT use it for publish.
      // Instead, attempt a no-cors POST (fire-and-forget). GAS accepts cross-origin POSTs
      // but the browser won't expose the response body in no-cors mode.
      try {
        await fetch(requestUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        // no-cors response is always opaque — we assume success if no network error thrown
        console.log('[AnswerService] no-cors POST dispatched. Response is opaque (GAS should have received the payload).');
        return {
          success: true,
          count: rows.length,
          sheetName: resolvedSheetName,
          warning: 'Response not readable (no-cors mode). Verify the ' + resolvedSheetName + ' tab in your Google Sheet to confirm data was received.',
          data: { status: 'dispatched_no_cors' }
        };
      } catch (noCorsErr) {
        console.error('[AnswerService] no-cors POST also failed:', noCorsErr);
        return {
          success: false,
          error: 'Could not reach the Google Apps Script endpoint. ' +
            'Make sure the Web App is deployed with "Anyone" access and the URL is correct. ' +
            'Note: publishing requires the exam to be served over HTTP/HTTPS (not file://). ' +
            'Original error: ' + fetchErr.message
        };
      }
    }
  }

  return {
    initialize,
    fetchExternalAnswers,
    getAnswer,
    getAllAnswers,
    scoreQuestion,
    scoreQuestionDetailed,
    scoreSection,
    computeAllScores,
    extractAnswerKeyRows,
    downloadAnswerKey,
    publishAnswerKey,
    sanitizeExamForClient,
    getMode: () => _mode,
    isReady: () => _isReady,
    getLastError: () => _lastError,
  };

})();

if (typeof window !== 'undefined') {
  window.JCAHAnswerService = JCAHAnswerService;
  window.answerService = JCAHAnswerService;
}
if (typeof module !== 'undefined') module.exports = JCAHAnswerService;

