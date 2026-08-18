/**
 * EduGuard AI - Standalone Login & Authentication Controller
 */
document.addEventListener('DOMContentLoaded', () => {
  const authForm = document.getElementById('authForm');
  const authRoleInput = document.getElementById('authRoleInput');
  const authEmailInput = document.getElementById('authEmailInput');
  const authPasswordInput = document.getElementById('authPasswordInput');
  const authNameInput = document.getElementById('authNameInput');
  const authClassCodeInput = document.getElementById('authClassCodeInput');
  const authOtpInput = document.getElementById('authOtpInput');
  const authRoleTabTeacher = document.getElementById('authRoleTabTeacher');
  const authRoleTabStudent = document.getElementById('authRoleTabStudent');
  const authRoleTabManager = document.getElementById('authRoleTabManager');
  const authNameField = document.getElementById('authNameField');
  const authClassCodeField = document.getElementById('authClassCodeField');
  const authOtpField = document.getElementById('authOtpField');
  const authSendOtpBtn = document.getElementById('authSendOtpBtn');
  const authToggleLink = document.getElementById('authToggleLink');
  const authToggleText = document.getElementById('authToggleText');
  const authTogglePrompt = document.getElementById('authTogglePrompt');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const togglePasswordBtn = document.getElementById('togglePasswordVisibilityBtn');
  const emailValidationStatus = document.getElementById('emailValidationStatus');
  const emailErrorMsg = document.getElementById('emailErrorMsg');
  const toastContainer = document.getElementById('toastContainer');

  let isRegisterMode = false;
  let otpTimerInterval = null;

  // Toast notification helper
  window.showToast = function(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'danger' ? '🚨' : type === 'warning' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  };

  // Direct Role Navigation & Session Handler
  function navigateToRolePortal(user, classCode) {
    if (classCode) {
      user.roomId = classCode.toUpperCase();
    }
    localStorage.setItem('eduguard_user', JSON.stringify(user));
    
    if (user.role === 'teacher') {
      window.location.href = '/teacher.html';
    } else if (user.role === 'student') {
      window.location.href = '/student.html';
    } else if (user.role === 'manager') {
      window.location.href = '/manager.html';
    } else {
      window.location.href = '/teacher.html';
    }
  }

  // 1-Click Instant Demo Login Buttons
  document.getElementById('quickDemoTeacherBtn')?.addEventListener('click', () => {
    navigateToRolePortal({
      name: 'Dr. Evelyn Reed',
      email: 'teacher@eduguard.edu',
      role: 'teacher',
      id: 't-001'
    });
  });

  document.getElementById('quickDemoStudentBtn')?.addEventListener('click', () => {
    const classCode = authClassCodeInput?.value.trim().toUpperCase() || 'CLASS-101';
    navigateToRolePortal({
      name: 'Alex Johnson',
      email: 'student@eduguard.edu',
      role: 'student',
      id: 'stu-001'
    }, classCode);
  });

  // Password Policy Checklist & Strength Bar
  function updatePasswordUI() {
    const pwd = authPasswordInput.value;
    const hasLen = pwd.length >= 8;
    const hasUpper = /[A-Z]/.test(pwd);
    const hasLower = /[a-z]/.test(pwd);
    const hasNum = /[0-9]/.test(pwd);
    const hasSym = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(pwd);

    const updateCheck = (id, valid) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = `pwd-check-item ${valid ? 'valid' : 'invalid'}`;
      el.innerHTML = `<span>${valid ? '✓' : '○'}</span> ${el.textContent.replace(/^[✓○]\s*/, '')}`;
    };

    updateCheck('chkLen', hasLen);
    updateCheck('chkUpper', hasUpper);
    updateCheck('chkLower', hasLower);
    updateCheck('chkNum', hasNum);
    updateCheck('chkSym', hasSym);

    const score = [hasLen, hasUpper, hasLower, hasNum, hasSym].filter(Boolean).length;
    const fill = document.getElementById('pwdStrengthFill');
    if (fill) {
      fill.style.width = `${(score / 5) * 100}%`;
      fill.style.backgroundColor = score <= 2 ? '#ef4444' : score <= 4 ? '#f59e0b' : '#10b981';
    }
  }

  // Email Validation UI
  function updateEmailUI() {
    const email = authEmailInput.value.trim();
    const isValid = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);

    if (emailValidationStatus) {
      emailValidationStatus.style.display = isValid ? 'inline-block' : 'none';
    }
    if (emailErrorMsg) {
      if (email.length > 0 && !isValid) {
        emailErrorMsg.classList.add('visible');
      } else {
        emailErrorMsg.classList.remove('visible');
      }
    }
  }

  authEmailInput?.addEventListener('input', updateEmailUI);
  authPasswordInput?.addEventListener('input', updatePasswordUI);

  togglePasswordBtn?.addEventListener('click', () => {
    const isPwd = authPasswordInput.type === 'password';
    authPasswordInput.type = isPwd ? 'text' : 'password';
    togglePasswordBtn.textContent = isPwd ? '🔒' : '👁️';
  });

  // Role Tab Switchers
  authRoleTabTeacher?.addEventListener('click', () => {
    authRoleTabTeacher.classList.add('active');
    authRoleTabStudent?.classList.remove('active');
    authRoleTabManager?.classList.remove('active');
    authRoleInput.value = 'teacher';
    authEmailInput.placeholder = 'teacher@eduguard.edu';
    authEmailInput.value = '';
    authPasswordInput.value = '';
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
    authEmailInput.placeholder = 'student@eduguard.edu';
    authEmailInput.value = '';
    authPasswordInput.value = '';
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
    authEmailInput.placeholder = 'Enter manager email';
    authEmailInput.value = '';
    authPasswordInput.value = '';
    if (authClassCodeField) authClassCodeField.style.display = 'none';
    if (isRegisterMode) authToggleLink?.click();
    if (authTogglePrompt) authTogglePrompt.style.display = 'none';
    updateEmailUI();
    updatePasswordUI();
  });

  // Toggle Register vs Login Mode
  authToggleLink?.addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    if (isRegisterMode) {
      authNameField.style.display = 'flex';
      authSendOtpBtn.style.display = 'block';
      authSubmitBtn.innerHTML = '✨ Create Account & Enter';
      authToggleText.textContent = 'Already registered with an institution?';
      authToggleLink.textContent = 'Login Here';
    } else {
      authNameField.style.display = 'none';
      authSendOtpBtn.style.display = 'none';
      authOtpField.style.display = 'none';
      authSubmitBtn.innerHTML = '🚀 Enter Proctored Classroom';
      authToggleText.textContent = "Don't have an institution account?";
      authToggleLink.textContent = 'Register Here';
    }
  });

  // Send OTP
  authSendOtpBtn?.addEventListener('click', async () => {
    const email = authEmailInput.value.trim();
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      showToast('Please enter a valid institutional email address.', 'danger');
      return;
    }

    try {
      authSendOtpBtn.disabled = true;
      authSendOtpBtn.textContent = 'Sending...';
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.success) {
        showToast('OTP sent successfully! Check your inbox.', 'success');
        authOtpField.style.display = 'block';
        const demoBanner = document.getElementById('authOtpDemoBanner');
        if (demoBanner && data.demoOtp) {
          demoBanner.textContent = `Demo Mode Code: ${data.demoOtp}`;
        }
      } else {
        showToast(data.message || 'Failed to send OTP.', 'danger');
      }
    } catch (err) {
      showToast('Network error while requesting OTP code.', 'danger');
    } finally {
      authSendOtpBtn.disabled = false;
      authSendOtpBtn.textContent = '📨 Send OTP';
    }
  });

  // Submit Login / Register
  authForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authEmailInput.value.trim();
    const password = authPasswordInput.value;
    const role = authRoleInput.value;
    const name = authNameInput.value.trim();
    const classCode = authClassCodeInput?.value.trim().toUpperCase() || 'CLASS-101';
    const otp = authOtpInput?.value.trim();

    if (isRegisterMode) {
      if (!name) {
        showToast('Please enter your full name.', 'warning');
        return;
      }
      try {
        authSubmitBtn.disabled = true;
        authSubmitBtn.textContent = 'Registering...';
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, role, otp })
        });
        const data = await res.json();
        if (data.success) {
          const user = data.user || data.data;
          showToast('Account registered successfully! Redirecting...', 'success');
          setTimeout(() => navigateToRolePortal(user, classCode), 500);
        } else {
          showToast(data.message || 'Registration failed.', 'danger');
        }
      } catch (err) {
        console.error('Registration error:', err);
        showToast('Network error while registering account.', 'danger');
      } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.innerHTML = '✨ Create Account & Enter';
      }
    } else {
      try {
        authSubmitBtn.disabled = true;
        authSubmitBtn.textContent = 'Verifying Credentials...';
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.success) {
          const user = data.user || data.data;
          showToast(`Welcome back, ${user?.name || 'User'}! Redirecting...`, 'success');
          setTimeout(() => navigateToRolePortal(user, classCode), 400);
        } else {
          showToast(data.message || 'Invalid email or password.', 'danger');
        }
      } catch (err) {
        console.error('Login error:', err);
        showToast('Network error connecting to authentication server.', 'danger');
      } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.innerHTML = '🚀 Enter Proctored Classroom';
      }
    }
  });

  // Trigger initial UI setup
  updateEmailUI();
  updatePasswordUI();
});
