/**
 * JCAH Exam Delivery — Main Student Controller
 * Orchestrates start screen, 9-section navigation, timer countdown, question map, supervision, and submission.
 */
(() => {

  let exam = null;
  let attempt = null;
  let timerInterval = null;
  let currentTabIdx = 0;
  let currentQuestionIdx = 0;

  // v2.0b — automatic translation lock. While the JCAHTranslationGuard shows
  // its blocking prompt (browser/device translation detected), the countdown
  // timer is paused so the candidate does not lose time fixing the issue.
  let translationLocked = false;

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

  /* -------------------------------------------------------
     Brute-Force Lockout (per device / per exam)
     5 wrong access-code attempts → locked for 1 hour.
     State is persisted in localStorage so it survives page reloads.
  ------------------------------------------------------- */
  const JCAHLockout = (() => {
    const STORAGE_KEY  = 'jcah_lockout_v1';
    const MAX_FAILURES = 5;
    const LOCK_MS      = 60 * 60 * 1000; // 1 hour

    function _key(examId) {
      return STORAGE_KEY + '_' + (examId || 'default');
    }

    function _load(examId) {
      try {
        const raw = localStorage.getItem(_key(examId));
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return { failures: 0, lockedUntil: 0 };
    }

    function _save(examId, state) {
      try {
        localStorage.setItem(_key(examId), JSON.stringify(state));
      } catch (_) {}
    }

    /** Returns { locked: bool, msRemaining: number } */
    function status(examId) {
      const s = _load(examId);
      const now = Date.now();
      if (s.lockedUntil && now < s.lockedUntil) {
        return { locked: true,  msRemaining: s.lockedUntil - now, failures: s.failures };
      }
      // Auto-clear expired lock
      if (s.lockedUntil && now >= s.lockedUntil) {
        _save(examId, { failures: 0, lockedUntil: 0 });
      }
      return { locked: false, msRemaining: 0, failures: s.failures };
    }

    /** Call after each wrong code. Returns { locked: bool, failures: number } */
    function recordFailure(examId) {
      const s = _load(examId);
      // If an old lock already expired, start fresh
      if (s.lockedUntil && Date.now() >= s.lockedUntil) {
        s.failures   = 0;
        s.lockedUntil = 0;
      }
      s.failures = (s.failures || 0) + 1;
      if (s.failures >= MAX_FAILURES) {
        s.lockedUntil = Date.now() + LOCK_MS;
      }
      _save(examId, s);
      return { locked: s.failures >= MAX_FAILURES, failures: s.failures, remaining: MAX_FAILURES - s.failures };
    }

    /** Call on successful exam start to reset the counter */
    function clearFailures(examId) {
      _save(examId, { failures: 0, lockedUntil: 0 });
    }

    /** Formats ms into HH:MM:SS */
    function _fmtCountdown(ms) {
      const totalSec = Math.max(0, Math.ceil(ms / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
    }

    /**
     * If the device is currently locked, replaces the app container with a
     * lock screen and starts a live countdown.  Returns true if locked.
     */
    function renderLockScreenIfNeeded(examId, appEl) {
      const st = status(examId);
      if (!st.locked) return false;

      let _cdInterval = null;

      function _paint() {
        const remaining = status(examId).msRemaining;
        if (remaining <= 0) {
          // Lock expired — reload to restore the start screen
          clearInterval(_cdInterval);
          location.reload();
          return;
        }
        const countdownEl = document.getElementById('lockout-countdown');
        if (countdownEl) countdownEl.textContent = _fmtCountdown(remaining);
      }

      appEl.innerHTML = `
        <div class="exam-screen-view active" style="align-items:center;padding:var(--sp-6) var(--sp-4);min-height:100%;overflow-y:auto">
          <div class="start-screen-card">
            <div class="start-card-header" style="background:linear-gradient(135deg,#7f1d1d,#991b1b)">
              <div style="font-size:48px;margin-bottom:8px">🔒</div>
              <h1 style="font-size:24px;font-weight:800;color:#fca5a5">Access Temporarily Locked</h1>
              <p style="color:#fecaca;font-size:14px;margin-top:4px">Too many incorrect access code attempts</p>
            </div>
            <div class="p-6">
              <div class="alert" style="background:rgba(127,29,29,0.12);border:1px solid #fca5a5;border-radius:var(--radius);padding:var(--sp-4);margin-bottom:var(--sp-4)">
                <div style="font-size:13px;color:var(--clr-text)">
                  This device has been temporarily blocked after <strong>${MAX_FAILURES} failed access code attempts</strong>.
                  Access will be restored automatically in:
                </div>
                <div id="lockout-countdown" style="font-size:36px;font-weight:800;font-variant-numeric:tabular-nums;color:#ef4444;text-align:center;margin:16px 0;letter-spacing:2px">
                  ${_fmtCountdown(st.msRemaining)}
                </div>
                <div style="font-size:12px;color:var(--clr-text-muted);text-align:center">
                  If you believe this is an error, please contact your instructor.
                </div>
              </div>
            </div>
          </div>
        </div>`;

      _cdInterval = setInterval(_paint, 1000);
      return true;
    }

    return { status, recordFailure, clearFailures, renderLockScreenIfNeeded, MAX_FAILURES };
  })();
  /* -- end JCAHLockout -- */

  document.addEventListener('jcah:exam-lock', () => { translationLocked = true; });
  document.addEventListener('jcah:exam-unlock', () => { 
    translationLocked = false; 
    try {
      if (exam && attempt && !attempt.submitted && typeof window.switchSection === 'function') {
        window.switchSection(currentTabIdx);
      } else if (exam && !attempt && typeof renderStartScreen === 'function') {
        renderStartScreen();
      }
    } catch (_) {}
  });

  // v2.0b — section tabs are built dynamically from the exam's configured part counts
  // (reading 1-3 parts, listening 1-3 parts, speaking). Built after exam data loads.
  let SECTION_TABS = [];

  function buildSectionTabs(examData) {
    const isPlacement = (examData && examData.examType === 'placement');
    const tabs = [
      { key: 'vocab', label: 'Vocabulary', type: 'vocab' },
      { key: 'grammar', label: 'Grammar', type: 'grammar' },
    ];
    let rBanks = (examData && Array.isArray(examData.readingBanks)) 
      ? examData.readingBanks 
      : (examData && examData.reading ? [examData.reading] : []);
    if (isPlacement) {
      rBanks = rBanks.slice(0, 1);
    }
    rBanks.forEach((bank, i) => {
      tabs.push({
        key: `reading_${i}`,
        label: (bank && bank.name) ? `Reading ${i + 1}: ${bank.name}` : `Reading Part ${i + 1}`,
        type: 'reading',
        bankIdx: i
      });
    });

    let lBanks = (examData && Array.isArray(examData.listeningBanks)) 
      ? examData.listeningBanks 
      : (examData && examData.listening ? [examData.listening] : []);
    if (isPlacement) {
      lBanks = lBanks.slice(0, 1);
    }
    lBanks.forEach((bank, i) => {
      tabs.push({
        key: `listening_${i}`,
        label: (bank && bank.name) ? `Listening ${i + 1}: ${bank.name}` : `Listening Part ${i + 1}`,
        type: 'listening',
        bankIdx: i
      });
    });

    if (examData && examData.speaking && examData.speaking.enabled !== false) {
      tabs.push({ key: 'speaking', label: 'Speaking', type: 'speaking' });
    }
    return tabs;
  }

  /* -------------------------------------------------------
     Boot
  ------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', async () => {
    exam = loadExamData();
    if (window.JCAHFontManager && exam) {
      try {
        window.JCAHFontManager.applyFont(exam);
      } catch (fontErr) {
        console.warn('[Exam Boot] Font error:', fontErr);
      }
    }
    if (!exam) {
      const targetEl = document.getElementById('jcah-exam-app') || document.body;
      targetEl.innerHTML = `<div class="p-8 text-center text-error">Error: No exam data found. Please run this exam from a published JCAH generator package or Author Studio.</div>`;
      return;
    }

    // v2.0b — build the section tabs from the exam's configured part counts
    SECTION_TABS = buildSectionTabs(exam);
    if (currentTabIdx >= SECTION_TABS.length) currentTabIdx = 0;

    if (exam.colorScheme) {
      document.body.setAttribute('data-theme', exam.colorScheme);
    }
    document.body.setAttribute('data-exam-type', exam.examType || 'complete');

    // Drain pending submissions from outbox if webhook is reachable
    if (typeof JCAHResults !== 'undefined' && typeof JCAHResults.flushOutbox === 'function') {
      try {
        JCAHResults.flushOutbox(exam).catch(e => console.warn('[Exam Boot] Outbox auto-flush:', e));
      } catch (_) {}
    }

    renderStartScreen();
  });

  function loadExamData() {
    // 0. Check sessionStorage for live preview from Author Studio
    try {
      if (typeof sessionStorage !== 'undefined') {
        const previewRaw = sessionStorage.getItem('__JCAH_PREVIEW_EXAM__');
        if (previewRaw) return JSON.parse(previewRaw);
      }
    } catch (_) {}
    // 1. Check window.__JCAH_EXAM__ / window.__JCAH_EXAM__ (embedded in generated packages)
    if (window.__JCAH_EXAM__) return window.__JCAH_EXAM__;
    if (window.__JCAH_EXAM__) return window.__JCAH_EXAM__;
    // 2. Check localStorage from Author Studio
    try {
      const raw = localStorage.getItem('__JCAH_TGENX_PROJECT__') || localStorage.getItem('jcah_exam_v1');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  /* -------------------------------------------------------
     1. Start Screen & Identification Form
  ------------------------------------------------------- */
  function _examLockId() {
    return (exam && (exam.id || exam.examId || exam.title)) ? String(exam.id || exam.examId || exam.title).replace(/\s+/g, '_').toLowerCase() : 'default';
  }

  function checkSpeakingBrowserSupport() {
    if (typeof SpeechHandler !== 'undefined' && typeof SpeechHandler.getBrowserSupport === 'function') {
      return SpeechHandler.getBrowserSupport();
    }
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    const isYandex = /YaBrowser|Yowser/i.test(ua);
    const hasSpeechRec = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const isFirefox = /Firefox/i.test(ua);
    const isOpera = /OPR|Opera/i.test(ua);
    const isEdge = /Edg\//i.test(ua);
    const isChrome = /Chrome\//i.test(ua) && !isYandex && !isOpera && !isEdge;
    const isBrave = typeof navigator !== 'undefined' && (!!navigator.brave || /Brave/i.test(ua));

    let browserName = 'Navegador Web';
    if (isYandex) browserName = 'Yandex Browser';
    else if (isEdge) browserName = 'Microsoft Edge';
    else if (isChrome) browserName = 'Google Chrome';
    else if (isFirefox) browserName = 'Mozilla Firefox';
    else if (isOpera) browserName = 'Opera';
    else if (isBrave) browserName = 'Brave';

    return {
      isCompatible: hasSpeechRec && !isYandex,
      isRecommended: (isChrome || isEdge || isBrave) && !isYandex,
      isYandex,
      hasSpeechRec,
      browserName,
      recommendedBrowsers: ['Google Chrome', 'Microsoft Edge', 'Brave']
    };
  }

  function isMobilePhoneDevice() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    const ua = (navigator.userAgent || navigator.vendor || window.opera || '').toLowerCase();
    
    // Explicit phone markers in user agent string
    const isPhoneUA = /iphone|ipod|windows phone|blackberry|bb10|mobile.*android|android.*mobile/i.test(ua);
    
    // Tablets (iPad Mini, iPad Air, Galaxy Tab) have smallest dimension >= 600px.
    // Smartphones have smallest physical dimension < 500px in CSS pixels.
    const screenMinDim = Math.min(
      (window.screen && window.screen.width) || window.innerWidth || 1024,
      (window.screen && window.screen.height) || window.innerHeight || 768
    );
    const hasTouch = Boolean(navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
    const isSmallTouchScreen = hasTouch && (screenMinDim < 600 || window.innerWidth < 600);

    return isPhoneUA || isSmallTouchScreen;
  }
  window.isMobilePhoneDevice = isMobilePhoneDevice;

  function renderMobileBlockedScreen(appEl) {
    const width = window.innerWidth || (window.screen && window.screen.width) || 390;
    const height = window.innerHeight || (window.screen && window.screen.height) || 844;

    appEl.innerHTML = `
      <div class="device-blocked-wrapper">
        <div class="device-blocked-card">
          <div class="device-blocked-icon-wrap">
            <span class="device-blocked-icon">💻</span>
            <span class="device-blocked-badge-no">📱✕</span>
          </div>

          <div class="device-blocked-chip">Tablets & Desktops Only</div>

          <h1 class="device-blocked-title">Desktop or Tablet Required</h1>
          <div class="device-blocked-subtitle">Se Requiere Computador o Tableta</div>

          <div class="device-blocked-notice">
            <p style="margin:0 0 10px 0;">
              <strong>EN:</strong> This examination is configured for <strong>tablets, laptops, or desktop computers</strong>. 
              Mobile phones are not permitted to ensure academic integrity, reading passage ergonomics, audio controls, and proctoring compliance.
            </p>
            <p style="margin:0;">
              <strong>ES:</strong> Esta evaluación requiere una <strong>tableta, computador portátil o de escritorio</strong>. 
              No está permitido presentar el examen en teléfonos móviles para garantizar la legibilidad de lecturas, controles de audio y supervisión.
            </p>
          </div>

          <div class="device-requirements-box">
            <div class="device-req-item valid">
              <span class="device-req-check">✓</span>
              <span>Desktop Computer / Computador de Escritorio</span>
            </div>
            <div class="device-req-item valid">
              <span class="device-req-check">✓</span>
              <span>Laptop / Computador Portátil</span>
            </div>
            <div class="device-req-item valid">
              <span class="device-req-check">✓</span>
              <span>Tablet Device / Tableta (iPad, Android Tablet ≥ 600px)</span>
            </div>
            <div class="device-req-item invalid">
              <span class="device-req-cross">✕</span>
              <span>Smartphone / Teléfono Móvil (Not Supported / No Permitido)</span>
            </div>
          </div>

          <div class="device-detected-pill">
            <span>Detected Screen: <strong>Mobile Viewport</strong> (${width} × ${height} px)</span>
          </div>

          <div class="device-blocked-footer">
            <button type="button" class="btn btn-primary" onclick="window.location.reload()" style="min-width:180px;">
              🔄 Refresh / Reintentar
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderStartScreen() {
    const appEl = document.getElementById('jcah-exam-app');
    if (!appEl) return;

    // Check device policy: ONLY Placement tests are mobile friendly and allowed on smartphones.
    // Complete assessments are restricted to tablets/desktops unless explicitly overridden.
    const isPlacement = (exam.examType === 'placement');
    const allowMobile = isPlacement || (exam.allowMobileDevices === true);
    if (!allowMobile && isMobilePhoneDevice()) {
      renderMobileBlockedScreen(appEl);
      return;
    }

    const isModern = (exam.examExperienceVersion !== 'standard');
    const speakingActive = Boolean(exam.speaking && exam.speaking.enabled !== false);
    const spSupport = speakingActive ? checkSpeakingBrowserSupport() : null;

    if (!isModern) {
      // =====================================================================
      // STANDARD / CLASSIC LEGACY START SCREEN
      // =====================================================================
      appEl.innerHTML = `
        <div class="exam-screen-view active" style="align-items:center;padding:var(--sp-6) var(--sp-4);min-height:100%;overflow-y:auto">
          <div class="start-screen-card">
            <div class="start-card-header">
              ${(exam.logoDataUrl || exam.customLogoUrl)
                ? `<img src="${escapeAttr(exam.logoDataUrl || exam.customLogoUrl)}" style="max-height:64px;margin-bottom:12px;object-fit:contain" alt="Institution Logo">`
                : `<div class="start-crest">${getIcon('building', 'width="48" height="48" style="color:var(--clr-primary)"')}</div>`}
              <h1 style="font-size:26px;font-weight:800;color:var(--clr-text)">${escapeHtml(exam.title || 'Evaluación de Suficiencia en Inglés')}</h1>
              <p class="text-muted text-sm mt-1">${escapeHtml(exam.course || 'Academia de Idiomas')} · Nivel ${escapeHtml(exam.level || 'B1-B2')}</p>

              <div class="start-cefr-strip">
                <span class="chip chip-a1">A1</span>
                <span class="chip chip-a2">A2</span>
                <span class="chip chip-b1">B1</span>
                <span class="chip chip-b2">B2</span>
              </div>
            </div>

            <div class="p-6">
              <!-- Assessment Overview Strip -->
              <div class="exam-orientation-card p-3 mb-4" style="background:var(--clr-surface-alt, #F8FAFC);border:1px solid var(--clr-border, #E2E8F0);border-radius:var(--radius);font-size:12px;">
                <div style="font-weight:700;color:var(--clr-primary);margin-bottom:6px;display:flex;align-items:center;gap:6px">
                  ${getIcon('info', 'width="14" height="14" style="vertical-align:-2px"')} <span>Assessment Overview / Información General</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;color:var(--clr-text)">
                  <div>⏱️ <strong>Time Limit:</strong> ${exam.timerMinutes || 60} min</div>
                  <div>📚 <strong>Sections:</strong> Vocab, Grammar, Reading, Listening${speakingActive ? ', Speaking' : ''}</div>
                  <div>🎯 <strong>Passing Score:</strong> ${exam.passingScore || 70}%</div>
                  <div>🛡️ <strong>Supervision:</strong> ${exam.antiCheatingEnabled ? 'Camera proctoring' : 'Standard delivery'}</div>
                </div>
              </div>

              <!-- Inline Error Box -->
              <div id="start-screen-inline-error" class="alert alert-danger mb-4" style="display:none;border:1.5px solid #ef4444;background:#fef2f2;color:#991b1b;padding:12px 14px;border-radius:8px;font-size:13px;align-items:center;gap:10px" role="alert"></div>

              ${exam.instructions ? `
                <div class="alert alert-info mb-4">
                  <span class="alert-icon">ℹ️</span>
                  <div>${escapeHtml(exam.instructions)}</div>
                </div>` : ''}

              ${(speakingActive && spSupport) ? (!spSupport.isCompatible ? `
                <div class="alert alert-danger mb-4" style="border:1.5px solid #ef4444;background:#fef2f2;color:#991b1b;padding:14px;border-radius:8px">
                  <div style="display:flex;gap:12px;align-items:flex-start">
                    <span style="font-size:24px;line-height:1">⚠️</span>
                    <div style="font-size:13px;line-height:1.5">
                      <strong style="font-size:14px;display:block;margin-bottom:4px;color:#b91c1c">Navegador no compatible con la sección de Speaking (${escapeHtml(spSupport.browserName)})</strong>
                      Este examen incluye una <strong>sección oral evaluativa (Speaking)</strong>.<br>
                      Para poder realizarla, abra el examen en <strong>Google Chrome</strong>, <strong>Microsoft Edge</strong> o <strong>Brave</strong>.
                    </div>
                  </div>
                </div>` : `
                <div class="alert alert-success mb-4" style="border:1px solid #10b981;background:#ecfdf5;color:#065f46;padding:10px 14px;border-radius:6px;font-size:12px;display:flex;align-items:center;gap:8px">
                  <span style="font-size:16px">✓</span>
                  <div><strong>Navegador Compatible:</strong> Micrófono y reconocimiento de voz listos para Speaking (${escapeHtml(spSupport.browserName)}).</div>
                </div>`) : ''}

              <form id="student-form" onsubmit="handleStartExam(event)">
                ${(exam.requireOccupation || exam.requireRank) ? `
                  <div class="form-field mb-3">
                    <label for="st-rank">Position or Occupation / Cargo u Ocupación *</label>
                    <input type="text" id="st-rank" required placeholder="e.g. Student, Engineer, Manager, Officer, Analyst...">
                  </div>` : ''}

                <div class="form-row">
                  <div class="form-field">
                    <label for="st-name">Student's First Name *</label>
                    <input type="text" id="st-name" required placeholder="e.g. Maria">
                  </div>
                  <div class="form-field">
                    <label for="st-lastname">Student's Last Name *</label>
                    <input type="text" id="st-lastname" required placeholder="e.g. Rodriguez">
                  </div>
                </div>

                ${(exam.examType === 'placement' || exam.collectEmail !== false) ? `
                <div class="form-row">
                  <div class="form-field">
                    <label for="st-id">Student ID / Code *</label>
                    <input type="text" id="st-id" required placeholder="e.g. 20240315">
                  </div>
                  <div class="form-field">
                    <label for="st-email">${exam.examType === 'placement' ? 'Institutional Email * (Results Delivered Here)' : 'Institutional Email *'}</label>
                    <input type="email" id="st-email" required placeholder="e.g. student@university.edu">
                  </div>
                </div>` : `
                <div class="form-row">
                  <div class="form-field">
                    <label for="st-id">Student ID / Code *</label>
                    <input type="text" id="st-id" required placeholder="e.g. 20240315">
                  </div>
                </div>`}

                ${isAccessCodeRequired(exam) ? `
                  <div class="form-field">
                    <label for="st-access-code">${exam.examType === 'placement' ? 'Authorized Promo Code / Access Key *' : 'Access Code *'}</label>
                    <input type="text" id="st-access-code" required placeholder="${exam.examType === 'placement' ? 'Enter the unique promo code assigned to you' : 'Enter the access code provided by your instructor'}" class="font-mono" autocomplete="off">
                  </div>` : ''}

                ${exam.examType === 'placement' ? `
                <div class="alert alert-info mb-3" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:8px;padding:12px;font-size:12.5px;line-height:1.5">
                  <strong>⚠️ Placement Assessment Security:</strong>
                  This diagnostic assessment is restricted to verified candidates. You must provide your full legal name, student ID, valid institutional email, and an active one-time promo code. Results will be officially indexed and transmitted to your email.
                </div>` : ''}

                <div class="form-field mb-3" style="display:flex;align-items:center;gap:8px">
                  <input type="checkbox" id="st-a11y-mode" onchange="window.__JCAH_ACCESSIBILITY_MODE__ = this.checked">
                  <label for="st-a11y-mode" style="margin:0;font-size:13px;cursor:pointer">
                    ♿ Accessibility Mode (permits assistive technology, screen readers, and native context menus)
                  </label>
                </div>

                ${exam.antiCheatingEnabled ? `
                  <div class="alert alert-warning mb-4">
                    <span class="alert-icon">${getIcon('camera')}</span>
                    <div>
                      <strong>Camera Supervision Enabled:</strong>
                      Camera access will be requested for identity verification and random snapshots during the exam.
                    </div>
                  </div>` : ''}

                <div class="privacy-consent-box p-3 mb-3 text-xs" style="background:var(--clr-surface-alt, #F8FAFC);border:1px solid var(--clr-border, #E2E8F0);border-radius:var(--radius);line-height:1.5">
                  <strong style="color:var(--clr-text)">Privacy Notice:</strong>
                  Candidate name, identification code, and assessment responses are processed solely for academic evaluation.
                  ${exam.antiCheatingEnabled ? 'Supervision photos (if enabled) are transmitted over HTTPS and stored only in the author\'s private Google Drive folder in accordance with institutional policy.' : 'No biometric or camera images are captured.'}
                </div>

                ${exam.antiCheatingEnabled ? `
                <div class="consent-check-box mb-4" style="padding:10px 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;text-align:left">
                  <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#1e293b;cursor:pointer">
                    <input type="checkbox" id="st-supervision-consent" style="margin-top:2px" required>
                    <span><strong>Consentimiento Informado / Informed Consent:</strong> Autorizo la captura periódica de fotografías mediante mi cámara web durante la evaluación para la supervisión académica de mi identidad. / I consent to supervision photo capture for academic identity verification during this exam.</span>
                  </label>
                </div>` : ''}

                <button type="submit" class="btn btn-primary btn-lg btn-block mt-2">
                  Start Exam →
                </button>
                ${exam.answerSource !== 'external' ? `
                <div class="text-xs text-muted text-center mt-2" style="font-size:11px;opacity:0.85">
                  📌 Formative Practice Mode (Local Scoring)
                </div>` : ''}
              </form>

              <p class="text-xs text-muted text-center mt-4">
                By clicking Start Exam, you agree that your answers and results report will be recorded in the institutional system.
              </p>
            </div>
          </div>
        </div>`;
    } else {
      // =====================================================================
      // MODERNIZED STITCH 2026 UX START SCREEN
      // =====================================================================
      appEl.innerHTML = `
        <div class="exam-screen-view active modern-portal-view" style="padding:0;min-height:100%;overflow-y:auto">
          <!-- Modern Top Portal Header -->
          <header class="modern-portal-header">
            <div class="modern-portal-brand">
              ${(exam.logoDataUrl || exam.customLogoUrl)
                ? `<img src="${escapeAttr(exam.logoDataUrl || exam.customLogoUrl)}" class="modern-portal-logo" alt="Institution Logo">`
                : `<div class="modern-portal-crest-badge">${getIcon('building', 'width="18" height="18" style="color:#fff"')}</div>`}
              <div>
                <span class="modern-portal-title">${escapeHtml(exam.title || 'Academic Assessment Portal')}</span>
                <span class="modern-portal-sub">${escapeHtml(exam.course || 'Academic Evaluation Matrix')} · Nivel ${escapeHtml(exam.level || 'B1-B2')}</span>
              </div>
            </div>
            <div class="modern-proctoring-pill">
              <span class="proctoring-pulse-dot"></span>
              <span>${exam.antiCheatingEnabled ? (exam.answerSource === 'external' ? 'Proctored Session Active · Server Graded' : 'Proctored Practice Session · Local Scoring') : (exam.answerSource === 'external' ? 'Standard Delivery · Server Graded' : 'Practice Delivery')}</span>
            </div>
          </header>

          <!-- Modern Main Content Container -->
          <main class="modern-portal-main">
            <!-- Hero Banner & Context Meta Tags Bento Strip -->
            <div class="modern-hero-card">
              <div class="modern-hero-flex">
                <div>
                  <div class="modern-badge-row">
                    <span class="modern-checkin-badge">Official Evaluation</span>
                    <span class="text-caption-meta text-muted">ID: ${escapeHtml(exam.id || 'EXAM-2026')}</span>
                  </div>
                  <h1 class="modern-hero-title">${escapeHtml(exam.title || 'Academic English Proficiency Assessment')}</h1>
                  <p class="modern-hero-lead">Please verify your candidate credentials, confirm integrity regulations, and complete verification before starting the assessment.</p>
                </div>

                <div class="modern-bento-strip">
                  <div class="modern-bento-item">
                    <div class="modern-bento-label">Target CEFR</div>
                    <div class="modern-bento-val">${escapeHtml(exam.level || 'B1-B2')}</div>
                  </div>
                  <div class="modern-bento-item">
                    <div class="modern-bento-label">Duration</div>
                    <div class="modern-bento-val">${exam.timerMinutes || 60} min</div>
                  </div>
                  <div class="modern-bento-item">
                    <div class="modern-bento-label">Passing Mark</div>
                    <div class="modern-bento-val" style="color:var(--clr-primary)">${exam.passingScore || 70}%</div>
                  </div>
                  <div class="modern-bento-item">
                    <div class="modern-bento-label">Proctoring</div>
                    <div class="modern-bento-val" style="color:${exam.antiCheatingEnabled ? 'var(--clr-accent, #10B981)' : 'var(--clr-text-muted)'}">${exam.antiCheatingEnabled ? '3-Phase Live' : 'Standard'}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Dual-Column Master Grid -->
            <div class="modern-portal-grid">
              <!-- LEFT COLUMN (7 Cols): Structure & Guidelines -->
              <div class="modern-col-left">
                <!-- What to Expect / Blueprint Card -->
                <div class="modern-card">
                  <div class="modern-card-header">
                    <div class="modern-card-title flex items-center gap-2">
                      ${getIcon('bookOpen', 'width="18" height="18" style="color:var(--clr-primary)"')}
                      <span>Assessment Structure &amp; Sections</span>
                    </div>
                    <span class="chip chip-primary text-xs">${SECTION_TABS ? SECTION_TABS.length : 4} Sections</span>
                  </div>

                  <div class="modern-section-grid">
                    <div class="modern-sec-item">
                      <div class="modern-sec-icon">📖</div>
                      <div>
                        <strong>Vocabulary</strong>
                        <div class="text-xs text-muted">${exam.vocabulary?.displayCount || exam.vocabulary?.questions?.length || 20} items · Diagnostic</div>
                      </div>
                    </div>
                    <div class="modern-sec-item">
                      <div class="modern-sec-icon">✏️</div>
                      <div>
                        <strong>Grammar</strong>
                        <div class="text-xs text-muted">${exam.grammar?.displayCount || exam.grammar?.questions?.length || 20} items · Syntax &amp; Usage</div>
                      </div>
                    </div>
                    <div class="modern-sec-item">
                      <div class="modern-sec-icon">📄</div>
                      <div>
                        <strong>Reading</strong>
                        <div class="text-xs text-muted">${exam.readingBanks?.length || 1} Part(s) · Academic Passages</div>
                      </div>
                    </div>
                    <div class="modern-sec-item">
                      <div class="modern-sec-icon">🎧</div>
                      <div>
                        <strong>Listening</strong>
                        <div class="text-xs text-muted">${exam.listeningBanks?.length || 1} Part(s) · High-Fidelity Audio</div>
                      </div>
                    </div>
                    ${speakingActive ? `
                    <div class="modern-sec-item" style="grid-column: 1 / -1">
                      <div class="modern-sec-icon">🎙️</div>
                      <div>
                        <strong>Speaking Assessment</strong>
                        <div class="text-xs text-muted">Adaptive CEFR Oral Evaluation · Voice-activated speech recognition</div>
                      </div>
                    </div>` : ''}
                  </div>
                </div>

                ${exam.instructions ? `
                <div class="modern-card">
                  <div class="modern-card-header">
                    <div class="modern-card-title flex items-center gap-2">
                      ${getIcon('info', 'width="18" height="18" style="color:var(--clr-primary)"')}
                      <span>Instructions &amp; Exam Guidelines</span>
                    </div>
                  </div>
                  <div class="text-sm" style="line-height:1.6;color:var(--clr-text)">
                    ${escapeHtml(exam.instructions)}
                  </div>
                </div>` : ''}

                ${(speakingActive && spSupport) ? (!spSupport.isCompatible ? `
                <div class="alert alert-danger" style="border:1.5px solid #ef4444;background:#fef2f2;color:#991b1b;padding:14px;border-radius:10px">
                  <div style="display:flex;gap:12px;align-items:flex-start">
                    <span style="font-size:24px;line-height:1">⚠️</span>
                    <div style="font-size:13px;line-height:1.5">
                      <strong style="font-size:14px;display:block;margin-bottom:4px;color:#b91c1c">Navegador no compatible con la sección de Speaking (${escapeHtml(spSupport.browserName)})</strong>
                      Este examen incluye una <strong>sección oral evaluativa (Speaking)</strong>.<br>
                      Para realizarla, abra el examen en <strong>Google Chrome</strong>, <strong>Microsoft Edge</strong> o <strong>Brave Browser</strong>.
                    </div>
                  </div>
                </div>` : `
                <div class="alert alert-success" style="border:1px solid #10b981;background:#ecfdf5;color:#065f46;padding:10px 14px;border-radius:8px;font-size:12px;display:flex;align-items:center;gap:8px">
                  <span style="font-size:16px">✓</span>
                  <div><strong>Navegador Compatible:</strong> Micrófono y reconocimiento de voz listos para la sección de Speaking (${escapeHtml(spSupport.browserName)}).</div>
                </div>`) : ''}

                <!-- Integrity rules -->
                <div class="modern-card" style="background:var(--clr-surface-alt, #F8FAFC)">
                  <div style="font-size:13px;font-weight:700;color:var(--clr-text);margin-bottom:6px">📋 Academic Integrity Code</div>
                  <div class="text-xs text-muted" style="line-height:1.5">
                    This evaluation is administered under strict institutional guidelines. Answers must be candidate's own work without external aids, dictionaries, secondary devices, or unauthorized tabs.
                  </div>
                </div>
              </div>

              <!-- RIGHT COLUMN (5 Cols): Verification Profile & Camera -->
              <div class="modern-col-right">
                <div class="modern-card">
                  <div class="modern-card-header">
                    <div class="modern-card-title flex items-center gap-2">
                      ${getIcon('userCheck', 'width="18" height="18" style="color:var(--clr-primary)"')}
                      <span>Candidate Identification</span>
                    </div>
                    <span class="text-xs text-muted">Required</span>
                  </div>

                  <!-- Inline Error Box -->
                  <div id="start-screen-inline-error" class="alert alert-danger mb-4" style="display:none;border:1.5px solid #ef4444;background:#fef2f2;color:#991b1b;padding:12px 14px;border-radius:8px;font-size:13px;align-items:center;gap:10px" role="alert"></div>

                  <form id="student-form" onsubmit="handleStartExam(event)">
                    ${(exam.requireOccupation || exam.requireRank) ? `
                      <div class="form-field mb-3">
                        <label for="st-rank">Position or Occupation / Cargo u Ocupación *</label>
                        <input type="text" id="st-rank" required placeholder="e.g. Student, Engineer, Manager, Officer, Analyst...">
                      </div>` : ''}

                    <div class="form-row">
                      <div class="form-field">
                        <label for="st-name">First Name *</label>
                        <input type="text" id="st-name" required placeholder="e.g. Maria">
                      </div>
                      <div class="form-field">
                        <label for="st-lastname">Last Name *</label>
                        <input type="text" id="st-lastname" required placeholder="e.g. Rodriguez">
                      </div>
                    </div>

                    ${(exam.examType === 'placement' || exam.collectEmail !== false) ? `
                    <div class="form-row">
                      <div class="form-field">
                        <label for="st-id">Student ID / Code *</label>
                        <input type="text" id="st-id" required placeholder="e.g. 20240315">
                      </div>
                      <div class="form-field">
                        <label for="st-email">${exam.examType === 'placement' ? 'Institutional Email * (Results Delivered Here)' : 'Institutional Email *'}</label>
                        <input type="email" id="st-email" required placeholder="e.g. student@university.edu">
                      </div>
                    </div>` : `
                    <div class="form-row">
                      <div class="form-field">
                        <label for="st-id">Student ID / Code *</label>
                        <input type="text" id="st-id" required placeholder="e.g. 20240315">
                      </div>
                    </div>`}

                    ${isAccessCodeRequired(exam) ? `
                      <div class="form-field mb-3">
                        <label for="st-access-code">${exam.examType === 'placement' ? 'Authorized Promo Code / Access Key *' : 'Access Code *'}</label>
                        <input type="text" id="st-access-code" required placeholder="${exam.examType === 'placement' ? 'Enter your unique promo code' : 'Enter the access code provided by your instructor'}" class="font-mono" autocomplete="off">
                      </div>` : ''}

                    ${exam.examType === 'placement' ? `
                    <div class="alert alert-info mb-3" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:8px;padding:12px;font-size:12.5px;line-height:1.5">
                      <strong>⚠️ Placement Assessment Security:</strong>
                      This diagnostic assessment is restricted to verified candidates. You must provide your full legal name, student ID, valid institutional email, and an active one-time promo code. Results will be officially indexed and transmitted to your email.
                    </div>` : ''}

                    <div class="form-field mb-3" style="display:flex;align-items:center;gap:8px">
                      <input type="checkbox" id="st-a11y-mode" onchange="window.__JCAH_ACCESSIBILITY_MODE__ = this.checked">
                      <label for="st-a11y-mode" style="margin:0;font-size:12px;cursor:pointer">
                        ♿ Accessibility Mode (permits assistive screen readers)
                      </label>
                    </div>

                    ${exam.antiCheatingEnabled ? `
                      <div class="modern-proctoring-card mb-4">
                        <div class="flex items-center justify-between mb-2">
                          <strong style="font-size:13px;color:var(--clr-text)">Optical Proctoring Active</strong>
                          <span class="chip chip-success text-xs" style="font-size:10px">3-Phase ID</span>
                        </div>
                        <div class="text-xs text-muted mb-3" style="line-height:1.4">
                          Camera access will be verified at start, with random checks during the exam, and on final submission. Please ensure your face is well lit and centered.
                        </div>
                        <div class="proctoring-face-guide-box" style="margin:8px 0;height:120px;background:#0f172a;border-radius:8px;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden">
                          <div class="face-oval-guide" style="width:70px;height:95px;border:2px dashed rgba(56,189,248,0.7);border-radius:50%;display:flex;align-items:center;justify-content:center">
                            <span style="font-size:10px;color:rgba(255,255,255,0.7);text-align:center">Face Guide</span>
                          </div>
                        </div>
                      </div>` : ''}

                    <div class="privacy-consent-box p-3 mb-3 text-xs" style="background:var(--clr-surface-alt, #F8FAFC);border:1px solid var(--clr-border, #E2E8F0);border-radius:8px;line-height:1.4">
                      <strong style="color:var(--clr-text)">Privacy Notice:</strong>
                      Candidate name, ID code, and responses are processed solely for academic grading and institutional reporting.
                      ${exam.antiCheatingEnabled ? 'Supervision photos (if enabled) are transmitted over HTTPS and stored only in the author\'s private Google Drive folder in accordance with institutional policy.' : 'No biometric or camera images are captured.'}
                    </div>

                    ${exam.antiCheatingEnabled ? `
                    <div class="consent-check-box mb-4" style="padding:10px 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;text-align:left">
                      <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#1e293b;cursor:pointer">
                        <input type="checkbox" id="st-supervision-consent" style="margin-top:2px" required>
                        <span><strong>Consentimiento Informado / Informed Consent:</strong> Autorizo la captura periódica de fotografías mediante mi cámara web durante la evaluación para la supervisión académica de mi identidad. / I consent to supervision photo capture for academic identity verification during this exam.</span>
                      </label>
                    </div>` : ''}

                    <button type="submit" class="btn btn-primary btn-lg btn-block modern-start-btn" style="padding:14px;font-size:15px;font-weight:700">
                      Verify Credentials &amp; Begin Exam →
                    </button>
                    ${exam.answerSource !== 'external' ? `
                    <div class="text-xs text-muted text-center mt-3" style="font-size:11px;opacity:0.85">
                      📌 Formative Practice Mode (Local Scoring)
                    </div>` : ''}
                  </form>
                </div>
              </div>
            </div>
          </main>
        </div>`;
    }

    // Brute-force lockout check — replace the start screen if device is locked
    const appEl2 = document.getElementById('jcah-exam-app');
    if (appEl2) JCAHLockout.renderLockScreenIfNeeded(_examLockId(), appEl2);
  }

  function isAccessCodeRequired(examObj) {
    if (!examObj) return false;
    if (examObj.examType === 'placement') return true;
    if (examObj.accessCodeEnabled === false) return false;
    if (examObj.accessCodeEnabled === true) {
      if (examObj.accessCodeType === 'url' || examObj.accessCodeType === 'google_sheets') {
        const u = (examObj.accessCodeUrl && String(examObj.accessCodeUrl).trim()) || (examObj.webhookUrl && String(examObj.webhookUrl).trim()) || (examObj.placementWebhookUrl && String(examObj.placementWebhookUrl).trim());
        return !!u;
      }
      return !!(examObj.accessCodeValue && String(examObj.accessCodeValue).trim());
    }
    if (examObj.accessCodeType === 'static' && examObj.accessCodeValue && String(examObj.accessCodeValue).trim()) return true;
    if (examObj.accessCodeType === 'url' || examObj.accessCodeType === 'google_sheets') {
      const u = (examObj.accessCodeUrl && String(examObj.accessCodeUrl).trim()) || (examObj.webhookUrl && String(examObj.webhookUrl).trim()) || (examObj.placementWebhookUrl && String(examObj.placementWebhookUrl).trim());
      return !!u;
    }
    return false;
  }

  /**
   * Remote Access Code Verification Helper
   * Attempts Fetch POST first, and falls back to JSONP for zero-CORS restriction on file:// URLs.
   */
  function verifyRemoteCode(url, payload) {
    return new Promise((resolve, reject) => {
      // 1. Try modern Fetch POST
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      })
      .then(async resp => {
        let data = null;
        try {
          data = await resp.json();
        } catch (_) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
        }
        if (data && typeof data.valid === 'boolean') {
          return data;
        }
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        throw new Error('Server POST does not support code verification: ' + (data && (data.error || data.message)));
      })
      .then(data => {
        resolve(data);
      })
      .catch(fetchErr => {
        console.warn('[JCAH] Fetch POST failed (likely CORS on file:// origin or unhandled endpoint), attempting JSONP fallback:', fetchErr);

        // 2. Fallback to JSONP (works seamlessly on file:/// and offline web packages)
        try {
          const cbName = '__jcah_ac_' + Math.random().toString(36).substring(2, 9);
          const script = document.createElement('script');
          let timer = null;

          window[cbName] = function(data) {
            clearTimeout(timer);
            if (script.parentNode) script.parentNode.removeChild(script);
            try { delete window[cbName]; } catch (_) {}
            resolve(data);
          };

          script.onerror = function() {
            clearTimeout(timer);
            if (script.parentNode) script.parentNode.removeChild(script);
            try { delete window[cbName]; } catch (_) {}
            reject(new Error('Connection error during remote code verification'));
          };

          const sep = url.indexOf('?') === -1 ? '?' : '&';
          script.src = `${url}${sep}action=verify_code&code=${encodeURIComponent(payload.code)}&studentId=${encodeURIComponent(payload.studentId || '')}&studentEmail=${encodeURIComponent(payload.studentEmail || '')}&studentName=${encodeURIComponent(payload.studentName || '')}&studentFirstName=${encodeURIComponent(payload.studentFirstName || '')}&studentLastName=${encodeURIComponent(payload.studentLastName || '')}&position=${encodeURIComponent(payload.position || '')}&apiKey=${encodeURIComponent(payload.apiKey || '')}&callback=${cbName}`;

          timer = setTimeout(() => {
            if (script.parentNode) script.parentNode.removeChild(script);
            try { delete window[cbName]; } catch (_) {}
            reject(new Error('Verification timeout'));
          }, 12000);

          document.head.appendChild(script);
        } catch (jsonpErr) {
          reject(jsonpErr);
        }
      });
    });
  }

  function showStartInlineError(msg) {
    const errBox = document.getElementById('start-screen-inline-error');
    if (errBox) {
      errBox.innerHTML = `<span class="alert-icon">⚠️</span><div>${escapeHtml(msg).replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>')}</div>`;
      errBox.style.display = 'flex';
      errBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (typeof alert === 'function') {
      try { alert(msg); } catch (_) {}
    }
  }

  window.handleStartExam = async function(e) {
    e.preventDefault();

    // Device restriction guard: ONLY Placement tests are allowed on smartphones
    const isPlacementTest = (exam.examType === 'placement');
    const allowMobileDevice = isPlacementTest || (exam.allowMobileDevices === true);
    if (!allowMobileDevice && isMobilePhoneDevice()) {
      showStartInlineError('This examination cannot be taken on a smartphone. Please open this exam on a tablet, laptop, or desktop computer.');
      return;
    }

    // Brute-force lockout guard — abort immediately if device is currently locked
    {
      const _lockAppEl = document.getElementById('jcah-exam-app');
      if (_lockAppEl && JCAHLockout.renderLockScreenIfNeeded(_examLockId(), _lockAppEl)) return;
    }

    // Trigger fullscreen synchronously inside user gesture loop
    JCAHSupervision.requestFullscreen();

    const rankEl = document.getElementById('st-rank');
    const occupationRequired = Boolean(exam.requireOccupation || exam.requireRank);
    const position = rankEl ? rankEl.value.trim() : 'N/A';
    const rank = position;
    const name = document.getElementById('st-name').value.trim();
    const lastName = document.getElementById('st-lastname') ? document.getElementById('st-lastname').value.trim() : '';
    const id = document.getElementById('st-id').value.trim();
    const emailEl = document.getElementById('st-email');
    const email = emailEl ? emailEl.value.trim() : (exam.defaultEmail || 'candidate@assessment.local');
    const fullName = lastName ? `${name} ${lastName}` : name;

    const a11yEl = document.getElementById('st-a11y-mode');
    if (a11yEl && a11yEl.checked) {
      window.__JCAH_ACCESSIBILITY_MODE__ = true;
    }

    if (isPlacementTest) {
      if (!name || name.length < 2 || !lastName || lastName.length < 2) {
        showStartInlineError('Placement Test Security: Full legal First Name and Last Name are required (minimum 2 characters each).');
        return;
      }
      if (!id || id.length < 1) {
        showStartInlineError('Placement Test Security: Valid Student ID / Code is required.');
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        showStartInlineError('Placement Test Security: A valid institutional email is required so your diagnostic results can be indexed and sent to you.');
        return;
      }
    } else {
      if (!name || !lastName || !id || (emailEl && !email) || (occupationRequired && !position)) {
        showStartInlineError('Please fill in all identification fields.');
        return;
      }
    }

    if (exam.antiCheatingEnabled) {
      const consentChk = document.getElementById('st-supervision-consent');
      if (consentChk && !consentChk.checked) {
        showStartInlineError('Debe dar su consentimiento informado marcando la casilla de supervisión de cámara para iniciar la evaluación.');
        return;
      }
    }

    // Verify speaking browser compatibility before starting
    if (exam.speaking && exam.speaking.enabled !== false) {
      const spSupport = checkSpeakingBrowserSupport();
      if (!spSupport.isCompatible) {
        const proceed = confirm(
          `⚠️ ATENCIÓN: NAVEGADOR NO COMPATIBLE CON SPEAKING\n\n` +
          `Su navegador actual (${spSupport.browserName}) no es compatible con el motor de reconocimiento por voz requerido para la evaluación oral.\n\n` +
          `Si continúa en este navegador, no podrá grabar sus respuestas orales y su calificación en Speaking será 0 / A0.\n\n` +
          `Navegadores 100% compatibles recomendados:\n• Google Chrome\n• Microsoft Edge\n• Brave Browser\n\n` +
          `¿Desea continuar de todos modos bajo su responsabilidad o prefiere abrir el examen en uno de los navegadores recomendados?`
        );
        if (!proceed) return;
      }
    }

    // Verify Access Code if required
    let verifiedCode = '';
    if (isAccessCodeRequired(exam)) {
      const codeInput = document.getElementById('st-access-code');
      const inputCode = codeInput ? codeInput.value.trim() : '';
      if (!inputCode) {
        showStartInlineError(isPlacementTest ? 'Please enter your authorized promo code assigned by your instructor.' : 'Please enter the access code provided by your instructor.');
        return;
      }

      const isRemoteAccess = (exam.accessCodeType === 'google_sheets' || exam.accessCodeType === 'url' || isPlacementTest);

      // Mode 1: Static Direct Password Verification (Offline - Forbidden for Placement Test)
      if (!isRemoteAccess && (exam.accessCodeType === 'static' || (!exam.accessCodeType && exam.accessCodeValue))) {
        if (isPlacementTest) {
          showStartInlineError('Placement Test Security: Placement tests require online server-verified promo codes. Offline access is prohibited.');
          return;
        }
        const validCodes = (exam.accessCodeValue || '')
          .split(',')
          .map(c => c.trim().toUpperCase())
          .filter(Boolean);

        // Fail-closed: If validCodes is empty or code does not match, access is denied
        if (validCodes.length === 0 || !validCodes.includes(inputCode.toUpperCase())) {
          const lk = JCAHLockout.recordFailure(_examLockId());
          if (lk.locked) {
            const appEl = document.getElementById('jcah-exam-app');
            if (appEl) JCAHLockout.renderLockScreenIfNeeded(_examLockId(), appEl);
          } else {
            const left = lk.remaining;
            showStartInlineError(`Incorrect access code. Please check the code provided by your instructor.\n\n⚠️ Warning: ${lk.failures} of ${JCAHLockout.MAX_FAILURES} attempts used. Access will be locked for 1 hour after ${left} more failed attempt${left === 1 ? '' : 's'}.`);
          }
          return;
        }
        verifiedCode = inputCode;
      }
      // Mode 2: Remote Webhook Verification (Google Apps Script / Google Sheets)
      else {
        const remoteUrl = (isPlacementTest && exam.placementWebhookUrl)
          ? exam.placementWebhookUrl
          : ((exam.accessCodeUrl && exam.accessCodeUrl.trim()) || (exam.webhookUrl && exam.webhookUrl.trim()));
        if (!remoteUrl) {
          if (isPlacementTest) {
            showStartInlineError('Placement Test Security: No active webhook URL is configured for promo code verification. Please contact the exam administrator.');
            return;
          }
          showStartInlineError('No active verification endpoint configured for access codes.');
          return;
        }

        try {
          const res = await verifyRemoteCode(remoteUrl, {
            action: 'verify_code',
            code: inputCode,
            studentId: id,
            studentEmail: email,
            studentName: fullName,
            studentFirstName: name,
            studentLastName: lastName,
            position: position,
            occupation: position,
            userRank: rank,
            apiKey: (exam.webhookApiKey || exam.apiKey || '').trim()
          });
          if (!res || res.valid !== true) {
            const lk = JCAHLockout.recordFailure(_examLockId());
            if (lk.locked) {
              const appEl = document.getElementById('jcah-exam-app');
              if (appEl) JCAHLockout.renderLockScreenIfNeeded(_examLockId(), appEl);
            } else {
              const left = lk.remaining;
              const serverMsg = (res && res.message) ? res.message : 'Invalid or unauthorized access code. Please verify your promo code or contact your administrator.';
              showStartInlineError(`${serverMsg}\n\n⚠️ Warning: ${lk.failures} of ${JCAHLockout.MAX_FAILURES} attempts used. Access will be locked for 1 hour after ${left} more failed attempt${left === 1 ? '' : 's'}.`);
            }
            return;
          }
          verifiedCode = inputCode;
        } catch (err) {
          console.warn('Access code verification error:', err);
          const lk = JCAHLockout.recordFailure(_examLockId());
          showStartInlineError('Could not verify access code with server. An active internet connection and authorized code are required to start this evaluation.\n\nError details: ' + (err.message || 'Network error'));
          return;
        }
      }
    }

    // Access code accepted — clear the failure counter
    JCAHLockout.clearFailures(_examLockId());

    const studentInfo = { 
      name: fullName, 
      firstName: name, 
      lastName: lastName, 
      id, 
      email, 
      position, 
      occupation: position, 
      rank, 
      userRank: rank, 
      studentRank: rank,
      accessCode: verifiedCode
    };
    exam.__verifiedAccessCode = verifiedCode;

    // Answer Service Initialization (Mode A: Local vs Mode B: External)
    if (typeof JCAHAnswerService !== 'undefined') {
      const ansMode = exam.answerSource || 'local';
      const ansConfig = exam.externalAnswerConfig || { apiEndpoint: exam.webhookUrl };
      const ansRes = await JCAHAnswerService.initialize(ansMode, ansConfig, exam);
      if (!ansRes.success && ansMode === 'external' && !ansConfig.fallbackToLocal) {
        alert('External Answer Key Connection Error:\n' + (ansRes.error || 'Could not reach server.') + '\n\nPlease check your internet connection or contact your instructor.');
        return;
      }
    }

    // Initialize or resume attempt for candidate
    attempt = JCAHAttemptStore.initAttempt(exam, studentInfo);
    attempt.position = position;
    attempt.occupation = position;
    attempt.userRank = rank;
    attempt.studentRank = rank;
    attempt.rank = rank;
    attempt.accessCode = (isAccessCodeRequired(exam) && document.getElementById('st-access-code'))
      ? document.getElementById('st-access-code').value.trim()
      : (attempt.accessCode || '');
    window.__CURRENT_ATTEMPT__ = attempt;
    JCAHAttemptStore.saveAttempt(attempt);

    // Anti-cheating & Camera ID Verification Setup
    const cameraRequired = (exam.examType !== 'placement') && ((typeof JCAHSupervision !== 'undefined' && JCAHSupervision.isCameraProctoringEnabled)
      ? JCAHSupervision.isCameraProctoringEnabled(exam)
      : (exam.antiCheatingEnabled === true || exam.antiCheatingEnabled === 'true'));

    if (cameraRequired) {
      attempt.supervisionConsent = true;
      attempt.supervisionConsentGivenAt = new Date().toISOString();
      JCAHAttemptStore.saveAttempt(attempt);

      // Initialize supervision so _exam and _attempt are ready
      JCAHSupervision.init(exam, attempt, handleViolation, handleTermination);

      const camOk = await JCAHSupervision.startCamera();
      if (!camOk) {
        const exemptChoice = (typeof confirm !== 'undefined') && confirm(
          'Camera access could not be established / No se detectó cámara o el acceso fue denegado.\n\n¿Posee un código de exención otorgado por el supervisor para realizar el examen sin cámara web?\nIf you have a proctor exemption code to proceed without a webcam, click OK.'
        );
        if (exemptChoice) {
          const authCode = (typeof prompt !== 'undefined')
            ? prompt('Ingrese código de exención otorgado por el supervisor / Enter proctor exemption code:')
            : null;
          if (authCode && authCode.trim()) {
            const authTrimmed = authCode.trim();
            const codeUpper = authTrimmed.toUpperCase();
            const configuredCodes = (exam && exam.proctorExemptions ? String(exam.proctorExemptions).split(',') : [])
              .map(c => c.trim().toUpperCase())
              .filter(Boolean);
            const examPasscode = (exam && (exam.passcode || exam.accessCode)) ? String(exam.passcode || exam.accessCode).trim().toUpperCase() : '';

            let valid = false;
            let msg = '';

            // 1. Local/offline authorization (author-configured exemption codes or exam passcode)
            if (configuredCodes.includes(codeUpper) || (examPasscode && codeUpper === examPasscode)) {
              valid = true;
              msg = 'Exención de cámara autorizada por el supervisor / Proctor camera exemption authorized.';
            } else {
              const webhookUrl = (typeof JCAHSupervision !== 'undefined' && JCAHSupervision.getWebhookUrl) ? JCAHSupervision.getWebhookUrl() : (exam.webhookUrl || '');
              if (webhookUrl) {
                try {
                  const resp = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: 'verify_exemption',
                      code: authTrimmed,
                      studentId: id
                    })
                  });
                  const resJson = await resp.json();
                  valid = resJson && (resJson.valid === true || resJson.success === true);
                  msg = resJson && resJson.message ? resJson.message : (valid ? 'Exención autorizada.' : 'Código inválido.');
                } catch (exErr) {
                  console.warn('Exemption check network error:', exErr);
                  valid = false;
                  msg = 'Error de conexión al verificar el código de exención.';
                }
              } else {
                valid = false;
                msg = 'Código de exención inválido o no reconocido.';
              }
            }

            if (valid) {
              attempt.cameraExempt = true;
              attempt.cameraExemptReason = 'Proctor Exemption: ' + authCode.trim();
              attempt.cameraExemptionCode = authCode.trim();
              attempt.cameraExemptAt = new Date().toISOString();
              JCAHAttemptStore.saveAttempt(attempt);
              if (typeof alert !== 'undefined') alert(msg || 'Exención autorizada por el supervisor.');
            } else {
              if (typeof alert !== 'undefined') alert(msg || 'Código de exención inválido o no reconocido. No se puede iniciar la evaluación sin cámara.');
              return;
            }
          } else {
            return;
          }
        } else {
          if (typeof alert !== 'undefined') alert('Camera access is required to take this proctored exam.\n\nSe requiere acceso a la cámara obligatoriamente para realizar esta evaluación supervisada.\n\nPor favor permita el acceso a la cámara en su navegador o verifique que el dispositivo esté conectado.');
          return;
        }
      }

      if (!attempt.cameraExempt) {
        // Show Identity Verification Modal with Snapshot Info & ID Reference Image
        if (typeof JCAHSupervision.showIdentityVerificationModal === 'function') {
          const verified = await JCAHSupervision.showIdentityVerificationModal(exam);
          if (!verified) {
            if (typeof JCAHSupervision.stopCamera === 'function') {
              JCAHSupervision.stopCamera();
            }
            return; // Student cancelled or verification failed
          }
        } else {
          const initialPhoto = await JCAHSupervision.capturePhoto('initial');
          if (!initialPhoto) {
            alert('Camera verification error. Could not capture initial snapshot.\n\nError de verificación de cámara: No se pudo capturar la fotografía inicial.');
            if (typeof JCAHSupervision.stopCamera === 'function') {
              JCAHSupervision.stopCamera();
            }
            return;
          }
        }
      }
    } else {
      JCAHSupervision.init(exam, attempt, handleViolation, handleTermination);
    }

    // Launch main exam shell
    renderExamShell();

    // Attach stream to active exam navbar preview
    if (cameraRequired) {
      JCAHSupervision.attachVideoStream();
    }
  };

  /* -------------------------------------------------------
     Nav Dropdowns & Section Tabs Helper
  ------------------------------------------------------- */
  window.toggleNavDropdown = function(dropdownId, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const wasOpen = dropdown.classList.contains('open');
    document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
    if (!wasOpen) {
      dropdown.classList.add('open');
    }
  };

  window.selectNavDropdownItem = function(tabIdx) {
    document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
    switchSection(tabIdx);
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown')) {
      document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
    }
  });

  function renderSectionNavTabs() {
    const isModern = (exam && exam.examExperienceVersion !== 'standard');
    
    const readingIndices = [];
    const listeningIndices = [];
    SECTION_TABS.forEach((tab, idx) => {
      if (tab.type === 'reading') readingIndices.push(idx);
      else if (tab.type === 'listening') listeningIndices.push(idx);
    });

    let html = '';
    let i = 0;
    while (i < SECTION_TABS.length) {
      const tab = SECTION_TABS[i];
      if (tab.type === 'reading' && readingIndices.length > 1) {
        const isReadingActive = readingIndices.includes(currentTabIdx);
        const activeTab = isReadingActive ? SECTION_TABS[currentTabIdx] : null;
        const triggerLabel = activeTab ? activeTab.label : 'Reading';
        
        html += `
          <div class="nav-dropdown" id="nav-dropdown-reading">
            <button type="button" class="tab-pill nav-dropdown-trigger ${isReadingActive ? 'active' : ''}"
                    id="nav-dropdown-trigger-reading"
                    onclick="toggleNavDropdown('nav-dropdown-reading', event)">
              ${isModern ? '<span class="dot"></span>' : ''}
              <span class="dropdown-trigger-text">${escapeHtml(triggerLabel)}</span>
              <svg class="dropdown-caret" width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
              </svg>
            </button>
            <div class="nav-dropdown-menu" id="nav-dropdown-menu-reading">
              ${readingIndices.map(rIdx => {
                const rTab = SECTION_TABS[rIdx];
                return `
                  <button type="button" class="nav-dropdown-item ${rIdx === currentTabIdx ? 'active' : ''}"
                          id="tab-btn-${rIdx}"
                          onclick="selectNavDropdownItem(${rIdx})">
                    <span>${escapeHtml(rTab.label)}</span>
                    <span class="part-status-badge" id="part-status-${rIdx}"></span>
                  </button>`;
              }).join('')}
            </div>
          </div>`;
        i += readingIndices.length;
        continue;
      }

      if (tab.type === 'listening' && listeningIndices.length > 1) {
        const isListeningActive = listeningIndices.includes(currentTabIdx);
        const activeTab = isListeningActive ? SECTION_TABS[currentTabIdx] : null;
        const triggerLabel = activeTab ? activeTab.label : 'Listening';

        html += `
          <div class="nav-dropdown" id="nav-dropdown-listening">
            <button type="button" class="tab-pill nav-dropdown-trigger ${isListeningActive ? 'active' : ''}"
                    id="nav-dropdown-trigger-listening"
                    onclick="toggleNavDropdown('nav-dropdown-listening', event)">
              ${isModern ? '<span class="dot"></span>' : ''}
              <span class="dropdown-trigger-text">${escapeHtml(triggerLabel)}</span>
              <svg class="dropdown-caret" width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
              </svg>
            </button>
            <div class="nav-dropdown-menu" id="nav-dropdown-menu-listening">
              ${listeningIndices.map(lIdx => {
                const lTab = SECTION_TABS[lIdx];
                return `
                  <button type="button" class="nav-dropdown-item ${lIdx === currentTabIdx ? 'active' : ''}"
                          id="tab-btn-${lIdx}"
                          onclick="selectNavDropdownItem(${lIdx})">
                    <span>${escapeHtml(lTab.label)}</span>
                    <span class="part-status-badge" id="part-status-${lIdx}"></span>
                  </button>`;
              }).join('')}
            </div>
          </div>`;
        i += listeningIndices.length;
        continue;
      }

      html += `
        <button type="button" class="tab-pill ${i === currentTabIdx ? 'active' : ''}"
                id="tab-btn-${i}" onclick="switchSection(${i})">
          ${isModern ? '<span class="dot"></span>' : ''}
          ${escapeHtml(tab.label)}
        </button>`;
      i++;
    }

    return html;
  }

  /* -------------------------------------------------------
     2. Main Exam Shell (Header, Tabs, Section View, Timer)
  ------------------------------------------------------- */
  function renderExamShell() {
    const appEl = document.getElementById('jcah-exam-app');
    if (!appEl) return;

    const isModern = (exam && exam.examExperienceVersion !== 'standard');

    appEl.innerHTML = `
      <!-- Fixed Header Navbar -->
      <header class="exam-header">
        <div class="exam-brand">
          ${(exam.logoDataUrl || exam.customLogoUrl) ? `<img src="${escapeAttr(exam.logoDataUrl || exam.customLogoUrl)}" class="exam-brand-logo" alt="Institution Logo">` : ''}
          <span class="exam-brand-title">${escapeHtml(exam.title || 'JCAH Exam')}</span>
        </div>

        <!-- Section Tabs (with Dropdowns for Multi-Part Reading / Listening) -->
        <nav class="exam-nav-tabs" id="exam-tab-bar">
          ${renderSectionNavTabs()}
        </nav>

        <!-- Timer & Controls -->
        <div class="exam-header-actions">
          <div class="timer-badge" id="exam-timer-badge" aria-live="polite">
            ${getIcon('clock', 'width="16" height="16" style="margin-right:4px;vertical-align:-2px"')} <span id="timer-display" aria-live="polite">${JCAHScoring.formatTime(attempt.timeRemainingSeconds)}</span>
          </div>

          <button type="button" class="qmap-toggle-btn" onclick="toggleQuestionMap()" title="Question Map">
            ${getIcon('barChart', 'width="16" height="16" style="margin-right:4px;vertical-align:-2px"')} Map
          </button>

          <button type="button" class="btn btn-danger btn-sm" onclick="confirmSubmitExam()">
            Submit Answers
          </button>
        </div>
      </header>

      ${isModern ? `
      <!-- Modern Stitch Progress Strip -->
      <section class="stitch-progress-strip" id="modern-progress-strip">
        <div class="stitch-progress-left">
          <div class="stitch-progress-text" id="modern-prog-text">
            Question 1 of 1 <span>(0% completed)</span>
          </div>
          <div class="stitch-progress-bar-wrap">
            <div class="stitch-progress-bar-fill" id="modern-prog-bar" style="width: 0%;"></div>
          </div>
        </div>

        <div class="stitch-progress-right">
          <div class="stitch-breadcrumb-sec" id="modern-sec-breadcrumb">
            <span>Section 1: Vocabulary</span>
          </div>
          <span>•</span>
          <div class="stitch-proctor-pill">
            <span class="stitch-pulse-dot"></span>
            <span>PROCTOR VERIFIED</span>
          </div>
        </div>
      </section>
      ` : `
      <!-- Discrete Section Progress Bar -->
      <div class="section-progress-container" id="section-progress-container" style="background:var(--clr-surface-alt, #f8fafc);border-bottom:1px solid var(--clr-border, #e2e8f0);padding:5px 16px;display:flex;align-items:center;justify-content:space-between;font-size:12px;position:relative;z-index:10" role="progressbar" aria-label="Section Progress">
        <div style="display:flex;align-items:center;gap:12px;flex:1;max-width:560px">
          <span id="sec-prog-label" style="font-weight:600;color:var(--clr-text, #1e293b);white-space:nowrap;font-size:11.5px">Progress:</span>
          <div style="flex:1;background:rgba(0,0,0,0.08);border-radius:999px;height:7px;overflow:hidden;position:relative">
            <div id="sec-prog-fill" style="width:0%;height:100%;background:var(--clr-primary, #1B4F8A);border-radius:999px;transition:width 0.25s ease"></div>
          </div>
          <span id="sec-prog-count" style="font-family:var(--font-mono, monospace);font-size:11px;font-weight:700;color:var(--clr-text-muted, #64748b);white-space:nowrap">0 / 0 (0%)</span>
        </div>
        <div id="sec-prog-status" style="font-size:11px;font-weight:600;color:var(--clr-primary, #1B4F8A)"></div>
      </div>
      `}

      <!-- Main Content View Area -->
      <div class="exam-main-container" id="exam-main-content">
        <!-- Rendered dynamically -->
      </div>

      <!-- Slide-in Question Map Panel -->
      <div class="qmap-panel" id="qmap-panel">
        <div class="qmap-header">
          <span class="fw-700 text-sm">Question Map</span>
          <button type="button" class="btn btn-ghost btn-sm" onclick="toggleQuestionMap()">${getIcon('x', 'width="16" height="16"')}</button>
        </div>
        <div class="qmap-grid" id="qmap-grid-dots"></div>
        <div class="qmap-legend">
          <span>${getIcon('circle', 'width="12" height="12" style="margin-right:4px;vertical-align:-1px;color:var(--clr-text-muted)"')} Unanswered</span>
          <span style="color:var(--clr-primary)">${getIcon('circleDot', 'width="12" height="12" style="margin-right:4px;vertical-align:-1px"')} Answered</span>
          <span style="color:var(--clr-warning)">${getIcon('flag', 'width="12" height="12" style="margin-right:4px;vertical-align:-1px;fill:currentColor"')} Flagged</span>
        </div>
      </div>

      <!-- Camera Preview Widget (Draggable Floating Window) -->
      ${exam.antiCheatingEnabled ? `
        <div id="camera-preview-container" class="camera-preview-container" title="Drag to reposition camera feed">
          <div class="camera-preview-header">
            <span style="display:flex;align-items:center;gap:4px">
              <span class="camera-preview-live-dot"></span>
              <span>LIVE PROCTOR</span>
            </span>
            <span class="camera-preview-drag-hint">⋮⋮</span>
          </div>
          <video id="camera-video" autoplay playsinline muted></video>
        </div>` : ''}

      <!-- Violation Overlay -->
      <div class="violation-overlay" id="violation-overlay" role="alertdialog" aria-modal="true" aria-labelledby="violation-title">
        <div class="violation-box">
          <h2 id="violation-title" style="font-size:24px;color:#FCA5A5;margin-bottom:8px">${getIcon('alertTriangle', 'width="24" height="24" style="margin-right:6px;vertical-align:-3px"')} Security Warning</h2>
          <p id="violation-reason-text" class="mb-4">A security violation has been detected.</p>
          <p class="text-sm text-muted mb-6">
            This exam must remain in fullscreen at all times. A second violation will <strong style="color:#FCA5A5">automatically terminate your exam and submit your current answers</strong>.
          </p>
          <button type="button" class="btn btn-danger btn-block" onclick="dismissViolationOverlay()" aria-label="Understood — continue exam">
            Understood — Return to Exam (Enable Fullscreen)
          </button>
        </div>
      </div>

      <!-- Accessible Submission Confirmation Modal -->
      <div class="modal-overlay" id="submission-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="modal-submit-title">
        <div class="modal p-6 text-center" style="max-width:480px">
          <div style="margin-bottom:12px">${getIcon('upload', 'width="44" height="44" style="color:var(--clr-primary)"')}</div>
          <h2 id="modal-submit-title" style="font-size:22px;font-weight:800;margin-bottom:8px">Submit Your Exam?</h2>
          <p id="modal-submit-desc" class="text-muted text-sm mb-4">
            Once submitted, your scores will be calculated and you will not be able to modify your answers.
          </p>
          <div id="modal-unanswered-alert" class="alert alert-warning mb-6 text-left" style="display:none">
            <span class="alert-icon">${getIcon('alertTriangle')}</span>
            <div>
              <strong id="modal-unanswered-count">You have unanswered questions.</strong>
              <div class="text-xs mt-1">We recommend reviewing the question map before submitting.</div>
            </div>
          </div>
          <div id="modal-answered-alert" class="alert alert-success mb-6 text-left" style="display:none">
            <span class="alert-icon">${getIcon('check')}</span>
            <div>
              <strong>All questions have been answered!</strong>
              <div class="text-xs mt-1">You are ready to submit your results.</div>
            </div>
          </div>
          <div class="flex gap-3 justify-center">
            <button type="button" class="btn btn-ghost" onclick="closeSubmitModal()" aria-label="Review questions and cancel submission">
              Review Questions
            </button>
            <button type="button" class="btn btn-primary" onclick="proceedSubmitExam()" aria-label="Confirm and submit exam">
              Yes, Submit Exam ${getIcon('check', 'width="16" height="16" style="margin-left:4px;vertical-align:-2px"')}
            </button>
          </div>
        </div>
      </div>

      <!-- Listening Section Play Limit Notice Modal -->
      <div class="modal-overlay" id="listening-notice-modal" role="dialog" aria-modal="true" aria-labelledby="modal-listening-title">
        <div class="modal p-6 text-center" style="max-width:480px">
          <div style="margin-bottom:12px">${getIcon('headphones', 'width="44" height="44" style="color:var(--clr-primary)"')}</div>
          <h2 id="modal-listening-title" style="font-size:22px;font-weight:800;margin-bottom:8px">Listening Section</h2>
          <p id="modal-listening-desc" class="text-muted text-sm mb-4">
            Please note that for the listening section, you will be able to listen to the recording only <strong id="modal-listening-limit-text" style="color:var(--clr-primary);font-size:16px;">2 times</strong>.
          </p>
          <div class="alert alert-info mb-6 text-left" style="font-size:13px">
            <span class="alert-icon">ℹ️</span>
            <div>
              Ensure your headphones or speakers are properly configured before playing. Audio cannot be paused during playback (only played or stopped).
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-block" onclick="dismissListeningNoticeModal()" aria-label="I understand, continue to listening section">
            Got It, Start Listening →
          </button>
        </div>
      </div>`;

    // Bind question callbacks
    JCAHQuestions.registerCallbacks(handleQuestionAnswer, handleQuestionFlag);
    JCAHAudio.setPlayCountCallback(handleAudioPlayCount);

    // v2.0b — mark the attempt as in progress (translation guard stays active)
    window.__JCAH_EXAM_STATE__ = 'in_progress';

    // Start countdown timer
    startTimer();

    // Render active section
    switchSection(attempt.currentSectionIdx || 0);
    updateSectionProgressBar();

    if (exam.antiCheatingEnabled) {
      setTimeout(initDraggableCamera, 60);
    }
  }

  function initDraggableCamera() {
    const container = document.getElementById('camera-preview-container');
    if (!container || container._hasDragInit) return;
    container._hasDragInit = true;

    let isDragging = false;
    let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

    function onPointerDown(e) {
      if (e.type === 'mousedown' && e.button !== 0) return;
      isDragging = true;
      const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

      startX = clientX;
      startY = clientY;

      const rect = container.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      container.style.right = 'auto';
      container.style.bottom = 'auto';
      container.style.left = initialLeft + 'px';
      container.style.top = initialTop + 'px';

      document.addEventListener('mousemove', onPointerMove);
      document.addEventListener('mouseup', onPointerUp);
      document.addEventListener('touchmove', onPointerMove, { passive: false });
      document.addEventListener('touchend', onPointerUp);
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault();
      const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

      let newLeft = initialLeft + (clientX - startX);
      let newTop = initialTop + (clientY - startY);

      const maxLeft = window.innerWidth - container.offsetWidth - 8;
      const maxTop = window.innerHeight - container.offsetHeight - 8;
      newLeft = Math.max(8, Math.min(newLeft, maxLeft));
      newTop = Math.max(8, Math.min(newTop, maxTop));

      container.style.left = newLeft + 'px';
      container.style.top = newTop + 'px';
    }

    function onPointerUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onPointerMove);
      document.removeEventListener('mouseup', onPointerUp);
      document.removeEventListener('touchmove', onPointerMove);
      document.removeEventListener('touchend', onPointerUp);
    }

    container.addEventListener('mousedown', onPointerDown);
    container.addEventListener('touchstart', onPointerDown, { passive: true });
  }
  window.initDraggableCamera = initDraggableCamera;

  window.dismissListeningNoticeModal = function() {
    const modal = document.getElementById('listening-notice-modal');
    if (modal) modal.classList.remove('show');
  };

  function checkListeningSectionPrompt(tabIdx) {
    const tab = SECTION_TABS[tabIdx];
    if (!tab || tab.type !== 'listening') return;
    if (attempt.listeningPromptShown) return;

    const item = attempt.selectedListeningItems?.[tab.bankIdx] || attempt.selectedListeningItems?.[0];
    const playLimit = (item && item.playLimit !== undefined) ? item.playLimit : (exam.listeningBanks?.[0]?.items?.[0]?.playLimit !== undefined ? exam.listeningBanks[0].items[0].playLimit : 2);

    // If playLimit is 0 (or undefined/unlimited), do not show prompt
    if (!playLimit || playLimit <= 0) {
      attempt.listeningPromptShown = true;
      JCAHAttemptStore.saveAttempt(attempt);
      return;
    }

    attempt.listeningPromptShown = true;
    JCAHAttemptStore.saveAttempt(attempt);

    const modal = document.getElementById('listening-notice-modal');
    const limitTextEl = document.getElementById('modal-listening-limit-text');
    if (limitTextEl) {
      limitTextEl.textContent = `${playLimit} ${playLimit === 1 ? 'time' : 'times'}`;
    }
    if (modal) {
      modal.classList.add('show');
    }
  }

  /* -------------------------------------------------------
     Section Switcher & Renderer
  ------------------------------------------------------- */
  window.switchSection = function(tabIdx, keepQIdx) {
    currentTabIdx = tabIdx;
    if (!keepQIdx) {
      currentQuestionIdx = 0;
    }
    attempt.currentSectionIdx = tabIdx;
    JCAHAttemptStore.saveAttempt(attempt);

    // Check listening prompt on first entry to listening section
    checkListeningSectionPrompt(tabIdx);

    // Close any open dropdowns
    document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));

    // Update tab bar pills & dropdown items
    SECTION_TABS.forEach((t, idx) => {
      const btn = document.getElementById(`tab-btn-${idx}`);
      if (btn) btn.classList.toggle('active', idx === tabIdx);
    });

    // Update dropdown triggers if multi-part
    const rTrigger = document.getElementById('nav-dropdown-trigger-reading');
    if (rTrigger) {
      const activeRTab = SECTION_TABS[tabIdx]?.type === 'reading' ? SECTION_TABS[tabIdx] : null;
      rTrigger.classList.toggle('active', !!activeRTab);
      const textSpan = rTrigger.querySelector('.dropdown-trigger-text');
      if (textSpan) textSpan.textContent = activeRTab ? activeRTab.label : 'Reading';
    }

    const lTrigger = document.getElementById('nav-dropdown-trigger-listening');
    if (lTrigger) {
      const activeLTab = SECTION_TABS[tabIdx]?.type === 'listening' ? SECTION_TABS[tabIdx] : null;
      lTrigger.classList.toggle('active', !!activeLTab);
      const textSpan = lTrigger.querySelector('.dropdown-trigger-text');
      if (textSpan) textSpan.textContent = activeLTab ? activeLTab.label : 'Listening';
    }

    const mainContainer = document.getElementById('exam-main-content');
    if (!mainContainer) return;

    const tab = SECTION_TABS[tabIdx];

    // Hide/show question map toggle button based on adaptive section
    const qmapToggleBtn = document.getElementById('qmap-toggle-btn');
    const isAdaptiveTab = tab && (tab.type === 'vocab' || tab.type === 'grammar');
    if (qmapToggleBtn) {
      qmapToggleBtn.style.display = isAdaptiveTab ? 'none' : '';
    }
    const qmapPanel = document.getElementById('qmap-panel');
    if (qmapPanel && isAdaptiveTab) {
      qmapPanel.classList.remove('open');
    }

    switch (tab.type) {
      case 'vocab':
        renderSingleColSection(mainContainer, 'vocab', 'Vocabulary', attempt.vocabQuestions, attempt.vocabAnswers);
        break;
      case 'grammar':
        renderSingleColSection(mainContainer, 'grammar', 'Grammar', attempt.grammarQuestions, attempt.grammarAnswers);
        break;
      case 'reading': {
        const item = attempt.selectedReadingItems[tab.bankIdx];
        renderSplitPaneSection(mainContainer, `reading_${tab.bankIdx}`, tab.label, item, attempt.readingAnswers);
        break;
      }
      case 'listening': {
        const item = attempt.selectedListeningItems[tab.bankIdx];
        renderListeningSection(mainContainer, `listening_${tab.bankIdx}`, tab.label, item, attempt.listeningAnswers);
        break;
      }
      case 'speaking':
        renderSpeakingSection(mainContainer);
        break;
    }

    updateQuestionMapGrid();
    updateSectionProgressBar();
  };

  window.goToQuestion = function(idx) {
    const isModern = (exam && exam.examExperienceVersion !== 'standard');
    if (!isModern) return;
    const tab = SECTION_TABS[currentTabIdx];
    let questions = [];
    if (tab.type === 'vocab') questions = attempt.vocabQuestions || [];
    else if (tab.type === 'grammar') questions = attempt.grammarQuestions || [];
    else if (tab.type === 'reading') questions = attempt.selectedReadingItems?.[tab.bankIdx]?.questions || [];
    else if (tab.type === 'listening') questions = attempt.selectedListeningItems?.[tab.bankIdx]?.questions || [];

    if (idx < 0 || idx >= questions.length) return;
    currentQuestionIdx = idx;

    if (tab.type === 'listening') {
      const targetQ = questions[idx];
      if (targetQ) {
        const el = document.getElementById('qcard-' + targetQ.id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('focused-q-card');
          setTimeout(() => el.classList.remove('focused-q-card'), 1800);
        }
      }
      const footer = document.querySelector('.modern-exam-footer');
      if (footer) {
        const answers = attempt.listeningAnswers || {};
        footer.outerHTML = renderModernNavFooter(questions, answers);
      }
      return;
    }

    switchSection(currentTabIdx, true);
  };

  function renderModernNavFooter(questions, answers) {
    const total = questions ? questions.length : 0;
    const prevDisabled = currentQuestionIdx === 0;
    const isLastQ = currentQuestionIdx === total - 1;
    const nextTab = currentTabIdx < SECTION_TABS.length - 1 ? SECTION_TABS[currentTabIdx + 1] : null;

    // Generate matrix pills
    const pillsHtml = (questions || []).map((q, idx) => {
      const val = answers ? answers[q.id] : undefined;
      const isAnswered = val !== undefined && val !== null && val !== '' &&
                         (!Array.isArray(val) || val.length > 0) &&
                         (typeof val !== 'object' || Object.keys(val).length > 0);
      const isFlagged = !!attempt.flaggedQuestions?.[q.id];
      const isActive = idx === currentQuestionIdx;

      let pillCls = 'modern-q-pill';
      if (isActive) pillCls += ' active';
      else if (isFlagged) pillCls += ' flagged';
      else if (isAnswered) pillCls += ' answered';
      else pillCls += ' unanswered';

      return `<button type="button" class="${pillCls}" id="qpill-${q.id}" onclick="goToQuestion(${idx})" title="Question ${idx + 1}">${idx + 1}</button>`;
    }).join('');

    return `
      <footer class="modern-exam-footer">
        <button type="button" class="modern-footer-btn-prev" onclick="goToQuestion(${currentQuestionIdx - 1})" ${prevDisabled ? 'disabled' : ''}>
          <span>←</span>
          <span>Previous Question</span>
        </button>

        <div class="modern-footer-center">
          <div class="modern-matrix-strip">
            ${pillsHtml}
          </div>
        </div>

        <div>
          ${!isLastQ ? `
            <button type="button" class="modern-footer-btn-next" onclick="goToQuestion(${currentQuestionIdx + 1})">
              <span>Next Question</span>
              <span>→</span>
            </button>` : (nextTab ? `
            <button type="button" class="modern-footer-btn-next" onclick="switchSection(${currentTabIdx + 1})">
              <span>Next: ${escapeHtml(nextTab.label)}</span>
              <span>→</span>
            </button>` : `
            <button type="button" class="modern-footer-btn-next btn-submit" onclick="confirmSubmitExam()">
              <span>Review &amp; Submit</span>
              <span>✓</span>
            </button>`)}
        </div>
      </footer>`;
  }

  /* -------------------------------------------------------
     Adaptive Vocabulary & Grammar State Manager Integration
  ------------------------------------------------------- */
  function getAdaptiveManager(key) {
    if (key !== 'vocab' && key !== 'grammar') return null;
    if (exam && exam.examType === 'placement') return null; // Placement tests use fixed 12-item stratified linear scoring
    if (attempt[key + 'AdaptiveManager']) {
      return attempt[key + 'AdaptiveManager'];
    }
    const Engine = (typeof JCAHAdaptiveEngine !== 'undefined') ? JCAHAdaptiveEngine : ((typeof JCAHAdaptiveEngine !== 'undefined') ? JCAHAdaptiveEngine : null);
    if (!Engine || typeof Engine.AdaptiveStateManager !== 'function') return null;

    const restoredState = attempt[key + 'AdaptiveState'] || null;
    const bankQuestions = key === 'vocab' ? (exam.vocabulary?.questions || []) : (exam.grammar?.questions || []);
    const mgr = new Engine.AdaptiveStateManager({
      sectionKey: key,
      exam: exam,
      questionsPerSection: (exam.examType === 'placement' ? 10 : (exam.questionsPerSection || exam[key]?.questionsPerSection || exam[key]?.displayCount || 20)),
      startingLevel: exam[key + 'Adaptive']?.startingLevel || 'A2',
      allowC1: exam[key + 'Adaptive']?.allowC1,
      minPerLevel: exam[key + 'Adaptive']?.minPerLevel || 2,
      bankQuestions: bankQuestions,
      restoredState: restoredState
    });

    attempt[key + 'AdaptiveManager'] = mgr;
    attempt[key + 'AdaptiveState'] = mgr.serialize();
    attempt[key + 'Questions'] = mgr.getPresentedQuestions();
    attempt[key + 'Answers'] = mgr.getAllAnswers();
    return mgr;
  }

  function renderAdaptiveNavFooter(mgr) {
    if (!mgr || !mgr.activeBlock) return '';
    const activeBlock = mgr.activeBlock;
    const curIdx = activeBlock.currentIdxInBlock;
    const prevDisabled = curIdx === 0;
    const isLastQInBlock = (curIdx === activeBlock.blockLength - 1);
    const curQ = activeBlock.questions[curIdx];
    const hasCurrentAns = curQ && mgr.isAnswerValid(activeBlock.provisionalAnswers[curQ.id]);

    const pillsHtml = [];
    for (let i = 0; i < activeBlock.revealedCount; i++) {
      const q = activeBlock.questions[i];
      if (!q) continue;
      const val = activeBlock.provisionalAnswers[q.id];
      const isAnswered = mgr.isAnswerValid(val);
      const isFlagged = !!activeBlock.markedForReview[q.id];
      const isActive = (i === curIdx);
      const qNum = activeBlock.startQNum + i;

      let pillCls = 'modern-q-pill';
      if (isActive) pillCls += ' active';
      else if (isFlagged) pillCls += ' flagged';
      else if (isAnswered) pillCls += ' answered';
      else pillCls += ' unanswered';

      pillsHtml.push(`<button type="button" class="${pillCls}" id="qpill-${q.id}" onclick="goToAdaptiveQuestion('${mgr.sectionKey}', ${i})" title="Question ${qNum}">${qNum}</button>`);
    }

    return `
      <footer class="modern-exam-footer">
        <button type="button" class="modern-footer-btn-prev" onclick="goToAdaptiveQuestion('${mgr.sectionKey}', ${curIdx - 1})" ${prevDisabled ? 'disabled' : ''}>
          <span>←</span>
          <span>Previous</span>
        </button>

        <div class="modern-footer-center">
          <div class="modern-matrix-strip">
            ${pillsHtml.join('')}
          </div>
        </div>

        <div>
          ${(isLastQInBlock && hasCurrentAns) ? `
            <button type="button" class="modern-footer-btn-next btn-primary" onclick="handleAdaptiveNextClick('${mgr.sectionKey}')">
              <span>Confirm and continue</span>
              <span>✓</span>
            </button>` : `
            <button type="button" class="modern-footer-btn-next" onclick="handleAdaptiveNextClick('${mgr.sectionKey}')">
              <span>Next</span>
              <span>→</span>
            </button>`}
        </div>
      </footer>`;
  }

  window.goToAdaptiveQuestion = function(key, targetIdx) {
    const mgr = getAdaptiveManager(key);
    if (!mgr || !mgr.activeBlock) return;
    const curIdx = mgr.activeBlock.currentIdxInBlock;
    if (targetIdx < 0 || targetIdx >= mgr.activeBlock.revealedCount) return;
    if (targetIdx > curIdx + 1) return;
    if (targetIdx === curIdx + 1) {
      const check = mgr.canAdvance();
      if (!check.allowed) {
        showAdaptiveError("Select an answer to continue.");
        return;
      }
    }
    mgr.activeBlock.currentIdxInBlock = targetIdx;
    attempt[key + 'AdaptiveState'] = mgr.serialize();
    JCAHAttemptStore.saveAttempt(attempt);
    switchSection(currentTabIdx, true);
  };

  window.handleAdaptiveNextClick = function(key) {
    const mgr = getAdaptiveManager(key);
    if (!mgr || !mgr.activeBlock) return;
    const check = mgr.canAdvance();
    if (!check.allowed) {
      showAdaptiveError("Select an answer to continue.");
      return;
    }
    if (mgr.isEndOfBlock()) {
      openBlockConfirmModal(key);
    } else {
      mgr.goToNext();
      attempt[key + 'AdaptiveState'] = mgr.serialize();
      JCAHAttemptStore.saveAttempt(attempt);
      switchSection(currentTabIdx, true);
    }
  };

  function showAdaptiveError(msg) {
    let container = document.getElementById('adaptive-error-container');
    if (!container) {
      container = document.querySelector('.modern-single-q-pane');
    }
    if (container) {
      let banner = document.getElementById('adaptive-error-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'adaptive-error-banner';
        banner.className = 'adaptive-error-banner';
        container.prepend(banner);
      }
      banner.textContent = msg;
      banner.style.display = 'flex';
      clearTimeout(banner._timer);
      banner._timer = setTimeout(() => {
        if (banner) banner.style.display = 'none';
      }, 4000);
    } else {
      alert(msg);
    }
  }

  window.openBlockConfirmModal = function(key) {
    const mgr = getAdaptiveManager(key);
    if (!mgr) return;
    const summary = mgr.getBlockReviewSummary();
    const blockNum = mgr.currentBlockNum;

    let markedHtml = '';
    if (summary.markedCount > 0) {
      markedHtml = `
        <div class="card p-4 mb-4" style="background:#fffbeb;border:1.5px solid #fde68a;">
          <p class="fw-700 text-sm mb-2" style="color:#92400e">
            Review your marked questions before continuing. Unanswered marked questions will be scored as incorrect.
          </p>
          <div class="flex flex-col gap-2">
            ${summary.markedQuestions.map(m => `
              <div class="flex items-center justify-between p-2 rounded" style="background:#ffffff;border:1px solid #fed7aa">
                <span class="text-xs fw-600">Question ${m.questionNumber}: <span class="badge ${m.hasAnswer ? 'badge-success' : 'badge-warning'}">${m.hasAnswer ? 'Answered' : 'Not answered'}</span></span>
                <button type="button" class="btn btn-secondary btn-sm" onclick="closeBlockConfirmModal(); goToAdaptiveQuestion('${key}', ${m.idxInBlock})">
                  Review Question
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    const modalHtml = `
      <div class="adaptive-modal-backdrop" id="adaptive-block-modal">
        <div class="adaptive-modal-dialog p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 style="margin:0;font-size:18px;font-weight:800">Complete Block ${blockNum}</h3>
            <span class="chip chip-primary">Block ${blockNum} of ${mgr.totalBlocks}</span>
          </div>

          <div class="alert alert-warning mb-4" style="background:#fff7ed;border:1.5px solid #fdba74;color:#9a3412;padding:12px;border-radius:8px;font-size:13.5px;line-height:1.5">
            You are about to complete Block ${blockNum}. You will not be able to change these answers later. Marked questions left unanswered will be scored as incorrect.
          </div>

          <div class="card p-4 mb-4">
            <div class="fw-700 text-sm mb-2">Review Summary</div>
            <div class="grid-3 gap-2 text-center">
              <div class="p-2 rounded" style="background:#f0fdf4;border:1px solid #bbf7d0">
                <div class="text-xs text-muted">Answered</div>
                <div class="fw-800 text-lg" style="color:#166534">${summary.answeredCount}</div>
              </div>
              <div class="p-2 rounded" style="background:#fef2f2;border:1px solid #fecaca">
                <div class="text-xs text-muted">Not answered</div>
                <div class="fw-800 text-lg" style="color:#991b1b">${summary.unansweredCount}</div>
              </div>
              <div class="p-2 rounded" style="background:#fffbeb;border:1px solid #fde68a">
                <div class="text-xs text-muted">Marked for review</div>
                <div class="fw-800 text-lg" style="color:#92400e">${summary.markedCount} of 2</div>
              </div>
            </div>
          </div>

          ${markedHtml}

          <div class="flex items-center justify-end gap-3 mt-5">
            <button type="button" class="btn btn-ghost" onclick="closeBlockConfirmModal()">
              Previous
            </button>
            <button type="button" class="btn btn-primary" onclick="confirmAdaptiveBlock('${key}')">
              Confirm and continue
            </button>
          </div>
        </div>
      </div>
    `;

    const existing = document.getElementById('adaptive-block-modal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  };

  window.closeBlockConfirmModal = function() {
    const modal = document.getElementById('adaptive-block-modal');
    if (modal) modal.remove();
  };

  function showAdaptiveFeedbackToast(msg) {
    try {
      const existing = document.getElementById('adaptive-feedback-toast');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.id = 'adaptive-feedback-toast';
      el.className = 'fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50 flex items-center gap-2';
      el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#059669;color:#fff;padding:10px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:99999;font-weight:600;font-size:14px;';
      el.innerHTML = `<span>✓</span> <span>${escapeHtml(msg)}</span>`;
      document.body.appendChild(el);
      setTimeout(() => { if (el.parentNode) el.remove(); }, 4000);
    } catch (_) {}
  }

  window.confirmAdaptiveBlock = async function(key) {
    const mgr = getAdaptiveManager(key);
    if (!mgr) return;

    const isModeB = Boolean(exam && exam.answerSource === 'external' && exam.webhookUrl && exam.examType !== 'placement');

    if (isModeB) {
      const confirmBtn = document.querySelector('#adaptive-block-modal button.btn-primary');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = 'Verifying with server...';
      }

      try {
        const activeBlock = mgr.activeBlock;
        const currentBlockNum = mgr.currentBlockNum;
        const answers = (activeBlock && activeBlock.provisionalAnswers) ? activeBlock.provisionalAnswers : {};

        // 1. Ensure active session token for this section
        let sessionToken = attempt[key + '_sessionToken'];
        if (!sessionToken) {
          const initPayload = {
            action: 'start_adaptive_session',
            spreadsheetId: exam.spreadsheetId || '',
            sheetName: exam.answersSheetName || 'Answers',
            studentId: attempt.candidateId || attempt.studentId || 'candidate',
            studentEmail: attempt.email || '',
            section: key,
            startingLevel: exam[key + 'Adaptive']?.startingLevel || 'A2',
            questionsPerSection: mgr.questionsPerSection || 20,
            initialQids: (activeBlock && activeBlock.questions) ? activeBlock.questions.map(q => q.id) : Object.keys(answers)
          };

          const initResp = await fetch(exam.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(initPayload)
          });
          const initJson = await initResp.json();
          if (!initJson.success) {
            throw new Error(initJson.error || initJson.message || 'Failed to initialize adaptive session with server.');
          }
          sessionToken = initJson.sessionToken;
          attempt[key + '_sessionToken'] = sessionToken;
          attempt[key + '_sessionId'] = initJson.sessionId;
          JCAHAttemptStore.saveAttempt(attempt);
        }

        // 2. Submit block to grade_block
        const gradePayload = {
          action: 'grade_block',
          spreadsheetId: exam.spreadsheetId || '',
          sheetName: exam.answersSheetName || 'Answers',
          sessionToken: sessionToken,
          studentId: attempt.candidateId || attempt.studentId || 'candidate',
          block: currentBlockNum,
          answers: answers,
          section: key
        };

        const gradeResp = await fetch(exam.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(gradePayload)
        });
        const gradeJson = await gradeResp.json();
        if (!gradeJson.success) {
          throw new Error(gradeJson.error || gradeJson.message || 'Block verification failed.');
        }

        // Apply server verdict to adaptive manager
        mgr.setServerBlockVerdict(gradeJson);

        if (gradeJson.score !== undefined) {
          showAdaptiveFeedbackToast(`Block ${currentBlockNum} verified: ${gradeJson.score}/${gradeJson.total || 5} correct.`);
        }
      } catch (err) {
        console.error('Mode B adaptive verification error:', err);
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = 'Retry Verification';
        }
        alert('Server verification could not be completed:\n' + (err.message || 'Network error') + '\n\nPlease check your internet connection and click "Retry Verification".');
        return;
      }
    }

    closeBlockConfirmModal();

    mgr.confirmCurrentBlock();
    attempt[key + 'AdaptiveState'] = mgr.serialize();
    attempt[key + 'Questions'] = mgr.getPresentedQuestions();
    attempt[key + 'Answers'] = mgr.getAllAnswers();
    JCAHAttemptStore.saveAttempt(attempt);

    if (mgr.isCompleted) {
      attempt[key + 'AdaptiveResult'] = mgr.finalSummary;
      JCAHAttemptStore.saveAttempt(attempt);

      if (key === 'vocab') {
        const grammarTabIdx = SECTION_TABS.findIndex(t => t.type === 'grammar');
        if (grammarTabIdx >= 0) {
          switchSection(grammarTabIdx);
          return;
        }
      }
      if (key === 'grammar') {
        const nextTabIdx = currentTabIdx + 1;
        if (nextTabIdx < SECTION_TABS.length) {
          switchSection(nextTabIdx);
          return;
        } else {
          confirmSubmitExam();
          return;
        }
      }
    }

    switchSection(currentTabIdx, true);
  };

  /* Single Column Sections (Vocab & Grammar) */
  function renderSingleColSection(container, key, title, questions, answers) {
    const isModern = (exam && exam.examExperienceVersion !== 'standard');
    const secData = key === 'vocab' ? exam.vocabulary : exam.grammar;
    const showAudio = exam.audibleInstructionsEnabled !== false && secData?.audioInstructionEnabled !== false && secData?.audioInstructionDataUrl;

    const mgr = getAdaptiveManager(key);
    if (mgr) {
      if (mgr.isCompleted) {
        container.innerHTML = `
          <div class="modern-single-q-pane text-center p-8">
            <div class="card p-6" style="max-width:540px;margin:0 auto">
              <span class="chip chip-success mb-3">✓ Section Completed</span>
              <h2 style="font-size:22px;font-weight:800;margin-bottom:8px">${escapeHtml(title)} Section Finished</h2>
              <p class="text-sm text-muted mb-4">You have completed and confirmed all questions for this section. Questions in completed sections are locked and cannot be modified.</p>
              ${key === 'vocab' ? `
                <button type="button" class="btn btn-primary" onclick="switchSection(${SECTION_TABS.findIndex(t => t.type === 'grammar')})">
                  Continue to Grammar →
                </button>
              ` : `
                <button type="button" class="btn btn-primary" onclick="switchSection(${currentTabIdx + 1 < SECTION_TABS.length ? currentTabIdx + 1 : currentTabIdx})">
                  Continue to Next Section →
                </button>
              `}
            </div>
          </div>
        `;
        return;
      }

      const activeBlock = mgr.activeBlock;
      const q = mgr.getCurrentQuestion();
      const curIdx = activeBlock ? activeBlock.currentIdxInBlock : 0;
      const qNum = activeBlock ? (activeBlock.startQNum + curIdx) : 1;
      const totalQ = mgr.questionsPerSection;
      const markedCount = mgr.getMarkedCount();
      const provAnswers = activeBlock ? activeBlock.provisionalAnswers : {};
      const provFlags = activeBlock ? activeBlock.markedForReview : {};

      container.innerHTML = `
        <div class="modern-single-q-pane">
          ${(secData?.instructions || showAudio) ? `
            <div class="modern-sec-instructions-banner mb-3">
              <div class="flex items-center gap-2">
                <span style="font-weight:700;color:var(--clr-primary, #0051d5)">ℹ️ ${escapeHtml(title)}:</span>
                <span class="text-xs text-muted">${escapeHtml(secData?.instructions || 'Select or type the correct answer.')}</span>
              </div>
              ${showAudio ? `<audio controls src="${escapeAttr(secData.audioInstructionDataUrl)}" style="height:28px;max-width:200px"></audio>` : ''}
            </div>` : ''}

          <div id="adaptive-error-container"></div>

          <div class="modern-question-container">
            ${JCAHQuestions.renderSingleQuestionCard(
              q,
              curIdx,
              totalQ,
              provAnswers,
              provFlags,
              key,
              {
                isAdaptive: true,
                isLocked: false,
                questionNumber: qNum,
                markedCount: markedCount,
                markedMax: 2
              }
            )}
          </div>

          ${renderAdaptiveNavFooter(mgr)}
        </div>`;
      return;
    }

    if (!isModern) {
      container.innerHTML = `
        <div class="single-col-pane">
          <div class="flex items-center justify-between mb-4">
            <h2>${title}</h2>
            <span class="chip chip-neutral">${questions.length} questions</span>
          </div>

          ${(secData?.instructions || showAudio) ? `
            <div class="audio-instruction-card p-4 mb-4 flex items-center justify-between gap-4 flex-wrap" role="region" aria-label="Section instructions">
              <div class="flex items-center gap-3">
                <span class="audio-instruction-icon" aria-hidden="true">${getIcon('volume2', 'width="22" height="22" style="color:var(--clr-primary);vertical-align:middle"')}</span>
                <div>
                  <div class="fw-700 text-sm">Section Instructions</div>
                  <div class="text-xs text-muted">${escapeHtml(secData?.instructions || 'Select or type the correct answer.')}</div>
                </div>
              </div>
              ${showAudio ? `
                <audio controls src="${escapeAttr(secData.audioInstructionDataUrl)}" aria-label="Section instructions audio player" style="height:34px;max-width:260px"></audio>
              ` : ''}
            </div>
          ` : ''}

          <div id="qstack-${key}">
            ${JCAHQuestions.renderQuestionStack(questions, answers, attempt.flaggedQuestions, key)}
          </div>

          ${renderNavFooter()}
        </div>`;
      return;
    }

    // Modern Stitch 2026 UX: One question at a time
    const total = questions ? questions.length : 0;
    if (currentQuestionIdx >= total) currentQuestionIdx = Math.max(0, total - 1);
    if (currentQuestionIdx < 0) currentQuestionIdx = 0;
    const q = questions ? questions[currentQuestionIdx] : null;

    container.innerHTML = `
      <div class="modern-single-q-pane">
        ${(secData?.instructions || showAudio) ? `
          <div class="modern-sec-instructions-banner mb-3">
            <div class="flex items-center gap-2">
              <span style="font-weight:700;color:var(--clr-primary, #0051d5)">ℹ️ ${escapeHtml(title)}:</span>
              <span class="text-xs text-muted">${escapeHtml(secData?.instructions || 'Select or type the correct answer.')}</span>
            </div>
            ${showAudio ? `<audio controls src="${escapeAttr(secData.audioInstructionDataUrl)}" style="height:28px;max-width:200px"></audio>` : ''}
          </div>` : ''}

        <div class="modern-question-container">
          ${JCAHQuestions.renderSingleQuestionCard(q, currentQuestionIdx, total, answers, attempt.flaggedQuestions, key)}
        </div>

        ${renderModernNavFooter(questions, answers)}
      </div>`;
  }

  /* Split Pane Section (Reading) */
  function renderSplitPaneSection(container, key, title, item, answers) {
    if (!item) {
      container.innerHTML = `<div class="p-8 text-center text-muted">No item configured for ${title}.</div>`;
      return;
    }

    const isModern = (exam && exam.examExperienceVersion !== 'standard');
    const showReadingAudio = exam.audibleInstructionsEnabled !== false && exam.readingAudioInstructionEnabled !== false && exam.readingAudioInstructionDataUrl;

    if (!isModern) {
      container.innerHTML = `
        <div class="split-pane">
          <!-- Left Pane: Passage -->
          <div class="split-left-pane">
            ${(exam.readingGeneralInstructions || showReadingAudio) ? `
              <div class="audio-instruction-card p-3 mb-3 flex items-center justify-between gap-3 flex-wrap" role="region" aria-label="General reading instructions">
                <div class="flex items-center gap-2">
                  <span class="audio-instruction-icon" aria-hidden="true">${getIcon('volume2', 'width="20" height="20" style="color:var(--clr-primary);vertical-align:middle"')}</span>
                  <div>
                    <div class="fw-700 text-xs">General Reading Instructions</div>
                    <div class="text-xs text-muted">${escapeHtml(exam.readingGeneralInstructions || 'Read the passages carefully and answer the questions.')}</div>
                  </div>
                </div>
                ${showReadingAudio ? `
                  <audio controls src="${escapeAttr(exam.readingAudioInstructionDataUrl)}" aria-label="General reading instructions audio player" style="height:32px;max-width:220px"></audio>
                ` : ''}
              </div>
            ` : ''}

            <div class="label-sm text-primary">Reading Passage</div>
            <div class="passage-title notranslate" translate="no">${escapeHtml(item.title || title)}</div>
            ${item.instructions ? `<p class="text-xs text-muted mb-2 notranslate" translate="no">${escapeHtml(item.instructions)}</p>` : ''}

            ${item.mode === 'image' && item.passageImageDataUrl
              ? `<img src="${escapeAttr(item.passageImageDataUrl)}" alt="Reading passage image" style="max-width:100%;border-radius:var(--radius);border:1px solid var(--clr-border)">`
              : `<div class="passage-body notranslate" translate="no">${sanitizeHtml(item.passageHtml || '<p>No text provided.</p>')}</div>`}

            ${item.vocabSupport ? `
              <div class="card p-3 mt-4" style="background:#FFF">
                <span class="label-sm mb-1">Vocabulary Support / Glossary</span>
                <div class="text-xs text-muted">${escapeHtml(item.vocabSupport)}</div>
              </div>` : ''}
          </div>

          <!-- Right Pane: Questions -->
          <div class="split-right-pane">
            <div class="flex items-center justify-between mb-4">
              <h3 style="font-size:18px">${title} — Questions</h3>
              <span class="chip chip-neutral">${item.questions.length} questions</span>
            </div>

            <div id="qstack-${key}">
              ${JCAHQuestions.renderQuestionStack(item.questions, answers, attempt.flaggedQuestions, key)}
            </div>

            ${renderNavFooter()}
          </div>
        </div>`;
      return;
    }

    // Modern Stitch 2026 UX: Split pane with single question on right
    const questions = item.questions || [];
    const total = questions.length;
    if (currentQuestionIdx >= total) currentQuestionIdx = Math.max(0, total - 1);
    if (currentQuestionIdx < 0) currentQuestionIdx = 0;
    const q = questions[currentQuestionIdx];

    container.innerHTML = `
      <div class="modern-split-pane v6-presentation-split-slide">
        <!-- Left: Passage -->
        <div class="modern-passage-pane">
          <div class="modern-passage-top">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <span class="modern-passage-badge">📖 STIMULUS TEXT • ACADEMIC EXCERPT</span>
              <div class="v6-stimulus-toolbar" role="toolbar" aria-label="Reading text display controls">
                <button type="button" class="v6-stim-tool-btn" onclick="window.adjustPassageFontSize && window.adjustPassageFontSize(-1)" title="Decrease passage font size">A−</button>
                <button type="button" class="v6-stim-tool-btn" onclick="window.adjustPassageFontSize && window.adjustPassageFontSize(1)" title="Increase passage font size">A＋</button>
                <button type="button" class="v6-stim-tool-btn" id="v6-focus-mode-btn" onclick="window.togglePassageFocusMode && window.togglePassageFocusMode()" title="Toggle comfortable reading line spacing">≡ Focus</button>
              </div>
            </div>
            <h2 class="modern-passage-title notranslate" translate="no">${escapeHtml(item.title || title)}</h2>
            ${item.instructions ? `<div class="text-xs text-muted mt-1 notranslate" translate="no">${escapeHtml(item.instructions)}</div>` : ''}
          </div>

          ${(exam.readingGeneralInstructions || showReadingAudio) ? `
            <div class="modern-audio-instruction-bar">
              <span class="text-xs font-semibold text-primary">Instructions:</span>
              <span class="text-xs text-muted">${escapeHtml(exam.readingGeneralInstructions || 'Read the passages carefully.')}</span>
              ${showReadingAudio ? `<audio controls src="${escapeAttr(exam.readingAudioInstructionDataUrl)}" style="height:26px;max-width:180px"></audio>` : ''}
            </div>` : ''}

          <div class="modern-passage-scroll custom-scrollbar notranslate" id="v6-reading-passage-scroll" translate="no">
            ${item.mode === 'image' && item.passageImageDataUrl
              ? `<img src="${escapeAttr(item.passageImageDataUrl)}" alt="Reading passage image" style="max-width:100%;border-radius:6px;border:1px solid var(--clr-border)">`
              : `<div class="passage-body" id="v6-reading-passage-body">${sanitizeHtml(item.passageHtml || '<p>No text provided.</p>')}</div>`}

            ${item.vocabSupport ? `
              <div class="modern-glossary-card mt-4">
                <strong>Vocabulary Support / Glossary</strong>
                <div class="text-xs text-muted mt-1">${escapeHtml(item.vocabSupport)}</div>
              </div>` : ''}
          </div>
        </div>

        <!-- Right: Single Question Workspace -->
        <div class="modern-question-pane">
          <div class="modern-question-container">
            ${JCAHQuestions.renderSingleQuestionCard(q, currentQuestionIdx, total, answers, attempt.flaggedQuestions, key)}
          </div>
          ${renderModernNavFooter(questions, answers)}
        </div>
      </div>`;
  }

  let _passageFontScale = 15.5;
  let _passageFocusActive = false;
  window.adjustPassageFontSize = function (delta) {
    _passageFontScale = Math.max(13, Math.min(21, _passageFontScale + delta * 1.5));
    const el = document.getElementById('v6-reading-passage-body');
    if (el) el.style.fontSize = _passageFontScale + 'px';
  };
  window.togglePassageFocusMode = function () {
    _passageFocusActive = !_passageFocusActive;
    const el = document.getElementById('v6-reading-passage-body');
    const btn = document.getElementById('v6-focus-mode-btn');
    if (el) el.style.lineHeight = _passageFocusActive ? '2.05' : '';
    if (btn) btn.classList.toggle('active', _passageFocusActive);
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', function (ev) {
      if (window.__JCAH_EXAM_STATE__ !== 'in_progress') return;
      const tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (ev.target && ev.target.isContentEditable)) return;
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;

      // Keys 1..4 select MCQ radio option in single-question slide view
      if (['1', '2', '3', '4'].includes(ev.key)) {
        const idx = parseInt(ev.key, 10) - 1;
        const container = document.querySelector('.modern-question-container');
        if (!container) return;
        const radios = container.querySelectorAll('input[type="radio"]:not(:disabled)');
        if (radios && radios[idx]) {
          radios[idx].checked = true;
          if (typeof radios[idx].onchange === 'function') {
            radios[idx].onchange();
          } else {
            const qName = radios[idx].getAttribute('name') || '';
            const qId = qName.replace(/^q_/, '');
            if (qId && window.JCAHQuestions) window.JCAHQuestions.handleInput(qId, radios[idx].value);
          }
        }
      } else if (ev.key === 'f' || ev.key === 'F') {
        const flagBtn = document.querySelector('.modern-question-container .stitch-flag-btn:not(:disabled)');
        if (flagBtn && typeof flagBtn.click === 'function') flagBtn.click();
      }
    });
  }

  /* Listening Section (Audio Widget + Questions) */
  function renderListeningSection(container, key, title, item, answers) {
    if (!item) {
      container.innerHTML = `<div class="p-8 text-center text-muted">No item configured for ${title}.</div>`;
      return;
    }

    const isModern = (exam && exam.examExperienceVersion !== 'standard');
    const currentPlays = attempt.audioPlayCounts[key] || 0;
    const showListeningAudio = exam.audibleInstructionsEnabled !== false && exam.listeningAudioInstructionEnabled !== false && exam.listeningAudioInstructionDataUrl;

    if (!isModern) {
      container.innerHTML = `
        <div class="split-pane">
          <!-- Left Pane: Audio Widget -->
          <div class="split-left-pane">
            ${(exam.listeningGeneralInstructions || showListeningAudio) ? `
              <div class="audio-instruction-card p-3 mb-3 flex items-center justify-between gap-3 flex-wrap" role="region" aria-label="General listening instructions">
                <div class="flex items-center gap-2">
                  <span class="audio-instruction-icon" aria-hidden="true">${getIcon('volume2', 'width="20" height="20" style="color:var(--clr-primary);vertical-align:middle"')}</span>
                  <div>
                    <div class="fw-700 text-xs">General Listening Instructions</div>
                    <div class="text-xs text-muted">${escapeHtml(exam.listeningGeneralInstructions || 'Listen carefully and answer the questions.')}</div>
                  </div>
                </div>
                ${showListeningAudio ? `
                  <audio controls src="${escapeAttr(exam.listeningAudioInstructionDataUrl)}" aria-label="General listening instructions audio player" style="height:32px;max-width:220px"></audio>
                ` : ''}
              </div>
            ` : ''}

            <div class="label-sm text-primary">Listening Audio</div>
            ${JCAHAudio.renderPlayerWidget(item, currentPlays, key)}
          </div>

          <!-- Right Pane: Questions -->
          <div class="split-right-pane">
            <div class="flex items-center justify-between mb-4">
              <h3 style="font-size:18px">${title} — Questions</h3>
              <span class="chip chip-neutral">${item.questions.length} questions</span>
            </div>

            <div id="qstack-${key}">
              ${JCAHQuestions.renderQuestionStack(item.questions, answers, attempt.flaggedQuestions, key)}
            </div>

            ${renderNavFooter()}
          </div>
        </div>`;
      return;
    }

    // Modern Stitch 2026 UX: Split pane with Audio on left, all questions stack on right (like classic)
    const questions = item.questions || [];
    const total = questions.length;
    if (currentQuestionIdx >= total) currentQuestionIdx = Math.max(0, total - 1);
    if (currentQuestionIdx < 0) currentQuestionIdx = 0;

    container.innerHTML = `
      <div class="modern-split-pane">
        <!-- Left: Audio Widget -->
        <div class="modern-passage-pane">
          <div class="modern-passage-top">
            <span class="modern-passage-badge">Listening Evaluation</span>
            <h2 class="modern-passage-title">${escapeHtml(item.title || title)}</h2>
          </div>

          ${(exam.listeningGeneralInstructions || showListeningAudio) ? `
            <div class="modern-audio-instruction-bar">
              <span class="text-xs font-semibold text-primary">Instructions:</span>
              <span class="text-xs text-muted">${escapeHtml(exam.listeningGeneralInstructions || 'Listen carefully.')}</span>
              ${showListeningAudio ? `<audio controls src="${escapeAttr(exam.listeningAudioInstructionDataUrl)}" style="height:26px;max-width:180px"></audio>` : ''}
            </div>` : ''}

          <div class="p-6">
            <div class="label-sm text-primary mb-2">High-Fidelity Audio Player</div>
            ${JCAHAudio.renderPlayerWidget(item, currentPlays, key)}
          </div>
        </div>

        <!-- Right: Questions Stack Workspace (All questions visible simultaneously) -->
        <div class="modern-question-pane">
          <div class="modern-question-container" style="max-height:calc(100vh - 210px);overflow-y:auto;padding-right:8px">
            <div class="flex items-center justify-between mb-4">
              <h3 style="font-size:18px;font-weight:700;color:var(--clr-text)">${escapeHtml(title)} — Questions</h3>
              <span class="chip chip-neutral">${total} questions</span>
            </div>
            <div id="qstack-${key}">
              ${JCAHQuestions.renderQuestionStack(questions, answers, attempt.flaggedQuestions, key)}
            </div>
          </div>
          ${renderModernNavFooter(questions, answers)}
        </div>
      </div>`;
  }

  /* Speaking Section */
  function renderSpeakingSection(container) {
    container.innerHTML = `
      <div class="single-col-pane" style="max-width:840px">
        <div id="speaking-container" class="w-full"></div>
        ${renderNavFooter()}
      </div>`;
    const showSpeakingAudio = exam.audibleInstructionsEnabled !== false && exam.speaking?.audioInstructionEnabled !== false && exam.speaking?.audioInstructionDataUrl;

    JCAHSpeakingUI.init(
      'speaking-container',
      exam.speaking?.accentDefault || 'US',
      (speakingSummary) => {
        attempt.speakingResults = speakingSummary;
        JCAHAttemptStore.saveAttempt(attempt);
        updateTabPillStatus(currentTabIdx);
        updateSectionProgressBar();
      },
      exam.speaking?.prompts || null,
      showSpeakingAudio ? exam.speaking.audioInstructionDataUrl : null,
      exam.speaking?.instructions || null,
      (exam.examType === 'placement' ? 2 : (exam.speaking?.parts || 4))
    );
  }

  /* Navigation Footer Arrows */
  function renderNavFooter() {
    const prevTab = currentTabIdx > 0 ? SECTION_TABS[currentTabIdx - 1] : null;
    const nextTab = currentTabIdx < SECTION_TABS.length - 1 ? SECTION_TABS[currentTabIdx + 1] : null;

    return `
      <div class="flex justify-between items-center mt-6 pt-4" style="border-top:1px solid var(--clr-border)">
        ${prevTab ? `
          <button type="button" class="btn btn-ghost" onclick="switchSection(${currentTabIdx - 1})">
            ← ${prevTab.label}
          </button>` : '<div></div>'}

        ${nextTab ? `
          <button type="button" class="btn btn-primary" onclick="switchSection(${currentTabIdx + 1})">
            ${nextTab.label} →
          </button>` : `
          <button type="button" class="btn btn-danger" onclick="confirmSubmitExam()">
            Submit Answers ${getIcon('check', 'width="16" height="16" style="margin-left:4px;vertical-align:-2px"')}
          </button>`}
      </div>`;
  }

  /* -------------------------------------------------------
     Answer & Flag Handlers
  ------------------------------------------------------- */
  function handleQuestionAnswer(qId, answerVal) {
    const tab = SECTION_TABS[currentTabIdx];

    if (tab && (tab.type === 'vocab' || tab.type === 'grammar')) {
      const mgr = getAdaptiveManager(tab.type);
      if (mgr) {
        mgr.recordProvisionalAnswer(qId, answerVal);
        attempt[tab.type + 'AdaptiveState'] = mgr.serialize();
        attempt[tab.type + 'Questions'] = mgr.getPresentedQuestions();
        attempt[tab.type + 'Answers'] = mgr.getAllAnswers();
        JCAHAttemptStore.saveAttempt(attempt);

        const card = document.getElementById(`qcard-${qId}`);
        if (card) {
          const isAnswered = mgr.isAnswerValid(answerVal);
          card.classList.toggle('answered', isAnswered);
        }

        const footer = document.querySelector('.modern-exam-footer');
        if (footer) {
          footer.outerHTML = renderAdaptiveNavFooter(mgr);
        }
        updateSectionProgressBar();
        return;
      }
    }

    switch (tab.type) {
      case 'vocab': attempt.vocabAnswers[qId] = answerVal; break;
      case 'grammar': attempt.grammarAnswers[qId] = answerVal; break;
      case 'reading': attempt.readingAnswers[qId] = answerVal; break;
      case 'listening': attempt.listeningAnswers[qId] = answerVal; break;
    }

    JCAHAttemptStore.saveAttempt(attempt);

    // Update card styling
    const card = document.getElementById(`qcard-${qId}`);
    if (card) {
      const isAnswered = answerVal !== undefined && answerVal !== null && answerVal !== '' &&
                         (!Array.isArray(answerVal) || answerVal.length > 0) &&
                         (typeof answerVal !== 'object' || Object.keys(answerVal).length > 0);
      card.classList.toggle('answered', isAnswered);
    }

    const pill = document.getElementById(`qpill-${qId}`);
    if (pill) {
      const isAns = answerVal !== undefined && answerVal !== null && answerVal !== '' &&
                    (!Array.isArray(answerVal) || answerVal.length > 0) &&
                    (typeof answerVal !== 'object' || Object.keys(answerVal).length > 0);
      pill.classList.toggle('answered', isAns);
      pill.classList.toggle('unanswered', !isAns);
    }

    updateQuestionMapGrid();
    updateTabPillStatus(currentTabIdx);
    updateSectionProgressBar();
  }

  function updateSectionProgressBar() {
    const fillEl = document.getElementById('sec-prog-fill');
    const countEl = document.getElementById('sec-prog-count');
    const labelEl = document.getElementById('sec-prog-label');
    const statusEl = document.getElementById('sec-prog-status');
    if (!attempt) return;

    const tab = SECTION_TABS[currentTabIdx];
    if (!tab) return;

    if (labelEl) {
      labelEl.textContent = `${tab.label} Progress:`;
    }

    if (tab.type === 'speaking') {
      const isDone = Boolean(attempt.speakingResults && (attempt.speakingResults.completed || (attempt.speakingResults.partResults && attempt.speakingResults.partResults.length > 0)));
      const partsDone = (attempt.speakingResults && Array.isArray(attempt.speakingResults.partResults)) ? attempt.speakingResults.partResults.length : 0;
      const totalParts = Math.max(1, Math.min(4, parseInt(exam.speaking?.parts, 10) || 4));
      const pct = (attempt.speakingResults && attempt.speakingResults.completed) ? 100 : Math.round((partsDone / totalParts) * 100);

      if (fillEl) fillEl.style.width = `${pct}%`;
      if (countEl) countEl.textContent = (pct === 100) ? `${totalParts} / ${totalParts} (100%)` : `${partsDone} / ${totalParts} Parts (${pct}%)`;
      if (statusEl) {
        statusEl.innerHTML = (pct === 100)
          ? `<span style="color:var(--clr-success,#059669)">✓ Speaking Complete</span>`
          : `<span>Oral Recording</span>`;
      }

      const modText = document.getElementById('modern-prog-text');
      const modBar = document.getElementById('modern-prog-bar');
      const modBreadcrumb = document.getElementById('modern-sec-breadcrumb');
      if (modText && modBar) {
        modText.innerHTML = `Speaking Assessment <span>(${pct}% completed)</span>`;
        modBar.style.width = `${pct}%`;
      }
      if (modBreadcrumb) {
        modBreadcrumb.innerHTML = `<span>Section ${currentTabIdx + 1}: Speaking</span>`;
      }
      return;
    }

    let questions = tab.questions || [];
    if (tab.type === 'reading') {
      const item = attempt.selectedReadingItems?.[tab.bankIdx];
      questions = item ? (item.questions || []) : [];
    } else if (tab.type === 'listening') {
      const item = attempt.selectedListeningItems?.[tab.bankIdx];
      questions = item ? (item.questions || []) : [];
    } else if (tab.type === 'vocab') {
      questions = attempt.vocabQuestions || [];
    } else if (tab.type === 'grammar') {
      questions = attempt.grammarQuestions || [];
    }

    const total = questions.length;
    if (total === 0) {
      if (fillEl) fillEl.style.width = '100%';
      if (countEl) countEl.textContent = '0 questions';
      if (statusEl) statusEl.textContent = '';
      return;
    }

    let answered = 0;
    questions.forEach(q => {
      let val = undefined;
      if (tab.type === 'vocab' && attempt.vocabAnswers) val = attempt.vocabAnswers[q.id];
      else if (tab.type === 'grammar' && attempt.grammarAnswers) val = attempt.grammarAnswers[q.id];
      else if (tab.type === 'reading' && attempt.readingAnswers) val = attempt.readingAnswers[q.id];
      else if (tab.type === 'listening' && attempt.listeningAnswers) val = attempt.listeningAnswers[q.id];
      else if (attempt.answers) val = attempt.answers[q.id];

      if (val !== undefined && val !== null && val !== '' &&
          (!Array.isArray(val) || val.length > 0) &&
          (typeof val !== 'object' || Object.keys(val).length > 0)) {
        answered++;
      }
    });

    const pct = Math.round((answered / total) * 100);
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (countEl) countEl.textContent = `${answered} / ${total} (${pct}%)`;
    if (statusEl) {
      if (answered === total) {
        statusEl.innerHTML = `<span style="color:var(--clr-success,#059669)">✓ Section Complete</span>`;
      } else {
        const remaining = total - answered;
        statusEl.textContent = `${remaining} remaining`;
      }
    }

    const modText = document.getElementById('modern-prog-text');
    const modBar = document.getElementById('modern-prog-bar');
    const modBreadcrumb = document.getElementById('modern-sec-breadcrumb');
    if (modText && modBar) {
      modText.innerHTML = `Question ${currentQuestionIdx + 1} of ${total} <span>(${pct}% completed)</span>`;
      modBar.style.width = `${pct}%`;
    }
    if (modBreadcrumb && tab) {
      modBreadcrumb.innerHTML = `<span>Section ${currentTabIdx + 1}: ${escapeHtml(tab.label)}</span>`;
    }
  }
  window.updateSectionProgressBar = updateSectionProgressBar;

  function handleQuestionFlag(qId) {
    const tab = SECTION_TABS[currentTabIdx];
    if (tab && (tab.type === 'vocab' || tab.type === 'grammar')) {
      const mgr = getAdaptiveManager(tab.type);
      if (mgr) {
        const res = mgr.toggleMarkForReview(qId);
        if (!res.success) {
          showAdaptiveError(res.message);
          return;
        }
        attempt[tab.type + 'AdaptiveState'] = mgr.serialize();
        if (!attempt.flaggedQuestions) attempt.flaggedQuestions = {};
        if (res.marked) attempt.flaggedQuestions[qId] = true;
        else delete attempt.flaggedQuestions[qId];
        JCAHAttemptStore.saveAttempt(attempt);

        JCAHQuestions.updateFlagDisplay(qId, res.marked, `Marked: ${res.markedCount} of 2`);
        const pill = document.getElementById(`qpill-${qId}`);
        if (pill) {
          pill.classList.toggle('flagged', res.marked);
        }
        return;
      }
    }

    if (!attempt.flaggedQuestions) attempt.flaggedQuestions = {};

    // Toggle: if already flagged, remove; otherwise add
    const isFlagged = !attempt.flaggedQuestions[qId];
    if (isFlagged) {
      attempt.flaggedQuestions[qId] = true;
    } else {
      delete attempt.flaggedQuestions[qId];
    }
    JCAHAttemptStore.saveAttempt(attempt);

    // Update flag button and card border in-place (no full re-render)
    JCAHQuestions.updateFlagDisplay(qId, isFlagged);

    const pill = document.getElementById(`qpill-${qId}`);
    if (pill) {
      pill.classList.toggle('flagged', isFlagged);
    }

    updateQuestionMapGrid();
    updateTabPillStatus(currentTabIdx);
  }

  function handleAudioPlayCount(audioKey, count) {
    if (!attempt.audioPlayCounts) attempt.audioPlayCounts = {};
    attempt.audioPlayCounts[audioKey] = count;
    JCAHAttemptStore.saveAttempt(attempt);
  }

  /* -------------------------------------------------------
     Supervision Event Handlers
  ------------------------------------------------------- */
  function handleViolation(count, reason) {
    const overlay = document.getElementById('violation-overlay');
    const reasonEl = document.getElementById('violation-reason-text');
    if (reasonEl) reasonEl.textContent = `Security violation detected: ${reason}. This is warning ${count} of 2.`;
    if (overlay) overlay.classList.add('show');
    // Re-assert fullscreen immediately on first warning
    if (!JCAHSupervision.isFullscreen()) {
      JCAHSupervision.requestFullscreen();
    }
  }

  window.dismissViolationOverlay = function() {
    const overlay = document.getElementById('violation-overlay');
    if (overlay) overlay.classList.remove('show');
    if (!JCAHSupervision.isFullscreen()) {
      JCAHSupervision.requestFullscreen();
    }
  };

  function handleTermination(reason) {
    const vOverlay = document.getElementById('violation-overlay');
    if (vOverlay) vOverlay.classList.remove('show');
    const fsOverlay = document.getElementById('fs-enforce-overlay');
    if (fsOverlay) fsOverlay.remove();
    const camOverlay = document.getElementById('camera-lock-overlay');
    if (camOverlay) camOverlay.remove();
    const submitModal = document.getElementById('submission-confirm-modal');
    if (submitModal) submitModal.classList.remove('show');
    const lModal = document.getElementById('listening-notice-modal');
    if (lModal) lModal.classList.remove('show');

    submitExam(`Terminated by proctoring: ${reason}`);
  }

  /* -------------------------------------------------------
     Timer Management
  ------------------------------------------------------- */
  function startTimer() {
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      // v2.0b — freeze the countdown while the translation guard is blocking.
      if (translationLocked) return;

      if (attempt.timeRemainingSeconds <= 0) {
        clearInterval(timerInterval);
        submitExam('Time expired');
        return;
      }
      attempt.timeRemainingSeconds--;
      JCAHAttemptStore.saveAttempt(attempt);
      updateTimerDisplay();
    }, 1000);
  }

  function updateTimerDisplay() {
    const badge = document.getElementById('exam-timer-badge');
    if (!badge) return;
    const s = attempt.timeRemainingSeconds;
    badge.innerHTML = `${getIcon('clock', 'width="16" height="16" style="margin-right:4px;vertical-align:-2px"')} <span id="timer-display" class="font-mono timer-digits" aria-live="polite">${JCAHScoring.formatTime(s)}</span>`;
    badge.classList.toggle('caution', s <= 600 && s > 300);
    badge.classList.toggle('urgent', s <= 300);
  }

  /* -------------------------------------------------------
     Question Map Slide-in Panel
  ------------------------------------------------------- */
  window.toggleQuestionMap = function() {
    const tab = SECTION_TABS[currentTabIdx];
    if (tab && (tab.type === 'vocab' || tab.type === 'grammar')) return;
    const panel = document.getElementById('qmap-panel');
    if (panel) panel.classList.toggle('open');
  };

  function updateQuestionMapGrid() {
    const grid = document.getElementById('qmap-grid-dots');
    if (!grid) return;

    let html = '';
    SECTION_TABS.forEach((tab, sIdx) => {
      if (tab.type === 'vocab' || tab.type === 'grammar') return;
      let questions = [];
      let answers = {};

      if (tab.type === 'vocab') {
        questions = attempt.vocabQuestions || [];
        answers = attempt.vocabAnswers || {};
      } else if (tab.type === 'grammar') {
        questions = attempt.grammarQuestions || [];
        answers = attempt.grammarAnswers || {};
      } else if (tab.type === 'reading') {
        const item = attempt.selectedReadingItems?.[tab.bankIdx];
        questions = item ? item.questions : [];
        answers = attempt.readingAnswers || {};
      } else if (tab.type === 'listening') {
        const item = attempt.selectedListeningItems?.[tab.bankIdx];
        questions = item ? item.questions : [];
        answers = attempt.listeningAnswers || {};
      } else if (tab.type === 'speaking') {
        questions = [{ id: 'sp_tab', text: 'Speaking' }];
      }

      if (questions.length > 0) {
        html += `
          <div class="mb-3">
            <div class="text-xs fw-600 text-muted mb-2 flex items-center justify-between">
              <span>${tab.label}</span>
              <button type="button" class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" onclick="switchSection(${sIdx})">Go →</button>
            </div>
            <div class="grid-4" style="gap:6px">
              ${questions.map((q, qIdx) => {
                const val = answers[q.id];
                const isAnswered = tab.type === 'speaking' ? !!attempt.speakingResults :
                                   (val !== undefined && val !== null && val !== '' &&
                                   (!Array.isArray(val) || val.length > 0) &&
                                   (typeof val !== 'object' || Object.keys(val).length > 0));
                const isFlagged = !!attempt.flaggedQuestions?.[q.id];
                let cls = 'qmap-dot';
                if (isFlagged) cls += ' flagged';
                else if (isAnswered) cls += ' answered';
                if (sIdx === currentTabIdx) cls += ' current';

                return `
                  <button type="button" class="${cls}" onclick="navigateToQuestion(${sIdx}, '${q.id}')" title="Question ${qIdx + 1}">
                    ${qIdx + 1}
                  </button>`;
              }).join('')}
            </div>
          </div>`;
      }
    });

    grid.innerHTML = html;
  }

  function updateTabPillStatus(tabIdx) {
    const pill = document.getElementById(`tab-btn-${tabIdx}`);
    if (!pill) return;
    const tab = SECTION_TABS[tabIdx];

    let questions = [];
    let answers = {};
    if (tab.type === 'vocab') {
      questions = attempt.vocabQuestions || [];
      answers = attempt.vocabAnswers || {};
    } else if (tab.type === 'grammar') {
      questions = attempt.grammarQuestions || [];
      answers = attempt.grammarAnswers || {};
    } else if (tab.type === 'reading') {
      const item = attempt.selectedReadingItems?.[tab.bankIdx];
      questions = item ? item.questions : [];
      answers = attempt.readingAnswers || {};
    } else if (tab.type === 'listening') {
      const item = attempt.selectedListeningItems?.[tab.bankIdx];
      questions = item ? item.questions : [];
      answers = attempt.listeningAnswers || {};
    } else if (tab.type === 'speaking') {
      pill.classList.toggle('completed', !!attempt.speakingResults);
      return;
    }

    const allAnswered = questions.length > 0 && questions.every(q => {
      const v = answers[q.id];
      return v !== undefined && v !== null && v !== '' &&
             (!Array.isArray(v) || v.length > 0) &&
             (typeof v !== 'object' || Object.keys(v).length > 0);
    });

    const hasFlag = questions.some(q => attempt.flaggedQuestions?.[q.id]);

    pill.classList.toggle('completed', allAnswered);
    pill.classList.toggle('has-flag', hasFlag);

    // Also update parent dropdown completion and flag status
    if (tab.type === 'reading') {
      const rTrigger = document.getElementById('nav-dropdown-trigger-reading');
      if (rTrigger) {
        const rIndices = SECTION_TABS.map((t, i) => t.type === 'reading' ? i : -1).filter(i => i >= 0);
        const allRCompleted = rIndices.length > 0 && rIndices.every(idx => {
          const b = document.getElementById(`tab-btn-${idx}`);
          return b && b.classList.contains('completed');
        });
        const hasRFlag = rIndices.some(idx => {
          const b = document.getElementById(`tab-btn-${idx}`);
          return b && b.classList.contains('has-flag');
        });
        rTrigger.classList.toggle('completed', allRCompleted);
        rTrigger.classList.toggle('has-flag', hasRFlag);
      }
    } else if (tab.type === 'listening') {
      const lTrigger = document.getElementById('nav-dropdown-trigger-listening');
      if (lTrigger) {
        const lIndices = SECTION_TABS.map((t, i) => t.type === 'listening' ? i : -1).filter(i => i >= 0);
        const allLCompleted = lIndices.length > 0 && lIndices.every(idx => {
          const b = document.getElementById(`tab-btn-${idx}`);
          return b && b.classList.contains('completed');
        });
        const hasLFlag = lIndices.some(idx => {
          const b = document.getElementById(`tab-btn-${idx}`);
          return b && b.classList.contains('has-flag');
        });
        lTrigger.classList.toggle('completed', allLCompleted);
        lTrigger.classList.toggle('has-flag', hasLFlag);
      }
    }
  }

  window.navigateToQuestion = function(tabIdx, qId) {
    toggleQuestionMap();
    const isModern = (exam && exam.examExperienceVersion !== 'standard');
    if (isModern) {
      const tab = SECTION_TABS[tabIdx];
      let questions = [];
      if (tab.type === 'vocab') questions = attempt.vocabQuestions || [];
      else if (tab.type === 'grammar') questions = attempt.grammarQuestions || [];
      else if (tab.type === 'reading') questions = attempt.selectedReadingItems?.[tab.bankIdx]?.questions || [];
      else if (tab.type === 'listening') questions = attempt.selectedListeningItems?.[tab.bankIdx]?.questions || [];
      const qIdx = questions.findIndex(q => q.id === qId);
      currentQuestionIdx = (qIdx >= 0) ? qIdx : 0;
      switchSection(tabIdx, true);
    } else {
      switchSection(tabIdx);
      setTimeout(() => {
        const el = document.getElementById(`qcard-${qId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    }
  };

  window.scrollToQuestion = window.navigateToQuestion;

  /* -------------------------------------------------------
     Submission Logic
  ------------------------------------------------------- */
  window.confirmSubmitExam = function() {
    // Count unanswered questions
    let totalUnanswered = 0;
    const checkAns = (qArr, ansObj) => {
      (qArr || []).forEach(q => {
        const val = ansObj?.[q.id];
        const isAnswered = val !== undefined && val !== null && val !== '' &&
                           (!Array.isArray(val) || val.length > 0) &&
                           (typeof val !== 'object' || Object.keys(val).length > 0);
        if (!isAnswered) totalUnanswered++;
      });
    };

    checkAns(attempt.vocabQuestions, attempt.vocabAnswers);
    checkAns(attempt.grammarQuestions, attempt.grammarAnswers);
    (attempt.selectedReadingItems || []).forEach(item => { if (item) checkAns(item.questions, attempt.readingAnswers); });
    (attempt.selectedListeningItems || []).forEach(item => { if (item) checkAns(item.questions, attempt.listeningAnswers); });

    const modal = document.getElementById('submission-confirm-modal');
    const alertWarn = document.getElementById('modal-unanswered-alert');
    const alertOk = document.getElementById('modal-answered-alert');
    const countEl = document.getElementById('modal-unanswered-count');

    if (modal) {
      if (totalUnanswered > 0) {
        if (countEl) countEl.textContent = `You have ${totalUnanswered} unanswered question(s).`;
        if (alertWarn) alertWarn.style.display = 'flex';
        if (alertOk) alertOk.style.display = 'none';
      } else {
        if (alertWarn) alertWarn.style.display = 'none';
        if (alertOk) alertOk.style.display = 'flex';
      }
      modal.classList.add('show');
    } else {
      // Fallback
      if (confirm(totalUnanswered > 0 ? `You have ${totalUnanswered} unanswered question(s).\n\nDo you want to submit anyway?` : 'Are you ready to submit your answers?')) {
        submitExam('User submitted');
      }
    }
  };

  window.closeSubmitModal = function() {
    const modal = document.getElementById('submission-confirm-modal');
    if (modal) modal.classList.remove('show');
  };

  window.proceedSubmitExam = async function() {
    closeSubmitModal();
    await submitExam('User submitted');
  };

  async function submitExam(reason = 'Completed') {
    if (timerInterval) clearInterval(timerInterval);

    // Show calm submission loading overlay
    let submitOverlay = document.getElementById('exam-submitting-overlay');
    if (!submitOverlay) {
      submitOverlay = document.createElement('div');
      submitOverlay.id = 'exam-submitting-overlay';
      submitOverlay.className = 'submission-loading-overlay';
      submitOverlay.setAttribute('role', 'alert');
      submitOverlay.setAttribute('aria-live', 'assertive');
      submitOverlay.innerHTML = `
        <div class="submission-loading-card">
          <div class="submission-loading-spinner" aria-hidden="true"></div>
          <h2 style="font-size:20px;font-weight:700;margin:16px 0 8px;color:var(--clr-text)">Submitting Assessment...</h2>
          <p class="text-muted text-sm" style="margin:0;line-height:1.5">Calculating your scores and recording your submission safely.<br>Please do not close or reload this window.</p>
        </div>
      `;
      document.body.appendChild(submitOverlay);
    }

    // Phase 3 Camera Proctoring: Capture snapshot upon finishing the test
    if (typeof JCAHSupervision !== 'undefined' && JCAHSupervision.captureFinishPhoto) {
      try {
        await JCAHSupervision.captureFinishPhoto();
      } catch (photoErr) {
        console.warn('[JCAH] Finish photo capture warning:', photoErr);
      }
    }

    attempt.status = 'submitted';
    attempt.submittedAt = new Date().toISOString();
    attempt.terminationReason = reason;

    // v2.0b — results are final; the translation guard no longer blocks the screen
    window.__JCAH_EXAM_STATE__ = 'submitted';

    // Collect all reading and listening questions arrays for scoring computation
    attempt.readingQuestions = (attempt.selectedReadingItems || []).flatMap(it => it ? it.questions : []);
    attempt.listeningQuestions = (attempt.selectedListeningItems || []).flatMap(it => it ? it.questions : []);

    // Ensure speaking results default to 0 if speaking is enabled on the exam but unanswered
    const examIncludesSpeaking = Boolean(exam.speaking && exam.speaking.enabled !== false && (exam.speaking.parts === undefined || Number(exam.speaking.parts) > 0));
    if (examIncludesSpeaking) {
      if (!attempt.speakingResults) {
        attempt.speakingResults = {
          overallLevel: 'A0',
          partLevels: ['A0', 'A0', 'A0', 'A0'],
          partResults: [],
          numericScore: 0,
          score: 0,
          speakingScore: 0
        };
      } else if (typeof attempt.speakingResults.numericScore !== 'number') {
        attempt.speakingResults.numericScore = 0;
        attempt.speakingResults.score = 0;
        attempt.speakingResults.speakingScore = 0;
      }
      if (typeof attempt.speakingScore !== 'number') {
        attempt.speakingScore = 0;
      }
      attempt.examIncludesSpeaking = true;
    }

    // Compute scores using AnswerService (with JCAHScoring fallback)
    if (typeof JCAHAnswerService !== 'undefined') {
      if (exam.answerSource === 'external') {
        // Mode B: Server will grade upon submission. Client does not hold answers.
        const examIncludesSpeaking = Boolean(exam.speaking && exam.speaking.enabled !== false && (exam.speaking.parts === undefined || Number(exam.speaking.parts) > 0));
        attempt.scores = {
          overall: null,
          passed: false,
          pendingServerGrading: true,
          serverVerdict: 'pending',
          vocab: { pct: 0, score: 0, total: (attempt.vocabQuestions || []).length },
          grammar: { pct: 0, score: 0, total: (attempt.grammarQuestions || []).length },
          reading: { pct: 0, score: 0, total: (attempt.readingQuestions || []).length },
          listening: { pct: 0, score: 0, total: (attempt.listeningQuestions || []).length },
          speakingIncluded: examIncludesSpeaking,
        };

        // Compute local fallback scores if questions carry answer keys (resilience against 401/network failure)
        try {
          const fb = (typeof JCAHScoring !== 'undefined' && typeof JCAHScoring.computeAllScores === 'function')
            ? JCAHScoring.computeAllScores(attempt, exam)
            : ((typeof JCAHAnswerService !== 'undefined' && typeof JCAHAnswerService.computeAllScores === 'function')
                ? JCAHAnswerService.computeAllScores(attempt, exam)
                : null);
          if (fb && !fb.isIncomplete && typeof fb.overall === 'number') {
            attempt.localFallbackScores = fb;
          }
        } catch (_) {}
      } else {
        attempt.scores = JCAHAnswerService.computeAllScores(attempt, exam);
      }
    } else {
      attempt.scores = (typeof JCAHScoring !== 'undefined')
        ? JCAHScoring.computeAllScores(attempt, exam)
        : {};
    }

    // Integrate adaptive section summaries if adaptive sections were active
    const vocabMgr = getAdaptiveManager('vocab');
    const grammarMgr = getAdaptiveManager('grammar');
    if (vocabMgr && grammarMgr) {
      const vSummary = vocabMgr.finalSummary || vocabMgr.finalizeSection();
      const gSummary = grammarMgr.finalSummary || grammarMgr.finalizeSection();
      attempt.vocabAdaptiveResult = vSummary;
      attempt.grammarAdaptiveResult = gSummary;
      const Engine = (typeof JCAHAdaptiveEngine !== 'undefined') ? JCAHAdaptiveEngine : ((typeof JCAHAdaptiveEngine !== 'undefined') ? JCAHAdaptiveEngine : null);
      if (Engine && typeof Engine.calculateOverallResult === 'function') {
        const overallRes = Engine.calculateOverallResult(vSummary, gSummary);
        attempt.adaptiveOverallResult = overallRes;
        if (exam.answerSource !== 'external' || attempt.localFallbackScores) {
          attempt.scores = attempt.scores || {};
          attempt.scores.vocab = { pct: vSummary.score, score: vSummary.score, correct: vSummary.correctCount, total: vSummary.totalItems, level: vSummary.level };
          attempt.scores.vocabCefr = { label: vSummary.level };
          attempt.scores.grammar = { pct: gSummary.score, score: gSummary.score, correct: gSummary.correctCount, total: gSummary.totalItems, level: gSummary.level };
          attempt.scores.grammarCefr = { label: gSummary.level };
          attempt.scores.divergenceNotice = overallRes.divergenceNotice;

          const hasReading = attempt.readingQuestions && attempt.readingQuestions.length > 0;
          const hasListening = attempt.listeningQuestions && attempt.listeningQuestions.length > 0;

          if (hasReading || hasListening || examIncludesSpeaking) {
            // Recompute overall across all active components (Writing, Reading, Listening, Speaking)
            const writingPct = (vSummary.score + gSummary.score) / 2;
            attempt.scores.writing = { pct: writingPct, score: writingPct };
            const rPct = (attempt.localFallbackScores && attempt.localFallbackScores.reading && typeof attempt.localFallbackScores.reading.pct === 'number')
              ? attempt.localFallbackScores.reading.pct
              : ((attempt.scores.reading && typeof attempt.scores.reading.pct === 'number') ? attempt.scores.reading.pct : 0);
            const lPct = (attempt.localFallbackScores && attempt.localFallbackScores.listening && typeof attempt.localFallbackScores.listening.pct === 'number')
              ? attempt.localFallbackScores.listening.pct
              : ((attempt.scores.listening && typeof attempt.scores.listening.pct === 'number') ? attempt.scores.listening.pct : 0);
            const sScore = examIncludesSpeaking ? (typeof attempt.scores.speakingScore === 'number' ? attempt.scores.speakingScore : (attempt.speakingResults?.numericScore || 0)) : null;

            const fullOverall = examIncludesSpeaking
              ? (writingPct + rPct + lPct + sScore) / 4
              : (writingPct + rPct + lPct) / 3;

            const levelMapper = (typeof JCAHScoring !== 'undefined' && JCAHScoring.mapPercentageToLevel)
              ? JCAHScoring.mapPercentageToLevel
              : (typeof JCAHAnswerService !== 'undefined' && JCAHAnswerService.mapPercentageToLevel ? JCAHAnswerService.mapPercentageToLevel : null);
            if (levelMapper) {
              attempt.scores.overallCefr = { label: levelMapper(fullOverall) };
            }
            attempt.scores.overall = Math.round(fullOverall);
            if (attempt.localFallbackScores) {
              attempt.localFallbackScores.overall = attempt.scores.overall;
              attempt.localFallbackScores.overallCefr = attempt.scores.overallCefr;
            }
          } else {
            attempt.scores.overall = overallRes.overallScore;
            attempt.scores.overallCefr = { label: overallRes.overallCefr };
          }
          const passing = Number(exam.passingScore || 70);
          attempt.scores.passed = attempt.scores.overall >= passing;
        }
      }
    }

    JCAHAttemptStore.saveAttempt(attempt);

    // SCORM 1.2 score and completion reporting
    if (typeof ScormHelper !== 'undefined') {
      try {
        if (isModeB) {
          // H4: In Mode B, score is graded authoritatively by the server.
          // Defer score and passed/failed status until the webhook returns.
          // Set status to 'incomplete' so LMS does not record 0%/failed prematurely.
          if (typeof ScormHelper.setStatus === 'function') {
            ScormHelper.setStatus('incomplete');
          } else if (typeof ScormHelper.getAPI === 'function' && ScormHelper.getAPI()) {
            const scormApi = ScormHelper.getAPI();
            scormApi.LMSSetValue('cmi.core.lesson_status', 'incomplete');
            scormApi.LMSCommit('');
          }
        } else {
          const rawScore = (attempt.scores && typeof attempt.scores.overall === 'number') ? attempt.scores.overall : 0;
          const isPassed = attempt.scores ? Boolean(attempt.scores.passed) : false;
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
        console.warn('[Exam] SCORM report error:', scormErr);
      }
    }

    // NOTE: Webhook dispatch is handled exclusively inside JCAHResults.render()
    // via the !attempt.webhookSent guard. Do NOT call dispatchWebhook here —
    // doing so fires the request before render() runs, and then render() fires
    // it again (webhookSent is still false at that point) = duplicate sheet rows.

    // Render results view BEFORE cleanup so the fullscreen-change handler
    // triggered by exitFullscreen does not show the 'requires fullscreen' overlay
    const appEl = document.getElementById('jcah-exam-app');
    if (appEl) {
      const overlay = document.getElementById('exam-submitting-overlay');
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      // Allow the results container to scroll freely
      appEl.style.overflow = 'auto';
      appEl.innerHTML = `<div id="results-view" style="padding:24px;max-width:960px;margin:0 auto"></div>`;
      JCAHResults.render(exam, attempt, 'results-view');
    }

    // Cleanup supervision AFTER rendering results (prevents fullscreen overlay from re-appearing)
    JCAHSupervision.cleanup();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
