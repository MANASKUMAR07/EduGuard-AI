/**
 * EduGuard AI - Executive Manager Portal Bootstrap Controller
 */
document.addEventListener('DOMContentLoaded', () => {
  // Strict Manager Session Verification
  let user = null;
  try {
    const raw = localStorage.getItem('eduguard_user');
    if (raw) user = JSON.parse(raw);
  } catch (e) {}

  if (!user || user.role !== 'manager') {
    alert('🛡️ Access Denied: Executive Manager authentication required.\n\nPlease log in with your Manager credentials.');
    localStorage.removeItem('eduguard_user');
    window.location.href = '/index.html';
    return;
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

  window.showToast?.(`Welcome Super Administrator, ${user.name}!`, 'success');
});
