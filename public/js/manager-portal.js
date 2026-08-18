/**
 * EduGuard AI - Executive Manager Portal Bootstrap Controller
 */
document.addEventListener('DOMContentLoaded', () => {
  // Session Init
  let user = null;
  try {
    const raw = localStorage.getItem('eduguard_user');
    if (raw) user = JSON.parse(raw);
  } catch (e) {}

  if (!user || user.role !== 'manager') {
    user = {
      name: 'Executive Manager',
      email: 'manasku2007@gmail.com',
      role: 'manager',
      id: 'mgr-001'
    };
    localStorage.setItem('eduguard_user', JSON.stringify(user));
  }

  // Load Manager Overview
  if (window.managerHub) {
    window.managerHub.loadManagerOverview();
  }

  // Logout Action
  document.getElementById('headerLogoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('eduguard_user');
    window.location.href = '/index.html';
  });

  window.showToast?.('Authenticated to Super Administrator Master Control Suite.', 'success');
});
