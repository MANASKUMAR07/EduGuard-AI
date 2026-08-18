/**
 * EduGuard AI - Student Portal Bootstrap & View Controller
 */
document.addEventListener('DOMContentLoaded', () => {
  // Session Init
  let user = null;
  try {
    const raw = localStorage.getItem('eduguard_user');
    if (raw) user = JSON.parse(raw);
  } catch (e) {}

  if (!user || user.role !== 'student') {
    user = {
      name: 'Alex Johnson',
      email: 'student@eduguard.edu',
      role: 'student',
      id: 'stu-001',
      roomId: 'CLASS-101'
    };
    localStorage.setItem('eduguard_user', JSON.stringify(user));
  }

  // Update Header UI
  const nameEl = document.getElementById('headerUserName');
  const roleEl = document.getElementById('headerUserRole');
  const avatarEl = document.getElementById('headerAvatarInitial');
  const roomLabel = document.getElementById('currentRoomCodeLabel');
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = 'Candidate / Student';
  if (avatarEl) avatarEl.textContent = user.name ? user.name.charAt(0).toUpperCase() : 'A';
  if (roomLabel && user.roomId) roomLabel.textContent = user.roomId;

  // Initialize Classroom as Student
  if (window.classroom) {
    if (user.roomId) window.classroom.currentRoomId = user.roomId;
    window.classroom.setRole('student', user.name, user.email, user.id);
  }

  // Initialize Assignments & Tasks
  if (window.assignmentHub) {
    window.assignmentHub.currentRole = 'student';
    window.assignmentHub.renderAssignments();
    window.assignmentHub.renderTasks();
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
      if (targetView === 'tasks') {
        window.assignmentHub?.renderTasks();
      }
    });
  });

  // Header Actions
  document.getElementById('openRoomManagerBtn')?.addEventListener('click', () => {
    const code = window.classroom?.currentRoomId || 'CLASS-101';
    navigator.clipboard?.writeText(code);
    window.showToast?.(`📋 Copied classroom code: ${code}`, 'success');
  });

  // Logout Action
  document.getElementById('headerLogoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('eduguard_user');
    window.classroom?.cleanupSession();
    window.location.href = '/index.html';
  });

  window.showToast?.(`Welcome back, ${user.name}! Keep your camera centered.`, 'info');
});
