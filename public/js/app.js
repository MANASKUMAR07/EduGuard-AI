/**
 * EduGuard AI - Production Application Controller & UI Router
 */

document.addEventListener('DOMContentLoaded', () => {
  // Global Toast System
  window.showToast = (message, type = 'info') => {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'danger' ? '🚨' : (type === 'success' ? '✅' : (type === 'warning' ? '⚠️' : 'ℹ️'));
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  };

  // Initialize Core Subsystems
  window.classroom = new ClassroomManager();
  window.assignmentHub = new AssignmentManager();
  window.reportHub = new ReportManager();

  // =======================================================
  // AUTHENTICATION & SESSION CONTROLLER
  // =======================================================
  const authOverlay = document.getElementById('authOverlayScreen');
  const authForm = document.getElementById('authForm');
  const authRoleInput = document.getElementById('authRoleInput');
  const authRoleTabTeacher = document.getElementById('authRoleTabTeacher');
  const authRoleTabStudent = document.getElementById('authRoleTabStudent');
  const authEmailInput = document.getElementById('authEmailInput');
  const authPasswordInput = document.getElementById('authPasswordInput');
  const authNameField = document.getElementById('authNameField');
  const authNameInput = document.getElementById('authNameInput');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const authToggleLink = document.getElementById('authToggleLink');
  const authToggleText = document.getElementById('authToggleText');
  const headerLogoutBtn = document.getElementById('headerLogoutBtn');
  const togglePasswordVisibilityBtn = document.getElementById('togglePasswordVisibilityBtn');

  // Real-time UI Elements
  const emailStatus = document.getElementById('emailValidationStatus');
  const emailErrorMsg = document.getElementById('emailErrorMsg');
  const pwdErrorMsg = document.getElementById('passwordErrorMsg');
  const pwdStrengthFill = document.getElementById('pwdStrengthFill');
  const pwdStrengthLabel = document.getElementById('pwdStrengthLabel');

  const ruleLength = document.getElementById('ruleLength');
  const ruleUpper = document.getElementById('ruleUpper');
  const ruleLower = document.getElementById('ruleLower');
  const ruleNumber = document.getElementById('ruleNumber');
  const ruleSymbol = document.getElementById('ruleSymbol');

  let isRegisterMode = false;

  // Validation Logic Helpers
  function validateEmailFormat(email) {
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return re.test(String(email).toLowerCase().trim());
  }

  function validatePasswordStrength(pwd) {
    const hasLen = pwd.length >= 8;
    const hasUpper = /[A-Z]/.test(pwd);
    const hasLower = /[a-z]/.test(pwd);
    const hasNum = /[0-9]/.test(pwd);
    const hasSym = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(pwd);

    let score = 0;
    if (hasLen) score++;
    if (hasUpper) score++;
    if (hasLower) score++;
    if (hasNum) score++;
    if (hasSym) score++;

    return {
      hasLen,
      hasUpper,
      hasLower,
      hasNum,
      hasSym,
      score,
      isValid: score === 5
    };
  }

  function updateEmailUI() {
    const val = authEmailInput.value.trim();
    if (!val) {
      if (emailStatus) emailStatus.style.display = 'none';
      if (emailErrorMsg) emailErrorMsg.classList.remove('visible');
      return true;
    }
    const isValid = validateEmailFormat(val);
    if (isValid) {
      if (emailStatus) {
        emailStatus.style.display = 'inline';
        emailStatus.textContent = '✓ Valid Email';
        emailStatus.style.color = '#34d399';
      }
      if (emailErrorMsg) emailErrorMsg.classList.remove('visible');
      authEmailInput.style.borderColor = 'rgba(16, 185, 129, 0.5)';
    } else {
      if (emailStatus) {
        emailStatus.style.display = 'inline';
        emailStatus.textContent = '✕ Invalid Format';
        emailStatus.style.color = '#f87171';
      }
      if (emailErrorMsg) emailErrorMsg.classList.add('visible');
      authEmailInput.style.borderColor = 'rgba(239, 68, 68, 0.5)';
    }
    return isValid;
  }

  function updatePasswordUI() {
    const pwd = authPasswordInput.value || '';
    const res = validatePasswordStrength(pwd);

    const updateCheckItem = (el, valid) => {
      if (!el) return;
      el.className = `pwd-check-item ${valid ? 'valid' : 'invalid'}`;
      el.querySelector('span').textContent = valid ? '✓' : '●';
    };

    updateCheckItem(ruleLength, res.hasLen);
    updateCheckItem(ruleUpper, res.hasUpper);
    updateCheckItem(ruleLower, res.hasLower);
    updateCheckItem(ruleNumber, res.hasNum);
    updateCheckItem(ruleSymbol, res.hasSym);

    const pct = (res.score / 5) * 100;
    if (pwdStrengthFill) {
      pwdStrengthFill.style.width = `${pct}%`;
      if (res.score <= 2) pwdStrengthFill.style.backgroundColor = '#ef4444';
      else if (res.score <= 4) pwdStrengthFill.style.backgroundColor = '#f59e0b';
      else pwdStrengthFill.style.backgroundColor = '#10b981';
    }

    if (pwdStrengthLabel) {
      if (res.score === 5) {
        pwdStrengthLabel.textContent = '🛡️ Password Policy Satisfied (Strong)';
        pwdStrengthLabel.style.color = '#34d399';
      } else {
        pwdStrengthLabel.textContent = `Security Policy (${res.score}/5 criteria met)`;
        pwdStrengthLabel.style.color = '#f59e0b';
      }
    }

    if (res.isValid) {
      if (pwdErrorMsg) pwdErrorMsg.classList.remove('visible');
      authPasswordInput.style.borderColor = 'rgba(16, 185, 129, 0.5)';
    } else if (pwd.length > 0) {
      authPasswordInput.style.borderColor = 'rgba(245, 158, 11, 0.5)';
    }

    return res.isValid;
  }

  authEmailInput?.addEventListener('input', updateEmailUI);
  authPasswordInput?.addEventListener('input', updatePasswordUI);

  togglePasswordVisibilityBtn?.addEventListener('click', () => {
    const isPass = authPasswordInput.type === 'password';
    authPasswordInput.type = isPass ? 'text' : 'password';
    togglePasswordVisibilityBtn.textContent = isPass ? '🔒' : '👁️';
  });

  setTimeout(() => {
    updateEmailUI();
    updatePasswordUI();
  }, 100);

  const authSendOtpBtn = document.getElementById('authSendOtpBtn');
  const authOtpField = document.getElementById('authOtpField');
  const authOtpInput = document.getElementById('authOtpInput');
  const authOtpTimer = document.getElementById('authOtpTimer');
  const authOtpDemoBanner = document.getElementById('authOtpDemoBanner');

  let otpTimerInterval = null;

  function startOtpCountdown(seconds = 600) {
    if (otpTimerInterval) clearInterval(otpTimerInterval);
    let remaining = seconds;
    if (authOtpTimer) {
      authOtpTimer.textContent = `Expires in ${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, '0')}`;
    }

    otpTimerInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(otpTimerInterval);
        if (authOtpTimer) authOtpTimer.textContent = 'OTP Expired';
      } else if (authOtpTimer) {
        authOtpTimer.textContent = `Expires in ${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, '0')}`;
      }
    }, 1000);
  }

  authSendOtpBtn?.addEventListener('click', async () => {
    const email = authEmailInput.value.trim();
    const name = authNameInput.value.trim();
    const role = authRoleInput.value;

    if (!validateEmailFormat(email)) {
      window.showToast?.('Please enter a valid institutional email first.', 'danger');
      authEmailInput.focus();
      return;
    }

    try {
      authSendOtpBtn.disabled = true;
      authSendOtpBtn.textContent = '⏳ Sending...';

      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, role })
      });
      const data = await res.json();

      if (data.success) {
        window.showToast?.(`📨 Verification OTP dispatched to ${email}`, 'success');
        if (authOtpField) authOtpField.style.display = 'block';
        if (authOtpDemoBanner) {
          const previewHtml = data.emailResult?.previewUrl 
            ? `<div style="margin-top:4px;"><a href="${data.emailResult.previewUrl}" target="_blank" style="color:#38bdf8; text-decoration:underline; font-size:0.75rem;">🔗 Click to View Sent Email in Browser</a></div>`
            : `<div style="margin-top:2px; font-size:0.7rem; color:#a5b4fc;">✅ Dispatched via SMTP to ${email}</div>`;

          authOtpDemoBanner.innerHTML = `
            <div style="background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.4); border-radius:6px; padding:6px; margin-top:4px;">
              <strong>📨 Verification Code:</strong> 
              <span style="font-size:1.15rem; color:#fff; font-family:monospace; background:rgba(99,102,241,0.5); padding:2px 8px; border-radius:4px; font-weight:800; letter-spacing:2px;">${data.devOtp}</span>
              ${previewHtml}
            </div>
          `;
        }
        if (authOtpInput) {
          authOtpInput.value = data.devOtp || '';
          authOtpInput.focus();
        }
        startOtpCountdown(600);
      } else {
        window.showToast?.(data.message || 'Failed to dispatch OTP', 'danger');
      }
    } catch (e) {
      window.showToast?.('Network error sending OTP', 'danger');
    } finally {
      authSendOtpBtn.disabled = false;
      authSendOtpBtn.textContent = '🔄 Resend OTP';
    }
  });

  authToggleLink?.addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    if (isRegisterMode) {
      authNameField.style.display = 'flex';
      authNameInput.required = true;
      if (authSendOtpBtn) authSendOtpBtn.style.display = 'block';
      if (authOtpField) authOtpField.style.display = 'block';
      authSubmitBtn.innerHTML = '✅ Verify OTP & Create Account';
      authToggleText.textContent = 'Already have an account?';
      authToggleLink.textContent = 'Login Here';
    } else {
      authNameField.style.display = 'none';
      authNameInput.required = false;
      if (authSendOtpBtn) authSendOtpBtn.style.display = 'none';
      if (authOtpField) authOtpField.style.display = 'none';
      authSubmitBtn.innerHTML = '🚀 Enter Proctored Classroom';
      authToggleText.textContent = "Don't have an institution account?";
      authToggleLink.textContent = 'Register Here';
    }
  });

  const authClassCodeField = document.getElementById('authClassCodeField');
  const authClassCodeInput = document.getElementById('authClassCodeInput');
  const authTogglePrompt = document.getElementById('authTogglePrompt');

  authRoleTabTeacher?.addEventListener('click', () => {
    authRoleTabTeacher.classList.add('active');
    authRoleTabStudent?.classList.remove('active');
    authRoleTabManager?.classList.remove('active');
    authRoleInput.value = 'teacher';
    authEmailInput.value = 'teacher@eduguard.edu';
    authPasswordInput.value = 'EduGuard@2026';
    if (authClassCodeField) authClassCodeField.style.display = 'none';
    if (authTogglePrompt) authTogglePrompt.style.display = 'flex';
    updateEmailUI();
    updatePasswordUI();
  });

  authRoleTabStudent?.addEventListener('click', () => {
    authRoleTabStudent.classList.add('active');
    authRoleTabTeacher?.classList.remove('active');
    authRoleTabManager?.classList.remove('active');
    authRoleInput.value = 'student';
    authEmailInput.value = 'student@eduguard.edu';
    authPasswordInput.value = 'EduGuard@2026';
    if (authClassCodeField) authClassCodeField.style.display = 'flex';
    if (authTogglePrompt) authTogglePrompt.style.display = 'flex';
    updateEmailUI();
    updatePasswordUI();
  });

  authRoleTabManager?.addEventListener('click', () => {
    authRoleTabManager.classList.add('active');
    authRoleTabTeacher?.classList.remove('active');
    authRoleTabStudent?.classList.remove('active');
    authRoleInput.value = 'manager';
    authEmailInput.value = 'manager@eduguard.edu';
    authPasswordInput.value = 'Manager@2026';
    if (authClassCodeField) authClassCodeField.style.display = 'none';
    
    // Completely disable/hide registration for Manager role
    if (isRegisterMode) {
      authToggleLink?.click();
    }
    if (authTogglePrompt) authTogglePrompt.style.display = 'none';

    updateEmailUI();
    updatePasswordUI();
  });

  authForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authEmailInput.value.trim();
    const password = authPasswordInput.value;
    const role = authRoleInput.value;
    const name = authNameInput.value.trim();
    const classCode = authClassCodeInput?.value.trim().toUpperCase() || 'CLASS-101';
    const otp = authOtpInput?.value.trim() || '';

    if (!validateEmailFormat(email)) {
      if (emailErrorMsg) emailErrorMsg.classList.add('visible');
      window.showToast?.('Please enter a valid institutional email format.', 'danger');
      authEmailInput.focus();
      return;
    }

    const pwdRes = validatePasswordStrength(password);
    if (!pwdRes.isValid) {
      if (pwdErrorMsg) pwdErrorMsg.classList.add('visible');
      window.showToast?.('Password does not meet required policy (8+ chars, uppercase, lowercase, number, symbol).', 'danger');
      authPasswordInput.focus();
      return;
    }

    try {
      if (isRegisterMode) {
        if (!otp || otp.length !== 6) {
          window.showToast?.('Please enter the 6-digit verification code sent to your email.', 'danger');
          authOtpInput?.focus();
          return;
        }

        const res = await fetch('/api/auth/verify-otp-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, role, otp })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('🎉 Email verified! Account registered successfully.', 'success');
          completeLogin(data.data);
        } else {
          window.showToast?.(data.message || 'Registration failed', 'danger');
        }
        return;
      }

      // Login Mode
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role })
      });
      const data = await res.json();

      if (data.success) {
        if (role === 'student') {
          window.classroom.currentRoomId = classCode;
        }
        completeLogin(data.data);
      } else {
        window.showToast?.(data.message || 'Authentication error', 'danger');
      }
    } catch (err) {
      window.showToast?.('Server connection error during authentication', 'danger');
    }
  });

  async function refreshCapacityBadge() {
    try {
      const res = await fetch('/api/capacity');
      const data = await res.json();
      if (data.success) {
        const badge = document.getElementById('authCapacityBadge');
        if (badge) {
          badge.innerHTML = `🏛️ <strong>Classroom Capacity:</strong> Max 40 Students & 2 Teachers per Session (Concurrent Classes Supported)`;
        }
      }
    } catch (e) {
      console.warn('Error fetching capacity', e);
    }
  }
  refreshCapacityBadge();

  function syncRolePills(role) {
    const teacherBtn = document.getElementById('switchTeacherBtn');
    const studentBtn = document.getElementById('switchStudentBtn');
    const managerBtn = document.getElementById('switchManagerBtn');

    [teacherBtn, studentBtn, managerBtn].forEach(btn => {
      if (btn) {
        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-secondary)';
      }
    });

    if (role === 'teacher' && teacherBtn) {
      teacherBtn.classList.add('active');
      teacherBtn.style.background = 'var(--accent-primary)';
      teacherBtn.style.color = '#fff';
    } else if (role === 'student' && studentBtn) {
      studentBtn.classList.add('active');
      studentBtn.style.background = 'var(--accent-primary)';
      studentBtn.style.color = '#fff';
    } else if (role === 'manager' && managerBtn) {
      managerBtn.classList.add('active');
      managerBtn.style.background = '#8b5cf6';
      managerBtn.style.color = '#fff';
    }
  }

  function completeLogin(user) {
    localStorage.setItem('eduguard_user', JSON.stringify(user));
    authOverlay.classList.add('hidden');

    window.classroom.setRole(user.role, user.name, user.email);

    syncRolePills(user.role);
    window.assignmentHub.renderAssignments();
    if (user.role === 'manager') {
      window.managerHub?.loadManagerOverview();
    }
    window.showToast?.(`Logged in as: ${user.name} (${user.role.toUpperCase()})`, 'success');
  }

  // 1-Click Header Role Switchers
  document.getElementById('switchTeacherBtn')?.addEventListener('click', () => {
    const teacherUser = {
      name: 'Dr. Evelyn Reed',
      email: 'teacher@eduguard.edu',
      role: 'teacher',
      id: 't-001'
    };
    completeLogin(teacherUser);
  });

  document.getElementById('switchStudentBtn')?.addEventListener('click', () => {
    const studentUser = {
      name: 'Alex Johnson',
      email: 'student@eduguard.edu',
      role: 'student',
      id: 'stu-001'
    };
    completeLogin(studentUser);
  });

  document.getElementById('switchManagerBtn')?.addEventListener('click', () => {
    const managerUser = {
      name: 'Executive Manager',
      email: 'manager@eduguard.edu',
      role: 'manager',
      id: 'mgr-001'
    };
    completeLogin(managerUser);
  });

  headerLogoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('eduguard_user');
    authOverlay.classList.remove('hidden');
    authRoleTabTeacher?.click();
    window.showToast?.('Signed out of EduGuard AI.', 'info');
  });

  // Always display the Authentication & Role Portal on load
  authOverlay.classList.remove('hidden');
  authRoleTabTeacher?.click();

  // =======================================================
  // NAVIGATION TABS SWITCHER WITH STRICT ROLE GUARDS
  // =======================================================
  const navButtons = document.querySelectorAll('.nav-tab-btn');
  const viewSections = document.querySelectorAll('.view-section');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const currentRole = window.classroom?.currentRole;
      const isTeacher = currentRole === 'teacher' || currentRole === 'manager';
      const isManager = currentRole === 'manager';
      const targetView = btn.dataset.view;

      // Strict Guard: Manager Portal is accessible to Manager ONLY
      if (targetView === 'manager' && !isManager) {
        window.showToast?.('🔒 Access Denied: Executive Manager portal is restricted to authorized Managers only.', 'danger');
        return;
      }

      // Strict Guard: All student reports & AI Proctoring are accessible to Teacher & Manager ONLY
      if (!isTeacher && (targetView === 'reports' || targetView === 'proctoring' || btn.classList.contains('teacher-only-nav'))) {
        window.showToast?.('🔒 Access Denied: AI Malpractice Reports & Proctoring Analytics are strictly accessible to Teachers only.', 'danger');
        return;
      }

      navButtons.forEach(b => b.classList.remove('active'));
      viewSections.forEach(s => s.classList.remove('active'));

      btn.classList.add('active');
      let targetSection = document.getElementById(`view-${targetView}`) || document.getElementById(`${targetView}View`);
      if (targetSection) {
        targetSection.classList.add('active');
      }

      if (targetView === 'reports' && isTeacher && !window.reportHub.currentReport) {
        window.reportHub.generateLiveReport();
      }
      if (targetView === 'manager' && isManager) {
        window.managerHub?.loadManagerOverview();
      }
    });
  });

  // Universal Copy Helper function
  function copyToClipboard(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        window.showToast?.(successMsg, 'success');
      }).catch(() => fallbackCopy(text, successMsg));
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      window.showToast?.(successMsg, 'success');
    } catch (err) {
      prompt('Copy this code:', text);
    }
    textArea.remove();
  }

  // =======================================================
  // ROOM MANAGER MODAL & JOIN HANDLERS (Random Code & Knock)
  // =======================================================
  document.getElementById('openRoomManagerBtn')?.addEventListener('click', () => {
    const currentCode = window.classroom?.currentRoomId || 'CLASS-101';
    const display = document.getElementById('modalActiveRoomCodeDisplay');
    if (display) display.textContent = currentCode;
    document.getElementById('roomManagerModal')?.classList.add('active');
  });

  // 1. Header Copy Code Button
  document.getElementById('quickCopyRoomCodeBtn')?.addEventListener('click', () => {
    const code = window.classroom?.currentRoomId || 'CLASS-101';
    copyToClipboard(code, `📋 Class Code "${code}" copied to clipboard!`);
  });

  // 2. Stage Bar Copy Code Button
  document.getElementById('stageCopyCodeBtn')?.addEventListener('click', () => {
    const code = window.classroom?.currentRoomId || 'CLASS-101';
    copyToClipboard(code, `📋 Class Code "${code}" copied to clipboard!`);
  });

  // 3. Modal Copy Code Button
  document.getElementById('modalCopyCodeBtn')?.addEventListener('click', () => {
    const code = window.classroom?.currentRoomId || 'CLASS-101';
    copyToClipboard(code, `📋 Class Code "${code}" copied!`);
  });

  // 4. Modal Copy Invitation Link Button
  document.getElementById('modalCopyLinkBtn')?.addEventListener('click', () => {
    const code = window.classroom?.currentRoomId || 'CLASS-101';
    const inviteUrl = `${window.location.origin}?room=${code}`;
    copyToClipboard(inviteUrl, `🔗 Invitation Link "${inviteUrl}" copied!`);
  });

  // 5. Modal Random Code Generator
  document.getElementById('modalRandomGenBtn')?.addEventListener('click', () => {
    const newCode = window.classroom?.generateRandomRoomCode() || 'MATH-101';
    const input = document.getElementById('newRoomIdInput');
    if (input) input.value = newCode;
  });

  // Quick Generate Random Class Code (Teacher Header)
  document.getElementById('quickGenRoomCodeBtn')?.addEventListener('click', async () => {
    if (window.classroom?.currentRole !== 'teacher') return;
    const newCode = window.classroom.generateRandomRoomCode();
    const title = `Live Classroom ${newCode}`;

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: newCode,
          title,
          teacherId: window.classroom.currentUser.id,
          teacherName: window.classroom.currentUser.name
        })
      });
      const data = await res.json();
      if (data.success) {
        window.classroom.joinRoom(newCode);
        document.getElementById('currentRoomCodeLabel').textContent = newCode;
        document.getElementById('classRoomTitleHeader').textContent = `Live Virtual Classroom (Room: ${newCode})`;
        const modalDisplay = document.getElementById('modalActiveRoomCodeDisplay');
        if (modalDisplay) modalDisplay.textContent = newCode;
        window.showToast?.(`🎲 New Class Code: ${newCode}! Click "Copy Code" to share with students.`, 'success');
      }
    } catch (e) {
      window.classroom.joinRoom(newCode);
      document.getElementById('currentRoomCodeLabel').textContent = newCode;
      window.showToast?.(`Switched to Room Code: ${newCode}`, 'success');
    }
  });

  // Join Room Button
  document.getElementById('joinRoomBtn')?.addEventListener('click', () => {
    const roomId = document.getElementById('joinRoomInput')?.value.trim().toUpperCase();
    if (roomId) {
      if (window.classroom.currentRole === 'student') {
        window.classroom.requestStudentJoin(roomId);
      } else {
        window.classroom.joinRoom(roomId);
      }
      document.getElementById('currentRoomCodeLabel').textContent = roomId;
      document.getElementById('classRoomTitleHeader').textContent = `Live Virtual Classroom (Room: ${roomId})`;
      document.getElementById('roomManagerModal')?.classList.remove('active');
    }
  });

  document.getElementById('createNewRoomBtn')?.addEventListener('click', async () => {
    const title = document.getElementById('newRoomTitleInput')?.value.trim();
    const customId = document.getElementById('newRoomIdInput')?.value.trim().toUpperCase() || window.classroom.generateRandomRoomCode();

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: customId,
          title: title || `Live Classroom ${customId}`,
          teacherId: window.classroom.currentUser.id,
          teacherName: window.classroom.currentUser.name
        })
      });
      const data = await res.json();
      if (data.success) {
        const room = data.data;
        window.classroom.joinRoom(room.roomId);
        document.getElementById('currentRoomCodeLabel').textContent = room.roomId;
        document.getElementById('classRoomTitleHeader').textContent = `${room.title} (Room: ${room.roomId})`;
        document.getElementById('roomManagerModal')?.classList.remove('active');
        window.showToast?.(`Created and joined new room: ${room.roomId}`, 'success');
      }
    } catch (e) {
      window.showToast?.('Failed to create room', 'danger');
    }
  });

  // Check URL query parameters for auto room join (e.g. ?room=MATH-8921)
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    const code = roomParam.trim().toUpperCase();
    if (window.classroom) {
      window.classroom.currentRoomId = code;
    }
    const label = document.getElementById('currentRoomCodeLabel');
    if (label) label.textContent = code;
    const titleHeader = document.getElementById('classRoomTitleHeader');
    if (titleHeader) titleHeader.textContent = `Live Virtual Classroom (Room: ${code})`;
  }

  // Modal Close Handlers
  document.querySelectorAll('.modal-close-btn, .btn-secondary').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal-backdrop');
      if (modal) modal.classList.remove('active');
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });
});
