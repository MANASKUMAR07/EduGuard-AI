/**
 * EduGuard AI - High-Accuracy Computer Vision Proctoring Engine
 * Multi-Stage Neural & Universal YCbCr Chrominance Face Detection
 */

class EduProctorEngine {
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.canvasElement = options.canvasElement || null;
    this.onViolation = options.onViolation || (() => {});
    this.onTelemetry = options.onTelemetry || (() => {});

    this.isActive = false;
    this.audioCtx = null;

    // Proctoring Metrics State
    this.tabSwitches = 0;
    this.windowBlurs = 0;
    this.focusScore = 100;
    this.gazeState = 'Center (Focused)';
    this.isFaceDetected = true;
    this.detectedFacesCount = 1;

    // Temporal Smoothing & Presence Thresholds
    this.consecutiveNoFaceFrames = 0;
    this.consecutiveGazeDriftFrames = 0;
    this.smoothedCentroidX = null;
    this.smoothedCentroidY = null;
    this.lastViolationTimestamp = 0;
    this.violationCooldownMs = 8000;

    // Native ML FaceDetector support (Chromium Hardware Accelerated)
    this.nativeDetector = null;
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      try {
        this.nativeDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
      } catch (e) {
        this.nativeDetector = null;
      }
    }

    this.initEventListeners();
  }

  initEventListeners() {
    // 1. Browser Tab Visibility Change Interception
    document.addEventListener('visibilitychange', () => {
      if (!this.isActive) return;

      if (document.hidden) {
        this.tabSwitches++;
        this.penalizeFocus(15);
        this.triggerMalpracticeViolation('Tab Switch Detected', 'Student switched away from the examination/lecture tab.');
      }
    });

    // 2. Window Blur (Application Switch or Minimize)
    window.addEventListener('blur', () => {
      if (!this.isActive) return;
      this.windowBlurs++;
      this.penalizeFocus(10);
      this.triggerMalpracticeViolation('Window / App Focus Lost', 'Student navigated to a third-party application or split screen.');
    });

    // 3. Prevent Copy / Paste / Developer Tools Cheating Shortcuts
    window.addEventListener('keydown', (e) => {
      if (!this.isActive) return;

      // Intercept Ctrl+C, Ctrl+V, Ctrl+Shift+I, F12
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v' || e.key === 'u')) {
        e.preventDefault();
        this.triggerMalpracticeViolation('Clipboard / Inspect Shortcut Blocked', `Attempted prohibited shortcut (Ctrl+${e.key.toUpperCase()}).`);
      }
      if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I')) {
        e.preventDefault();
        this.triggerMalpracticeViolation('DevTools Access Attempt', 'Attempted to open browser developer tools.');
      }
    });

    // Audio Context Initializer on User Interaction
    const unlockAudio = () => {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.audioCtx = new AudioContext();
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
  }

  playAlarmSound(type = 'danger') {
    try {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.audioCtx = new AudioContext();
      }
      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === 'danger') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, this.audioCtx.currentTime); // A5
        osc.frequency.exponentialRampToValueAtTime(440, this.audioCtx.currentTime + 0.35);
        gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.35);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.35);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, this.audioCtx.currentTime); // D5
        gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.2);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.2);
      }
    } catch (e) {
      console.warn('Web Audio playback error:', e);
    }
  }

  penalizeFocus(points) {
    this.focusScore = Math.max(10, this.focusScore - points);
  }

  triggerMalpracticeViolation(violationType, details) {
    const now = Date.now();
    if (now - this.lastViolationTimestamp < this.violationCooldownMs) {
      return; // prevent spamming within cooldown
    }
    this.lastViolationTimestamp = now;

    this.playAlarmSound('danger');
    const snapshotBase64 = this.captureCurrentSnapshot();

    this.onViolation({
      violationType,
      severity: 'High',
      details,
      snapshot: snapshotBase64,
      timestamp: new Date().toISOString()
    });
  }

  startMonitoring(videoElement, canvasElement) {
    if (videoElement) this.videoElement = videoElement;
    if (canvasElement) this.canvasElement = canvasElement;
    this.isActive = true;

    this.runVisionLoop();
  }

  stopMonitoring() {
    this.isActive = false;
  }

  captureCurrentSnapshot() {
    if (!this.videoElement || this.videoElement.readyState < 2) {
      return null;
    }
    try {
      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = 400;
      snapCanvas.height = 300;
      const ctx = snapCanvas.getContext('2d');
      ctx.drawImage(this.videoElement, 0, 0, snapCanvas.width, snapCanvas.height);

      // Watermark with timestamp and violation alert
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, snapCanvas.height - 28, snapCanvas.width, 28);
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`🚨 EduGuard AI Audit | ${new Date().toLocaleTimeString()}`, 10, snapCanvas.height - 10);

      return snapCanvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      console.warn('Snapshot capture error:', e);
      return null;
    }
  }

  async runVisionLoop() {
    if (!this.isActive) return;

    if (this.videoElement && this.videoElement.readyState >= 2 && this.canvasElement) {
      await this.analyzeFrame();
    }

    requestAnimationFrame(() => this.runVisionLoop());
  }

  async analyzeFrame() {
    const video = this.videoElement;
    const canvas = this.canvasElement;
    if (!video || !canvas || video.paused || video.ended) return;

    const ctx = canvas.getContext('2d');
    const vWidth = video.videoWidth || video.clientWidth || 640;
    const vHeight = video.videoHeight || video.clientHeight || 480;

    if (canvas.width !== vWidth || canvas.height !== vHeight) {
      canvas.width = vWidth;
      canvas.height = vHeight;
    }

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    let detectedFace = false;
    let faceBox = null;
    let centroidX = width / 2;
    let centroidY = height / 2;

    // ============================================================
    // PASS 1: Native Machine Learning FaceDetector (Chromium ML)
    // ============================================================
    if (this.nativeDetector) {
      try {
        const faces = await this.nativeDetector.detect(video);
        if (faces && faces.length > 0) {
          detectedFace = true;
          this.detectedFacesCount = faces.length;

          if (faces.length > 1) {
            this.triggerMalpracticeViolation('Multiple People Detected in Frame', `Proctor detected ${faces.length} individuals in camera feed.`);
          }

          const primaryFace = faces[0].boundingBox;
          centroidX = primaryFace.x + (primaryFace.width / 2);
          centroidY = primaryFace.y + (primaryFace.height / 2);
          faceBox = {
            w: primaryFace.width * 1.1,
            h: primaryFace.height * 1.2
          };
        }
      } catch (err) {
        // Fallback to Pass 2 below
      }
    }

    // ============================================================
    // PASS 2: Universal YCbCr + Adaptive Chrominance & Motion Filter
    // ============================================================
    if (!detectedFace) {
      const sampleW = 80;
      const sampleH = 60;
      if (!this.offCanvas) {
        this.offCanvas = document.createElement('canvas');
        this.offCanvas.width = sampleW;
        this.offCanvas.height = sampleH;
        this.offCtx = this.offCanvas.getContext('2d', { willReadFrequently: true });
      }

      let imgData;
      try {
        this.offCtx.drawImage(video, 0, 0, sampleW, sampleH);
        imgData = this.offCtx.getImageData(0, 0, sampleW, sampleH);
      } catch (e) {
        return;
      }

      const data = imgData.data;
      let matchedPixels = 0;
      let sumX = 0;
      let sumY = 0;

      for (let y = 0; y < sampleH; y++) {
        for (let x = 0; x < sampleW; x++) {
          const idx = (y * sampleW + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // 1. Convert to YCbCr Color Space (Universal Human Chrominance Locus)
          const Cb = 128 - (0.168736 * r) - (0.331264 * g) + (0.5 * b);
          const Cr = 128 + (0.5 * r) - (0.418688 * g) - (0.081312 * b);

          // Universal Chrominance Range (Covers all human complexions in warm/cool/LED lighting)
          const isYCbCrSkin = (Cr >= 130 && Cr <= 180 && Cb >= 75 && Cb <= 138);

          // 2. Normalized RGB Fallback for low-light & backlit rooms
          const isRGBRelaxed = (r > 35 && g > 25 && b > 15) && (r > b || Math.abs(r - g) < 40) && ((r + g + b) > 110);

          if (isYCbCrSkin || isRGBRelaxed) {
            matchedPixels++;
            sumX += x;
            sumY += y;
          }
        }
      }

      const totalPixels = sampleW * sampleH;
      const matchRatio = matchedPixels / totalPixels;

      // Relaxed presence threshold (works reliably in all room lightings)
      if (matchRatio >= 0.015 && matchedPixels > 0) {
        detectedFace = true;
        const rawCentroidX = (sumX / matchedPixels) * (width / sampleW);
        const rawCentroidY = (sumY / matchedPixels) * (height / sampleH);

        centroidX = rawCentroidX;
        centroidY = rawCentroidY;
      }
    }

    // ============================================================
    // TEMPORAL POSITION SMOOTHING (Kalman / Low-Pass Filter)
    // ============================================================
    if (detectedFace) {
      if (this.smoothedCentroidX === null) {
        this.smoothedCentroidX = centroidX;
        this.smoothedCentroidY = centroidY;
      } else {
        // Smooth coordinates across frames to eliminate jitter
        this.smoothedCentroidX += (centroidX - this.smoothedCentroidX) * 0.35;
        this.smoothedCentroidY += (centroidY - this.smoothedCentroidY) * 0.35;
      }
      centroidX = this.smoothedCentroidX;
      centroidY = this.smoothedCentroidY;
    }

    // Normalize coordinates (-1 to 1)
    const normX = ((centroidX / width) - 0.5) * 2;
    const normY = ((centroidY / height) - 0.5) * 2;

    let currentGaze = 'Center (Focused)';
    let statusColor = '#10b981'; // Green

    if (!detectedFace) {
      this.consecutiveNoFaceFrames++;
      this.consecutiveGazeDriftFrames = 0;

      // Allow 3.5 seconds of transient movement before declaring absence violation
      if (this.consecutiveNoFaceFrames > 90) {
        currentGaze = 'No Student in Frame';
        statusColor = '#ef4444';
        this.penalizeFocus(4);
        this.triggerMalpracticeViolation('Student Absence from Camera', 'Student completely left the proctoring camera frame.');
      } else {
        currentGaze = 'Refocusing...';
        statusColor = '#f59e0b';
      }
    } else {
      this.consecutiveNoFaceFrames = 0;
      this.isFaceDetected = true;

      // Gaze Direction & Phone Use Heuristics
      if (normX < -0.42) {
        currentGaze = 'Looking Left';
        statusColor = '#f59e0b';
        this.consecutiveGazeDriftFrames++;
      } else if (normX > 0.42) {
        currentGaze = 'Looking Right';
        statusColor = '#f59e0b';
        this.consecutiveGazeDriftFrames++;
      } else if (normY > 0.45) {
        currentGaze = 'Looking Down (Phone / Notes?)';
        statusColor = '#ef4444';
        this.consecutiveGazeDriftFrames++;
      } else {
        currentGaze = 'Center (Focused)';
        statusColor = '#10b981';
        this.consecutiveGazeDriftFrames = 0;
      }

      // If sustained gaze drift (> 3.5 seconds)
      if (this.consecutiveGazeDriftFrames > 90) {
        this.penalizeFocus(6);
        this.triggerMalpracticeViolation(`Suspicious Gaze: ${currentGaze}`, 'Prolonged visual attention drift away from screen.');
        this.consecutiveGazeDriftFrames = 0;
      }
    }

    this.gazeState = currentGaze;

    // ============================================================
    // RENDER MODERN CYBERPUNK HUD BRACKETS ON CANVAS
    // ============================================================
    if (detectedFace) {
      const boxW = (faceBox && faceBox.w) || Math.min(width * 0.45, 240);
      const boxH = (faceBox && faceBox.h) || Math.min(height * 0.56, 280);

      // Mirror X position to perfectly align with mirrored selfie video
      const boxX = (width - centroidX) - (boxW / 2);
      const boxY = Math.max(10, centroidY - (boxH / 2));

      // Corner target brackets
      const cornerLen = 22;
      ctx.strokeStyle = statusColor;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.shadowColor = statusColor;
      ctx.shadowBlur = 8;

      // Top-Left
      ctx.beginPath();
      ctx.moveTo(boxX, boxY + cornerLen);
      ctx.lineTo(boxX, boxY);
      ctx.lineTo(boxX + cornerLen, boxY);
      ctx.stroke();

      // Top-Right
      ctx.beginPath();
      ctx.moveTo(boxX + boxW - cornerLen, boxY);
      ctx.lineTo(boxX + boxW, boxY);
      ctx.lineTo(boxX + boxW, boxY + cornerLen);
      ctx.stroke();

      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(boxX, boxY + boxH - cornerLen);
      ctx.lineTo(boxX, boxY + boxH);
      ctx.lineTo(boxX + cornerLen, boxY + boxH);
      ctx.stroke();

      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(boxX + boxW - cornerLen, boxY + boxH);
      ctx.lineTo(boxX + boxW, boxY + boxH);
      ctx.lineTo(boxX + boxW, boxY + boxH - cornerLen);
      ctx.stroke();

      // Center Aim Dot
      ctx.fillStyle = statusColor;
      ctx.beginPath();
      ctx.arc(boxX + boxW / 2, boxY + boxH / 2, 4, 0, Math.PI * 2);
      ctx.fill();

      // Telemetry Header Pill
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(10, 14, 26, 0.88)';
      ctx.fillRect(boxX, Math.max(0, boxY - 26), 180, 22);
      ctx.fillStyle = statusColor;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.fillText(`AI: ${currentGaze}`, boxX + 8, Math.max(14, boxY - 10));
    } else if (this.consecutiveNoFaceFrames > 90) {
      // Out of frame warning
      ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚠️ NO STUDENT IN CAMERA FRAME', width / 2, height / 2);
      ctx.textAlign = 'left';
    }

    // Telemetry Callback
    this.onTelemetry({
      gaze: currentGaze,
      faceDetected: detectedFace,
      centroid: { x: normX, y: normY },
      focusScore: this.focusScore,
      tabSwitches: this.tabSwitches
    });
  }
}

window.EduProctorEngine = EduProctorEngine;
