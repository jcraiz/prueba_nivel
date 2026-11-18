/**
 * JCAH Exam Delivery â Anti-Cheating & Supervision Module (v6)
 * Enforces fullscreen mode, tab blur detection, camera verification, and random captures.
 * Provides robust webhook photo delivery with retries, CORS handling, and failure resilience.
 */
const JCAHSupervision = (() => {

  let _exam = null;
  let _attempt = null;
  let _onViolationCb = null;
  let _onTerminateCb = null;
  let _stream = null;
  let _warningsCount = 0;
  let _lastViolationTime = 0;
  let _cameraCheckInterval = null;
  let _cameraReconnectTimer = null;
  let _cameraLockCountdown = 60;
  let _isCameraLocked = false;
  let _randomPhotoTimers = [];
  let _isActive = false;
  // When true, fullscreen-exit events and blur events are ignored
  // (used while browser shows the mic-permission dialog)
  let _suppressFullscreenCheck = false;
  let _suppressResumeTimer = null;
  // v2.0b+ â while the automatic-translation guard blocks the exam, proctoring
  // violations are suspended: the candidate may need to leave the tab to
  // disable translation and must not be penalized for doing so.
  let _translationHold = false;
  // Pre-exam modal guard: while candidate is verifying identity or granting consent,
  // exam-level surveillance (window blur, tab switch, fullscreen enforcement) is suspended
  // to prevent browser dialogs or accidental unfocusing from terminating the session.
  let _isIdentityVerifying = false;

  /**
   * Helper: Retrieve configured webhook URL from _exam, config, or global object
   */
  function getWebhookUrl() {
    if (_exam && typeof _exam.webhookUrl === 'string' && _exam.webhookUrl.trim()) {
      return _exam.webhookUrl.trim();
    }
    if (_exam && _exam.externalAnswerConfig && typeof _exam.externalAnswerConfig.apiEndpoint === 'string' && _exam.externalAnswerConfig.apiEndpoint.trim()) {
      return _exam.externalAnswerConfig.apiEndpoint.trim();
    }
    if (_exam && _exam.config && typeof _exam.config.webhookUrl === 'string' && _exam.config.webhookUrl.trim()) {
      return _exam.config.webhookUrl.trim();
    }
    const globalExam = (typeof window !== 'undefined') ? (window.__JCAH_EXAM__ || window.__JCAH_EXAM__) : null;
    if (globalExam) {
      if (typeof globalExam.webhookUrl === 'string' && globalExam.webhookUrl.trim()) {
        return globalExam.webhookUrl.trim();
      }
      if (globalExam.externalAnswerConfig && typeof globalExam.externalAnswerConfig.apiEndpoint === 'string' && globalExam.externalAnswerConfig.apiEndpoint.trim()) {
        return globalExam.externalAnswerConfig.apiEndpoint.trim();
      }
      if (globalExam.config && typeof globalExam.config.webhookUrl === 'string' && globalExam.config.webhookUrl.trim()) {
        return globalExam.config.webhookUrl.trim();
      }
    }
    return null;
  }

  /**
   * Helper: Retrieve configured Google Drive folder ID or URL from exam config
   */
  function getDriveFolderId() {
    const globalExam = (typeof window !== 'undefined') ? (window.__JCAH_EXAM__ || window.__JCAH_EXAM__) : null;
    const candidates = [
      _exam && _exam.driveFolderId,
      _exam && _exam.folderId,
      _exam && _exam.imageFolderId,
      _exam && _exam.reporting && (_exam.reporting.driveFolderId || _exam.reporting.folderId || _exam.reporting.imageFolderId),
      _exam && _exam.config && (_exam.config.driveFolderId || _exam.config.folderId || _exam.config.imageFolderId),
      _exam && _exam.externalAnswerConfig && (_exam.externalAnswerConfig.driveFolderId || _exam.externalAnswerConfig.folderId || _exam.externalAnswerConfig.imageFolderId),
      globalExam && (globalExam.driveFolderId || globalExam.folderId || globalExam.imageFolderId),
      globalExam && globalExam.reporting && (globalExam.reporting.driveFolderId || globalExam.reporting.folderId || globalExam.reporting.imageFolderId),
      globalExam && globalExam.config && (globalExam.config.driveFolderId || globalExam.config.folderId || globalExam.config.imageFolderId)
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return '';
  }

  /**
   * Initialize supervision for an attempt
   */
  function init(exam, attempt, onViolation, onTerminate) {
    _exam = exam;
    _attempt = attempt;
    _onViolationCb = onViolation;
    _onTerminateCb = onTerminate;
    _warningsCount = attempt.violations ? attempt.violations.length : 0;
    _isActive = true;

    // -------------------------------------------------------
    // RIGHT-CLICK SUPPRESSION (belt-and-suspenders over body attr)
    // -------------------------------------------------------
    document.addEventListener('contextmenu', _handleContextMenu, true);

    // -------------------------------------------------------
    // PAGE-LEAVE WARNING (fires when user tries to close tab/navigate away)
    // -------------------------------------------------------
    window.addEventListener('beforeunload', _handleBeforeUnload);

    // -------------------------------------------------------
    // FULLSCREEN MONITORING â applies to ALL exams always
    // -------------------------------------------------------
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Initial fullscreen check: if not in fullscreen, prompt immediately
    if (!isFullscreen()) {
      showFullscreenOverlay();
    }

    // -------------------------------------------------------
    // TAB / WINDOW FOCUS MONITORING â applies to ALL exams always
    // -------------------------------------------------------
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    // -------------------------------------------------------
    // CODE-INSPECTION ANTI-CHEAT (block F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+S)
    // -------------------------------------------------------
    document.addEventListener('keydown', (e) => {
      // Accessibility mode bypass: do not block inspection / assistive navigation shortcuts
      if (typeof window !== 'undefined' && window.__JCAH_ACCESSIBILITY_MODE__) {
        return;
      }
      if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) ||
        (e.ctrlKey && ['u', 'U', 's', 'S'].includes(e.key))
      ) {
        e.preventDefault();
        e.stopPropagation();
        triggerViolation('Intento de inspección de código detectado (herramientas de desarrollador bloqueadas).');
        return false;
      }
    }, true);

    // -------------------------------------------------------
    // CAMERA SUPERVISION (3-Phase Snapshot Engine: 1. Start, 2. Mid 20-30m, 3. Finish)
    // -------------------------------------------------------
    if (!isCameraProctoringEnabled(exam)) return;

    _randomPhotoTimers.forEach(t => clearTimeout(t));
    _randomPhotoTimers = [];

    // Phase 2: Mid-exam snapshot timed strictly between 20-30 minutes (or scaled if exam < 30m)
    const totalMs = (exam.timerMinutes || 60) * 60 * 1000;
    let minMs = (exam.randomSnapshotMinMinutes || 20) * 60 * 1000;
    let maxMs = (exam.randomSnapshotMaxMinutes || 30) * 60 * 1000;

    if (minMs >= totalMs) {
      minMs = Math.floor(totalMs * 0.35);
      maxMs = Math.floor(totalMs * 0.75);
    } else if (maxMs >= totalMs) {
      maxMs = Math.floor(totalMs * 0.85);
    }

    const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    console.log(`[JCAH Supervision] 3-Phase Camera: Mid-exam random snapshot scheduled in ${(randomDelay / 60000).toFixed(1)} minutes.`);

    const timerId = setTimeout(() => {
      capturePhoto('random').then(dataUrl => {
        if (!dataUrl && _isActive && isCameraProctoringEnabled(_exam)) {
          handleCameraInterruption('Fallo al capturar fotografía aleatoria obligatoria (cámara inaccesible).');
        }
      });
    }, randomDelay);

    _randomPhotoTimers.push(timerId);
  }

  /**
   * Check if currently in fullscreen mode
   */
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
  }

  /**
   * Request fullscreen mode
   */
  function requestFullscreen() {
    const elem = document.documentElement;
    try {
      if (!isFullscreen()) {
        if (elem.requestFullscreen) {
          elem.requestFullscreen().catch(err => console.warn('Fullscreen request rejected:', err));
        } else if (elem.webkitRequestFullscreen) {
          elem.webkitRequestFullscreen();
        } else if (elem.mozRequestFullScreen) {
          elem.mozRequestFullScreen();
        } else if (elem.msRequestFullscreen) {
          elem.msRequestFullscreen();
        }
      }
    } catch (e) {
      console.warn('Fullscreen request denied:', e);
    }
  }

  /**
   * Exit fullscreen mode
   */
  function exitFullscreen() {
    try {
      if (isFullscreen()) {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
      }
    } catch (e) {}
  }

  /**
   * Toggle fullscreen mode
   */
  function toggleFullscreen() {
    if (isFullscreen()) {
      exitFullscreen();
    } else {
      requestFullscreen();
    }
  }

  /**
   * Helper: Check if camera proctoring is enabled in exam or configuration
   */
  function isCameraProctoringEnabled(exam) {
    const e = exam || _exam || (typeof window !== 'undefined' ? (window.__JCAH_EXAM__ || window.__JCAH_EXAM__) : null);
    if (!e) return false;
    // 1. If explicitly disabled via antiCheatingEnabled or proctoring.enabled or camera flags, camera MUST NOT be activated
    if (e.antiCheatingEnabled === false || e.antiCheatingEnabled === 'false') return false;
    if (e.proctoring && (e.proctoring.enabled === false || e.proctoring.requireCamera === false)) return false;
    if (e.cameraEnforced === false || e.enableCamera === false) return false;

    // 2. Check if explicitly enabled
    if (e.antiCheatingEnabled === true || e.antiCheatingEnabled === 'true') return true;
    if (e.proctoring && e.proctoring.enabled === true && e.proctoring.requireCamera !== false) return true;
    return false;
  }

  /**
   * Request camera authorization and start stream preview
   */
  async function startCamera() {
    try {
      if (_stream) {
        try {
          _stream.getTracks().forEach(t => t.stop());
        } catch (_) {}
        _stream = null;
      }
      _stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      attachVideoStream();

      // Monitor camera hardware events (unplug, driver crash, OS permissions revoked)
      const videoTrack = _stream && _stream.getVideoTracks && _stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          console.warn('[JCAH Supervision] Video track ended unexpectedly.');
          if (_isActive && isCameraProctoringEnabled(_exam)) {
            handleCameraInterruption('Pérdida de señal de cámara (dispositivo desconectado o apagado).');
          }
        };
        videoTrack.onmute = () => {
          console.warn('[JCAH Supervision] Video track muted.');
          if (_isActive && isCameraProctoringEnabled(_exam)) {
            handleCameraInterruption('Cámara silenciada o bloqueada por el sistema.');
          }
        };
      }

      // Monitor camera stream every 3s
      if (_cameraCheckInterval) clearInterval(_cameraCheckInterval);
      _cameraCheckInterval = setInterval(checkCameraStream, 3000);
      return true;
    } catch (err) {
      console.warn('Camera access error:', err);
      return false;
    }
  }

  /**
   * Stop camera stream tracks and release hardware
   */
  function stopCamera() {
    if (_cameraCheckInterval) {
      clearInterval(_cameraCheckInterval);
      _cameraCheckInterval = null;
    }
    if (_stream) {
      try {
        _stream.getTracks().forEach(track => track.stop());
      } catch (_) {}
      _stream = null;
    }
    hideCameraLockOverlay();
  }

  /**
   * Attach active camera stream to video preview DOM element
   */
  function attachVideoStream() {
    if (!_stream) return;
    const video = document.getElementById('camera-video');
    if (video) {
      video.srcObject = _stream;
      video.play().catch(e => console.warn('Camera video play error:', e));
    }
    const verifyVideo = document.getElementById('id-verify-video');
    if (verifyVideo) {
      verifyVideo.srcObject = _stream;
      verifyVideo.play().catch(e => console.warn('Preview video play error:', e));
    }
  }

  /**
   * Check if camera stream is still active
   */
  function checkCameraStream() {
    if (_isIdentityVerifying) return;
    if (!isCameraProctoringEnabled(_exam)) return;
    if (!_isActive) return;
    if (!_stream || !_stream.active || !_stream.getVideoTracks || _stream.getVideoTracks().length === 0 || _stream.getVideoTracks()[0].readyState !== 'live') {
      console.warn('[JCAH Supervision] Active check: camera stream lost or inactive.');
      handleCameraInterruption('Pérdida de señal de la cámara de supervisión.');
    }
  }

  /**
   * Handle camera interruption: Locks the exam behind an impassable barrier
   * giving the candidate 60s to reconnect before terminating the assessment.
   */
  function handleCameraInterruption(reason) {
    if (!_isActive) return;
    if (_isCameraLocked) return; // Overlay already active
    _isCameraLocked = true;

    console.warn(`[JCAH Supervision] CAMERA INTERRUPTION DETECTED: ${reason}. Locking exam.`);

    if (_attempt) {
      if (!_attempt.violations) _attempt.violations = [];
      _attempt.violations.push({
        type: 'CAMERA_DISCONNECT',
        reason: reason,
        at: new Date().toISOString()
      });
      if (typeof JCAHAttemptStore !== 'undefined') {
        JCAHAttemptStore.saveAttempt(_attempt);
      }
    }

    showCameraLockOverlay(reason);
  }

  /**
   * Display non-dismissible camera lock overlay with 60s countdown
   */
  function showCameraLockOverlay(reason) {
    let overlay = document.getElementById('camera-lock-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'camera-lock-overlay';
      overlay.className = 'camera-lock-overlay';
      document.body.appendChild(overlay);
    }

    _cameraLockCountdown = 60;
    const cleanReason = String(reason || 'Error de cámara / Camera stream lost').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    overlay.style.cssText = 'position:fixed !important;inset:0 !important;z-index:999999 !important;background:rgba(15,23,42,0.96) !important;backdrop-filter:blur(10px) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;color:#fff !important;font-family:system-ui,-apple-system,sans-serif !important;';

    overlay.innerHTML = `
      <div style="background:#1e293b;border:2px solid #ef4444;border-radius:16px;max-width:540px;width:100%;padding:28px;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
        <div style="width:64px;height:64px;margin:0 auto 16px;background:rgba(239,68,68,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#ef4444;">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </div>
        <h2 style="font-size:22px;font-weight:800;color:#f87171;margin:0 0 8px;">⚠️ EXAMEN PAUSADO — ERROR DE CÁMARA</h2>
        <h3 style="font-size:14px;font-weight:600;color:#94a3b8;margin:0 0 16px;text-transform:uppercase;letter-spacing:0.04em;">EXAM LOCKED — CAMERA SIGNAL LOST</h3>
        
        <div style="text-align:left;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;margin-bottom:18px;">
          <p style="margin:0 0 8px 0;font-size:13.5px;line-height:1.45;color:#e2e8f0;">
            <strong>ES:</strong> Se interrumpió la señal de la cámara de video (<strong>${cleanReason}</strong>). Este examen requiere supervisión continua obligatoria. La prueba ha sido pausada y <strong>no se puede continuar sin señal de cámara</strong>.
          </p>
          <p style="margin:0;font-size:12.5px;line-height:1.4;color:#94a3b8;">
            <strong>EN:</strong> Video proctoring signal was interrupted. This exam requires continuous video supervision and cannot proceed without a live camera.
          </p>
        </div>

        <div style="background:#0f172a;border-radius:10px;padding:12px;margin-bottom:18px;border:1px solid #334155;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;margin-bottom:2px;">Tiempo límite para restablecer cámara / Reconnection time remaining:</div>
          <div id="cam-lock-countdown" style="font-size:32px;font-weight:800;color:#f59e0b;font-family:monospace;">60s</div>
        </div>

        <div id="cam-lock-feedback" style="display:none;margin-bottom:14px;font-size:13px;font-weight:600;padding:10px;border-radius:8px;"></div>

        <button type="button" id="btn-reconnect-camera" class="btn btn-primary btn-lg" style="width:100%;padding:14px;font-size:15px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#ef4444;border-color:#dc2626;cursor:pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          <span>Reintentar / Reconectar Cámara (Reconnect Camera)</span>
        </button>
      </div>
    `;

    const countdownEl = document.getElementById('cam-lock-countdown');
    const reconnectBtn = document.getElementById('btn-reconnect-camera');
    const feedbackEl = document.getElementById('cam-lock-feedback');

    if (_cameraReconnectTimer) clearInterval(_cameraReconnectTimer);
    _cameraReconnectTimer = setInterval(() => {
      _cameraLockCountdown--;
      if (countdownEl) countdownEl.textContent = `${_cameraLockCountdown}s`;

      if (_cameraLockCountdown <= 0) {
        clearInterval(_cameraReconnectTimer);
        _cameraReconnectTimer = null;
        if (countdownEl) countdownEl.textContent = '0s';
        if (feedbackEl) {
          feedbackEl.style.display = 'block';
          feedbackEl.style.background = '#7f1d1d';
          feedbackEl.style.color = '#fee2e2';
          feedbackEl.textContent = '❌ Tiempo límite expirado. Terminando evaluación...';
        }
        if (reconnectBtn) reconnectBtn.disabled = true;

        setTimeout(() => {
          hideCameraLockOverlay();
          terminateExam('Examen terminado automáticamente: No se restableció la cámara de supervisión en el tiempo límite.');
        }, 1500);
      }
    }, 1000);

    if (reconnectBtn) {
      reconnectBtn.onclick = async () => {
        reconnectBtn.disabled = true;
        if (feedbackEl) {
          feedbackEl.style.display = 'block';
          feedbackEl.style.background = '#1e3a8a';
          feedbackEl.style.color = '#dbeafe';
          feedbackEl.textContent = '⏳ Conectando a la cámara / Reconnecting to camera...';
        }

        const success = await attemptCameraReconnect();
        if (success) {
          if (feedbackEl) {
            feedbackEl.style.background = '#065f46';
            feedbackEl.style.color = '#d1fae5';
            feedbackEl.textContent = '✅ Cámara restablecida con éxito. Continuando evaluación...';
          }
          setTimeout(() => {
            hideCameraLockOverlay();
          }, 800);
        } else {
          reconnectBtn.disabled = false;
          if (feedbackEl) {
            feedbackEl.style.display = 'block';
            feedbackEl.style.background = '#7f1d1d';
            feedbackEl.style.color = '#fee2e2';
            feedbackEl.textContent = '❌ No se pudo conectar a la cámara. Verifique que no esté ocupada o desconectada e intente de nuevo.';
          }
        }
      };
    }
  }

  /**
   * Attempt to reconnect the camera stream
   */
  async function attemptCameraReconnect() {
    try {
      const ok = await startCamera();
      if (!ok) return false;
      attachVideoStream();

      if (!_stream || !_stream.active || !_stream.getVideoTracks || _stream.getVideoTracks().length === 0 || _stream.getVideoTracks()[0].readyState !== 'live') {
        return false;
      }

      if (_attempt) {
        if (!_attempt.violations) _attempt.violations = [];
        _attempt.violations.push({
          type: 'CAMERA_RECONNECTED_SUCCESS',
          at: new Date().toISOString(),
          message: 'Camera video signal restored by candidate.'
        });
        if (typeof JCAHAttemptStore !== 'undefined') {
          JCAHAttemptStore.saveAttempt(_attempt);
        }
      }

      return true;
    } catch (e) {
      console.warn('[JCAH Supervision] Reconnect attempt failed:', e);
      return false;
    }
  }

  /**
   * Hide camera lock overlay and clear reconnect timer
   */
  function hideCameraLockOverlay() {
    _isCameraLocked = false;
    if (_cameraReconnectTimer) {
      clearInterval(_cameraReconnectTimer);
      _cameraReconnectTimer = null;
    }
    const overlay = document.getElementById('camera-lock-overlay');
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  /**
   * Upload snapshot payload to configured webhook (Google Apps Script)
   * Uses mode: 'no-cors' with text/plain payload for immediate transmission without browser CORS restrictions or redirect blocks.
   */
  async function uploadSnapshotToWebhook(url, payload) {
    const jsonBody = JSON.stringify(payload);
    const sizeKB = (jsonBody.length / 1024).toFixed(1);
    console.log(`[JCAH Supervision] Uploading snapshot [${payload.type}] (${payload.fileName}, ${sizeKB} KB) to webhook: ${url}`);

    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: jsonBody,
      });
      console.log(`[JCAH Supervision] Photo snapshot [${payload.type}] sent successfully to webhook.`);
      return { success: true, mode: 'no-cors' };
    } catch (err) {
      console.warn(`[JCAH Supervision] Snapshot delivery error for [${payload.type}]:`, err);
      return { success: false, error: err.message || String(err) };
    }
  }

  /**
   * Capture photo snapshot from camera
   */
  async function capturePhoto(type = 'initial') {
    if (!_stream || !_stream.active || !_stream.getVideoTracks || _stream.getVideoTracks().length === 0 || _stream.getVideoTracks()[0].readyState !== 'live') {
      console.warn('[JCAH Supervision] No active live camera stream available for capturePhoto');
      if (_isIdentityVerifying) {
        console.log('[JCAH Supervision] Attempting camera stream recovery during ID verification...');
        const restarted = await startCamera();
        if (restarted) {
          attachVideoStream();
        }
      }
      if (!_stream || !_stream.active || !_stream.getVideoTracks || _stream.getVideoTracks().length === 0 || _stream.getVideoTracks()[0].readyState !== 'live') {
        if (_isActive && !_isIdentityVerifying && isCameraProctoringEnabled(_exam)) {
          handleCameraInterruption('Señal de video inactiva al intentar capturar foto (' + type + ').');
        }
        return null;
      }
    }

    try {
      attachVideoStream();

      let dataUrl = null;
      const track = _stream.getVideoTracks()[0];

      // Strategy 1: ImageCapture API (Chromium / Edge native, grabs raw camera frame)
      if (typeof ImageCapture !== 'undefined' && track && track.readyState === 'live') {
        try {
          const imageCapture = new ImageCapture(track);
          // Allow up to 3 attempts with small pause for camera sensor readiness
          for (let attempt = 0; attempt < 3 && !dataUrl; attempt++) {
            try {
              const bitmap = await imageCapture.grabFrame();
              if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
                let w = bitmap.width;
                let h = bitmap.height;
                const MAX_DIM = 800;
                if (w > MAX_DIM || h > MAX_DIM) {
                  if (w > h) {
                    h = Math.round((h * MAX_DIM) / w);
                    w = MAX_DIM;
                  } else {
                    w = Math.round((w * MAX_DIM) / h);
                    h = MAX_DIM;
                  }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0, w, h);
                dataUrl = canvas.toDataURL('image/jpeg', 0.80);
              }
            } catch (grabErr) {
              await new Promise(r => setTimeout(r, 150));
            }
          }
        } catch (icErr) {
          console.warn('[JCAH Supervision] ImageCapture init failed:', icErr);
        }
      }

      // Strategy 2: HTMLVideoElement rendering fallback
      if (!dataUrl) {
        let video = document.getElementById('camera-video') || document.getElementById('id-verify-video');
        let tempVideo = null;

        if (!video) {
          tempVideo = document.createElement('video');
          tempVideo.srcObject = _stream;
          tempVideo.muted = true;
          tempVideo.playsInline = true;
          await tempVideo.play().catch(() => {});
          video = tempVideo;
        } else {
          if (video.srcObject !== _stream) {
            video.srcObject = _stream;
          }
          if (video.paused) {
            await video.play().catch(() => {});
          }
        }

        // Wait up to 2000ms for video frame dimensions and readyState to be ready
        let retries = 20;
        while ((video.readyState < 2 || !video.videoWidth || video.videoWidth === 0) && retries > 0) {
          await new Promise(r => setTimeout(r, 100));
          retries--;
        }

        let vw = video.videoWidth > 0 ? video.videoWidth : 640;
        let vh = video.videoHeight > 0 ? video.videoHeight : 480;
        const MAX_DIM = 800;
        if (vw > MAX_DIM || vh > MAX_DIM) {
          if (vw > vh) {
            vh = Math.round((vh * MAX_DIM) / vw);
            vw = MAX_DIM;
          } else {
            vw = Math.round((vw * MAX_DIM) / vh);
            vh = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = vw;
        canvas.height = vh;
        const ctx = canvas.getContext('2d');
        try {
          ctx.drawImage(video, 0, 0, vw, vh);
          dataUrl = canvas.toDataURL('image/jpeg', 0.80);
        } catch (drawErr) {
          console.warn('[JCAH Supervision] Video drawImage failed:', drawErr);
        }

        if (tempVideo) {
          tempVideo.pause();
          tempVideo.srcObject = null;
        }
      }

      if (!dataUrl) {
        console.warn('[JCAH Supervision] Could not generate dataUrl from camera');
        return null;
      }

      const timestamp = Date.now();
      const isoTime = new Date().toISOString();
      const studentId = _attempt ? (_attempt.studentId || 'student') : 'student';
      const studentName = _attempt ? (_attempt.studentName || 'Unknown') : 'Unknown';
      const cleanName = studentName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${studentId}_${cleanName}_${type}_${timestamp}.jpg`;

      // 1. ALWAYS store snapshot in local attempt record first
      const imageRecord = {
        type,
        dataUrl,
        fileName,
        capturedAt: isoTime,
        uploadStatus: 'pending'
      };

      if (_attempt) {
        if (!_attempt.cameraImages) _attempt.cameraImages = [];
        _attempt.cameraImages.push(imageRecord);
        JCAHAttemptStore.saveAttempt(_attempt);
      }

      // 2. Dispatch to Webhook (Google Drive via Google Apps Script) if configured
      const webhookUrl = getWebhookUrl();
      if (webhookUrl) {
        const payload = {
          action: 'save_image',
          imageData: dataUrl,
          fileName: fileName,
          studentId: studentId,
          studentName: studentName,
          type: type,
          folderId: getDriveFolderId(),
          driveFolderId: getDriveFolderId(),
          examTitle: (_exam && _exam.title) || (window.__JCAH_EXAM__ && window.__JCAH_EXAM__.title) || (window.__JCAH_EXAM__ && window.__JCAH_EXAM__.title) || 'JCAH Exam',
          timestamp: timestamp,
          isoTime: isoTime,
          apiKey: ((_exam && (_exam.webhookApiKey || _exam.apiKey)) || (window.__JCAH_EXAM__ && (window.__JCAH_EXAM__.webhookApiKey || window.__JCAH_EXAM__.apiKey)) || (window.__JCAH_EXAM__ && (window.__JCAH_EXAM__.webhookApiKey || window.__JCAH_EXAM__.apiKey)) || '').trim()
        };

        const uploadPromise = uploadSnapshotToWebhook(webhookUrl, payload)
          .then(res => {
            if (res.success) {
              imageRecord.uploadStatus = 'success';
              imageRecord.uploadedAt = new Date().toISOString();
            } else {
              imageRecord.uploadStatus = 'failed';
              imageRecord.uploadError = res.error || 'Upload failed';
            }
            if (_attempt) JCAHAttemptStore.saveAttempt(_attempt);
            return res;
          })
          .catch(err => {
            imageRecord.uploadStatus = 'failed';
            imageRecord.uploadError = err.message || String(err);
            if (_attempt) JCAHAttemptStore.saveAttempt(_attempt);
            return { success: false, error: err.message };
          });

        if (type === 'finish' || type === 'initial') {
          await uploadPromise;
        }
      } else {
        console.log('[JCAH Supervision] No webhookUrl configured. Photo saved locally in attempt store.');
        imageRecord.uploadStatus = 'local_only';
        if (_attempt) JCAHAttemptStore.saveAttempt(_attempt);
      }

      return dataUrl;
    } catch (e) {
      console.warn('[JCAH Supervision] Photo capture failed:', e);
      return null;
    }
  }

  /**
   * Event Handler: Tab visibility change â fires for ALL exams (not just antiCheat)
   */
  function handleVisibilityChange() {
    if (_isIdentityVerifying || _translationHold) return;
    if (document.hidden && _isActive) {
      triggerViolation('Tab switch or window minimized');
    }
  }

  /**
   * Event Handler: Window blur â fires for ALL exams (not just antiCheat)
   */
  function handleBlur() {
    if (_isIdentityVerifying || _translationHold) return;
    if (_isActive && !_suppressFullscreenCheck) {
      // Debounce window blur to avoid false positives on dropdown selects
      const now = Date.now();
      if (now - _lastViolationTime > 2000) {
        triggerViolation('Loss of exam window focus');
      }
    }
  }

  /**
   * Show modal overlay requiring fullscreen activation
   */
  function showFullscreenOverlay() {
    if (_isIdentityVerifying || !_isActive || isFullscreen()) return;
    let overlay = document.getElementById('fs-enforce-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'fs-enforce-overlay';
      overlay.className = 'fs-enforce-overlay';
      overlay.innerHTML = `
        <div class="fs-enforce-card">
          <div style="margin-bottom:12px">${getIcon('laptop', 'width="48" height="48" style="color:var(--clr-primary)"')}</div>
          <h2 style="font-size:20px;font-weight:800;margin-bottom:8px">Fullscreen Mode Required</h2>
          <p class="text-sm text-muted mb-4">This exam must be taken in fullscreen mode to ensure proctoring integrity and proper display of exam items.</p>
          <button type="button" class="btn btn-primary btn-lg w-full" id="btn-activate-fullscreen" onclick="JCAHSupervision.requestFullscreen()">
            Enable Fullscreen →
          </button>
        </div>
      `;
      document.body.appendChild(overlay);
    }
  }

  /**
   * Hide fullscreen requirement overlay
   */
  function hideFullscreenOverlay() {
    const overlay = document.getElementById('fs-enforce-overlay');
    if (overlay) overlay.remove();
  }

  /**
   * Temporarily suspend ALL proctoring violation handling.
   * Used by the automatic-translation guard while it blocks the exam, so the
   * candidate can disable translation (leaving the tab / fullscreen) without
   * being flagged. When released, fullscreen is quietly re-asserted if needed.
   */
  function setTranslationHold(val) {
    _translationHold = !!val;
    if (!_translationHold && _isActive && !isFullscreen()) {
      setTimeout(() => {
        if (_isActive && !_translationHold && !isFullscreen()) {
          requestFullscreen();
        }
      }, 300);
    }
  }

  /**
   * Pause fullscreen exit detection while the translation prompt is shown.
   */
  function handleFullscreenChange() {
    if (_translationHold) return;

    const isFs = isFullscreen();
    const fsBtn = document.getElementById('btn-fullscreen-toggle');
    if (fsBtn) {
      fsBtn.innerHTML = isFs ? `${getIcon('minimize', 'width="16" height="16" style="margin-right:6px;vertical-align:-2px"')} Exit Fullscreen` : `${getIcon('maximize', 'width="16" height="16" style="margin-right:6px;vertical-align:-2px"')} Fullscreen`;
      fsBtn.classList.toggle('active', isFs);
    }

    if (isFs) {
      hideFullscreenOverlay();
    } else if (_isActive && !_suppressFullscreenCheck) {
      showFullscreenOverlay();
      // Always count fullscreen exit as a violation regardless of antiCheatingEnabled
      triggerViolation('Exited fullscreen mode.');
    }
  }

  /**
   * Register a security violation
   */
  function triggerViolation(reason) {
    if (_isIdentityVerifying || !_isActive) return;
    if (_translationHold) return; // suspended while the translation prompt is shown
    const now = Date.now();
    if (now - _lastViolationTime < 2000) return; // Prevent duplicate rapid triggers
    _lastViolationTime = now;

    _warningsCount += 1;
    const violationRecord = { type: reason, at: new Date().toISOString(), count: _warningsCount };

    if (_attempt) {
      if (!_attempt.violations) _attempt.violations = [];
      _attempt.violations.push(violationRecord);
      JCAHAttemptStore.saveAttempt(_attempt);
    }

    // Second violation terminates exam immediately
    if (_warningsCount >= 2) {
      terminateExam('Multiple proctoring violations: ' + reason);
    } else {
      if (_onViolationCb) _onViolationCb(_warningsCount, reason);
    }
  }

  /**
   * Terminate exam due to proctoring violation
   */
  function terminateExam(reason) {
    _isActive = false;
    _suppressFullscreenCheck = false;
    hideFullscreenOverlay();
    cleanup();
    if (_onTerminateCb) _onTerminateCb(reason);
  }

  /**
   * Temporarily suspend fullscreen-exit violations.
   * Call this BEFORE requesting microphone (or camera) access so that the
   * browser's permission dialog (which forces an exit from fullscreen on Chrome/Edge)
   * does not trigger a proctoring violation.
   * @param {number} [maxMs=8000] - Maximum grace period in ms before auto-resume
   */
  function pauseForMicPermission(maxMs = 8000) {
    _suppressFullscreenCheck = true;
    if (_suppressResumeTimer) clearTimeout(_suppressResumeTimer);
    _suppressResumeTimer = setTimeout(() => {
      _suppressFullscreenCheck = false;
      _suppressResumeTimer = null;
      // After grace period, if we are not in fullscreen, re-request it silently
      if (_isActive && !isFullscreen()) {
        requestFullscreen();
      }
    }, maxMs);
    console.log('[JCAHSupervision] Fullscreen enforcement paused for mic permission dialog.');
  }

  /**
   * Resume fullscreen enforcement after the microphone permission dialog has closed.
   * Automatically re-requests fullscreen if needed.
   */
  function resumeAfterMicPermission() {
    if (_suppressResumeTimer) {
      clearTimeout(_suppressResumeTimer);
      _suppressResumeTimer = null;
    }
    if (_isActive && !isFullscreen()) {
      // Small delay so browser can settle after permission dialog closes
      setTimeout(() => { if (_isActive && !isFullscreen()) requestFullscreen(); }, 300);
    }
    // Grace period before re-arming violation triggers
    setTimeout(() => {
      _suppressFullscreenCheck = false;
    }, 1500);
    console.log('[JCAHSupervision] Fullscreen enforcement resumed after mic permission.');
  }

  /**
   * Suppress context menu (right-click) during active supervision
   */
  function _handleContextMenu(e) {
    if (typeof window !== 'undefined' && window.__JCAH_ACCESSIBILITY_MODE__) {
      return; // Permitted for screen readers and assistive technology
    }
    if (_isActive) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }

  /**
   * beforeunload handler â shows browser's native "Leave page?" dialog
   * and counts as a violation if _isActive
   */
  function _handleBeforeUnload(e) {
    if (!_isActive) return;
    if (_translationHold) return; // candidate may leave to disable translation / switch device
    // Count leaving as a violation
    triggerViolation('Attempted to leave or refresh the exam page');
    // Show native browser confirmation dialog
    e.preventDefault();
    e.returnValue = 'Leaving this page will terminate your exam. Are you sure?';
    return e.returnValue;
  }

  /**
   * Clean up timers and camera stream
   */
  async function captureFinishPhoto() {
    if (!_exam || !isCameraProctoringEnabled(_exam)) return null;
    if (!_isActive) return null;
    console.log('[JCAH Supervision] 3-Phase Camera: Capturing Phase 3 (Finish) photo...');
    return await capturePhoto('finish');
  }

  /**
   * Show identity verification overlay with snapshot information and ID reference image
   * @param {object} exam - current exam configuration
   * @returns {Promise<boolean>} resolves true if photo captured, false if cancelled
   */
  function showIdentityVerificationModal(exam) {
    _isIdentityVerifying = true;
    return new Promise((resolve) => {
      const existing = document.getElementById('id-verification-overlay');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

      const overlay = document.createElement('div');
      overlay.id = 'id-verification-overlay';
      overlay.className = 'id-verification-overlay';

      const refImgSrc = (exam && exam.idReferenceImageUrl) || (typeof window !== 'undefined' && window.JCAH_DEFAULT_ID_REFERENCE) || 'exam/images/id_reference.jpg';

      overlay.innerHTML = `
        <div class="id-verification-card">
          <div class="id-verification-header">
            <div class="id-verification-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <h2 class="id-verification-title">Camera Proctoring & ID Verification</h2>
            <div style="font-size:12px;font-weight:700;color:var(--clr-primary,#1B4F8A);text-transform:uppercase;letter-spacing:0.04em">Verificación de Identidad con Documento</div>
          </div>

          <div class="id-verification-instructions">
            <p style="margin:0 0 8px 0">
              <strong>EN:</strong> This assessment requires the proctoring system to capture <strong>3 camera snapshots</strong>: 
              <strong>1)</strong> Verification snapshot now with your photo ID, 
              <strong>2)</strong> Random mid-exam capture (between min 20-30), and 
              <strong>3)</strong> Final completion snapshot upon submission.
              Hold your ID card next to your face as shown in the reference image. 
              <strong>You must keep your camera enabled at all times</strong>; otherwise, the exam will stop immediately.
            </p>
            <p style="margin:0">
              <strong>ES:</strong> Esta prueba requiere capturar <strong>3 fotografías de supervisión</strong>: 
              <strong>1)</strong> Fotografía inicial sosteniendo su identificación con foto, 
              <strong>2)</strong> Captura aleatoria durante la prueba (min 20-30), y 
              <strong>3)</strong> Fotografía de finalización al enviar.
              Sostenga su documento oficial de identidad junto a su rostro como en la imagen de referencia. 
              <strong>Debe mantener su cámara encendida durante todo el examen</strong> para evitar la terminación automática.
            </p>
          </div>

          <div class="id-verification-grid">
            <div class="id-verification-box">
              <div class="id-verification-box-label">
                <span>📸 Reference / Imagen de Referencia</span>
              </div>
              <div class="id-verification-preview">
                <img id="id-ref-img" src="${refImgSrc}" alt="ID Reference Example" onerror="this.onerror=null; if(window.JCAH_DEFAULT_ID_REFERENCE) this.src=window.JCAH_DEFAULT_ID_REFERENCE; else this.src='images/id_reference.jpg';">
              </div>
              <div class="id-verification-caption">
                Face and ID clearly visible / Rostro y documento visibles
              </div>
            </div>

            <div class="id-verification-box">
              <div class="id-verification-box-label" style="background:#e0f2fe;color:#0369a1">
                <span>🔴 Live Camera / Su Cámara en Vivo</span>
              </div>
              <div class="id-verification-preview">
                <video id="id-verify-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1);"></video>
                <div class="camera-face-guide" aria-hidden="true"></div>
              </div>
              <div class="id-verification-caption">
                Align yourself and hold your ID card / Alinéese y sostenga su cédula
              </div>
            </div>
          </div>

          <div style="margin: 12px 0; padding: 10px 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; text-align: left;">
            <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#1e293b;cursor:pointer">
              <input type="checkbox" id="chk-supervision-consent" style="margin-top:2px;cursor:pointer">
              <span><strong>Consentimiento Informado / Informed Consent:</strong> Autorizo la captura de fotografías durante esta evaluación para la supervisión académica de mi identidad de conformidad con las políticas de privacidad. / I consent to supervision photo capture for academic identity verification during this exam.</span>
            </label>
          </div>

          <div id="id-verify-status" style="display:none;margin-bottom:12px;font-size:13px;font-weight:600;color:var(--clr-primary)">
            ⏳ Capturing photo and initializing proctoring...
          </div>

          <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
            <button type="button" class="btn btn-ghost" id="btn-cancel-id-verify" style="min-width:110px">
              Cancel / Cancelar
            </button>
            <button type="button" class="btn btn-primary btn-lg" id="btn-capture-id-verify" style="min-width:240px;display:inline-flex;align-items:center;justify-content:center;gap:8px">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              <span>Take Photo & Start / Tomar Foto y Comenzar</span>
            </button>
          </div>

          <div style="margin-top: 10px; text-align: center;">
            <button type="button" id="btn-proctor-exemption" style="color:#64748b;font-size:11px;text-decoration:underline;background:none;border:none;cursor:pointer">
              Solicitar exención autorizada de cámara / Request proctor camera exemption
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const verifyVideo = document.getElementById('id-verify-video');
      if (verifyVideo && _stream) {
        verifyVideo.srcObject = _stream;
        verifyVideo.play().catch(e => console.warn('Preview video play error:', e));
      }

      const captureBtn = document.getElementById('btn-capture-id-verify');
      const cancelBtn = document.getElementById('btn-cancel-id-verify');
      const statusEl = document.getElementById('id-verify-status');
      const exemptBtn = document.getElementById('btn-proctor-exemption');
      const consentChk = document.getElementById('chk-supervision-consent');

      if (consentChk) {
        consentChk.onchange = () => {
          consentChk.hasUserChanged = true;
          if (consentChk.checked) {
            if (statusEl && statusEl.innerHTML.includes('Consentimiento requerido')) {
              statusEl.style.display = 'none';
            }
            const parentBox = (consentChk.closest ? consentChk.closest('div') : null) || consentChk.parentElement;
            if (parentBox) {
              parentBox.style.borderColor = '#cbd5e1';
              parentBox.style.backgroundColor = '#f8fafc';
            }
          }
        };
      }

      if (exemptBtn) {
        exemptBtn.onclick = async () => {
          const authCode = (typeof prompt !== 'undefined')
            ? prompt('Ingrese código de exención otorgado por el supervisor / Enter proctor authorization code:')
            : null;
          if (!authCode || !authCode.trim()) return;

          const code = authCode.trim();
          const codeUpper = code.toUpperCase();
          const configuredCodes = (_exam && _exam.proctorExemptions ? String(_exam.proctorExemptions).split(',') : [])
            .map(c => c.trim().toUpperCase())
            .filter(Boolean);
          const examPasscode = (_exam && (_exam.passcode || _exam.accessCode)) ? String(_exam.passcode || _exam.accessCode).trim().toUpperCase() : '';

          let valid = false;
          let msg = '';

          // 1. Check local/offline authorization first (author-configured exemption codes or exam passcode)
          if (configuredCodes.includes(codeUpper) || (examPasscode && codeUpper === examPasscode)) {
            valid = true;
            msg = 'Exención de cámara autorizada por el supervisor / Proctor camera exemption authorized.';
          } else {
            // 2. Query Google Apps Script Web App
            const webhookUrl = getWebhookUrl();
            const studentId = _attempt ? (_attempt.studentId || _attempt.candidateId || '') : '';

            if (webhookUrl) {
              if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.color = 'var(--clr-primary,#1B4F8A)';
                statusEl.innerHTML = '⏳ Verificando código de exención con el servidor...';
              }
              try {
                const res = await fetch(webhookUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'verify_exemption',
                    code: code,
                    studentId: studentId
                  })
                });
                const json = await res.json();
                valid = json && (json.valid === true || json.success === true);
                msg = json && json.message ? json.message : (valid ? 'Exención autorizada.' : 'Código de exención no válido.');
              } catch (exErr) {
                console.warn('Exemption verification error:', exErr);
                valid = false;
                msg = 'Error de conexión al verificar el código de exención.';
              }
            } else {
              valid = false;
              msg = 'Código de exención no válido.';
            }
          }

          if (!valid) {
            if (statusEl) {
              statusEl.style.display = 'block';
              statusEl.style.color = '#dc2626';
              statusEl.innerHTML = `❌ ${escapeHtml(msg)}`;
            }
            if (typeof alert !== 'undefined') alert(msg);
            return;
          }

          if (_attempt) {
            _attempt.cameraExempt = true;
            _attempt.cameraExemptReason = 'Proctor Exemption: ' + code;
            _attempt.cameraExemptionCode = code;
            _attempt.cameraExemptAt = new Date().toISOString();
          }
          _isIdentityVerifying = false;
          stopCamera();
          if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
          resolve(true);
        };
      }

      captureBtn.onclick = async () => {
        if (!consentChk || !consentChk.checked) {
          // Visual non-blocking validation: do not use window.alert to avoid window blur and camera track termination
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#dc2626';
            statusEl.innerHTML = '⚠️ <strong>Consentimiento requerido / Consent Required:</strong> Debe marcar la casilla de consentimiento informado para continuar con la supervisión.<br><span style="font-size:12px;color:#6b7280">You must check the informed consent box to proceed with proctored verification.</span>';
          }
          if (consentChk) {
            const parentBox = (consentChk.closest ? consentChk.closest('div') : null) || consentChk.parentElement;
            if (parentBox) {
              parentBox.style.borderColor = '#dc2626';
              parentBox.style.backgroundColor = '#fef2f2';
              setTimeout(() => {
                if (parentBox) {
                  parentBox.style.borderColor = '#cbd5e1';
                  parentBox.style.backgroundColor = '#f8fafc';
                }
              }, 4000);
            }
            try { consentChk.focus(); } catch (_) {}
          }
          return;
        }

        if (_attempt) {
          _attempt.supervisionConsent = true;
          _attempt.supervisionConsentGivenAt = new Date().toISOString();
        }

        captureBtn.disabled = true;
        cancelBtn.disabled = true;
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = 'var(--clr-primary,#1B4F8A)';
          statusEl.innerHTML = '⏳ Capturing photo and initializing proctoring...';
        }

        await new Promise(r => setTimeout(r, 250));
        const dataUrl = await capturePhoto('initial');

        if (!dataUrl) {
          // Frame capture failed: camera turned off, blocked, or not providing frames
          captureBtn.disabled = false;
          cancelBtn.disabled = false;
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#dc2626';
            statusEl.innerHTML = '❌ <strong>Error de captura / Camera Error:</strong> No se detectó imagen de la cámara. Verifique que su cámara esté encendida, no esté tapada o bloqueada y vuelva a intentarlo.<br><span style="font-size:12px;color:#6b7280">Could not capture camera frame. Ensure your camera is plugged in, uncovered, and try again.</span>';
          }
          return; // DO NOT DISMISS MODAL! DO NOT PROCEED TO EXAM!
        }

        _isIdentityVerifying = false;
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(true);
      };

      cancelBtn.onclick = () => {
        _isIdentityVerifying = false;
        stopCamera();
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(false);
      };
    });
  }

  function cleanup() {
    _isActive = false;
    _isIdentityVerifying = false;
    _isCameraLocked = false;
    document.removeEventListener('contextmenu', _handleContextMenu, true);
    window.removeEventListener('beforeunload', _handleBeforeUnload);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleBlur);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
    document.removeEventListener('MSFullscreenChange', handleFullscreenChange);

    if (_cameraCheckInterval) clearInterval(_cameraCheckInterval);
    if (_cameraReconnectTimer) clearInterval(_cameraReconnectTimer);
    _randomPhotoTimers.forEach(t => clearTimeout(t));
    _randomPhotoTimers = [];

    hideCameraLockOverlay();

    if (_stream) {
      try {
        _stream.getTracks().forEach(track => track.stop());
      } catch (_) {}
      _stream = null;
    }
  }

  /**
   * Record automatic translation attempt in attempt audit trail
   */
  function recordTranslationViolation() {
    if (!_isActive) return;
    if (_attempt) {
      if (!_attempt.translationAttempts) _attempt.translationAttempts = 0;
      _attempt.translationAttempts += 1;
      if (!_attempt.violations) _attempt.violations = [];
      _attempt.violations.push({
        type: 'TRANSLATION_TOOL_DETECTED',
        at: new Date().toISOString(),
        message: 'Browser automatic translation tool was activated during assessment'
      });
      JCAHAttemptStore.saveAttempt(_attempt);
    }
  }

  return {
    init,
    isFullscreen,
    requestFullscreen,
    exitFullscreen,
    toggleFullscreen,
    startCamera,
    stopCamera,
    isCameraProctoringEnabled,
    handleCameraInterruption,
    showCameraLockOverlay,
    hideCameraLockOverlay,
    attemptCameraReconnect,
    attachVideoStream,
    capturePhoto,
    captureFinishPhoto,
    getDriveFolderId,
    getWebhookUrl,
    showIdentityVerificationModal,
    triggerViolation,
    terminateExam,
    cleanup,
    pauseForMicPermission,
    resumeAfterMicPermission,
    setTranslationHold,
    recordTranslationViolation,
  };
})();

if (typeof window !== 'undefined') {
  window.JCAHSupervision = JCAHSupervision;
}
if (typeof module !== 'undefined') {
  module.exports = JCAHSupervision;
}

/**
 * JCAH Exam Delivery — Automatic Translation Guard (v3.0)
 * ------------------------------------------------------------------
 * Enforces automatic translation suppression and real-time anti-cheat defense:
 *
 *  1. Anti-Translation Directives:
 *     The exam pages declare translate="no" + <meta name="google" content="notranslate">
 *     along with <meta name="googlebot" content="notranslate"> and mark html, body, and all
 *     question containers with "notranslate" class and translate="no" attribute.
 *
 *  2. Multi-Engine Real-Time Detection:
 *     - Google Chrome / Google Translate (class "translated-ltr|-rtl", injected <font> wrappers,
 *       .goog-te frames, google-src-text, etc.)
 *     - Microsoft Edge (attributes _msttexthash, _msthash, _mstmutation, etc.)
 *     - Browser Extensions (TWP, DeepL, ImTranslator, etc.)
 *     - Mutated HTML lang attribute (from en to es, fr, etc.)
 *     - Text Sentinel Canary (placed in document flow, detects translation rewrites)
 *
 *  3. Defense & Locking:
 *     - Exam is immediately LOCKED behind an unclosable bilingual shield.
 *     - Media is paused, and exam countdown timer is frozen (jcah:exam-lock).
 *     - When candidate turns off translation and clicks Try Again (or clicks "Show Original"),
 *       the exam unlocks, countdown resumes, and current section is re-rendered clean from memory.
 */
const JCAHTranslationGuard = (() => {

  // English sentinel canary item placed inside document flow.
  const SENTINEL_TEXT = 'English assessment integrity test item. Do not translate this phrase.';

  let _sentinel = null;
  let _overlay = null;
  let _locked = false;
  let _checkTimer = null;
  let _observer = null;
  let _initialLang = 'en';
  let _hadHardMarker = false;

  /** The exam app marks this once the attempt has been submitted. */
  function examEnded() {
    try { return window.__JCAH_EXAM_STATE__ === 'submitted'; } catch (e) { return false; }
  }

  /** Ensure the sentinel canary exists and is attached to document.body. */
  function ensureSentinel() {
    try {
      if (!document.body) return null;
      if (_sentinel && _sentinel.isConnected) return _sentinel;
      const existing = document.getElementById('jcah-translation-sentinel');
      if (existing && existing.isConnected) {
        _sentinel = existing;
        return _sentinel;
      }
      _sentinel = document.createElement('div');
      _sentinel.id = 'jcah-translation-sentinel';
      _sentinel.setAttribute('aria-hidden', 'true');
      _sentinel.setAttribute('translate', 'yes');
      _sentinel.textContent = SENTINEL_TEXT;
      // In document flow at minimal opacity so active translation engines process it
      _sentinel.style.cssText = 'position:fixed !important;bottom:0 !important;right:0 !important;width:1px !important;height:1px !important;opacity:0.01 !important;overflow:hidden !important;pointer-events:none !important;user-select:none !important;z-index:-1 !important;';
      document.body.appendChild(_sentinel);
      if (_observer) {
        try { _observer.observe(_sentinel, { childList: true, characterData: true, subtree: true }); } catch (e) {}
      }
      return _sentinel;
    } catch (e) {
      return null;
    }
  }

  /**
   * True when an explicit live translation marker is currently active on the page
   * (e.g. Chromium translated-ltr/rtl class, visible Google Translate banner, or active TWP flag).
   */
  function hasHardTranslationMarker() {
    try {
      const de = document.documentElement;
      if (!de) return false;

      // 1. Google Translate / Chrome / Chromium active marker classes on <html> or <body>
      const htmlCls = de.getAttribute('class') || '';
      const bodyCls = (document.body && document.body.getAttribute('class')) || '';
      if (/(?:^|\s)(translated-ltr|translated-rtl)(?:\s|$)/.test(htmlCls + ' ' + bodyCls)) return true;

      // 2. Visible Google Translate top banner frame
      const banner = document.querySelector('iframe.goog-te-banner-frame, .goog-te-banner-frame');
      if (banner) {
        const st = (typeof window !== 'undefined' && window.getComputedStyle) ? window.getComputedStyle(banner) : null;
        const isVisible = (!st || (st.display !== 'none' && st.visibility !== 'hidden')) &&
                          ((banner.offsetWidth || 0) > 0 || (banner.offsetHeight || 0) > 0);
        if (isVisible) return true;
      }

      // 3. Explicit active TWP (Translate Web Pages) state attribute
      const twpHtml = (de.getAttribute('data-twp-translated') || '').toLowerCase().trim();
      const twpBody = (document.body && (document.body.getAttribute('data-twp-translated') || '').toLowerCase().trim()) || '';
      if (twpHtml === 'true' || twpHtml === 'yes' || twpBody === 'true' || twpBody === 'yes') {
        return true;
      }
    } catch (e) {}
    return false;
  }

  /**
   * Clean up residual translation DOM artifacts (leftover <font> wrappers, Edge _mst* hashes,
   * mutated lang attributes, and stale sentinel text) once active translation is turned off.
   */
  function cleanTranslationArtifacts() {
    try {
      const de = document.documentElement;
      if (de) {
        de.removeAttribute('data-google-lang');
        de.removeAttribute('data-twp-translated');
        de.setAttribute('lang', _initialLang || 'en');
      }
      if (document.body) {
        document.body.removeAttribute('data-google-lang');
        document.body.removeAttribute('data-twp-translated');
        document.body.querySelectorAll('[_msttexthash], [_msthash], [_mstmutation], [data-twp-translated], [data-google-lang]').forEach(function (el) {
          el.removeAttribute('_msttexthash');
          el.removeAttribute('_msthash');
          el.removeAttribute('_mstmutation');
          el.removeAttribute('data-twp-translated');
          el.removeAttribute('data-google-lang');
        });
        document.body.querySelectorAll('font').forEach(function (fontEl) {
          const parent = fontEl.parentNode;
          if (!parent) return;
          while (fontEl.firstChild) {
            parent.insertBefore(fontEl.firstChild, fontEl);
          }
          parent.removeChild(fontEl);
        });
      }
      ensureSentinel();
      if (_sentinel) {
        _sentinel.innerHTML = '';
        _sentinel.textContent = SENTINEL_TEXT;
      }
    } catch (e) {}
  }

  /** True when the browser/device or extension currently shows the page translated. */
  function isTranslationActive() {
    try {
      const de = document.documentElement;
      if (!de) return false;

      // 1. Hard active markers (translated-ltr/rtl, visible goog-te-banner-frame, active TWP)
      if (hasHardTranslationMarker()) {
        _hadHardMarker = true;
        return true;
      }

      // If a hard marker (like Chrome's translated-ltr) was previously active and has just
      // been removed because the user clicked "Show original", clean residual artifacts first.
      if (_hadHardMarker) {
        _hadHardMarker = false;
        cleanTranslationArtifacts();
      }

      // 2. HTML lang attribute mutated from English to another language by an active translator
      const currentLang = (de.getAttribute('lang') || '').toLowerCase().trim();
      const baseLang = (_initialLang || 'en').toLowerCase().trim();
      if (currentLang && currentLang !== baseLang && currentLang !== 'en' && !currentLang.startsWith('en-') && !currentLang.startsWith('en_')) {
        if (['es', 'fr', 'de', 'pt', 'zh', 'ja', 'it', 'ru', 'ar', 'ko', 'nl', 'pl', 'tr', 'vi', 'hi'].some(l => currentLang.startsWith(l))) {
          return true;
        }
      }

      // 3. Active Google translate language attribute on <html> or <body>
      const gLang = (de.getAttribute('data-google-lang') || (document.body && document.body.getAttribute('data-google-lang')) || '').toLowerCase().trim();
      if (gLang && gLang !== 'en' && !gLang.startsWith('en-') && gLang !== 'original') {
        return true;
      }

      // 4. Translation canary rewritten / replaced / wrapped by browser translator (e.g. Edge, Chrome, Safari, extensions)
      const sentinel = ensureSentinel();
      if (sentinel && sentinel.isConnected) {
        const currentText = (sentinel.textContent || '').replace(/\s+/g, ' ').trim();
        if (currentText.length > 0 && currentText !== SENTINEL_TEXT) return true;
        if (sentinel.querySelector('font')) return true;
      }
    } catch (e) {
      // Never crash the exam because of a detection error.
    }
    return false;
  }

  /** Pause any media that may be playing while the exam is locked. */
  function pauseMedia() {
    try {
      document.querySelectorAll('audio, video').forEach(function (el) {
        try { el.pause(); } catch (e) {}
      });
    } catch (e) {}
  }

  function showOverlay() {
    if (_overlay && _overlay.isConnected) return;
    _overlay = document.createElement('div');
    _overlay.id = 'jcah-translation-overlay';
    _overlay.setAttribute('role', 'alertdialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.setAttribute('aria-labelledby', 'jcah-translation-title');
    _overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,0.85);backdrop-filter:blur(4px);';
    _overlay.innerHTML = `
      <div class="notranslate" translate="no" role="document" style="max-width:540px;width:100%;background:#ffffff;color:#1A2332;border-radius:16px;padding:32px 28px;box-shadow:0 24px 60px rgba(0,0,0,0.45);text-align:center;font-family:Arial,Helvetica,sans-serif;">
        <div style="width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:#FEF3C7;display:flex;align-items:center;justify-content:center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
        </div>
        <h2 id="jcah-translation-title" style="margin:0 0 14px;font-size:21px;font-weight:800;color:#1A2332;">Automatic Translation Prohibited / Traducción Prohibida</h2>
        <div style="text-align:left;font-size:13.5px;line-height:1.6;color:#334155;margin-bottom:14px;">
          <p style="margin:0 0 8px;">
            <strong>English:</strong> Automatic translation tools are strictly prohibited during this English Language Proficiency Assessment to maintain exam validity and standardized conditions. Your exam is temporarily paused.
          </p>
          <p style="margin:0;">
            <strong>Español:</strong> El uso de herramientas de traducción automática está estrictamente prohibido en esta evaluación de nivel de inglés. El examen ha sido pausado para garantizar la validez de la prueba.
          </p>
        </div>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;margin-bottom:20px;text-align:left;font-size:12.5px;line-height:1.5;color:#475569;">
          <strong>💡 How to disable translation / Cómo desactivar la traducción:</strong><br>
          Look at the top-right of your browser address bar. Click the Translation icon <strong>[文/A]</strong> and select <strong>"Show original"</strong> (o <em>"Mostrar original"</em> / <em>"No traducir nunca este sitio"</em>), then click the button below.
        </div>
        <button type="button" id="jcah-translation-retry" style="width:100%;padding:14px 20px;background:#1B4F8A;color:#ffffff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;transition:background 0.2s;" onclick="JCAHTranslationGuard.tryAgain()">
          I Have Disabled Translation — Resume Exam / Reanudar Examen
        </button>
      </div>`;
    document.body.appendChild(_overlay);
  }

  function hideOverlay() {
    if (_overlay && _overlay.isConnected) _overlay.remove();
  }

  function lock() {
    if (_locked) return;
    _locked = true;
    pauseMedia();
    
    // Suspend proctoring fullscreen violations while user handles browser menu
    try {
      if (typeof JCAHSupervision !== 'undefined' && JCAHSupervision.setTranslationHold) {
        JCAHSupervision.setTranslationHold(true);
      }
    } catch (e) {}

    // Record violation in attempt audit trail
    try {
      if (typeof JCAHSupervision !== 'undefined' && JCAHSupervision.recordTranslationViolation) {
        JCAHSupervision.recordTranslationViolation();
      }
    } catch (e) {}

    showOverlay();
    try {
      document.dispatchEvent(new CustomEvent('jcah:exam-lock', { detail: { reason: 'translation' } }));
    } catch (e) {}
  }

  function unlock() {
    if (!_locked) return;
    _locked = false;
    hideOverlay();
    try {
      if (typeof JCAHSupervision !== 'undefined' && JCAHSupervision.setTranslationHold) {
        JCAHSupervision.setTranslationHold(false);
      }
    } catch (e) {}
    try {
      document.dispatchEvent(new CustomEvent('jcah:exam-unlock'));
    } catch (e) {}
  }

  /** Re-run the detection; called periodically, on DOM mutations and by Try Again. */
  function check() {
    if (examEnded()) {
      if (_locked) unlock();
      return;
    }
    if (isTranslationActive()) {
      lock();
    } else if (_locked) {
      unlock();
    }
  }

  function createSentinel() {
    ensureSentinel();
  }

  function start() {
    try {
      if (document.documentElement) {
        const initLang = (document.documentElement.getAttribute('lang') || '').trim();
        if (initLang) _initialLang = initLang;
      }
      createSentinel();
      if (typeof MutationObserver !== 'undefined' && document.documentElement) {
        _observer = new MutationObserver(function () { 
          check(); 
        });
        // 1. Observe <html> attributes
        _observer.observe(document.documentElement, { 
          attributes: true, 
          attributeFilter: ['class', 'lang', 'data-google-lang', 'data-twp-translated'] 
        });
        // 2. Observe <body> for children and active translation attributes
        if (document.body) {
          _observer.observe(document.body, { 
            childList: true, 
            subtree: true, 
            attributes: true, 
            attributeFilter: ['class', 'lang', 'data-twp-translated', 'data-google-lang'] 
          });
        }
        // 3. Observe sentinel text and children
        if (_sentinel) {
          _observer.observe(_sentinel, { childList: true, characterData: true, subtree: true });
        }
      }
      setTimeout(check, 300);
      _checkTimer = setInterval(check, 800);
    } catch (e) {
      console.warn('[TranslationGuard] Could not start:', e);
    }
  }

  function tryAgain() {
    if (examEnded()) { unlock(); return; }
    if (!hasHardTranslationMarker()) {
      cleanTranslationArtifacts();
    }
    check();
    if (_locked) {
      const btn = document.getElementById('jcah-translation-retry');
      if (btn) {
        btn.textContent = 'Translation is still active — Please select "Show original" and try again';
        btn.style.background = '#DC2626';
        setTimeout(() => {
          if (btn) {
            btn.textContent = 'I Have Disabled Translation — Resume Exam / Reanudar Examen';
            btn.style.background = '#1B4F8A';
          }
        }, 2500);
      }
    }
  }

  // Auto-start only when running inside a browser document.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  return { start, check, tryAgain, isTranslationActive, cleanTranslationArtifacts, lock, unlock };
})();

// Global contextmenu suppression to prevent right-click -> "Translate to..."
if (typeof document !== 'undefined') {
  document.addEventListener('contextmenu', function (e) {
    if (typeof window !== 'undefined' && window.__JCAH_ACCESSIBILITY_MODE__) {
      return; // Permitted for screen readers and assistive technology
    }
    e.preventDefault();
    e.stopPropagation();
    return false;
  }, true);
}

if (typeof window !== 'undefined') {
  window.JCAHTranslationGuard = JCAHTranslationGuard;
  window.JCAHSupervision = JCAHSupervision;
}
if (typeof module !== 'undefined') module.exports = JCAHTranslationGuard;
