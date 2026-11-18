/**
 * JCAHTGenX v5 — Adaptive Written Scoring Engine (Vocabulary & Grammar)
 * Implements transparent, deterministic CEFR-based adaptive testing matching the
 * speaking section's adaptive principles.
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JCAHAdaptiveEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const CEFR_LEVELS_STANDARD = ['A1', 'A2', 'B1', 'B2'];
  const CEFR_LEVELS_EXTENDED = ['A1', 'A2', 'B1', 'B2', 'C1'];

  const CEFR_NUMERIC_MIDPOINTS = {
    'A0': 0,
    'A1': 15,
    'A1+': 25,
    'A2': 35,
    'A2+': 45,
    'B1': 55,
    'B1+': 65,
    'B2': 75,
    'B2+': 85,
    'C1': 95,
    'C1+': 98
  };

  /**
   * Partitions an array of questions into CEFR level buckets.
   * If a question lacks a 'level' property, it is assigned 'A2' or fallback.
   */
  function partitionQuestionsByLevel(questions, defaultLevel) {
    const fallback = (defaultLevel || 'A2').toUpperCase();
    const buckets = { A1: [], A2: [], B1: [], B2: [], C1: [] };
    if (!Array.isArray(questions)) return buckets;

    questions.forEach(q => {
      if (!q) return;
      const rawLvl = String(q.level || fallback).toUpperCase().trim();
      const cleanLvl = rawLvl.replace('+', '');
      if (buckets[cleanLvl]) {
        buckets[cleanLvl].push(q);
      } else if (cleanLvl.startsWith('A')) {
        buckets['A1'].push(q);
      } else if (cleanLvl.startsWith('B')) {
        buckets['B1'].push(q);
      } else if (cleanLvl.startsWith('C')) {
        buckets['C1'].push(q);
      } else {
        buckets['A2'].push(q);
      }
    });

    return buckets;
  }

  /**
   * Deterministic Adaptive Assessment Evaluator for Vocab and Grammar.
   * Analyzes an attempted set of questions or routes real-time item presentation.
   */
  class AdaptiveSectionEvaluator {
    constructor(options) {
      const opts = options || {};
      this.sectionKey = opts.sectionKey || 'vocab'; // 'vocab' | 'grammar'
      this.allowC1 = Boolean(opts.allowC1 || opts.includeC1);
      this.startingLevel = (opts.startingLevel || 'A2').toUpperCase();
      this.advanceStreak = Math.max(1, opts.advanceStreak || 2);
      this.dropStreak = Math.max(1, opts.dropStreak || 2);
      this.minPerLevel = Math.max(1, opts.minPerLevel || opts.minQuestionsPerLevel || 2);

      this.levels = this.allowC1 ? CEFR_LEVELS_EXTENDED : CEFR_LEVELS_STANDARD;
      let startIdx = this.levels.indexOf(this.startingLevel);
      if (startIdx < 0) startIdx = 0;
      this.currentLevelIdx = startIdx;
      this.highestLevelReached = this.levels[startIdx] || 'A1';

      this.log = [];
      this.scoredCount = 0;
      this.correctCount = 0;
      this.streakCorrect = 0;
      this.streakIncorrect = 0;
      this.levelHistory = [];
      this.done = false;
      this.settledLevel = null;
      this.isPlus = false;
      this.reason = '';
    }

    get currentLevel() {
      return this.levels[this.currentLevelIdx] || 'A1';
    }

    /**
     * Record an answered question at the current adaptive stage
     */
    recordAnswer(questionId, isCorrect, level, earned, possible) {
      const qLvl = (level || this.currentLevel).toUpperCase();
      const pEarned = earned !== undefined ? earned : (isCorrect ? 1 : 0);
      const pPossible = possible !== undefined ? possible : 1;
      const itemRecord = {
        n: this.log.length + 1,
        questionId: questionId,
        level: qLvl,
        isCorrect: Boolean(isCorrect),
        earned: pEarned,
        possible: pPossible,
      };
      this.log.push(itemRecord);
      this.scoredCount++;
      this.totalEarned = (this.totalEarned || 0) + pEarned;
      this.totalPossible = (this.totalPossible || 0) + pPossible;

      if (isCorrect) {
        this.correctCount++;
        this.streakCorrect++;
        this.streakIncorrect = 0;
        if (this.streakCorrect >= this.advanceStreak) {
          if (this.currentLevelIdx < this.levels.length - 1) {
            const prev = this.currentLevel;
            this.currentLevelIdx++;
            if (this.currentLevelIdx > this.levels.indexOf(this.highestLevelReached)) {
              this.highestLevelReached = this.currentLevel;
            }
            this.levelHistory.push({ from: prev, to: this.currentLevel, reason: `Advancement: ${this.advanceStreak} consecutive correct` });
            this.streakCorrect = 0;
          }
        }
      } else {
        this.streakIncorrect++;
        this.streakCorrect = 0;
        if (this.streakIncorrect >= this.dropStreak) {
          if (this.currentLevelIdx > 0) {
            const prev = this.currentLevel;
            this.currentLevelIdx--;
            this.levelHistory.push({ from: prev, to: this.currentLevel, reason: `Demotion: ${this.streakIncorrect} consecutive incorrect` });
            this.streakIncorrect = 0;
          }
        }
      }
    }

    recordResponse(isCorrect, details = {}) {
      const qId = details.id || details.questionId || ('q_' + (this.log.length + 1));
      const lvl = details.level || this.currentLevel;
      this.recordAnswer(qId, isCorrect, lvl);
    }

    /**
     * Finalize and compute estimated CEFR and 0-100 score
     */
    finalize() {
      this.done = true;
      if (this.scoredCount === 0 || this.correctCount === 0) {
        this.settledLevel = 'A0';
        this.isPlus = false;
        this.reason = this.scoredCount === 0 ? 'No questions answered.' : '0 questions answered correctly.';
        return this.getSummary();
      }

      if (this.correctCount === 1) {
        this.settledLevel = 'A0';
        this.isPlus = false;
        this.reason = 'Only 1 question correct. Insufficient evidence to certify above A0.';
        return this.getSummary();
      }

      // Check level distribution
      const levelHits = {};
      this.levels.forEach(l => { levelHits[l] = { correct: 0, total: 0, earned: 0 }; });
      this.log.forEach(item => {
        const lvl = item.level.replace('+', '');
        if (levelHits[lvl]) {
          levelHits[lvl].total += item.possible || 1;
          levelHits[lvl].earned += item.earned !== undefined ? item.earned : (item.isCorrect ? 1 : 0);
          if (item.isCorrect) levelHits[lvl].correct++;
        }
      });

      // Find highest reliably demonstrated level (at least minPerLevel correct or strong ratio)
      let highestValidatedIdx = 0; // A1
      for (let i = 0; i < this.levels.length; i++) {
        const lvl = this.levels[i];
        const stats = levelHits[lvl];
        if (stats && stats.correct >= this.minPerLevel && (stats.correct / stats.total) >= 0.5) {
          highestValidatedIdx = i;
        }
      }

      // If overall correct count < 3 and candidate reached A2+, cap at A1
      if (this.correctCount < 3 && highestValidatedIdx > 0) {
        highestValidatedIdx = 0; // A1
        this.reason = `Sample size limited (${this.correctCount} correct). Capped at A1.`;
      }

      const candidateLevel = this.levels[highestValidatedIdx] || 'A1';
      // Plus flag: if candidate demonstrated correct answers in the next level up or high overall accuracy
      const nextLvl = this.levels[highestValidatedIdx + 1];
      const hasUpperEvidence = nextLvl && levelHits[nextLvl] && levelHits[nextLvl].correct > 0;
      const overallRatio = this.correctCount / this.scoredCount;
      const plus = Boolean(hasUpperEvidence || overallRatio >= 0.85);

      this.settledLevel = candidateLevel;
      this.isPlus = plus;
      if (!this.reason) {
        this.reason = `Settled at ${candidateLevel}${plus ? '+' : ''} (${this.correctCount}/${this.scoredCount} correct).`;
      }

      return this.getSummary();
    }

    getSummary() {
      if (!this.done) {
        return this.finalize();
      }
      const fullLevel = this.settledLevel ? (this.settledLevel + (this.isPlus ? '+' : '')) : 'A0';
      const baseMid = CEFR_NUMERIC_MIDPOINTS[fullLevel] !== undefined ? CEFR_NUMERIC_MIDPOINTS[fullLevel] : 0;

      // Adjust score slightly within the band based on overall percentage accuracy
      let finalScore = baseMid;
      const effectiveAcc = (this.totalPossible > 0) ? (this.totalEarned / this.totalPossible) : (this.scoredCount > 0 ? this.correctCount / this.scoredCount : 0);
      if (this.scoredCount > 0 && this.settledLevel !== 'A0') {
        // Fine adjustment between -4 and +4 points within the 10-point CEFR band
        const fineAdj = Math.round((effectiveAcc - 0.6) * 10);
        finalScore = Math.max(0, Math.min(100, baseMid + fineAdj));
      } else if (this.settledLevel === 'A0') {
        finalScore = this.correctCount === 1 ? 5 : 0;
      }

      const totalEarnedPts = this.totalEarned !== undefined ? Number(this.totalEarned.toFixed(2)) : this.correctCount;
      return {
        section: this.sectionKey,
        level: fullLevel,
        estimatedCefr: fullLevel,
        rawLevel: this.settledLevel || 'A0',
        plus: this.isPlus,
        score: finalScore,
        finalScore: finalScore,
        correctCount: totalEarnedPts,
        totalCorrect: totalEarnedPts,
        scoredCount: this.scoredCount,
        totalItems: this.scoredCount,
        highestLevelReached: this.highestLevelReached || this.currentLevel,
        accuracy: Number((effectiveAcc * 100).toFixed(1)),
        levelHistory: this.levelHistory,
        log: this.log,
        reason: this.reason
      };
    }
  }

  /**
   * Helper to grade an entire completed section adaptively from answer map and questions
   */
  function gradeSectionAdaptively(a1, a2, a3, a4) {
    let sectionKey = 'vocab';
    let questions = [];
    let userAnswers = {};
    let options = {};

    if (typeof a1 === 'string') {
      sectionKey = a1;
      questions = a2 || [];
      userAnswers = a3 || {};
      options = a4 || {};
    } else {
      questions = a1 || [];
      userAnswers = a2 || {};
      sectionKey = a3 || 'vocab';
      options = a4 || {};
    }

    const evaluator = new AdaptiveSectionEvaluator({
      sectionKey: sectionKey,
      allowC1: options?.allowC1 || options?.includeC1,
      startingLevel: options?.startingLevel || 'A2',
      minPerLevel: options?.minPerLevel || options?.minQuestionsPerLevel || 2
    });

    const flatAns = userAnswers || {};
    (questions || []).forEach(q => {
      if (!q || !q.id) return;
      const uAns = flatAns[q.id];
      const isAnsProvided = (uAns !== undefined && uAns !== null && uAns !== '');
      let isCorrect = false;
      let earned = 0;
      let possible = 1;

      if (isAnsProvided) {
        if (q.type === 'matching') {
          // evaluate matching pairs
          const pairs = q.pairs || [];
          let matchCount = 0;
          if (typeof uAns === 'object' && uAns !== null) {
            pairs.forEach(p => {
              if (p && p.left && p.right) {
                const userVal = String(uAns[p.left] || '').trim().toLowerCase();
                const expVal = String(p.right).trim().toLowerCase();
                if (userVal === expVal && expVal.length > 0) matchCount++;
              }
            });
          }
          possible = 1;
          earned = pairs.length > 0 ? Number((matchCount / pairs.length).toFixed(4)) : 0;
          isCorrect = (earned === 1 && pairs.length > 0);
        } else if (q.type === 'tf') {
          const uNorm = String(uAns).trim().toLowerCase();
          const cNorm = String(q.correct).trim().toLowerCase();
          isCorrect = (uNorm === cNorm || (uNorm === 'true' && cNorm === 'verdadero') || (uNorm === 'false' && cNorm === 'falso'));
          earned = isCorrect ? 1 : 0;
        } else if (q.type === 'mr') {
          const uArr = Array.isArray(uAns) ? uAns : String(uAns).split(',').map(s => s.trim().toLowerCase());
          const cArr = Array.isArray(q.correct) ? q.correct.map(s => String(s).trim().toLowerCase()) : [String(q.correct).trim().toLowerCase()];
          const uSet = new Set(uArr.map(s => String(s).trim().toLowerCase()).filter(Boolean));
          const cSet = new Set(cArr.filter(Boolean));
          let correctCount = 0;
          uSet.forEach(x => { if (cSet.has(x)) correctCount++; });
          const excess = Math.max(0, uSet.size - cSet.size);
          const rawEarned = cSet.size > 0 ? (correctCount - excess) / cSet.size : 0;
          earned = Math.max(0, Number(rawEarned.toFixed(4)));
          possible = 1;
          isCorrect = (earned === 1 && uSet.size === cSet.size);
        } else if (q.type === 'fb') {
          const uNorm = String(uAns).trim().toLowerCase();
          const acceptable = Array.isArray(q.correct) ? q.correct : String(q.correct).split(',').map(s => s.trim());
          isCorrect = acceptable.some(a => String(a).trim().toLowerCase() === uNorm);
          earned = isCorrect ? 1 : 0;
        } else {
          // mc default
          isCorrect = String(uAns).trim().toLowerCase() === String(q.correct).trim().toLowerCase();
          earned = isCorrect ? 1 : 0;
        }
      }

      evaluator.recordAnswer(q.id, isCorrect, q.level || 'A2', earned, possible);
    });

    const summary = evaluator.finalize();
    summary.scorePercentage = summary.score;
    summary.totalQuestions = (questions || []).length;
    return summary;
  }

  /**
   * Evaluates correctness of a single question answer (matching, mr, tf, fb, mc).
   */
  function evaluateQuestionAnswer(q, userAns) {
    if (!q) return { earned: 0, possible: 1, isCorrect: false };
    if (typeof globalThis !== 'undefined' && globalThis.JCAHAnswerService && typeof globalThis.JCAHAnswerService.scoreQuestionDetailed === 'function') {
      try {
        return globalThis.JCAHAnswerService.scoreQuestionDetailed(q, userAns);
      } catch (_) {}
    }
    const isAnsProvided = (userAns !== undefined && userAns !== null && userAns !== '');
    if (!isAnsProvided) return { earned: 0, possible: 1, isCorrect: false };

    let isCorrect = false;
    let earned = 0;
    let possible = 1;

    if (q.type === 'matching') {
      const pairs = q.pairs || [];
      let matchCount = 0;
      if (typeof userAns === 'object' && userAns !== null) {
        pairs.forEach(p => {
          if (p && p.left && p.right) {
            const userVal = String(userAns[p.left] || '').trim().toLowerCase();
            const expVal = String(p.right).trim().toLowerCase();
            if (userVal === expVal && expVal.length > 0) matchCount++;
          }
        });
      }
      possible = 1;
      earned = pairs.length > 0 ? Number((matchCount / pairs.length).toFixed(4)) : 0;
      isCorrect = (earned === 1 && pairs.length > 0);
    } else if (q.type === 'tf') {
      const uNorm = String(userAns).trim().toLowerCase();
      const cNorm = String(q.correct).trim().toLowerCase();
      isCorrect = (uNorm === cNorm || (uNorm === 'true' && cNorm === 'verdadero') || (uNorm === 'false' && cNorm === 'falso'));
      earned = isCorrect ? 1 : 0;
    } else if (q.type === 'mr') {
      const uArr = Array.isArray(userAns) ? userAns : String(userAns).split(',').map(s => s.trim().toLowerCase());
      const cArr = Array.isArray(q.correct) ? q.correct.map(s => String(s).trim().toLowerCase()) : [String(q.correct).trim().toLowerCase()];
      const uSet = new Set(uArr.map(s => String(s).trim().toLowerCase()).filter(Boolean));
      const cSet = new Set(cArr.filter(Boolean));
      let correctCount = 0;
      uSet.forEach(x => { if (cSet.has(x)) correctCount++; });
      const excess = Math.max(0, uSet.size - cSet.size);
      const rawEarned = cSet.size > 0 ? (correctCount - excess) / cSet.size : 0;
      earned = Math.max(0, Number(rawEarned.toFixed(4)));
      possible = 1;
      isCorrect = (earned === 1 && uSet.size === cSet.size);
    } else if (q.type === 'fb') {
      const uNorm = String(userAns).trim().toLowerCase();
      const acceptable = Array.isArray(q.correct) ? q.correct : String(q.correct).split(',').map(s => s.trim());
      isCorrect = acceptable.some(a => String(a).trim().toLowerCase() === uNorm);
      earned = isCorrect ? 1 : 0;
    } else {
      const expectedCorrect = q.correct !== undefined ? q.correct : (q.options?.find(o => o.isCorrect)?.id);
      isCorrect = String(userAns).trim().toLowerCase() === String(expectedCorrect).trim().toLowerCase();
      earned = isCorrect ? 1 : 0;
    }
    return { earned, possible, isCorrect };
  }

  /**
   * Maps 0-100 score to CEFR bands per Section 9 specification:
   * A1: 0–19, A1+: 20–29, A2: 30–39, A2+: 40–49, B1: 50–59, B1+: 60–69, B2: 70–79, B2+: 80–89, C1: 90–100.
   */
  function scoreToCefr(score) {
    const s = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    if (s <= 19) return 'A1';
    if (s <= 29) return 'A1+';
    if (s <= 39) return 'A2';
    if (s <= 49) return 'A2+';
    if (s <= 59) return 'B1';
    if (s <= 69) return 'B1+';
    if (s <= 79) return 'B2';
    if (s <= 89) return 'B2+';
    return 'C1';
  }

  function cefrToMidpoint(cefr) {
    const clean = String(cefr || 'A0').toUpperCase().trim();
    return CEFR_NUMERIC_MIDPOINTS[clean] !== undefined ? CEFR_NUMERIC_MIDPOINTS[clean] : 0;
  }

  function getBaseCefrRank(level) {
    if (!level) return 0;
    const clean = String(level).toUpperCase().trim().replace('+', '');
    switch (clean) {
      case 'A1': return 1;
      case 'A2': return 2;
      case 'B1': return 3;
      case 'B2': return 4;
      case 'C1': return 5;
      case 'C2': return 6;
      default: return 0;
    }
  }

  /**
   * Checks if two CEFR levels differ by more than one full CEFR level (e.g. A1 vs B1, A2 vs B2).
   */
  function checkLevelDivergence(lvlA, lvlB) {
    const rankA = getBaseCefrRank(lvlA);
    const rankB = getBaseCefrRank(lvlB);
    const diff = Math.abs(rankA - rankB);
    const isDivergent = diff > 1;
    const lowerLevel = (rankA <= rankB) ? (lvlA || 'A1') : (lvlB || 'A1');
    return {
      isDivergent,
      diff,
      lowerLevel
    };
  }

  /**
   * Computes the combined overall result for Vocabulary and Grammar sections.
   * - Averaged equally: (Vocab + Grammar) / 2
   * - Score converted to CEFR via 0-100 bands
   * - If levels differ by > 1 full CEFR level, overall level is set to the lower level
   */
  function calculateOverallResult(vocabResult, grammarResult, maybeGScore, maybeGCefr) {
    let vScore = 0;
    let gScore = 0;
    let vCefr = 'A1';
    let gCefr = 'A1';

    if (typeof vocabResult === 'object' && vocabResult !== null) {
      vScore = Number(vocabResult?.score ?? vocabResult?.finalScore ?? 0);
      vCefr = String(vocabResult?.level || vocabResult?.estimatedCefr || 'A1');
    } else {
      vScore = Number(vocabResult || 0);
      vCefr = String(grammarResult || 'A1');
    }

    if (typeof grammarResult === 'object' && grammarResult !== null && maybeGScore === undefined) {
      gScore = Number(grammarResult?.score ?? grammarResult?.finalScore ?? 0);
      gCefr = String(grammarResult?.level || grammarResult?.estimatedCefr || 'A1');
    } else {
      gScore = Number(maybeGScore || 0);
      gCefr = String(maybeGCefr || 'A1');
    }

    const overallScore = Math.round((vScore + gScore) / 2);
    const bandCefr = scoreToCefr(overallScore);
    const div = checkLevelDivergence(vCefr, gCefr);

    let overallCefr = bandCefr;
    let divergenceNotice = '';

    if (div.isDivergent) {
      overallCefr = div.lowerLevel;
      divergenceNotice = 'Your Vocabulary and Grammar results differ. Your overall level reflects the lower section result.';
    }

    return {
      overallScore,
      overallCefr,
      vocabScore: vScore,
      vocabCefr: vCefr,
      grammarScore: gScore,
      grammarCefr: gCefr,
      isDivergent: div.isDivergent,
      diverged: div.isDivergent,
      divergenceNotice,
      divergenceMessage: divergenceNotice || null,
      vocabLine: `Vocabulary: ${vScore}/100 — ${vCefr}`,
      grammarLine: `Grammar: ${gScore}/100 — ${gCefr}`,
      overallLine: `Overall English level: ${overallScore}/100 — ${overallCefr}`
    };
  }

  /**
   * Stateful manager for an adaptive section (Vocabulary or Grammar).
   * Orchestrates block partitioning (5 questions per block), progressive navigation,
   * provisional answer tracking, answer changes & streak recalculation,
   * "Mark for review" (max 2 per block), and block confirmation & locking.
   */
  class AdaptiveStateManager {
    constructor(options) {
      const opts = options || {};
      this.sectionKey = opts.sectionKey || 'vocab';
      this.exam = opts.exam || {};
      
      const allowedCounts = [10, 15, 20, 25];
      let resolvedCount = Number(opts.questionsPerSection);
      if (opts.exam?.examType === 'placement') {
        resolvedCount = 10;
      } else if (!allowedCounts.includes(resolvedCount) && opts.restoredState && opts.restoredState.questionsPerSection) {
        resolvedCount = Number(opts.restoredState.questionsPerSection);
      }
      if (opts.exam?.examType !== 'placement' && !allowedCounts.includes(resolvedCount)) {
        resolvedCount = Number(opts.exam?.questionsPerSection ||
          opts.exam?.[this.sectionKey]?.questionsPerSection ||
          opts.exam?.[this.sectionKey]?.displayCount ||
          opts.exam?.[this.sectionKey + 'Adaptive']?.questionsPerSection || 20);
      }
      this.questionsPerSection = (opts.exam?.examType === 'placement') ? 10 : (allowedCounts.includes(resolvedCount) ? resolvedCount : 20);

      this.blockSize = 5;
      this.totalBlocks = Math.ceil(this.questionsPerSection / this.blockSize);
      this.startingLevel = (opts.startingLevel || opts.exam?.[this.sectionKey + 'Adaptive']?.startingLevel || 'A2').toUpperCase();
      this.allowC1 = Boolean(opts.allowC1 || opts.exam?.[this.sectionKey + 'Adaptive']?.allowC1);
      this.minPerLevel = Math.max(1, opts.minPerLevel || opts.exam?.[this.sectionKey + 'Adaptive']?.minPerLevel || 2);
      this.levels = this.allowC1 ? CEFR_LEVELS_EXTENDED : CEFR_LEVELS_STANDARD;

      this.bankQuestions = opts.bankQuestions || (this.sectionKey === 'vocab' ? (opts.exam?.vocabulary?.questions || []) : (opts.exam?.grammar?.questions || []));
      this.buckets = partitionQuestionsByLevel(this.bankQuestions, this.startingLevel);

      this.currentBlockNum = 1;
      this.currentLevel = this.levels.includes(this.startingLevel) ? this.startingLevel : 'A2';
      this.streakCorrect = 0;
      this.streakIncorrect = 0;
      this.serverVerdicts = {};
      this.queuedNextQids = [];
      this.confirmedBlocks = [];
      this.presentedQuestionIds = new Set();
      this.allPresentedQuestions = [];
      this.activeBlock = null;
      this.isCompleted = false;
      this.finalSummary = null;

      if (opts.restoredState) {
        this.restore(opts.restoredState);
      } else {
        this.initBlock(1);
      }
    }

    initBlock(blockNum) {
      this.currentBlockNum = blockNum;
      const startQNum = (blockNum - 1) * this.blockSize + 1;
      const endQNum = Math.min(blockNum * this.blockSize, this.questionsPerSection);
      const blockLength = endQNum - startQNum + 1;

      const firstQ = this.selectNextQuestion(this.currentLevel, false);

      this.activeBlock = {
        blockNum,
        startQNum,
        endQNum,
        blockLength,
        revealedCount: 1,
        currentIdxInBlock: 0,
        questions: firstQ ? [firstQ] : [],
        provisionalAnswers: {},
        markedForReview: {},
        answerChangeCounts: {},
        initialAnswers: {},
        responseTimes: {},
        questionLogs: {}
      };

      if (firstQ) {
        this.presentedQuestionIds.add(firstQ.id);
        this.allPresentedQuestions.push(firstQ);
        this.activeBlock.questionLogs[firstQ.id] = {
          section: this.sectionKey === 'vocab' ? 'Vocabulary' : 'Grammar',
          blockNumber: blockNum,
          questionNumber: startQNum,
          questionId: firstQ.id,
          cefrLevel: firstQ.level || this.currentLevel,
          difficulty: firstQ.difficulty || firstQ.level || this.currentLevel,
          initialAnswer: null,
          finalAnswer: null,
          changeCount: 0,
          markedForReview: false,
          responseTime: 0,
          finalResult: 'unanswered',
          levelBefore: this.currentLevel,
          levelAfter: this.currentLevel,
          streakBefore: { correct: this.streakCorrect, incorrect: this.streakIncorrect },
          streakAfter: { correct: this.streakCorrect, incorrect: this.streakIncorrect },
          startTime: Date.now()
        };
      }
    }

    selectNextQuestion(targetLevel, isProbing) {
      if (this.queuedNextQids && this.queuedNextQids.length > 0) {
        const nextQid = this.queuedNextQids.shift();
        const found = (this.bankQuestions || []).find(q => q && (q.id === nextQid || String(q.id).toLowerCase() === String(nextQid).toLowerCase()));
        if (found) {
          return JSON.parse(JSON.stringify(found));
        }
      }

      let lvl = targetLevel;
      if (isProbing) {
        const idx = this.levels.indexOf(lvl);
        if (idx >= 0 && idx < this.levels.length - 1) {
          lvl = this.levels[idx + 1];
        }
      }

      let pool = (this.buckets[lvl] || []).filter(q => q && !this.presentedQuestionIds.has(q.id));
      if (pool.length === 0) {
        for (const alt of this.levels) {
          const altPool = (this.buckets[alt] || []).filter(q => q && !this.presentedQuestionIds.has(q.id));
          if (altPool.length > 0) {
            pool = altPool;
            break;
          }
        }
      }
      if (pool.length === 0) {
        const currentActiveIds = new Set((this.activeBlock?.questions || []).map(q => q.id));
        pool = (this.bankQuestions || []).filter(q => q && !currentActiveIds.has(q.id));
      }
      if (pool.length === 0) return null;

      const selected = pool[Math.floor(Math.random() * pool.length)];
      return JSON.parse(JSON.stringify(selected));
    }

    isAnswerValid(ans) {
      if (ans === undefined || ans === null || ans === '') return false;
      if (Array.isArray(ans) && ans.length === 0) return false;
      if (typeof ans === 'object' && !Array.isArray(ans)) {
        const keys = Object.keys(ans);
        if (keys.length === 0) return false;
        return keys.some(k => ans[k] !== undefined && ans[k] !== null && ans[k] !== '');
      }
      return true;
    }

    evaluateAnswer(q, ans) {
      if (this.serverVerdicts && q && q.id && this.serverVerdicts[q.id] !== undefined) {
        const isCorr = Boolean(this.serverVerdicts[q.id]);
        return { isCorrect: isCorr, earned: isCorr ? 1 : 0, possible: 1 };
      }
      return evaluateQuestionAnswer(q, ans);
    }

    setServerBlockVerdict(verdict) {
      if (!verdict) return;
      if (!this.serverVerdicts) this.serverVerdicts = {};
      if (verdict.correctByQid) {
        Object.assign(this.serverVerdicts, verdict.correctByQid);
      }
      if (verdict.nextLevel) {
        this.currentLevel = verdict.nextLevel;
      }
      if (Array.isArray(verdict.nextQids) && verdict.nextQids.length > 0) {
        this.queuedNextQids = verdict.nextQids.slice();
      }
    }

    getCurrentQuestion() {
      if (!this.activeBlock || !this.activeBlock.questions) return null;
      return this.activeBlock.questions[this.activeBlock.currentIdxInBlock] || null;
    }

    recordProvisionalAnswer(qId, answer) {
      if (!this.activeBlock) return;
      const isNew = this.activeBlock.provisionalAnswers[qId] === undefined;
      const prevAnswer = this.activeBlock.provisionalAnswers[qId];
      this.activeBlock.provisionalAnswers[qId] = answer;

      if (isNew) {
        this.activeBlock.initialAnswers[qId] = answer;
        this.activeBlock.answerChangeCounts[qId] = 0;
      } else if (JSON.stringify(prevAnswer) !== JSON.stringify(answer)) {
        this.activeBlock.answerChangeCounts[qId] = (this.activeBlock.answerChangeCounts[qId] || 0) + 1;
      }

      // Check if answering current question reveals the next question in active block
      const curIdx = this.activeBlock.currentIdxInBlock;
      const curQ = this.activeBlock.questions[curIdx];
      if (curQ && curQ.id === qId) {
        const hasAnswer = this.isAnswerValid(answer);
        if (hasAnswer && this.activeBlock.revealedCount < this.activeBlock.blockLength) {
          if (this.activeBlock.questions.length <= this.activeBlock.revealedCount) {
            this.recalculateState();
            const isLaterBlock = this.currentBlockNum >= 2;
            const shouldProbe = isLaterBlock && (this.streakCorrect >= 1);
            const nextQ = this.selectNextQuestion(this.currentLevel, shouldProbe);
            if (nextQ) {
              this.presentedQuestionIds.add(nextQ.id);
              this.allPresentedQuestions.push(nextQ);
              this.activeBlock.questions.push(nextQ);
              const qNum = this.activeBlock.startQNum + this.activeBlock.questions.length - 1;
              this.activeBlock.questionLogs[nextQ.id] = {
                section: this.sectionKey === 'vocab' ? 'Vocabulary' : 'Grammar',
                blockNumber: this.currentBlockNum,
                questionNumber: qNum,
                questionId: nextQ.id,
                cefrLevel: nextQ.level || this.currentLevel,
                difficulty: nextQ.difficulty || nextQ.level || this.currentLevel,
                initialAnswer: null,
                finalAnswer: null,
                changeCount: 0,
                markedForReview: false,
                responseTime: 0,
                finalResult: 'unanswered',
                levelBefore: this.currentLevel,
                levelAfter: this.currentLevel,
                streakBefore: { correct: this.streakCorrect, incorrect: this.streakIncorrect },
                streakAfter: { correct: this.streakCorrect, incorrect: this.streakIncorrect },
                startTime: Date.now()
              };
            }
          }
          this.activeBlock.revealedCount = Math.min(this.activeBlock.blockLength, this.activeBlock.questions.length);
        }
      }

      this.recalculateState();
    }

    recalculateState() {
      let lvlIdx = this.levels.indexOf(this.startingLevel);
      if (lvlIdx < 0) lvlIdx = 0;
      let streakCorrect = 0;
      let streakIncorrect = 0;

      // 1. Replay confirmed blocks
      this.confirmedBlocks.forEach(cb => {
        cb.questions.forEach(q => {
          const uAns = cb.answers[q.id];
          if (this.isAnswerValid(uAns)) {
            const res = this.evaluateAnswer(q, uAns);
            if (res.isCorrect) {
              streakCorrect++;
              streakIncorrect = 0;
              if (streakCorrect >= 2) {
                if (lvlIdx < this.levels.length - 1) lvlIdx++;
                streakCorrect = 0;
              }
            } else {
              streakIncorrect++;
              streakCorrect = 0;
              if (streakIncorrect >= 2) {
                if (lvlIdx > 0) lvlIdx--;
                streakIncorrect = 0;
              }
            }
          }
        });
      });

      // 2. Replay active block revealed questions
      if (this.activeBlock && Array.isArray(this.activeBlock.questions)) {
        for (let i = 0; i < this.activeBlock.revealedCount; i++) {
          const q = this.activeBlock.questions[i];
          if (!q) continue;
          const uAns = this.activeBlock.provisionalAnswers[q.id];
          if (this.isAnswerValid(uAns)) {
            const res = this.evaluateAnswer(q, uAns);
            if (res.isCorrect) {
              streakCorrect++;
              streakIncorrect = 0;
              if (streakCorrect >= 2) {
                if (lvlIdx < this.levels.length - 1) lvlIdx++;
                streakCorrect = 0;
              }
            } else {
              streakIncorrect++;
              streakCorrect = 0;
              if (streakIncorrect >= 2) {
                if (lvlIdx > 0) lvlIdx--;
                streakIncorrect = 0;
              }
            }
          }
        }
      }

      this.currentLevel = this.levels[lvlIdx] || 'A2';
      this.streakCorrect = streakCorrect;
      this.streakIncorrect = streakIncorrect;
    }

    toggleMarkForReview(qId) {
      if (!this.activeBlock) return { success: false };
      const isCurrentlyMarked = !!this.activeBlock.markedForReview[qId];
      if (isCurrentlyMarked) {
        delete this.activeBlock.markedForReview[qId];
        if (this.activeBlock.questionLogs[qId]) {
          this.activeBlock.questionLogs[qId].markedForReview = false;
        }
        return { success: true, marked: false, markedCount: this.getMarkedCount() };
      } else {
        const currentCount = this.getMarkedCount();
        if (currentCount >= 2) {
          return {
            success: false,
            marked: false,
            markedCount: currentCount,
            message: "You can mark up to 2 questions for review in this section. Unmark one to mark another."
          };
        }
        this.activeBlock.markedForReview[qId] = true;
        if (this.activeBlock.questionLogs[qId]) {
          this.activeBlock.questionLogs[qId].markedForReview = true;
        }
        return { success: true, marked: true, markedCount: this.getMarkedCount() };
      }
    }

    getMarkedCount() {
      if (!this.activeBlock || !this.activeBlock.markedForReview) return 0;
      return Object.keys(this.activeBlock.markedForReview).filter(k => this.activeBlock.markedForReview[k]).length;
    }

    canAdvance() {
      if (!this.activeBlock) return { allowed: false, message: "Select an answer to continue." };
      const curIdx = this.activeBlock.currentIdxInBlock;
      const curQ = this.activeBlock.questions[curIdx];
      if (!curQ) return { allowed: false, message: "Select an answer to continue." };
      const ans = this.activeBlock.provisionalAnswers[curQ.id];
      const hasAnswer = this.isAnswerValid(ans);
      if (!hasAnswer) {
        return { allowed: false, message: "Select an answer to continue." };
      }
      return { allowed: true };
    }

    goToNext() {
      if (!this.activeBlock) return false;
      const check = this.canAdvance();
      if (!check.allowed) return false;
      if (this.activeBlock.currentIdxInBlock < this.activeBlock.revealedCount - 1) {
        this.activeBlock.currentIdxInBlock++;
        return true;
      }
      return false;
    }

    goToPrev() {
      if (!this.activeBlock) return false;
      if (this.activeBlock.currentIdxInBlock > 0) {
        this.activeBlock.currentIdxInBlock--;
        return true;
      }
      return false;
    }

    goToQuestionInBlock(targetIdx) {
      if (!this.activeBlock) return false;
      if (targetIdx < 0 || targetIdx >= this.activeBlock.revealedCount) return false;
      if (targetIdx > this.activeBlock.currentIdxInBlock + 1) return false; // Prevent jumping ahead past current + 1
      if (targetIdx === this.activeBlock.currentIdxInBlock + 1) {
        const check = this.canAdvance();
        if (!check.allowed) return false;
      }
      this.activeBlock.currentIdxInBlock = targetIdx;
      return true;
    }

    isEndOfBlock() {
      if (!this.activeBlock) return false;
      return this.activeBlock.currentIdxInBlock === (this.activeBlock.blockLength - 1);
    }

    getBlockReviewSummary() {
      if (!this.activeBlock) return { answeredCount: 0, unansweredCount: 0, markedCount: 0, markedQuestions: [] };
      let answered = 0;
      let unanswered = 0;
      const markedQuestions = [];

      for (let i = 0; i < this.activeBlock.blockLength; i++) {
        const q = this.activeBlock.questions[i];
        const qNum = this.activeBlock.startQNum + i;
        const isAns = q && this.isAnswerValid(this.activeBlock.provisionalAnswers[q.id]);
        if (isAns) answered++;
        else unanswered++;

        const isMarked = q && !!this.activeBlock.markedForReview[q.id];
        if (isMarked) {
          markedQuestions.push({
            questionId: q.id,
            questionNumber: qNum,
            idxInBlock: i,
            hasAnswer: isAns,
            provisionalAnswer: isAns ? this.activeBlock.provisionalAnswers[q.id] : null
          });
        }
      }

      return {
        answeredCount: answered,
        unansweredCount: unanswered,
        markedCount: markedQuestions.length,
        markedQuestions
      };
    }

    confirmCurrentBlock() {
      if (!this.activeBlock) return;

      this.activeBlock.questions.forEach((q, i) => {
        const qId = q.id;
        const qNum = this.activeBlock.startQNum + i;
        const finalAns = this.activeBlock.provisionalAnswers[qId];
        const hasAns = this.isAnswerValid(finalAns);
        const isMarked = !!this.activeBlock.markedForReview[qId];
        const isCorr = hasAns ? this.evaluateAnswer(q, finalAns).isCorrect : false;
        const log = this.activeBlock.questionLogs[qId] || {};

        log.section = this.sectionKey === 'vocab' ? 'Vocabulary' : 'Grammar';
        log.blockNumber = this.currentBlockNum;
        log.questionNumber = qNum;
        log.questionId = qId;
        log.cefrLevel = q.level || this.currentLevel;
        log.difficulty = q.difficulty || q.level || this.currentLevel;
        log.initialAnswer = this.activeBlock.initialAnswers[qId] || null;
        log.finalAnswer = hasAns ? finalAns : null;
        log.changeCount = this.activeBlock.answerChangeCounts[qId] || 0;
        log.markedForReview = isMarked;
        log.responseTime = log.startTime ? (Date.now() - log.startTime) : 0;
        log.finalResult = hasAns ? (isCorr ? 'correct' : 'incorrect') : 'unanswered';

        this.activeBlock.questionLogs[qId] = log;
      });

      this.confirmedBlocks.push({
        blockNum: this.currentBlockNum,
        startQNum: this.activeBlock.startQNum,
        endQNum: this.activeBlock.endQNum,
        questionIds: this.activeBlock.questions.map(q => q.id),
        questions: JSON.parse(JSON.stringify(this.activeBlock.questions)),
        answers: JSON.parse(JSON.stringify(this.activeBlock.provisionalAnswers)),
        markedForReview: JSON.parse(JSON.stringify(this.activeBlock.markedForReview)),
        questionLogs: JSON.parse(JSON.stringify(this.activeBlock.questionLogs))
      });

      this.recalculateState();

      if (this.currentBlockNum >= this.totalBlocks) {
        this.isCompleted = true;
        this.finalizeSection();
      } else {
        this.initBlock(this.currentBlockNum + 1);
      }
    }

    finalizeSection() {
      const allQuestions = [];
      const allAnswers = {};
      this.confirmedBlocks.forEach(cb => {
        cb.questions.forEach(q => {
          allQuestions.push(q);
          if (cb.answers[q.id] !== undefined) {
            allAnswers[q.id] = cb.answers[q.id];
          }
        });
      });

      const evaluator = new AdaptiveSectionEvaluator({
        sectionKey: this.sectionKey,
        allowC1: this.allowC1,
        startingLevel: this.startingLevel,
        minPerLevel: this.minPerLevel
      });

      allQuestions.forEach(q => {
        const uAns = allAnswers[q.id];
        const hasAns = this.isAnswerValid(uAns);
        let isCorr = false;
        let earned = 0;
        let possible = 1;
        if (hasAns) {
          const res = this.evaluateAnswer(q, uAns);
          isCorr = res.isCorrect;
          earned = res.earned;
          possible = res.possible;
        }
        evaluator.recordAnswer(q.id, isCorr, q.level || 'A2', earned, possible);
      });

      const summary = evaluator.finalize();
      this.finalSummary = summary;
      return summary;
    }

    getPresentedQuestions() {
      const list = [];
      this.confirmedBlocks.forEach(cb => {
        cb.questions.forEach(q => list.push(q));
      });
      if (this.activeBlock && Array.isArray(this.activeBlock.questions)) {
        this.activeBlock.questions.forEach(q => list.push(q));
      }
      return list;
    }

    getAllAnswers() {
      const ans = {};
      this.confirmedBlocks.forEach(cb => {
        Object.assign(ans, cb.answers);
      });
      if (this.activeBlock && this.activeBlock.provisionalAnswers) {
        Object.assign(ans, this.activeBlock.provisionalAnswers);
      }
      return ans;
    }

    getAllLogs() {
      const logs = [];
      this.confirmedBlocks.forEach(cb => {
        Object.keys(cb.questionLogs || {}).forEach(k => logs.push(cb.questionLogs[k]));
      });
      if (this.activeBlock && this.activeBlock.questionLogs) {
        Object.keys(this.activeBlock.questionLogs).forEach(k => logs.push(this.activeBlock.questionLogs[k]));
      }
      return logs;
    }

    serialize() {
      return {
        sectionKey: this.sectionKey,
        questionsPerSection: this.questionsPerSection,
        blockSize: this.blockSize,
        totalBlocks: this.totalBlocks,
        startingLevel: this.startingLevel,
        currentLevel: this.currentLevel,
        streakCorrect: this.streakCorrect,
        streakIncorrect: this.streakIncorrect,
        currentBlockNum: this.currentBlockNum,
        serverVerdicts: this.serverVerdicts || {},
        queuedNextQids: this.queuedNextQids || [],
        isCompleted: this.isCompleted,
        finalSummary: this.finalSummary,
        confirmedBlocks: this.confirmedBlocks,
        presentedQuestionIds: Array.from(this.presentedQuestionIds),
        activeBlock: this.activeBlock ? {
          blockNum: this.activeBlock.blockNum,
          startQNum: this.activeBlock.startQNum,
          endQNum: this.activeBlock.endQNum,
          blockLength: this.activeBlock.blockLength,
          revealedCount: this.activeBlock.revealedCount,
          currentIdxInBlock: this.activeBlock.currentIdxInBlock,
          questions: this.activeBlock.questions,
          provisionalAnswers: this.activeBlock.provisionalAnswers,
          markedForReview: this.activeBlock.markedForReview,
          answerChangeCounts: this.activeBlock.answerChangeCounts,
          initialAnswers: this.activeBlock.initialAnswers,
          responseTimes: this.activeBlock.responseTimes,
          questionLogs: this.activeBlock.questionLogs
        } : null
      };
    }

    restore(data) {
      if (!data) return;
      if (data.questionsPerSection && [10, 15, 20, 25].includes(Number(data.questionsPerSection))) {
        this.questionsPerSection = Number(data.questionsPerSection);
        this.totalBlocks = Math.ceil(this.questionsPerSection / this.blockSize);
      }
      this.currentBlockNum = data.currentBlockNum || 1;
      this.currentLevel = data.currentLevel || this.startingLevel;
      this.streakCorrect = data.streakCorrect || 0;
      this.streakIncorrect = data.streakIncorrect || 0;
      this.serverVerdicts = data.serverVerdicts || {};
      this.queuedNextQids = Array.isArray(data.queuedNextQids) ? data.queuedNextQids : [];
      this.isCompleted = !!data.isCompleted;
      this.finalSummary = data.finalSummary || null;
      this.confirmedBlocks = Array.isArray(data.confirmedBlocks) ? data.confirmedBlocks : [];
      this.presentedQuestionIds = new Set(Array.isArray(data.presentedQuestionIds) ? data.presentedQuestionIds : []);

      if (data.activeBlock) {
        this.activeBlock = {
          blockNum: data.activeBlock.blockNum,
          startQNum: data.activeBlock.startQNum,
          endQNum: data.activeBlock.endQNum,
          blockLength: data.activeBlock.blockLength,
          revealedCount: data.activeBlock.revealedCount,
          currentIdxInBlock: data.activeBlock.currentIdxInBlock || 0,
          questions: data.activeBlock.questions || [],
          provisionalAnswers: data.activeBlock.provisionalAnswers || {},
          markedForReview: data.activeBlock.markedForReview || {},
          answerChangeCounts: data.activeBlock.answerChangeCounts || {},
          initialAnswers: data.activeBlock.initialAnswers || {},
          responseTimes: data.activeBlock.responseTimes || {},
          questionLogs: data.activeBlock.questionLogs || {}
        };
        (this.activeBlock.questions || []).forEach(q => {
          if (q && q.id) this.presentedQuestionIds.add(q.id);
        });
      } else if (!this.isCompleted) {
        this.initBlock(this.currentBlockNum);
      }
    }
  }

  return {
    CEFR_LEVELS_STANDARD,
    CEFR_LEVELS_EXTENDED,
    CEFR_NUMERIC_MIDPOINTS,
    scoreToCefr,
    cefrToMidpoint,
    getBaseCefrRank,
    checkLevelDivergence,
    calculateOverallResult,
    evaluateQuestionAnswer,
    partitionQuestionsByLevel,
    AdaptiveSectionEvaluator,
    AdaptiveStateManager,
    isAnswerValid: (ans) => AdaptiveStateManager.prototype.isAnswerValid(ans),
    gradeSectionAdaptively
  };
});
