/**
 * EduGuard AI - Teacher Portal Bootstrap & View Controller
 */
document.addEventListener('DOMContentLoaded', () => {
  // Session Init
  let user = null;
  try {
    const raw = localStorage.getItem('eduguard_user');
    if (raw) user = JSON.parse(raw);
  } catch (e) {}

  if (!user || user.role !== 'teacher') {
    user = {
      name: 'Dr. Evelyn Reed',
      email: 'teacher@eduguard.edu',
      role: 'teacher',
      id: 't-001'
    };
    localStorage.setItem('eduguard_user', JSON.stringify(user));
  }

  // Update Header UI
  const nameEl = document.getElementById('headerUserName');
  const roleEl = document.getElementById('headerUserRole');
  const avatarEl = document.getElementById('headerAvatarInitial');
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = 'Teacher / Host';
  if (avatarEl) avatarEl.textContent = user.name ? user.name.charAt(0).toUpperCase() : 'T';

  // Initialize Classroom as Teacher
  if (window.classroom) {
    window.classroom.setRole('teacher', user.name, user.email);
  }

  // Initialize Assignments & Reports
  if (window.assignmentHub) {
    window.assignmentHub.currentRole = 'teacher';
    window.assignmentHub.renderAssignments();
  }
  if (window.reportsHub) {
    window.reportsHub.populateStudentDropdown();
    window.reportsHub.generateLiveReport('ALL');
  }

  // Navigation Tab Switching
  const navButtons = document.querySelectorAll('.nav-tab-btn');
  const viewSections = document.querySelectorAll('.view-section');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      viewSections.forEach(sec => {
        if (sec.id === `view-${targetView}`) {
          sec.classList.add('active');
        } else {
          sec.classList.remove('active');
        }
      });

      if (targetView === 'assignments') {
        window.assignmentHub?.renderAssignments();
      }
      if (targetView === 'reports') {
        window.reportsHub?.generateLiveReport('ALL');
      }
    });
  });

  // Header Actions
  document.getElementById('openRoomManagerBtn')?.addEventListener('click', () => {
    const code = window.classroom?.currentRoomId || 'CLASS-101';
    navigator.clipboard?.writeText(code);
    window.showToast?.(`📋 Copied classroom code: ${code}`, 'success');
  });

  document.getElementById('headerCopyCodeBtn')?.addEventListener('click', () => {
    const code = window.classroom?.currentRoomId || 'CLASS-101';
    navigator.clipboard?.writeText(code);
    window.showToast?.(`Copied class code: ${code}`, 'success');
  });

  document.getElementById('stageCopyCodeBtn')?.addEventListener('click', () => {
    const code = window.classroom?.currentRoomId || 'CLASS-101';
    navigator.clipboard?.writeText(code);
    window.showToast?.(`Copied class code: ${code}`, 'success');
  });

  document.getElementById('headerNewCodeBtn')?.addEventListener('click', () => {
    if (window.classroom) {
      const newCode = window.classroom.generateRandomRoomCode();
      window.classroom.joinRoom(newCode);
      window.showToast?.(`Created and joined new room: ${newCode}`, 'success');
    }
  });

  // Logout Action
  document.getElementById('headerLogoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('eduguard_user');
    window.classroom?.cleanupSession();
    window.location.href = '/index.html';
  });

  window.showToast?.(`Welcome to Teacher Host Suite, ${user.name}!`, 'success');
});
