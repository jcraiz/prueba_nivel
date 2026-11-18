/**
 * JCAH Exam Delivery — Results Screen & Report Generator
 * Renders the results dashboard, CEFR scale, PDF exporter, webhook reporter,
 * legal disclaimer, and full question-by-question review with feedback.
 * 
 * Supports Feedback Modes:
 * - 'none': Score only (CEFR badges and breakdown hidden)
 * - 'score_only': Score + CEFR level benchmarks (default)
 * - 'full': Full exam review enabled with feedback per question
 */
const JCAHResults = (() => {

  let _exam = null;
  let _attempt = null;
  let _containerId = null;
  let _activeFilterStatus = 'all'; // 'all' | 'incorrect' | 'correct' | 'unanswered'
  let _activeFilterSection = 'all'; // 'all' | 'vocab' | 'grammar' | 'reading' | 'listening' | 'speaking'

  const escapeAttr = (str) => {
    if (typeof JCAHScoring !== 'undefined' && JCAHScoring.escapeAttr) {
      return JCAHScoring.escapeAttr(str);
    }
    if (str === null || str === undefined) return '';
    const s = String(str);
    if (/^\s*javascript:/i.test(s)) return '#';
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  const sanitizeHtml = (html) => {
    if (typeof JCAHScoring !== 'undefined' && JCAHScoring.sanitizeHtml) {
      return JCAHScoring.sanitizeHtml(html);
    }
    if (!html || typeof html !== 'string') return '';
    return html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/\s+on\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
  };

  /**
   * Render full results screen HTML into target container
   * @param {object} exam - exam configuration
   * @param {object} attempt - submitted attempt record with computed scores
   * @param {string} containerId - target DOM container ID
   */
  function render(exam, attempt, containerId) {
    _exam = exam;
    _attempt = attempt;
    _containerId = containerId;

    const container = document.getElementById(containerId);
    if (!container) return;

    // v2.0b+ — always compute scores with the component-based Overall formula
    // (Speaking-aware). Stored scores from earlier submissions are recomputed so
    // they also carry the speakingIncluded/speakingPct metadata used below.
    let scores = attempt.scores;
    if (!scores || (scores.speakingIncluded === undefined && !scores.pendingServerGrading && exam.answerSource !== 'external')) {
      scores = (typeof JCAHScoring !== 'undefined')
        ? JCAHScoring.computeAllScores(attempt, exam)
        : {};
      attempt.scores = scores;
    }
    if (scores && (scores.serverGraded || scores.pendingServerGrading) && scores.speakingIncluded === undefined) {
      scores.speakingIncluded = Boolean(exam.speaking && exam.speaking.enabled !== false && exam.includeSpeaking !== false);
    }

    const feedbackMode = exam.feedbackMode || 'score_only';
    const isNoneMode = feedbackMode === 'none';
    const isFullMode = feedbackMode === 'full';

    const isPendingGrading = Boolean(
      scores.pendingServerGrading ||
      (exam.answerSource === 'external' && !scores.serverGraded)
    );

    const overallLvl = JCAHScoring.cefrForPct(scores.overall);
    let cefrLabel = isPendingGrading
      ? 'Pending'
      : (typeof scores.overallCefr === 'string' && scores.overallCefr
          ? scores.overallCefr
          : (scores.overallCefr && scores.overallCefr.label
              ? scores.overallCefr.label
              : (overallLvl && overallLvl.label ? overallLvl.label : 'A0')));
    const writingLvl = JCAHScoring.cefrForPct(scores.writingScore);
    const readingLvl = JCAHScoring.cefrForPct(scores.reading.pct);
    const listeningLvl = JCAHScoring.cefrForPct(scores.listening.pct);
    const speakingEnabled = exam.speaking && exam.speaking.enabled !== false;
    const speakingLvlKey = speakingEnabled ? (attempt.speakingResults?.overallLevel || 'A0') : 'N/A';

    const isPlacement = Boolean(
      exam.examType === 'placement' ||
      exam.type === 'placement' ||
      (attempt && (attempt.examType === 'placement' || attempt.isPlacement))
    );
    const vocabGrammarSubtitle = isPlacement
      ? 'Linear stratified assessment (12 Vocabulary + 12 Grammar)'
      : (exam.vocabAdaptive && exam.vocabAdaptive.enabled !== false
          ? 'Adaptive assessment evaluated separately and averaged equally'
          : 'Evaluated separately and averaged equally');
    const speakingSubtitle = isPlacement
      ? 'Diagnostic Speech Assessment:'
      : 'Speech Recognition Assessment:';

    const vScore = scores.vocab?.score ?? scores.vocab?.pct ?? (attempt.vocabAdaptiveResult?.score ?? 0);
    const vCefr = scores.vocab?.level || scores.vocabCefr?.label || attempt.vocabAdaptiveResult?.level || 'A1';
    const gScore = scores.grammar?.score ?? scores.grammar?.pct ?? (attempt.grammarAdaptiveResult?.score ?? 0);
    const gCefr = scores.grammar?.level || scores.grammarCefr?.label || attempt.grammarAdaptiveResult?.level || 'A1';

    const div = (typeof JCAHAdaptiveEngine !== 'undefined' && JCAHAdaptiveEngine.checkLevelDivergence)
      ? JCAHAdaptiveEngine.checkLevelDivergence(vCefr, gCefr)
      : { isDivergent: false, lowerLevel: vCefr };

    if (div.isDivergent && cefrLabel !== 'Pending') {
      cefrLabel = div.lowerLevel;
    }

    container.innerHTML = `
      <div class="results-container" style="max-width:920px;margin:0 auto;padding:var(--sp-6) var(--sp-4)">

        <!-- Live Delivery Status Banner -->
        <div id="jcah-sync-status-banner" class="card p-4 mb-6" style="display:none;border-width:1.5px" aria-live="polite"></div>

        <!-- Outbox Offline Pending Submissions Badge -->
        <div id="jcah-outbox-badge" style="display:none;margin-bottom:16px" aria-live="polite"></div>

        <!-- Header Subtitle -->
        <div class="text-center mb-6">
          <div class="label-sm text-primary">English Proficiency Assessment</div>
          <h1 style="font-size:28px;font-weight:800;margin:4px 0">Exam Results</h1>
          <p class="text-muted text-sm">
            ${escapeHtml(attempt.studentName)} · ID: ${escapeHtml(attempt.studentId)} · ${new Date(attempt.submittedAt || Date.now()).toLocaleDateString()}
          </p>
        </div>

        <!-- 1. OVERALL SCORE BANNER -->
        <div class="card p-6 mb-6" style="background:linear-gradient(135deg, #1B4F8A 0%, #3A7CA5 100%);color:#fff;position:relative">
          <div class="flex items-center justify-between flex-wrap gap-4">
            <div>
              <span class="label-sm" style="color:rgba(255,255,255,0.8)">OVERALL SCORE</span>
              <div id="results-overall-score-display" style="font-family:var(--font-mono);font-size:64px;font-weight:800;line-height:1;margin:6px 0">
                ${isPendingGrading ? 'PENDING' : (scores.overall !== null ? (typeof scores.overall === 'number' ? scores.overall.toFixed(2) + '%' : scores.overall + '%') : 'INCOMPLETE')}
              </div>
              <div class="text-sm" style="color:rgba(255,255,255,0.9)">
                ${isPendingGrading
                  ? 'Score pending / graded by server'
                  : (scores.isIncomplete
                      ? 'One or more required sections could not be scored.'
                      : `Total correct: ${(scores.vocab?.correct || 0) + (scores.grammar?.correct || 0) + (scores.reading?.correct || 0) + (scores.listening?.correct || 0)} of ${(scores.vocab?.total || 0) + (scores.grammar?.total || 0) + (scores.reading?.total || 0) + (scores.listening?.total || 0)} questions`)}
              </div>
            </div>

            <div class="text-right">
              ${!isNoneMode ? `
                <span class="label-sm" style="color:rgba(255,255,255,0.8)">ESTIMATED CEFR LEVEL</span>
                <div class="mt-2 mb-2">
                  ${isPendingGrading ? '<span class="chip chip-b1">Pending</span>' : (scores.isIncomplete ? '<span class="chip chip-muted">Incomplete</span>' : JCAHScoring.cefrChipHtml(scores.overall, true))}
                </div>
              ` : ''}
              <span id="results-pass-fail-badge" class="chip ${scores.isIncomplete ? 'chip-muted' : (scores.passed ? 'chip-success' : 'chip-error')}" style="font-size:14px;padding:6px 16px">
                ${isPendingGrading ? 'PENDING SERVER VERDICT' : (scores.isIncomplete ? 'INCOMPLETE' : (scores.passed ? 'PASSED ' + getIcon('check', 'width="16" height="16" style="margin-left:4px;vertical-align:-2px"') : 'NOT PASSED ' + getIcon('x', 'width="16" height="16" style="margin-left:4px;vertical-align:-2px"')))}
              </span>
            </div>
          </div>
        </div>

        ${scores.isIncomplete ? `
          <!-- INCOMPLETE ASSESSMENT BANNER -->
          <div class="card p-5 mb-6" style="background:#FEF2F2;border:1.5px solid #FCA5A5;color:#991B1B">
            <div class="flex gap-3" style="align-items:flex-start">
              <span>${getIcon('alertTriangle', 'width="20" height="20" style="color:#DC2626;flex-shrink:0;margin-top:2px"')}</span>
              <div style="font-size:13px;line-height:1.6">
                <strong>Assessment Incomplete:</strong>
                <ul style="margin:4px 0 0 16px;padding:0">
                  ${(scores.errors || []).map(err => `<li>${escapeHtml(err)}</li>`).join('')}
                </ul>
              </div>
            </div>
          </div>
        ` : ''}

        ${(scores.speakingIncluded === false && !scores.isIncomplete) ? `
          <!-- NO-SPEAKING DISCLAIMER (exams configured without a Speaking section) -->
          <div class="card p-5 mb-6" style="background:#FFFBEB;border:1.5px solid #FCD34D;color:#78350F">
            <div class="flex gap-3" style="align-items:flex-start">
              <span>${getIcon('info', 'width="20" height="20" style="color:#B45309;flex-shrink:0;margin-top:2px"')}</span>
              <div style="font-size:13px;line-height:1.6">
                These scores do not include speaking; therefore, the results provide only a partial overview of the test taker's language skills.
              </div>
            </div>
          </div>
        ` : ''}

        ${isFullMode ? `
          <!-- FULL FEEDBACK CALLOUT BANNER -->
          <div class="card p-5 mb-6" style="background:linear-gradient(135deg, rgba(27,79,138,0.06) 0%, rgba(58,124,165,0.08) 100%);border:1.5px solid var(--clr-primary)">
            <div class="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div class="label-sm text-primary" style="display:inline-flex;align-items:center;gap:4px">
                  ${getIcon('fileText', 'width="14" height="14" style="color:var(--clr-primary);vertical-align:-2px"')} <span>FULL FEEDBACK ACTIVE</span>
                </div>
                <h3 style="font-size:18px;margin:3px 0 4px">Review Entire Exam & Question Answers</h3>
                <p class="text-sm text-muted mb-0">You can review each question, your answers, correct answers, and feedback.</p>
              </div>
              <button type="button" class="btn btn-primary" onclick="JCAHResults.showReviewView()">
                ${getIcon('bookOpen', 'width="16" height="16" style="margin-right:6px;vertical-align:-2px"')} Review All Questions →
              </button>
            </div>
          </div>
        ` : ''}

        <!-- 2. SCORE CARDS GRID (3 cards if speaking disabled, 4 cards if speaking enabled) -->
        <div class="${speakingEnabled ? 'grid-2' : 'grid-3'} mb-6">

          <!-- Card 1: WRITING SCORE (Vocab + Grammar Approximation) -->
          <div class="card p-5">
            <div class="flex items-center justify-between mb-3">
              <div>
                <h3 style="font-size:16px;margin:0 0 2px 0;">Vocabulary &amp; Grammar Results</h3>
                <span class="text-xs text-muted">${vocabGrammarSubtitle}</span>
              </div>
              ${!isNoneMode ? (isPendingGrading ? '<span class="chip chip-b1">Pending</span>' : JCAHScoring.cefrChipHtml(scores.writingScore)) : ''}
            </div>

            <div class="mb-3 flex flex-col gap-2">
              <div class="p-3 rounded" style="background:#f8fafc;border:1px solid #e2e8f0;">
                <div class="fw-700 text-sm">Vocabulary: ${isPendingGrading ? 'Pending' : vScore + '/100 — ' + vCefr}</div>
                <div class="progress-bar mt-2 mb-1">
                  <div class="progress-fill" style="width:${isPendingGrading ? 0 : vScore}%"></div>
                </div>
              </div>

              <div class="p-3 rounded" style="background:#f8fafc;border:1px solid #e2e8f0;">
                <div class="fw-700 text-sm">Grammar: ${isPendingGrading ? 'Pending' : gScore + '/100 — ' + gCefr}</div>
                <div class="progress-bar mt-2 mb-1">
                  <div class="progress-fill" style="width:${isPendingGrading ? 0 : gScore}%"></div>
                </div>
              </div>

              <div class="p-3 rounded" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af">
                <div class="fw-800 text-sm">Overall English level: ${isPendingGrading ? 'Pending' : (scores.overall !== null ? scores.overall : Math.round((vScore + gScore) / 2)) + '/100 — ' + cefrLabel}</div>
              </div>
            </div>

            <div class="divider"></div>
            <div class="flex items-center justify-between">
              <span class="text-sm fw-600 text-secondary">Estimated Writing Score:</span>
              <span class="font-mono fw-800 text-primary" style="font-size:20px">${isPendingGrading ? 'PENDING' : scores.writingScore + '%'}</span>
            </div>
          </div>

          <!-- Card 2: READING -->
          <div class="card p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 style="font-size:16px">Reading</h3>
              ${!isNoneMode ? (isPendingGrading ? '<span class="chip chip-b1">Pending</span>' : JCAHScoring.cefrChipHtml(scores.reading.pct)) : ''}
            </div>

            <div style="font-family:var(--font-mono);font-size:36px;font-weight:800;color:var(--clr-primary);margin-bottom:8px">
              ${isPendingGrading ? 'PENDING' : scores.reading.pct + '%'}
            </div>
            <div class="progress-bar mb-3">
              <div class="progress-fill" style="width:${isPendingGrading ? 0 : scores.reading.pct}%"></div>
            </div>
            <div class="text-sm text-muted">
              ${isPendingGrading ? 'Server grading in progress...' : (scores.reading.correct + ' of ' + scores.reading.total + ' correct questions across ' + ((exam.readingBanks && exam.readingBanks.length) || 1) + ' reading passage' + ((exam.readingBanks && exam.readingBanks.length) !== 1 ? 's' : '') + '.')}
            </div>
          </div>

          <!-- Card 3: LISTENING -->
          <div class="card p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 style="font-size:16px">Listening</h3>
              ${!isNoneMode ? (isPendingGrading ? '<span class="chip chip-b1">Pending</span>' : JCAHScoring.cefrChipHtml(scores.listening.pct)) : ''}
            </div>

            <div style="font-family:var(--font-mono);font-size:36px;font-weight:800;color:var(--clr-primary);margin-bottom:8px">
              ${isPendingGrading ? 'PENDING' : scores.listening.pct + '%'}
            </div>
            <div class="progress-bar mb-3">
              <div class="progress-fill" style="width:${isPendingGrading ? 0 : scores.listening.pct}%"></div>
            </div>
            <div class="text-sm text-muted">
              ${isPendingGrading ? 'Server grading in progress...' : (scores.listening.correct + ' of ' + scores.listening.total + ' correct questions across ' + ((exam.listeningBanks && exam.listeningBanks.length) || 1) + ' audio track' + ((exam.listeningBanks && exam.listeningBanks.length) !== 1 ? 's' : '') + '.')}
            </div>
          </div>

          ${speakingEnabled ? `
          <!-- Card 4: SPEAKING (Only when enabled) -->
          <div class="card p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 style="font-size:16px">Speaking</h3>
              ${!isNoneMode ? ((scores.speakingScore !== null && scores.speakingScore !== undefined) ? JCAHScoring.cefrChipFromKey(speakingLvlKey) : '<span class="chip chip-muted">Missing</span>') : ''}
            </div>

            <div style="font-family:var(--font-mono);font-size:36px;font-weight:800;color:var(--clr-primary);margin-bottom:8px">
              ${(scores.speakingScore !== null && scores.speakingScore !== undefined) ? (typeof scores.speakingScore === 'number' ? scores.speakingScore.toFixed(2) + '%' : scores.speakingScore + '%') : 'N/A'}
            </div>
            ${(scores.speakingScore !== null && scores.speakingScore !== undefined) ? `
            <div class="progress-bar mb-3">
              <div class="progress-fill" style="width:${Math.max(0, Math.min(100, Number(scores.speakingScore) || 0))}%"></div>
            </div>
            ` : ''}

            <div class="text-xs text-muted mb-2">${speakingSubtitle}</div>
            <div class="grid-2 gap-2 text-xs font-mono">
              ${(() => {
                const levels = attempt.speakingResults?.partLevels || [];
                const n = Math.max(1, Math.min(4, parseInt(exam.speaking?.parts, 10) || levels.length || 4));
                return Array.from({ length: n }, (_, i) =>
                  `<div>Part ${i + 1}: <strong>${levels[i] || 'A0'}</strong></div>`
                ).join('');
              })()}
            </div>
          </div>
          ` : ''}

        </div>

        ${!isNoneMode ? `
          <!-- 3. CEFR SCALE REFERENCE -->
          <div class="card p-6 mb-6">
            <h3 class="mb-2" style="font-size:16px">CEFR Classification Scale (Common European Framework of Reference)</h3>
            <p class="text-xs text-muted mb-4">Visual scale based on percentage scores obtained:</p>
            ${JCAHScoring.cefrScaleHtml(overallLvl.key)}
          </div>
        ` : ''}

        <!-- 4. MANDATORY LEGAL DISCLAIMER -->
        <div class="alert alert-warning mb-6" style="background:#FFFBEB;border:1.5px solid #FCD34D;color:#78350F;padding:16px">
          <div class="flex gap-3">
            <span>${getIcon('scale', 'width="20" height="20" style="color:#B45309;vertical-align:middle"')}</span>
            <div style="font-size:13px;line-height:1.6">
              <strong>DISCLAIMER:</strong> This report is for internal institutional evaluation purposes only and does not replace official standardized examinations approved by the Ministry of Education.
            </div>
          </div>
        </div>

        <!-- 5. ACTIONS & FOOTER -->
        <div class="flex justify-center gap-3 mb-6 btn-print-hide flex-wrap">
          ${isFullMode ? `
            <button type="button" class="btn btn-secondary btn-lg" id="btn-review-answers" onclick="JCAHResults.showReviewView()">
              ${getIcon('bookOpen', 'width="18" height="18" style="margin-right:6px;vertical-align:-3px"')} Review Answers & Feedback
            </button>
          ` : ''}
          ${exam.reportPublicKey ? `
            <button type="button" class="btn btn-outline btn-lg" onclick="JCAHResults.downloadBackup()" style="background:#fff;display:inline-flex;align-items:center;gap:6px">
              <span>💾</span> Descargar Reporte Cifrado (.jcah)
            </button>
          ` : `
            <button type="button" class="btn btn-outline btn-lg" disabled title="Report encryption is not configured" style="background:#fff;opacity:0.5;cursor:not-allowed;display:inline-flex;align-items:center;gap:6px">
              <span>💾</span> Reporte Cifrado (no configurado)
            </button>
          `}
          <button type="button" class="btn btn-primary btn-lg" onclick="JCAHResults.downloadPDF()">
            ${getIcon('fileText', 'width="18" height="18" style="margin-right:6px;vertical-align:-3px"')} Download PDF Report
          </button>
          <button type="button" class="btn btn-ghost btn-lg" onclick="window.close() || alert('Exam completed. You may close this tab.')">
            Close Exam
          </button>
        </div>

        <div class="text-center text-xs text-muted">
          ${getIcon('checkCircle', 'width="14" height="14" style="color:var(--clr-success);margin-right:4px;vertical-align:-2px"')} The results of this exam have been recorded in the institutional system.
        </div>

      </div>`;

    // SCORM 1.2 score and completion reporting
    if (typeof ScormHelper !== 'undefined') {
      try {
        const isExternalModeB = (exam.answerSource === 'external') || Boolean(scores && scores.pendingServerGrading);
        if (isExternalModeB && (scores.overall === null || scores.overall === undefined)) {
          // H4: Defer 0/failed reporting in Mode B until authoritative server score returns
          if (typeof ScormHelper.setStatus === 'function') {
            ScormHelper.setStatus('incomplete');
          } else if (typeof ScormHelper.getAPI === 'function' && ScormHelper.getAPI()) {
            const scormApi = ScormHelper.getAPI();
            scormApi.LMSSetValue('cmi.core.lesson_status', 'incomplete');
            scormApi.LMSCommit('');
          }
        } else {
          const rawScore = typeof scores.overall === 'number' ? scores.overall : 0;
          const isPassed = Boolean(scores.passed);
          if (typeof ScormHelper.reportScore === 'function') {
            ScormHelper.reportScore(rawScore, isPassed);
          } else if (typeof ScormHelper.getAPI === 'function' && ScormHelper.getAPI()) {
            const scormApi = ScormHelper.getAPI();
            scormApi.LMSSetValue('cmi.core.score.min', '0');
            scormApi.LMSSetValue('cmi.core.score.max', '100');
            scormApi.LMSSetValue('cmi.core.score.raw', String(rawScore));
            scormApi.LMSSetValue('cmi.core.lesson_status', 'completed');
            scormApi.LMSSetValue('cmi.core.lesson_status', isPassed ? 'passed' : 'failed');
            scormApi.LMSCommit('');
          }
        }
      } catch (scormErr) {
        console.warn('[JCAH Results] SCORM score report warning:', scormErr);
      }
    }

    // Trigger webhook submission in background if configured
    const webhookUrl = (exam.webhookUrl && exam.webhookUrl.trim()) || (exam.externalAnswerConfig && exam.externalAnswerConfig.apiEndpoint && exam.externalAnswerConfig.apiEndpoint.trim());
    if (webhookUrl && !attempt.webhookSent) {
      dispatchWebhook(exam, attempt);
    }

    // Update outbox indicator and auto-flush any pending attempts
    _updateOutboxBadge();
    if (webhookUrl) {
      flushOutbox(exam).catch(e => console.warn('[JCAH Results] Auto-flush outbox:', e));
    }
  }

  /**
   * Switch view to Detailed Full Exam Review
   */
  function showReviewView() {
    if (!_exam || !_attempt || !_containerId) return;
    renderReviewView(_exam, _attempt, _containerId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Switch view back to Main Score Summary Dashboard
   */
  function showSummaryView() {
    if (!_exam || !_attempt || !_containerId) return;
    render(_exam, _attempt, _containerId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Render the complete question-by-question Review View
   */
  function renderReviewView(exam, attempt, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Mode B: Question answer keys are retained on server; render section breakdown & verdict
    if (exam && exam.answerSource === 'external') {
      const overall = attempt.scores?.overall ?? 'N/A';
      const passed = attempt.scores?.passed ? 'PASSED' : 'NOT PASSED';
      const cefr = attempt.scores?.cefrLevel || (typeof JCAHScoring !== 'undefined' ? JCAHScoring.cefrForPct(Number(overall)).label : 'N/A');
      const vPct = attempt.scores?.vocab?.pct ?? (attempt.scores?.vocabPct ?? 'N/A');
      const gPct = attempt.scores?.grammar?.pct ?? (attempt.scores?.grammarPct ?? 'N/A');
      const rPct = attempt.scores?.reading?.pct ?? (attempt.scores?.readingPct ?? 'N/A');
      const lPct = attempt.scores?.listening?.pct ?? (attempt.scores?.listeningPct ?? 'N/A');
      const wScore = attempt.scores?.writingScore ?? (typeof vPct === 'number' && typeof gPct === 'number' ? Math.round((vPct + gPct) / 2) : 'N/A');
      const speakingEnabled = exam.speaking && exam.speaking.enabled !== false;
      const speakingResults = attempt.speakingResults;

      container.innerHTML = `
        <div class="review-view-container">
          <div class="review-sticky-header">
            <div class="flex items-center justify-between flex-wrap gap-3">
              <div class="flex items-center gap-3">
                <button type="button" class="btn btn-ghost btn-sm" onclick="JCAHResults.showSummaryView()">← Back to Summary</button>
                <div>
                  <h2 style="font-size:18px;margin:0;font-weight:800">Certified Section Review</h2>
                  <div class="text-xs text-muted">${escapeHtml(attempt.studentName)} · ${escapeHtml(exam.title || 'JCAH Assessment')}</div>
                </div>
              </div>
              <div class="flex items-center gap-2 btn-print-hide">
                <button type="button" class="btn btn-primary btn-sm" onclick="window.print()">
                  ${getIcon('fileText', 'width="15" height="15" style="margin-right:4px;vertical-align:-2px"')} Print Review
                </button>
              </div>
            </div>
          </div>
          <div class="p-6">
            <div class="alert alert-info mb-6" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;padding:16px;border-radius:8px">
              <strong>Assessment Mode: Server-Graded (Mode B)</strong><br>
              In accordance with academic security standards, question-by-question answer keys are securely retained on the institution server. Your certified section scores and evaluated verdict are provided below.
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
              <div class="card p-4" style="text-align:center"><div class="text-xs text-muted">Overall Score</div><div style="font-size:28px;font-weight:800">${overall}%</div><div class="text-xs" style="color:${attempt.scores?.passed ? 'var(--clr-success)' : 'var(--clr-error)'};font-weight:700">${passed}</div></div>
              <div class="card p-4" style="text-align:center"><div class="text-xs text-muted">CEFR Classification</div><div style="font-size:28px;font-weight:800">${cefr}</div></div>
              <div class="card p-4" style="text-align:center"><div class="text-xs text-muted">Writing (Vocab + Grammar)</div><div style="font-size:24px;font-weight:700">${wScore}%</div></div>
              <div class="card p-4" style="text-align:center"><div class="text-xs text-muted">Vocabulary</div><div style="font-size:24px;font-weight:700">${vPct}%</div></div>
              <div class="card p-4" style="text-align:center"><div class="text-xs text-muted">Grammar</div><div style="font-size:24px;font-weight:700">${gPct}%</div></div>
              <div class="card p-4" style="text-align:center"><div class="text-xs text-muted">Reading</div><div style="font-size:24px;font-weight:700">${rPct}%</div></div>
              <div class="card p-4" style="text-align:center"><div class="text-xs text-muted">Listening</div><div style="font-size:24px;font-weight:700">${lPct}%</div></div>
            </div>
            ${(speakingEnabled && speakingResults) ? renderSpeakingReviewHtml(exam, speakingResults) : ''}
          </div>
        </div>
      `;
      return;
    }

    const sections = getStructuredReviewSections(exam, attempt);
    const stats = computeReviewStats(sections);
    const speakingEnabled = exam.speaking && exam.speaking.enabled !== false;
    const speakingResults = attempt.speakingResults;

    container.innerHTML = `
      <div class="review-view-container">

        <!-- STICKY REVIEW HEADER BAR -->
        <div class="review-sticky-header">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div class="flex items-center gap-3">
              <button type="button" class="btn btn-ghost btn-sm" onclick="JCAHResults.showSummaryView()" title="Return to Score Dashboard">
                ← Back to Summary
              </button>
              <div>
                <h2 style="font-size:18px;margin:0;font-weight:800">Exam Review & Feedback</h2>
                <div class="text-xs text-muted">${escapeHtml(attempt.studentName)} · ${escapeHtml(exam.title || 'JCAH Assessment')}</div>
              </div>
            </div>

            <div class="flex items-center gap-2 btn-print-hide">
              <button type="button" class="btn btn-primary btn-sm" onclick="window.print()">
                ${getIcon('fileText', 'width="15" height="15" style="margin-right:4px;vertical-align:-2px"')} Print Review
              </button>
            </div>
          </div>

          <!-- SUMMARY STAT PILLS -->
          <div class="review-stats-grid">
            <div class="review-stat-pill stat-score">
              <span class="num">${attempt.scores?.overall || 0}%</span>
              <span class="lbl">Score</span>
            </div>
            <div class="review-stat-pill">
              <span class="num">${stats.total}</span>
              <span class="lbl">Total Questions</span>
            </div>
            <div class="review-stat-pill stat-correct">
              <span class="num">${stats.correct}</span>
              <span class="lbl">Correct</span>
            </div>
            <div class="review-stat-pill stat-incorrect">
              <span class="num">${stats.incorrect}</span>
              <span class="lbl">Incorrect</span>
            </div>
            <div class="review-stat-pill stat-unanswered">
              <span class="num">${stats.unanswered}</span>
              <span class="lbl">Unanswered</span>
            </div>
          </div>

          <!-- INTERACTIVE FILTER BAR -->
          <div class="review-filter-bar btn-print-hide">
            <!-- Status Filters -->
            <div class="flex items-center gap-1 flex-wrap">
              <span class="text-xs fw-600 text-muted mr-1">Filter:</span>
              <button type="button" class="review-pill-btn ${_activeFilterStatus === 'all' ? 'active' : ''}" onclick="JCAHResults.filterStatus('all')">
                All (${stats.total})
              </button>
              <button type="button" class="review-pill-btn ${_activeFilterStatus === 'incorrect' ? 'active' : ''}" onclick="JCAHResults.filterStatus('incorrect')" style="color:var(--clr-error)">
                Incorrect (${stats.incorrect})
              </button>
              <button type="button" class="review-pill-btn ${_activeFilterStatus === 'correct' ? 'active' : ''}" onclick="JCAHResults.filterStatus('correct')" style="color:var(--clr-success)">
                Correct (${stats.correct})
              </button>
              <button type="button" class="review-pill-btn ${_activeFilterStatus === 'unanswered' ? 'active' : ''}" onclick="JCAHResults.filterStatus('unanswered')" style="color:var(--clr-warning)">
                Unanswered (${stats.unanswered})
              </button>
            </div>

            <!-- Section Jump / Filters -->
            <div class="flex items-center gap-1 flex-wrap">
              <span class="text-xs fw-600 text-muted mr-1">Section:</span>
              <button type="button" class="review-pill-btn ${_activeFilterSection === 'all' ? 'active' : ''}" onclick="JCAHResults.filterSection('all')">
                All
              </button>
              <button type="button" class="review-pill-btn ${_activeFilterSection === 'vocab' ? 'active' : ''}" onclick="JCAHResults.filterSection('vocab')">
                Vocab
              </button>
              <button type="button" class="review-pill-btn ${_activeFilterSection === 'grammar' ? 'active' : ''}" onclick="JCAHResults.filterSection('grammar')">
                Grammar
              </button>
              <button type="button" class="review-pill-btn ${_activeFilterSection === 'reading' ? 'active' : ''}" onclick="JCAHResults.filterSection('reading')">
                Reading
              </button>
              <button type="button" class="review-pill-btn ${_activeFilterSection === 'listening' ? 'active' : ''}" onclick="JCAHResults.filterSection('listening')">
                Listening
              </button>
              ${speakingEnabled ? `
                <button type="button" class="review-pill-btn ${_activeFilterSection === 'speaking' ? 'active' : ''}" onclick="JCAHResults.filterSection('speaking')">
                  Speaking
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- SECTIONS AND QUESTIONS CONTAINER -->
        <div id="review-sections-list">
          ${sections.map((sec, secIdx) => renderSectionReviewHtml(sec, secIdx)).join('')}

          ${(speakingEnabled && speakingResults) ? renderSpeakingReviewHtml(exam, speakingResults) : ''}
        </div>

        <!-- BOTTOM ACTIONS -->
        <div class="flex justify-center gap-3 mt-8 mb-8 btn-print-hide">
          <button type="button" class="btn btn-secondary btn-lg" onclick="JCAHResults.showSummaryView()">
            ← Return to Score Summary
          </button>
          <button type="button" class="btn btn-primary btn-lg" onclick="window.print()">
            ${getIcon('fileText', 'width="18" height="18" style="margin-right:6px;vertical-align:-3px"')} Print Detailed Review
          </button>
        </div>

      </div>`;

    // Apply current filter selection
    applyActiveFilters();
  }

  /**
   * Filter questions by correctness status
   */
  function filterStatus(statusKey) {
    _activeFilterStatus = statusKey;
    applyActiveFilters();
  }

  /**
   * Filter questions by section
   */
  function filterSection(sectionKey) {
    _activeFilterSection = sectionKey;
    applyActiveFilters();
  }

  /**
   * Synchronize DOM display based on current active filters
   */
  function applyActiveFilters() {
    // Update button active classes in header
    document.querySelectorAll('.review-filter-bar .review-pill-btn').forEach(btn => {
      const onclickAttr = btn.getAttribute('onclick') || '';
      if (onclickAttr.includes('filterStatus')) {
        btn.classList.toggle('active', onclickAttr.includes(`'${_activeFilterStatus}'`));
      } else if (onclickAttr.includes('filterSection')) {
        btn.classList.toggle('active', onclickAttr.includes(`'${_activeFilterSection}'`));
      }
    });

    // Filter section containers
    document.querySelectorAll('.review-section-block').forEach(secEl => {
      const secGroup = secEl.dataset.sectionGroup;
      const matchSection = (_activeFilterSection === 'all' || secGroup === _activeFilterSection);

      let visibleQCount = 0;
      secEl.querySelectorAll('.review-q-card').forEach(card => {
        const qStatus = card.dataset.status; // 'correct' | 'incorrect' | 'unanswered'
        const matchStatus = (_activeFilterStatus === 'all' || qStatus === _activeFilterStatus);

        if (matchSection && matchStatus) {
          card.style.display = 'block';
          visibleQCount++;
        } else {
          card.style.display = 'none';
        }
      });

      // Show/hide the section block itself
      if (matchSection && (_activeFilterStatus === 'all' || visibleQCount > 0)) {
        secEl.style.display = 'block';
      } else {
        secEl.style.display = 'none';
      }
    });

    // Speaking section container
    const spEl = document.getElementById('review-speaking-section');
    if (spEl) {
      const matchSp = (_activeFilterSection === 'all' || _activeFilterSection === 'speaking');
      spEl.style.display = matchSp ? 'block' : 'none';
    }
  }

  /**
   * Collect structured question objects and answers from attempt
   */
  function getStructuredReviewSections(exam, attempt) {
    const sections = [];

    // 1. Vocabulary
    const vQuestions = (attempt && Array.isArray(attempt.vocabQuestions) && attempt.vocabQuestions.length > 0)
      ? attempt.vocabQuestions
      : ((exam.vocabulary && Array.isArray(exam.vocabulary.questions)) ? exam.vocabulary.questions : []);
    if (vQuestions.length > 0) {
      sections.push({
        id: 'vocab',
        group: 'vocab',
        title: 'Vocabulary Section',
        icon: 'edit',
        questions: vQuestions,
        answers: (attempt && attempt.vocabAnswers) || {},
        scores: attempt?.scores?.vocab,
      });
    }

    // 2. Grammar
    const gQuestions = (attempt && Array.isArray(attempt.grammarQuestions) && attempt.grammarQuestions.length > 0)
      ? attempt.grammarQuestions
      : ((exam.grammar && Array.isArray(exam.grammar.questions)) ? exam.grammar.questions : []);
    if (gQuestions.length > 0) {
      sections.push({
        id: 'grammar',
        group: 'grammar',
        title: 'Grammar Section',
        icon: 'fileText',
        questions: gQuestions,
        answers: (attempt && attempt.grammarAnswers) || {},
        scores: attempt?.scores?.grammar,
      });
    }

    // 3. Reading Parts
    const rItems = (attempt && Array.isArray(attempt.selectedReadingItems) && attempt.selectedReadingItems.length > 0)
      ? attempt.selectedReadingItems
      : [];
    if (rItems.length > 0) {
      rItems.forEach((it, bIdx) => {
        if (it && Array.isArray(it.questions) && it.questions.length > 0) {
          sections.push({
            id: 'reading_' + bIdx,
            group: 'reading',
            title: `Reading — Part ${bIdx + 1}: ${it.passageTitle || it.title || 'Passage'}`,
            passageTitle: it.passageTitle || it.title || '',
            passageHtml: it.passageHtml || '',
            passageText: it.passageText || '',
            icon: 'bookOpen',
            questions: it.questions,
            answers: (attempt && attempt.readingAnswers) || {},
          });
        }
      });
    } else if (Array.isArray(exam.readingBanks)) {
      exam.readingBanks.forEach((bank, bIdx) => {
        const it = (bank.items && bank.items[0]);
        if (it && Array.isArray(it.questions) && it.questions.length > 0) {
          sections.push({
            id: 'reading_' + bIdx,
            group: 'reading',
            title: `Reading — Part ${bIdx + 1}: ${it.passageTitle || it.title || 'Passage'}`,
            passageTitle: it.passageTitle || it.title || '',
            passageHtml: it.passageHtml || '',
            passageText: it.passageText || '',
            icon: 'bookOpen',
            questions: it.questions,
            answers: (attempt && attempt.readingAnswers) || {},
          });
        }
      });
    }

    // 4. Listening Parts
    const lItems = (attempt && Array.isArray(attempt.selectedListeningItems) && attempt.selectedListeningItems.length > 0)
      ? attempt.selectedListeningItems
      : [];
    if (lItems.length > 0) {
      lItems.forEach((it, bIdx) => {
        if (it && Array.isArray(it.questions) && it.questions.length > 0) {
          sections.push({
            id: 'listening_' + bIdx,
            group: 'listening',
            title: `Listening — Part ${bIdx + 1}: ${it.title || 'Track'}`,
            trackTitle: it.title || '',
            audioDataUrl: it.audioDataUrl || it.audioSrc || '',
            visualAidDataUrl: it.visualAidDataUrl || '',
            icon: 'headphones',
            questions: it.questions,
            answers: (attempt && attempt.listeningAnswers) || {},
          });
        }
      });
    } else if (Array.isArray(exam.listeningBanks)) {
      exam.listeningBanks.forEach((bank, bIdx) => {
        const it = (bank.items && bank.items[0]);
        if (it && Array.isArray(it.questions) && it.questions.length > 0) {
          sections.push({
            id: 'listening_' + bIdx,
            group: 'listening',
            title: `Listening — Part ${bIdx + 1}: ${it.title || 'Track'}`,
            trackTitle: it.title || '',
            audioDataUrl: it.audioDataUrl || it.audioSrc || '',
            visualAidDataUrl: it.visualAidDataUrl || '',
            icon: 'headphones',
            questions: it.questions,
            answers: (attempt && attempt.listeningAnswers) || {},
          });
        }
      });
    }

    return sections;
  }

  /**
   * Aggregate total correct, incorrect, and unanswered questions
   */
  function computeReviewStats(sections) {
    let total = 0;
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;

    const scoringHelper = (typeof JCAHScoring !== 'undefined' && JCAHScoring.scoreQuestionDetailed)
      ? JCAHScoring
      : (typeof JCAHAnswerService !== 'undefined' && JCAHAnswerService.scoreQuestionDetailed ? JCAHAnswerService : null);

    sections.forEach(sec => {
      sec.questions.forEach(q => {
        const studentAns = sec.answers[q.id];
        const isAnswered = isAnswerProvided(studentAns);
        const qScore = scoringHelper ? scoringHelper.scoreQuestionDetailed(q, studentAns) : {
          earned: (typeof JCAHScoring !== 'undefined' ? JCAHScoring.scoreQuestion(q, studentAns) : false) ? 1 : 0,
          possible: 1,
          isCorrect: (typeof JCAHScoring !== 'undefined' ? JCAHScoring.scoreQuestion(q, studentAns) : false)
        };

        total += qScore.possible;
        correct += qScore.earned;

        if (qScore.isCorrect) {
          // completely correct
        } else if (!isAnswered) {
          unanswered += qScore.possible;
        } else {
          const missed = qScore.possible - qScore.earned;
          incorrect += missed;
        }
      });
    });

    return { total, correct, incorrect, unanswered };
  }

  function isAnswerProvided(val) {
    if (val === undefined || val === null || val === '') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.keys(val).length > 0;
    return true;
  }

  /**
   * Render HTML for a whole section (Vocab, Grammar, Reading, or Listening)
   */
  function renderSectionReviewHtml(sec, secIdx) {
    let secCorrect = 0;
    let secTotal = 0;
    const scoringHelper = (typeof JCAHScoring !== 'undefined' && JCAHScoring.scoreQuestionDetailed)
      ? JCAHScoring
      : (typeof JCAHAnswerService !== 'undefined' && JCAHAnswerService.scoreQuestionDetailed ? JCAHAnswerService : null);

    sec.questions.forEach(q => {
      if (scoringHelper) {
        const qScore = scoringHelper.scoreQuestionDetailed(q, sec.answers[q.id]);
        secCorrect += qScore.earned;
        secTotal += qScore.possible;
      } else {
        if (JCAHScoring.scoreQuestion(q, sec.answers[q.id])) secCorrect++;
        secTotal++;
      }
    });
    const secPct = secTotal > 0 ? Math.round((secCorrect / secTotal) * 100) : 0;

    return `
      <div class="review-section-block mb-8" id="sec-block-${sec.id}" data-section-group="${sec.group}">
        <!-- Section Header -->
        <div class="card p-4 mb-4" style="background:var(--clr-surface-alt);border-left:4px solid var(--clr-primary)">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <span>${getIcon(sec.icon || 'fileText', 'width="20" height="20" style="color:var(--clr-primary);vertical-align:-2px"')}</span>
              <h3 style="font-size:17px;font-weight:700;margin:0">${escapeHtml(sec.title)}</h3>
            </div>
            <div class="flex items-center gap-2">
              <span class="chip chip-neutral font-mono">${secCorrect}/${secTotal} correct (${secPct}%)</span>
            </div>
          </div>
        </div>

        ${sec.passageHtml || sec.passageText ? `
          <!-- Reading Passage Viewer -->
          <div class="review-passage-card mb-4">
            <div class="flex items-center justify-between">
              <strong style="font-size:14px">${escapeHtml(sec.passageTitle || 'Reading Passage')}</strong>
              <span class="text-xs text-muted">Passage text reference</span>
            </div>
            <div class="review-passage-body">
              ${sec.passageHtml ? sanitizeHtml(sec.passageHtml) : `<p>${escapeHtml(sec.passageText)}</p>`}
            </div>
          </div>
        ` : ''}

        ${sec.audioDataUrl ? `
          <!-- Listening Audio Reference Player -->
          <div class="card p-4 mb-4 flex items-center justify-between gap-3 flex-wrap" style="background:var(--clr-surface-alt)">
            <div class="flex items-center gap-3">
              <span>${getIcon('headphones', 'width="22" height="22" style="color:var(--clr-primary)"')}</span>
              <div>
                <div class="fw-700 text-sm">${escapeHtml(sec.trackTitle || 'Audio Track')}</div>
                <div class="text-xs text-muted">Listen to verify your answers</div>
              </div>
            </div>
            <audio controls src="${escapeAttr(sec.audioDataUrl)}" style="height:36px;max-width:320px"></audio>
          </div>
        ` : ''}

        ${sec.visualAidDataUrl ? `
          <div class="mb-4 text-center">
            <img src="${escapeAttr(sec.visualAidDataUrl)}" alt="Visual Aid" style="max-height:200px;max-width:100%;object-fit:contain;border-radius:4px;border:1px solid var(--clr-border)">
          </div>
        ` : ''}

        <!-- Question Cards Stack -->
        <div class="review-questions-stack">
          ${sec.questions.map((q, qIdx) => renderQuestionReviewCard(q, qIdx, sec.answers[q.id], sec)).join('')}
        </div>
      </div>`;
  }

  /**
   * Render single question card with comprehensive feedback
   */
  function renderQuestionReviewCard(q, qIdx, studentAns, sec) {
    const isAnswered = isAnswerProvided(studentAns);
    const scoringHelper = (typeof JCAHScoring !== 'undefined' && JCAHScoring.scoreQuestionDetailed)
      ? JCAHScoring
      : (typeof JCAHAnswerService !== 'undefined' && JCAHAnswerService.scoreQuestionDetailed ? JCAHAnswerService : null);
    const qScore = scoringHelper ? scoringHelper.scoreQuestionDetailed(q, studentAns) : {
      earned: (typeof JCAHScoring !== 'undefined' ? JCAHScoring.scoreQuestion(q, studentAns) : false) ? 1 : 0,
      possible: 1,
      isCorrect: (typeof JCAHScoring !== 'undefined' ? JCAHScoring.scoreQuestion(q, studentAns) : false)
    };
    const isOk = qScore.isCorrect;
    const statusKey = isOk ? 'correct' : (!isAnswered ? 'unanswered' : 'incorrect');

    // Resolve correct answer (supports Mode A local or Mode B external AnswerService)
    const extKey = (typeof JCAHAnswerService !== 'undefined' && JCAHAnswerService.getAnswer)
      ? JCAHAnswerService.getAnswer(q.id)
      : null;
    let correctVal = q.correct !== undefined ? q.correct : extKey?.correct;
    const pairsVal = q.pairs || extKey?.pairs;

    // Fix for review-view bug in Mode A: if correctVal is null due to obfuscation,
    // resolve correctVal by hashing options with examSalt and comparing with secureKeyMap entry
    if ((correctVal === undefined || correctVal === null) && typeof JCAHScoring !== 'undefined' && JCAHScoring.sha256Sync) {
      const examObj = (typeof window !== 'undefined' && (window.__JCAH_EXAM__ || window.__JCAH_EXAM__)) || _exam || {};
      const keyMap = examObj.secureKeyMap || examObj._secureKeyMap || (extKey?.secureEntry ? { [q.id]: extKey.secureEntry } : null);
      const salt = examObj.examSalt || examObj._salt || extKey?.salt || '';
      const secKey = (keyMap && keyMap[q.id]) || extKey?.secureEntry;
      if (secKey && secKey.hash) {
        if (q.type === 'mc' && Array.isArray(q.options)) {
          for (const opt of q.options) {
            const norm = String(opt).trim().toLowerCase();
            if (JCAHScoring.sha256Sync(`jcah_${salt}_${norm}`) === secKey.hash) {
              correctVal = opt;
              break;
            }
          }
        } else if (q.type === 'tf') {
          for (const val of ['true', 'false']) {
            const norm = String(val).trim().toLowerCase();
            if (JCAHScoring.sha256Sync(`jcah_${salt}_${norm}`) === secKey.hash) {
              correctVal = val;
              break;
            }
          }
        }
      }
    }

    return `
      <div class="review-q-card is-${statusKey}" id="review-card-${q.id}" data-status="${statusKey}">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <span class="chip chip-primary font-mono" style="font-size:11px">Question ${qIdx + 1}</span>
            <span class="chip chip-neutral" style="font-size:11px;text-transform:uppercase">${q.type}</span>
          </div>

          <div>
                        ${(q.type === 'matching' || q.type === 'mr') ? `
              <span class="chip ${qScore.earned === qScore.possible ? 'chip-success' : (qScore.earned > 0 ? 'chip-warning' : (isAnswered ? 'chip-error' : 'chip-warning'))}" style="font-size:12px;font-weight:700">
                ${qScore.earned}/${qScore.possible} pts ${qScore.earned === qScore.possible ? '✓' : ''}
              </span>
            ` : (statusKey === 'correct' ? `
              <span class="chip chip-success" style="font-size:12px">
                ${getIcon('check', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px"')} Correct
              </span>
            ` : (statusKey === 'unanswered' ? `
              <span class="chip chip-warning" style="font-size:12px">
                ${getIcon('alertTriangle', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px"')} Unanswered
              </span>
            ` : `
              <span class="chip chip-error" style="font-size:12px">
                ${getIcon('x', 'width="14" height="14" style="margin-right:4px;vertical-align:-2px"')} Incorrect
              </span>
            `))}
          </div>
        </div>

        <!-- Question Prompt -->
        <div class="q-text mb-4" style="font-size:16px;font-weight:600;line-height:1.5">
          ${escapeHtml(q.text)}
        </div>
        <!-- Options / Detailed Answers Breakdown -->
        <div class="review-options-container mb-3">
          ${renderQuestionAnswerBreakdown(q, studentAns, correctVal, pairsVal)}
        </div>

        <!-- Per-Question Feedback / Explanation Box -->
        ${renderQuestionExplanationBox(q, isOk, isAnswered, correctVal)}
      </div>`;
  }

  /**
   * Render question answers breakdown based on question type
   */
  function renderQuestionAnswerBreakdown(q, studentAns, correctVal, pairsVal) {
    const isOk = JCAHScoring.scoreQuestion(q, studentAns);
    switch (q.type) {
      case 'mc': {
        const opts = q.options || [];
        const hasKnownCorrect = correctVal !== undefined && correctVal !== null;
        return opts.map(opt => {
          const isCorrectChoice = hasKnownCorrect && String(opt).trim() === String(correctVal).trim();
          const isStudentChoice = String(opt).trim() === String(studentAns).trim();

          let optClass = 'review-option-item';
          let badge = '';

          if (isStudentChoice) {
            if (isOk || isCorrectChoice) {
              optClass += ' opt-student-correct';
              badge = `<span class="chip chip-success text-xs">✓ Your Answer (Correct)</span>`;
            } else if (hasKnownCorrect) {
              optClass += ' opt-student-wrong';
              badge = `<span class="chip chip-error text-xs">✗ Your Answer</span>`;
            } else {
              optClass += ' opt-student-neutral';
              badge = `<span class="chip chip-neutral text-xs">Your Answer</span>`;
            }
          } else if (isCorrectChoice) {
            optClass += ' opt-correct';
            badge = `<span class="chip chip-success text-xs">✓ Correct Answer</span>`;
          }

          return `
            <div class="${optClass}">
              <div class="flex items-center gap-2">
                <span style="color:var(--clr-text-muted)">${(isCorrectChoice || (isOk && isStudentChoice)) ? '●' : '○'}</span>
                <span>${escapeHtml(opt)}</span>
              </div>
              <div>${badge}</div>
            </div>`;
        }).join('');
      }

      case 'tf': {
        const choices = ['true', 'false'];
        const hasKnownCorrect = correctVal !== undefined && correctVal !== null;
        return choices.map(val => {
          const isCorrectChoice = hasKnownCorrect && String(val) === String(correctVal);
          const isStudentChoice = String(val) === String(studentAns);
          const label = val === 'true' ? 'True' : 'False';

          let optClass = 'review-option-item';
          let badge = '';

          if (isStudentChoice) {
            if (isOk || isCorrectChoice) {
              optClass += ' opt-student-correct';
              badge = `<span class="chip chip-success text-xs">✓ Your Answer (Correct)</span>`;
            } else if (hasKnownCorrect) {
              optClass += ' opt-student-wrong';
              badge = `<span class="chip chip-error text-xs">✗ Your Answer</span>`;
            } else {
              optClass += ' opt-student-neutral';
              badge = `<span class="chip chip-neutral text-xs">Your Answer</span>`;
            }
          } else if (isCorrectChoice) {
            optClass += ' opt-correct';
            badge = `<span class="chip chip-success text-xs">✓ Correct Answer</span>`;
          }

          return `
            <div class="${optClass}">
              <strong>${label}</strong>
              <div>${badge}</div>
            </div>`;
        }).join('');
      }

      case 'fb': {
        const isOk = JCAHScoring.scoreQuestion(q, studentAns);
        const accepted = Array.isArray(correctVal) ? correctVal : [correctVal || ''];
        return `
          <div class="flex flex-col gap-2">
            <div class="p-3" style="background:${isOk ? 'rgba(16,185,129,0.08)' : (studentAns ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)')};border:1.5px solid ${isOk ? '#10B981' : (studentAns ? '#EF4444' : '#F59E0B')};border-radius:var(--radius)">
              <div class="text-xs text-muted fw-700 uppercase mb-1">Your Submitted Answer:</div>
              <div class="font-mono fw-700" style="font-size:15px">
                ${studentAns ? `"${escapeHtml(studentAns)}"` : '<em class="text-muted">(No answer submitted)</em>'}
              </div>
            </div>

            <div class="p-3" style="background:var(--clr-surface-alt);border:1px solid var(--clr-border);border-radius:var(--radius)">
              <div class="text-xs text-muted fw-700 uppercase mb-1">Accepted Correct Solution(s):</div>
              <div class="flex gap-2 flex-wrap font-mono">
                ${accepted.map(a => `<span class="chip chip-success" style="font-size:13px">${escapeHtml(a)}</span>`).join(' ')}
              </div>
            </div>
          </div>`;
      }

      case 'mr': {
        const opts = q.options || [];
        const studentArr = Array.isArray(studentAns) ? studentAns : [];
        const correctArr = Array.isArray(correctVal) ? correctVal : [];

        return opts.map(opt => {
          const isStudentChecked = studentArr.some(s => String(s).trim() === String(opt).trim());
          const isExpected = correctArr.some(c => String(c).trim() === String(opt).trim());

          let optClass = 'review-option-item';
          let badge = '';

          if (isStudentChecked && isExpected) {
            optClass += ' opt-student-correct';
            badge = `<span class="chip chip-success text-xs">✓ Checked (Correct)</span>`;
          } else if (isStudentChecked && !isExpected) {
            optClass += ' opt-student-wrong';
            badge = `<span class="chip chip-error text-xs">✗ Checked (Should be unchecked)</span>`;
          } else if (!isStudentChecked && isExpected) {
            optClass += ' opt-correct';
            badge = `<span class="chip chip-warning text-xs">⚠️ Missed (Should be checked)</span>`;
          }

          return `
            <div class="${optClass}">
              <div class="flex items-center gap-2">
                <span>${isStudentChecked ? '☑' : '☐'}</span>
                <span>${escapeHtml(opt)}</span>
              </div>
              <div>${badge}</div>
            </div>`;
        }).join('');
      }

      case 'matching': {
        const pairs = Array.isArray(pairsVal) ? pairsVal : (q.pairs || []);
        const stObj = (studentAns && typeof studentAns === 'object') ? studentAns : {};

        return `
          <div class="card" style="background:var(--clr-surface-alt);border:1px solid var(--clr-border);overflow:hidden">
            <div class="p-2 fw-700 text-xs text-muted" style="border-bottom:1px solid var(--clr-border)">Matching Pairs Review:</div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                  <tr style="background:var(--clr-surface);text-align:left">
                    <th style="padding:8px 12px;border-bottom:1px solid var(--clr-border)">Prompt (Left)</th>
                    <th style="padding:8px 12px;border-bottom:1px solid var(--clr-border)">Your Selection</th>
                    <th style="padding:8px 12px;border-bottom:1px solid var(--clr-border)">Correct Match</th>
                    <th style="padding:8px 12px;border-bottom:1px solid var(--clr-border);text-align:center">Result</th>
                  </tr>
                </thead>
                <tbody>
                  ${pairs.map(p => {
                    const lKey = String(p.left || '').trim();
                    const stChoice = stObj[lKey] || stObj[p.left];
                    const expRight = String(p.right || '').trim();
                    const isPairOk = expRight
                      ? (String(stChoice || '').trim().toLowerCase() === expRight.toLowerCase())
                      : isOk;
                    return `
                      <tr style="border-bottom:1px solid var(--clr-border)">
                        <td style="padding:8px 12px;font-weight:600">${escapeHtml(p.left)}</td>
                        <td style="padding:8px 12px;color:${isPairOk ? 'var(--clr-success)' : 'var(--clr-error)'}">
                          ${stChoice ? escapeHtml(stChoice) : '<em class="text-muted">(Not matched)</em>'}
                        </td>
                        <td style="padding:8px 12px;font-weight:600;color:var(--clr-success)">${expRight ? escapeHtml(expRight) : '<em class="text-muted">(Hidden)</em>'}</td>
                        <td style="padding:8px 12px;text-align:center">
                          <span class="chip ${isPairOk ? 'chip-success' : 'chip-error'}" style="font-size:10px;padding:2px 8px">
                            ${isPairOk ? '✓' : '✗'}
                          </span>
                        </td>
                      </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
      }

      default:
        return `<div class="text-sm text-muted">Answer: ${escapeHtml(JSON.stringify(studentAns))}</div>`;
    }
  }

  /**
   * Render explanation and diagnostic feedback per question
   */
  function renderQuestionExplanationBox(q, isOk, isAnswered, correctVal) {
    const feedbackText = (q.feedback && String(q.feedback).trim().length > 0) ? String(q.feedback).trim() : null;
    const explanationText = (q.explanation && String(q.explanation).trim().length > 0) ? String(q.explanation).trim() : null;

    if (feedbackText || explanationText) {
      let html = '';
      if (feedbackText) {
        html += `
        <div class="review-feedback-box mb-2" style="border-left:4px solid var(--clr-primary);background:rgba(59,130,246,0.05)">
          <div class="fw-700 text-xs text-primary mb-1" style="display:flex;align-items:center;gap:4px">
            ${getIcon('info', 'width="14" height="14" style="color:var(--clr-primary);vertical-align:-2px"')} <span>QUESTION FEEDBACK</span>
          </div>
          <div>${escapeHtml(feedbackText)}</div>
        </div>`;
      }
      if (explanationText) {
        html += `
        <div class="review-feedback-box">
          <div class="fw-700 text-xs text-primary mb-1" style="display:flex;align-items:center;gap:4px">
            ${getIcon('lightbulb', 'width="14" height="14" style="color:var(--clr-primary);vertical-align:-2px"')} <span>QUESTION EXPLANATION</span>
          </div>
          <div>${escapeHtml(explanationText)}</div>
        </div>`;
      }
      return html;
    }

    if (isOk) {
      return `
        <div class="review-feedback-box" style="border-left:4px solid var(--clr-success);background:rgba(16,185,129,0.05)">
          <span class="text-success fw-700">✓ Accurate:</span> Your answer matches the required benchmark standard for this question.
        </div>`;
    } else if (!isAnswered) {
      return `
        <div class="review-feedback-box" style="border-left:4px solid var(--clr-warning);background:rgba(245,158,11,0.05)">
          <span class="text-warning fw-700">⚠️ Unanswered:</span> No response was recorded for this question. Consult the expected answer above.
        </div>`;
    } else {
      return `
        <div class="review-feedback-box" style="border-left:4px solid var(--clr-error);background:rgba(239,68,68,0.05)">
          <span class="text-error fw-700">✗ Feedback:</span> Your answer did not match the expected solution. Review the correct option highlighted above.
        </div>`;
    }
  }

  /**
   * Render Speaking Assessment review
   */
  function renderSpeakingReviewHtml(exam, speakingResults) {
    const partResults = speakingResults.partResults || [];
    const overallLvl = speakingResults.overallLevel || 'A0';

    return `
      <div class="review-section-block mb-8" id="review-speaking-section" data-section-group="speaking">
        <div class="card p-4 mb-4" style="background:var(--clr-surface-alt);border-left:4px solid var(--clr-primary)">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <span>${getIcon('mic', 'width="20" height="20" style="color:var(--clr-primary);vertical-align:-2px"')}</span>
              <h3 style="font-size:17px;font-weight:700;margin:0">Speaking Assessment Review</h3>
            </div>
            <div>
              <span class="chip chip-primary font-mono" style="font-size:13px">Overall Level: ${overallLvl}</span>
            </div>
          </div>
        </div>

        ${partResults.map((pr, pIdx) => {
          const log = pr.log || [];
          return `
            <div class="card p-5 mb-4">
              <div class="flex items-center justify-between mb-3">
                <h4 style="font-size:15px;margin:0">Part ${pIdx + 1} Speech Recognition</h4>
                <span class="chip chip-neutral font-mono">Achieved: ${pr.level || 'A0'}</span>
              </div>

              ${log.length > 0 ? log.map((item, itIdx) => {
                const isPass = item.score >= 0.5;
                return `
                  <div class="review-speaking-item mb-2">
                    <div class="flex items-center justify-between text-xs mb-1">
                      <span class="fw-700 text-primary">Item ${itIdx + 1} (${item.level})</span>
                      <span class="chip ${isPass ? 'chip-success' : 'chip-error'}" style="font-size:10px">
                        ${isPass ? '✓ Matched' : '✗ Did not match'} (${Math.round((item.score || 0) * 100)}%)
                      </span>
                    </div>
                    <div class="text-sm fw-600 mb-1">Target: "${escapeHtml(item.target)}"</div>
                    <div class="text-xs text-muted">Heard: "${escapeHtml(item.heard || '(no speech detected)')}"</div>
                  </div>`;
              }).join('') : `
                <div class="text-xs text-muted">Candidate completed Part ${pIdx + 1} with estimated level ${pr.level || 'A0'}.</div>
              `}
            </div>`;
        }).join('')}
      </div>`;
  }

  /**
   * PDF Export / Print Helper
   */
  function downloadPDF() {
    window.print();
  }

  /**
   * Send JSON payload to configured Google Apps Script Webhook
   */
  async function dispatchWebhook(exam, attempt) {
    const webhookUrl = (exam.webhookUrl && exam.webhookUrl.trim()) || (exam.externalAnswerConfig && exam.externalAnswerConfig.apiEndpoint && exam.externalAnswerConfig.apiEndpoint.trim()) || (window.__JCAH_EXAM__ && (window.__JCAH_EXAM__.webhookUrl || window.__JCAH_EXAM__.externalAnswerConfig?.apiEndpoint));
    if (!webhookUrl) return;
    try {
      // v2.0b+ — recompute scores if missing or produced by an older version
      // (component-based, speaking-aware Overall formula)
      let scores = attempt.scores;
      if (!scores || (scores.speakingIncluded === undefined && !scores.pendingServerGrading && exam.answerSource !== 'external')) {
        scores = (typeof JCAHScoring !== 'undefined')
          ? JCAHScoring.computeAllScores(attempt, exam)
          : {};
        attempt.scores = scores;
      }
      const cefrLabel = (scores.overallCefr && typeof scores.overallCefr === 'object' && scores.overallCefr.label)
        ? scores.overallCefr.label
        : (typeof scores.overallCefr === 'string' ? scores.overallCefr : 'A0');

      const isSpeakingActive = Boolean(
        exam.speaking &&
        exam.speaking.enabled !== false &&
        (exam.speaking.parts > 0 || (Array.isArray(exam.speaking.prompts) && exam.speaking.prompts.length > 0)) &&
        exam.includeSpeaking !== false
      );
      const sr = attempt.speakingResults;
      const speakingLevel = isSpeakingActive ? (sr?.overallLevel || 'A0') : 'N/A';
      const speakingPart1 = isSpeakingActive ? (sr?.partLevels?.[0] || sr?.partResults?.[0]?.level || 'A0') : 'N/A';
      const speakingPart2 = isSpeakingActive ? (sr?.partLevels?.[1] || sr?.partResults?.[1]?.level || 'A0') : 'N/A';
      const speakingPart3 = isSpeakingActive ? (sr?.partLevels?.[2] || sr?.partResults?.[2]?.level || 'A0') : 'N/A';
      const speakingPart4 = isSpeakingActive ? (sr?.partLevels?.[3] || sr?.partResults?.[3]?.level || 'A0') : 'N/A';

      const submittedTime = attempt.submittedAt || new Date().toISOString();
      const startedTime = attempt.startedAt || submittedTime;

      const isPendingServer = Boolean(
        exam.answerSource === 'external' ||
        (scores && scores.pendingServerGrading) ||
        (attempt.scores && attempt.scores.pendingServerGrading)
      );
      const requiresServerGrading = Boolean(
        exam.answerSource === 'external' ||
        (scores && scores.pendingServerGrading) ||
        (attempt.scores && attempt.scores.pendingServerGrading)
      );
      const answerSource = exam.answerSource || (exam.externalAnswerConfig ? 'external' : 'local');
      const overallPct = isPendingServer ? null : (typeof scores.overall === 'number' ? scores.overall : null);

      const combinedAnswers = attempt.answers || {
        vocab: attempt.vocabAnswers || {},
        grammar: attempt.grammarAnswers || {},
        reading: attempt.readingAnswers || {},
        listening: attempt.listeningAnswers || {},
      };

      const rankVal = String(attempt.occupation || attempt.position || attempt.userRank || attempt.studentRank || attempt.rank || (attempt.studentInfo && (attempt.studentInfo.occupation || attempt.studentInfo.position || attempt.studentInfo.rank)) || 'N/A').trim() || 'N/A';

      const hasWriting = (scores.vocab && scores.vocab.total > 0) || (scores.grammar && scores.grammar.total > 0);
      const writingScoreVal = hasWriting
        ? (typeof scores.writingScore === 'number' ? scores.writingScore : Math.round(((scores.vocab?.pct || 0) + (scores.grammar?.pct || 0)) / 2))
        : 'N/A';

      // Gather question details for fallback prompt matching and section breakdown on server
      const questionDetails = {};
      const gatherDetails = (qList, sec) => {
        (qList || []).forEach(q => {
          if (q && q.id) {
            questionDetails[q.id] = {
              text: q.text || '',
              type: q.type || 'mc',
              section: sec,
              level: q.level || ''
            };
          }
        });
      };
      const rDetailQuestions = (Array.isArray(attempt.readingQuestions) && attempt.readingQuestions.length > 0)
        ? attempt.readingQuestions
        : (attempt.selectedReadingItems || []).flatMap(it => (it && Array.isArray(it.questions)) ? it.questions : []);
      const lDetailQuestions = (Array.isArray(attempt.listeningQuestions) && attempt.listeningQuestions.length > 0)
        ? attempt.listeningQuestions
        : (attempt.selectedListeningItems || []).flatMap(it => (it && Array.isArray(it.questions)) ? it.questions : []);

      gatherDetails(attempt.vocabQuestions, 'vocab');
      gatherDetails(attempt.grammarQuestions, 'grammar');
      gatherDetails(rDetailQuestions, 'reading');
      gatherDetails(lDetailQuestions, 'listening');

      const payload = {
        action: 'submit_results',
        exam_id: exam.id || 'EVAL_TEST_001',
        attempt_id: attempt.id || ('att_' + Date.now()),
        max_score: 100,
        percentage: overallPct,
        duration: typeof attempt.duration === 'number' ? attempt.duration : (attempt.totalSeconds || 0),
        started_at: startedTime,
        finished_at: submittedTime,
        answers: combinedAnswers,
        questionDetails: questionDetails,
        idempotency_key: `${exam.id || 'exam'}_${attempt.id || 'att'}_${submittedTime}`,
        studentName: attempt.studentName || '',
        studentFirstName: attempt.studentFirstName || attempt.studentName || '',
        studentLastName: attempt.studentLastName || '',
        position: rankVal,
        occupation: rankVal,
        userRank: rankVal,
        studentRank: rankVal,
        rank: rankVal,
        grado: rankVal,
        studentId: attempt.studentId || '',
        studentEmail: attempt.studentEmail || '',
        examTitle: exam.title || '',
        overallScore: overallPct,
        overallCefr: cefrLabel,
        writingScore: writingScoreVal,
        vocabPct: (scores.vocab && typeof scores.vocab.pct === 'number' && (!isPendingServer || scores.vocab.pct > 0)) ? scores.vocab.pct : (attempt.localFallbackScores?.vocab?.pct !== undefined ? attempt.localFallbackScores.vocab.pct : 0),
        grammarPct: (scores.grammar && typeof scores.grammar.pct === 'number' && (!isPendingServer || scores.grammar.pct > 0)) ? scores.grammar.pct : (attempt.localFallbackScores?.grammar?.pct !== undefined ? attempt.localFallbackScores.grammar.pct : 0),
        readingPct: (scores.reading && typeof scores.reading.pct === 'number' && (!isPendingServer || scores.reading.pct > 0)) ? scores.reading.pct : (attempt.localFallbackScores?.reading?.pct !== undefined ? attempt.localFallbackScores.reading.pct : 0),
        listeningPct: (scores.listening && typeof scores.listening.pct === 'number' && (!isPendingServer || scores.listening.pct > 0)) ? scores.listening.pct : (attempt.localFallbackScores?.listening?.pct !== undefined ? attempt.localFallbackScores.listening.pct : 0),
        fallbackOverallScore: attempt.localFallbackScores ? (attempt.localFallbackScores.overall ?? null) : null,
        speakingIncluded: isSpeakingActive,
        examIncludesSpeaking: isSpeakingActive,
        speakingScore: (attempt.speakingResults?.numericScore !== undefined ? attempt.speakingResults.numericScore : (typeof attempt.speakingScore === 'number' ? attempt.speakingScore : null)),
        speakingResults: attempt.speakingResults || null,
        speakingLevel: speakingLevel,
        speakingPart1: speakingPart1,
        speakingPart2: speakingPart2,
        speakingPart3: speakingPart3,
        speakingPart4: speakingPart4,
        passed: Boolean(scores.passed),
        submittedAt: submittedTime,
        authorEmail: (exam.authorEmail || '').trim(),
        recipientEmails: (exam.recipientEmails || '').trim(),
        emailReportingEnabled: exam.emailReportingEnabled !== false,
        passingScore: (attempt.passingScore != null ? attempt.passingScore : (exam.passingScore || 70)),
        answerSource: answerSource,
        requiresServerGrading: requiresServerGrading,
        supervisionConsentGivenAt: attempt.supervisionConsentGivenAt || null,
        cameraExempt: Boolean(attempt.cameraExempt),
        examType: exam.examType || 'complete',
        creatorEmail: (exam.creatorEmail || exam.authorEmail || '').trim(),
        vocabCefr: (scores.vocabCefr?.label || scores.vocabCefr || ''),
        grammarCefr: (scores.grammarCefr?.label || scores.grammarCefr || ''),
        vocabAdaptive: exam.vocabAdaptive || null,
        grammarAdaptive: exam.grammarAdaptive || null,
        accessCode: attempt.accessCode || (attempt.code || ''),
      };

      const targetWebhookUrl = (exam.examType === 'placement' && exam.placementWebhookUrl) ? exam.placementWebhookUrl : (webhookUrl || exam.webhookUrl);
      console.log('[JCAH Results] Dispatching score webhook payload with retry & verification to:', targetWebhookUrl, payload);
      _updateSyncBanner('syncing');

      let confirmed = false;
      let lastErr = null;
      const maxRetries = 3;

      for (let attemptNum = 1; attemptNum <= maxRetries; attemptNum++) {
        try {
          const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          const timeoutId = controller ? setTimeout(() => controller.abort(), 22000) : null;

          const requestHeaders = { 'Content-Type': 'text/plain;charset=utf-8' };

          const resp = await fetch(targetWebhookUrl, {
            method: 'POST',
            keepalive: true,
            headers: requestHeaders,
            body: JSON.stringify(payload),
            signal: controller ? controller.signal : undefined
          });

          if (timeoutId) clearTimeout(timeoutId);

          if (!resp.ok) {
            if (resp.status === 401 || resp.status === 403) {
              const authErr = new Error(`Acceso no autorizado (HTTP ${resp.status}): credenciales o permisos insuficientes.`);
              authErr.code = 'AUTH_REQUIRED';
              authErr.httpStatus = resp.status;
              lastErr = authErr;
              _updateSyncBanner('failed', attemptNum, maxRetries, { code: 'AUTH_REQUIRED', httpStatus: resp.status, error: authErr.message, pendingServerGrading: isPendingServer });
              break;
            }
            throw new Error(`Error de servidor HTTP ${resp.status}`);
          }

          let jsonResp = null;
          try {
            jsonResp = await resp.json();
          } catch (_) {
            // Some servers return text OK
            jsonResp = { success: true };
          }

          if (jsonResp && (jsonResp.success === true || jsonResp.status === 'success' || jsonResp.statusCode === 200)) {
            confirmed = true;
            attempt.webhookSent = true;
            attempt.webhookConfirmedAt = new Date().toISOString();
            attempt.webhookError = null;

            // Mode B authoritative server grading response integration
            if (jsonResp.serverGraded === true) {
              try {
                _applyServerVerdict(attempt, jsonResp, isSpeakingActive);
              } catch (verdictErr) {
                console.error('[JCAH Results] Error applying server verdict to UI:', verdictErr);
              }
            } else {
              if (typeof JCAHAttemptStore !== 'undefined' && typeof JCAHAttemptStore.saveAttempt === 'function') {
                JCAHAttemptStore.saveAttempt(attempt);
              }
              if (typeof JCAHAttemptStore !== 'undefined' && typeof JCAHAttemptStore.removePendingSubmission === 'function') {
                JCAHAttemptStore.removePendingSubmission(attempt.id);
              }
            }

            console.log('[JCAH Results] Score webhook delivery verified by server on try ' + attemptNum + ':', jsonResp);
            _updateSyncBanner('success', 1, 3, jsonResp);
            _updateOutboxBadge();
            break;
          } else {
            const failCode = (jsonResp && jsonResp.code) || 'SERVER_REJECTED';
            const serverErrMsg = (jsonResp && (jsonResp.error || jsonResp.message)) || 'Respuesta de servidor inválida';
            const fatalErr = new Error(serverErrMsg);
            fatalErr.code = failCode;
            lastErr = fatalErr;
            if (failCode === 'GRADING_UNAVAILABLE' || failCode === 'NO_ANSWER_KEY_MATCH' || failCode === 'UNKNOWN_QUESTION_SECTION' || failCode === 'AUTH_REQUIRED' || failCode === 401 || failCode === 403) {
              _updateSyncBanner('failed', attemptNum, maxRetries, { code: failCode, error: serverErrMsg, pendingServerGrading: isPendingServer });
              break;
            }
            throw fatalErr;
          }
        } catch (tryErr) {
          lastErr = tryErr;
          console.warn(`[JCAH Results] Intento ${attemptNum}/${maxRetries} falló: ${tryErr.message}`);

          // JSONP verification fallback:
          // In file:/// environments, Chromium blocks reading 302 redirect responses even when GAS received the POST.
          // Query get_result via JSONP to verify and retrieve the server verdict without CORS restrictions.
          if (typeof document !== 'undefined' && targetWebhookUrl && payload.attempt_id) {
            try {
              console.log('[JCAH Results] Probing server verdict via JSONP for attempt:', payload.attempt_id);
              await new Promise(r => setTimeout(r, 1200));
              const jsonpResp = await fetchJsonp(targetWebhookUrl, {
                action: 'get_result',
                attempt_id: payload.attempt_id,
                studentId: payload.studentId || ''
              }, 8000);
              if (jsonpResp && (jsonpResp.success === true || jsonpResp.serverGraded === true)) {
                console.log('[JCAH Results] ✓ Received authoritative server verdict via JSONP:', jsonpResp);
                confirmed = true;
                attempt.webhookSent = true;
                attempt.webhookConfirmedAt = new Date().toISOString();
                attempt.webhookError = null;
                try {
                  _applyServerVerdict(attempt, jsonpResp, isSpeakingActive);
                } catch (verdictErr) {
                  console.error('[JCAH Results] Error applying JSONP server verdict to UI:', verdictErr);
                }
                _updateSyncBanner('success', 1, 3, jsonpResp);
                _updateOutboxBadge();
                break;
              }
            } catch (jpErr) {
              console.warn(`[JCAH Results] JSONP probe attempt ${attemptNum} failed:`, jpErr.message);
            }
          }

          if (attemptNum < maxRetries) {
            _updateSyncBanner('retrying', attemptNum, maxRetries);
            await new Promise(r => setTimeout(r, attemptNum * 2000));
          }
        }
      }

      // Final JSONP recovery check before declaring offline
      if (!confirmed && typeof document !== 'undefined' && targetWebhookUrl && payload.attempt_id) {
        console.log('[JCAH Results] Final check via JSONP before activating offline mode...');
        for (let finalPoll = 1; finalPoll <= 2; finalPoll++) {
          try {
            await new Promise(r => setTimeout(r, 1500));
            const jsonpResp = await fetchJsonp(targetWebhookUrl, {
              action: 'get_result',
              attempt_id: payload.attempt_id,
              studentId: payload.studentId || ''
            }, 8000);
            if (jsonpResp && (jsonpResp.success === true || jsonpResp.serverGraded === true)) {
              console.log('[JCAH Results] ✓ Final JSONP probe confirmed attempt:', jsonpResp);
              confirmed = true;
              attempt.webhookSent = true;
              attempt.webhookConfirmedAt = new Date().toISOString();
              attempt.webhookError = null;
              try {
                _applyServerVerdict(attempt, jsonpResp, isSpeakingActive);
              } catch (verdictErr) {
                console.error('[JCAH Results] Error applying final JSONP server verdict to UI:', verdictErr);
              }
              _updateSyncBanner('success', 1, 3, jsonpResp);
              _updateOutboxBadge();
              break;
            }
          } catch (_) {}
        }
      }

      if (!confirmed) {
        attempt.webhookSent = false;
        attempt.webhookError = lastErr ? lastErr.message : 'Error desconocido de red';
        if (typeof JCAHAttemptStore !== 'undefined' && typeof JCAHAttemptStore.saveAttempt === 'function') {
          JCAHAttemptStore.saveAttempt(attempt);
        }
        if (typeof JCAHAttemptStore !== 'undefined' && typeof JCAHAttemptStore.savePendingSubmission === 'function') {
          JCAHAttemptStore.savePendingSubmission(attempt);
        }
        console.error('[JCAH Results] Todos los intentos de entrega al Webhook fallaron:', lastErr);
        if (isPendingServer && attempt.localFallbackScores && typeof attempt.localFallbackScores.overall === 'number') {
          console.log('[JCAH Results] Activating local fallback scores due to webhook reachability failure');
          attempt.scores = Object.assign({}, attempt.localFallbackScores, {
            serverGraded: false,
            pendingServerGrading: false,
            isLocalFallback: true
          });
          _updateResultsScreenWithServerVerdict(attempt.scores);
        }
        _updateSyncBanner('failed', lastErr ? lastErr.message : 'Falla de conexión', maxRetries, {
          code: lastErr && lastErr.code,
          error: lastErr ? lastErr.message : 'Falla de conexión',
          pendingServerGrading: isPendingServer
        });
        _updateOutboxBadge();
        _showBackupSubmissionAlert(exam, attempt, payload);
      }
    } catch (e) {
      console.warn('[JCAH Results] Webhook dispatch general error:', e);
      _updateSyncBanner('failed', e.message);
    }
  }

  function fetchJsonp(url, params, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (typeof document === 'undefined') {
        return reject(new Error('DOM not available for JSONP'));
      }
      const targetDom = document.head || document.body || document.documentElement;
      if (!targetDom || typeof targetDom.appendChild !== 'function') {
        return reject(new Error('DOM container not available for JSONP'));
      }
      const callbackName = 'jcah_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
      const script = document.createElement('script');
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      };

      window[callbackName] = (data) => {
        cleanup();
        resolve(data);
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP request timed out'));
      }, timeoutMs);

      script.onerror = () => {
        cleanup();
        reject(new Error('JSONP script load error'));
      };

      const queryParts = [];
      for (const k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k)) {
          queryParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        }
      }
      queryParts.push('callback=' + encodeURIComponent(callbackName));
      const sep = url.includes('?') ? '&' : '?';
      script.src = url + sep + queryParts.join('&');
      targetDom.appendChild(script);
    });
  }

  function _applyServerVerdict(attempt, jsonResp, isSpeakingActive) {
    if (!jsonResp) return;
    attempt.scores = attempt.scores || {};
    if (typeof jsonResp.score === 'number') attempt.scores.overall = jsonResp.score;
    if (typeof jsonResp.calculatedScore === 'number' && typeof jsonResp.score !== 'number') attempt.scores.overall = jsonResp.calculatedScore;
    if (typeof jsonResp.passed === 'boolean') attempt.scores.passed = jsonResp.passed;
    attempt.scores.serverGraded = true;
    attempt.scores.pendingServerGrading = false;
    if (typeof jsonResp.speakingIncluded === 'boolean') {
      attempt.scores.speakingIncluded = jsonResp.speakingIncluded;
    } else {
      attempt.scores.speakingIncluded = isSpeakingActive;
    }
    const sScore = (typeof jsonResp.speakingScore === 'number') ? jsonResp.speakingScore : ((typeof jsonResp.speakingPct === 'number') ? jsonResp.speakingPct : null);
    if (sScore !== null) {
      attempt.scores.speakingScore = sScore;
      if (attempt.speakingResults) attempt.speakingResults.numericScore = sScore;
    } else if (attempt.speakingResults?.numericScore !== undefined) {
      attempt.scores.speakingScore = attempt.speakingResults.numericScore;
    }
    const vPct = (typeof jsonResp.vocabPct === 'number') ? jsonResp.vocabPct : ((typeof jsonResp.vocabScore === 'number') ? jsonResp.vocabScore : null);
    if (vPct !== null) {
      attempt.scores.vocab = attempt.scores.vocab || {};
      attempt.scores.vocab.pct = vPct;
      if (typeof jsonResp.vocabCorrect === 'number') attempt.scores.vocab.correct = jsonResp.vocabCorrect;
      if (typeof jsonResp.vocabTotal === 'number') attempt.scores.vocab.total = jsonResp.vocabTotal;
    }
    if (jsonResp.vocabCefr) {
      attempt.scores.vocab = attempt.scores.vocab || {};
      attempt.scores.vocab.cefr = { key: jsonResp.vocabCefr, label: jsonResp.vocabCefr };
      attempt.scores.vocabCefr = { key: jsonResp.vocabCefr, label: jsonResp.vocabCefr };
    }
    const gPct = (typeof jsonResp.grammarPct === 'number') ? jsonResp.grammarPct : ((typeof jsonResp.grammarScore === 'number') ? jsonResp.grammarScore : null);
    if (gPct !== null) {
      attempt.scores.grammar = attempt.scores.grammar || {};
      attempt.scores.grammar.pct = gPct;
      if (typeof jsonResp.grammarCorrect === 'number') attempt.scores.grammar.correct = jsonResp.grammarCorrect;
      if (typeof jsonResp.grammarTotal === 'number') attempt.scores.grammar.total = jsonResp.grammarTotal;
    }
    if (jsonResp.grammarCefr) {
      attempt.scores.grammar = attempt.scores.grammar || {};
      attempt.scores.grammar.cefr = { key: jsonResp.grammarCefr, label: jsonResp.grammarCefr };
      attempt.scores.grammarCefr = { key: jsonResp.grammarCefr, label: jsonResp.grammarCefr };
    }
    const rPct = (typeof jsonResp.readingPct === 'number') ? jsonResp.readingPct : ((typeof jsonResp.readingScore === 'number') ? jsonResp.readingScore : null);
    if (rPct !== null) {
      attempt.scores.reading = attempt.scores.reading || {};
      attempt.scores.reading.pct = rPct;
      if (typeof jsonResp.readingCorrect === 'number') attempt.scores.reading.correct = jsonResp.readingCorrect;
      if (typeof jsonResp.readingTotal === 'number') attempt.scores.reading.total = jsonResp.readingTotal;
    }
    const lPct = (typeof jsonResp.listeningPct === 'number') ? jsonResp.listeningPct : ((typeof jsonResp.listeningScore === 'number') ? jsonResp.listeningScore : null);
    if (lPct !== null) {
      attempt.scores.listening = attempt.scores.listening || {};
      attempt.scores.listening.pct = lPct;
      if (typeof jsonResp.listeningCorrect === 'number') attempt.scores.listening.correct = jsonResp.listeningCorrect;
      if (typeof jsonResp.listeningTotal === 'number') attempt.scores.listening.total = jsonResp.listeningTotal;
    }
    if (typeof jsonResp.writingScore === 'number') {
      attempt.scores.writingScore = jsonResp.writingScore;
    }
    if (jsonResp.cefrLevel) {
      attempt.scores.overallCefr = jsonResp.cefrLevel;
    }

    const isPlac = Boolean((_exam && (_exam.examType === 'placement' || _exam.type === 'placement')) || (attempt && (attempt.examType === 'placement' || attempt.isPlacement)));
    if (isPlac) {
      if (!attempt.scores.vocab?.total || attempt.scores.vocab.total < 12) {
        attempt.scores.vocab = attempt.scores.vocab || {};
        attempt.scores.vocab.total = (attempt.vocabQuestions || []).length || 12;
      }
      if (!attempt.scores.grammar?.total || attempt.scores.grammar.total < 12) {
        attempt.scores.grammar = attempt.scores.grammar || {};
        attempt.scores.grammar.total = (attempt.grammarQuestions || []).length || 12;
      }
      if (!attempt.scores.reading?.total || attempt.scores.reading.total < 10) {
        attempt.scores.reading = attempt.scores.reading || {};
        attempt.scores.reading.total = (attempt.readingQuestions || []).length || 10;
      }
      if (!attempt.scores.listening?.total || attempt.scores.listening.total < 10) {
        attempt.scores.listening = attempt.scores.listening || {};
        attempt.scores.listening.total = (attempt.listeningQuestions || []).length || 10;
      }
    }

    if (typeof JCAHAttemptStore !== 'undefined' && typeof JCAHAttemptStore.saveAttempt === 'function') {
      JCAHAttemptStore.saveAttempt(attempt);
    }
    if (typeof JCAHAttemptStore !== 'undefined' && typeof JCAHAttemptStore.removePendingSubmission === 'function') {
      JCAHAttemptStore.removePendingSubmission(attempt.id);
    }
    _updateResultsScreenWithServerVerdict(attempt.scores);
  }

  function _updateResultsScreenWithServerVerdict(scores) {
    if (typeof document === 'undefined') return;
    if (_exam && _attempt && _containerId && document.getElementById(_containerId)) {
      render(_exam, _attempt, _containerId);
      if (typeof ScormHelper !== 'undefined' && typeof ScormHelper.reportScore === 'function') {
        ScormHelper.reportScore(scores.overall, scores.passed);
      }
      return;
    }
    const scoreEl = document.getElementById('results-overall-score-display');
    if (scoreEl && typeof scores.overall === 'number') {
      scoreEl.textContent = scores.overall + '%';
    }
    const badgeEl = document.getElementById('results-pass-fail-badge');
    if (badgeEl && typeof scores.passed === 'boolean') {
      const checkIcon = typeof getIcon === 'function' ? (' ' + getIcon('check', 'width="16" height="16" style="margin-left:4px;vertical-align:-2px"')) : '';
      const xIcon = typeof getIcon === 'function' ? (' ' + getIcon('x', 'width="16" height="16" style="margin-left:4px;vertical-align:-2px"')) : '';
      badgeEl.className = 'chip ' + (scores.passed ? 'chip-success' : 'chip-error');
      badgeEl.innerHTML = scores.passed ? ('PASSED' + checkIcon) : ('NOT PASSED' + xIcon);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /**
   * Visual Sync Banner Controller
   */
  function _updateSyncBanner(status, currentTry = 1, maxTries = 3, extraData = null) {
    const banner = document.getElementById('jcah-sync-status-banner');
    if (!banner) return;

    if (status === 'syncing') {
      banner.style.display = 'block';
      banner.style.background = '#EFF6FF';
      banner.style.borderColor = '#3B82F6';
      banner.style.color = '#1E40AF';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:18px">⏳</span>
            <div>
              <strong>Sincronizando entrega con el servidor central...</strong>
              <div style="font-size:12px;opacity:0.85">Por favor no cierre esta ventana mientras se confirma la recepción.</div>
            </div>
          </div>
        </div>`;
    } else if (status === 'retrying') {
      banner.style.display = 'block';
      banner.style.background = '#FFFBEB';
      banner.style.borderColor = '#F59E0B';
      banner.style.color = '#92400E';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">🔄</span>
          <div>
            <strong>Reintentando entrega (intento ${currentTry + 1} de ${maxTries})...</strong>
            <div style="font-size:12px;opacity:0.85">Asegurando turno en el servidor de evaluación...</div>
          </div>
        </div>`;
    } else if (status === 'success') {
      banner.style.display = 'block';
      banner.style.background = '#ECFDF5';
      banner.style.borderColor = '#10B981';
      banner.style.color = '#065F46';
      if (extraData && extraData.serverGraded) {
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:20px">🛡️</span>
            <div>
              <strong>¡Calificación autoritativa del servidor completada exitosamente!</strong>
              <div style="font-size:12px;opacity:0.85">Puntuación oficial del servidor: <strong>${extraData.score}%</strong> — <strong>${extraData.passed ? 'APROBADO' : 'NO APROBADO'}</strong>. Resultados asegurados en la base de datos oficial.</div>
            </div>
          </div>`;
      } else {
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:18px">✅</span>
            <div>
              <strong>¡Entrega registrada y confirmada exitosamente en el servidor central!</strong>
              <div style="font-size:12px;opacity:0.85">Sus resultados han quedado asegurados en la base de datos oficial.</div>
            </div>
          </div>`;
      }
    } else if (status === 'failed') {
      banner.style.display = 'block';
      banner.style.background = '#FEF2F2';
      banner.style.borderColor = '#EF4444';
      banner.style.color = '#991B1B';
      const isPendingServer = extraData && extraData.pendingServerGrading;
      const failCode = (extraData && extraData.code) || '';
      const rawError = (extraData && extraData.error) || '';

      let headline = isPendingServer ? 'Aviso de Evaluación Pendiente de Validación Oficial (Modo B)' : 'Aviso de Entrega Pendiente de Sincronización';
      let description = isPendingServer ? 'El intento ha sido guardado en la bandeja de salida local. La puntuación oficial será calculada por el servidor cuando se restablezca la conexión.' : 'No se pudo confirmar la conexión con la hoja central debido a congestión de red. <b>Sus respuestas están intactas en esta máquina.</b>';

      if (failCode === 'GRADING_UNAVAILABLE') {
        headline = 'Score pending — the server could not grade this attempt';
        description = `Score pending — the server could not grade this attempt (${escapeHtml(rawError || 'The Answers sheet is missing or empty in the server spreadsheet')}). Sus respuestas están resguardadas de manera segura en esta máquina. Descargue su archivo de respaldo (.jcah).`;
      } else if (failCode === 'NO_ANSWER_KEY_MATCH') {
        headline = 'Error de Calificación: Clave de respuestas no coincide';
        description = `Score pending — no matching questions found in server answer key (${escapeHtml(rawError)}). Sus respuestas están resguardadas en esta máquina. Descargue su archivo de respaldo (.jcah).`;
      } else if (failCode === 'UNKNOWN_QUESTION_SECTION') {
        headline = 'Error de Calificación: Sección de pregunta desconocida';
        description = `Score pending — question section unknown on server (${escapeHtml(rawError)}). Descargue su archivo de respaldo (.jcah).`;
      } else if (failCode === 'AUTH_REQUIRED') {
        headline = 'Error de Autorización en el Servidor (HTTP 401/403)';
        description = `Acceso no autorizado por el servidor central (${escapeHtml(rawError || 'HTTP 401/403 No Autorizado')}). Verifique la configuración de permisos del Webhook o descargue su respaldo (.jcah).`;
      }

      banner.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px">⚠️</span>
            <div>
              <strong style="font-size:14px">${escapeHtml(headline)}</strong>
              <div style="font-size:12px;opacity:0.9">${description}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm btn-primary" onclick="JCAHResults.retrySubmission()" style="font-size:12px;padding:6px 12px">
              🔄 Reintentar Envío Ahora
            </button>
            <button type="button" class="btn btn-sm btn-outline" onclick="JCAHResults.downloadBackup()" style="font-size:12px;padding:6px 12px;background:#fff">
              💾 Descargar Respaldo (.jcah / .json)
            </button>
          </div>
        </div>`;
    }
  }

  function _showBackupSubmissionAlert(exam, attempt, payload) {
    console.warn('[JCAH Results] Modal de contingencia activado para estudiante:', attempt.studentId);
  }

  /**
   * Public retry handler callable from UI button
   */
  async function retrySubmission() {
    const exam = window.__JCAH_EXAM__ || _exam;
    const attempt = (typeof JCAHAttemptStore !== 'undefined')
      ? (typeof JCAHAttemptStore.loadCurrentAttempt === 'function' ? JCAHAttemptStore.loadCurrentAttempt(exam ? exam.id : null) : (typeof JCAHAttemptStore.loadAttempt === 'function' ? JCAHAttemptStore.loadAttempt(exam ? exam.id : null) : null))
      : _attempt;
    if (exam && attempt) {
      await dispatchWebhook(exam, attempt);
    } else {
      if (typeof alert !== 'undefined') {
        alert('No se encontró el intento activo para reintentar.');
      } else {
        console.warn('[JCAH Results] No se encontró el intento activo para reintentar.');
      }
    }
  }

  /**
   * Drain / Flush pending offline submissions from outbox
   */
  async function flushOutbox(exam) {
    const targetExam = exam || window.__JCAH_EXAM__ || _exam;
    if (!targetExam) return { sent: 0, pending: 0 };
    if (typeof JCAHAttemptStore === 'undefined' || typeof JCAHAttemptStore.getPendingSubmissions !== 'function') {
      return { sent: 0, pending: 0 };
    }
    const pendingList = JCAHAttemptStore.getPendingSubmissions() || [];
    if (pendingList.length === 0) {
      _updateOutboxBadge();
      return { sent: 0, pending: 0 };
    }

    console.log(`[JCAH Results] Draining offline outbox (${pendingList.length} items)...`);
    let sentCount = 0;
    for (const pendingAttempt of pendingList) {
      if (!pendingAttempt || !pendingAttempt.id) continue;
      try {
        await dispatchWebhook(targetExam, pendingAttempt);
        if (pendingAttempt.webhookSent) {
          sentCount++;
          if (typeof JCAHAttemptStore.removePendingSubmission === 'function') {
            JCAHAttemptStore.removePendingSubmission(pendingAttempt.id);
          }
        }
      } catch (err) {
        console.warn(`[JCAH Results] Error flushing attempt ${pendingAttempt.id}:`, err);
      }
    }
    _updateOutboxBadge();
    const remaining = (typeof JCAHAttemptStore.getPendingSubmissions === 'function')
      ? JCAHAttemptStore.getPendingSubmissions().length
      : 0;
    return { sent: sentCount, pending: remaining };
  }

  async function flushPendingOutbox() {
    const exam = window.__JCAH_EXAM__ || _exam;
    return await flushOutbox(exam);
  }

  function _updateOutboxBadge() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('jcah-outbox-badge');
    const pendingCount = (typeof JCAHAttemptStore !== 'undefined' && typeof JCAHAttemptStore.getPendingSubmissions === 'function')
      ? JCAHAttemptStore.getPendingSubmissions().length
      : 0;
    if (!badge) return;
    if (pendingCount > 0) {
      badge.style.display = 'block';
      badge.innerHTML = `
        <div style="margin-top:10px;padding:8px 12px;background:#FFFBEB;border:1px solid #F59E0B;border-radius:6px;font-size:12px;color:#92400E;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <span>📦 <strong>${pendingCount}</strong> envío${pendingCount === 1 ? '' : 's'} pendiente${pendingCount === 1 ? '' : 's'} en bandeja de salida local.</span>
          <button type="button" class="btn btn-sm btn-outline" onclick="JCAHResults.flushPendingOutbox()" style="font-size:11px;padding:4px 8px;background:#fff;border-color:#F59E0B;color:#92400E">
            🔄 Reintentar sincronización ahora
          </button>
        </div>`;
    } else {
      badge.style.display = 'none';
      badge.innerHTML = '';
    }
  }

  /**
   * Download encrypted/signed backup file for manual delivery
   */
  async function downloadBackup() {
    const exam = window.__JCAH_EXAM__ || _exam || {};
    const attempt = (typeof JCAHAttemptStore !== 'undefined') 
      ? (JCAHAttemptStore.loadCurrentAttempt ? JCAHAttemptStore.loadCurrentAttempt() : JCAHAttemptStore.loadAttempt(exam.id)) 
      : _attempt;

    if (!attempt) {
      if (typeof alert !== 'undefined') alert('No hay datos de intento disponibles para descargar.');
      return;
    }

    // Extract captured proctoring photos (3 Snapshots: initial, random, finish)
    const proctoringPhotos = {};
    if (Array.isArray(attempt.cameraImages)) {
      attempt.cameraImages.forEach(img => {
        if (img.type && img.dataUrl) {
          proctoringPhotos[img.type] = img.dataUrl;
        }
      });
    }

    const reportData = {
      examTitle: exam.title || 'JCAH Assessment',
      examId: exam.id || '',
      studentId: attempt.studentId || 'N/A',
      studentName: attempt.studentName || 'N/A',
      position: attempt.position || attempt.occupation || attempt.userRank || attempt.studentRank || 'N/A',
      occupation: attempt.occupation || attempt.position || attempt.userRank || attempt.studentRank || 'N/A',
      userRank: attempt.occupation || attempt.position || attempt.userRank || attempt.studentRank || 'N/A',
      scores: attempt.scores,
      overallCefr: (attempt.scores?.overallCefr?.label) || 'B1',
      passingScore: exam.passingScore || 70,
      submittedAt: attempt.submittedAt || new Date().toISOString(),
      answers: {
        vocab: attempt.vocabAnswers || {},
        grammar: attempt.grammarAnswers || {},
        reading: attempt.readingAnswers || {},
        listening: attempt.listeningAnswers || {},
      },
      proctoringPhotos: proctoringPhotos,
      violations: attempt.violations || [],
      integrityHash: 'JCAH-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Date.now(),
    };

    const reportPublicKey = exam.reportPublicKey;
    if (!reportPublicKey) {
      if (typeof alert !== 'undefined') {
        alert('Report encryption is not configured for this assessment (reportPublicKey missing). Offline backup download is disabled.');
      }
      return;
    }

    let fileBlob;
    const fileName = `JCAH_Report_${(attempt.studentId || 'student').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.jcah`;

    if (typeof JCAHCrypto !== 'undefined' && JCAHCrypto.encryptReportWithPublicKey) {
      try {
        const encryptedJson = await JCAHCrypto.encryptReportWithPublicKey(reportData, reportPublicKey);
        fileBlob = new Blob([encryptedJson], { type: 'application/json' });
      } catch (encErr) {
        console.error('[JCAH Results] Asymmetric encryption error:', encErr);
        if (typeof alert !== 'undefined') {
          alert('Error al generar el reporte cifrado: ' + (encErr.message || encErr.toString()));
        }
        return; // NEVER fall back to plaintext!
      }
    } else {
      if (typeof alert !== 'undefined') {
        alert('El módulo criptográfico para cifrado asimétrico no está disponible.');
      }
      return;
    }

    if (typeof document !== 'undefined') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(fileBlob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    if (typeof alert !== 'undefined') {
      alert(`Reporte seguro descargado: "${fileName}".\n\nEste reporte está cifrado asimétricamente con la clave pública institucional y solo puede ser inspeccionado por el evaluador con su clave privada.`);
    }
  }

  return {
    render,
    retrySubmission,
    downloadBackup,
    showReviewView,
    showSummaryView,
    renderReviewView,
    renderQuestionReviewCard,
    filterStatus,
    filterSection,
    downloadPDF,
    dispatchWebhook,
    flushOutbox,
    flushPendingOutbox,
  };
})();

if (typeof window !== 'undefined') {
  window.JCAHResults = JCAHResults;
}
if (typeof module !== 'undefined') module.exports = JCAHResults;
