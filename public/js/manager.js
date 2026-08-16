/**
 * EduGuard AI - Executive Manager & Super Admin Controller
 * Full Suite: Bypass Registration, Password Override, Manager Security & Credentials, Global System Policies, Real-time Broadcast
 */

class ManagerHub {
  constructor() {
    this.overviewData = null;
    this.init();
  }

  init() {
    this.bindEvents();
  }

  bindEvents() {
    // 1. Instant Bypass User Registration (No OTP)
    document.getElementById('mgrBypassRegForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('bypassRegName').value.trim();
      const email = document.getElementById('bypassRegEmail').value.trim();
      const role = document.getElementById('bypassRegRole').value;
      const password = document.getElementById('bypassRegPassword').value;

      try {
        const res = await fetch('/api/manager/bypass-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, role, password })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.(`⚡ ${data.message}`, 'success');
          document.getElementById('mgrBypassRegForm').reset();
          document.getElementById('bypassRegPassword').value = 'EduGuard@2026';
          this.loadManagerOverview();
        } else {
          window.showToast?.(data.message || 'Bypass registration failed', 'danger');
        }
      } catch (err) {
        window.showToast?.('Error during bypass registration', 'danger');
      }
    });

    // 2. Change Manager's Own Credentials & Password
    document.getElementById('mgrUpdateCredentialsForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentEmail = this.overviewData?.users?.find(u => u.role === 'manager')?.email || 'manager@eduguard.edu';
      const newName = document.getElementById('mgrNewName').value.trim();
      const newEmail = document.getElementById('mgrNewEmail').value.trim();
      const newPassword = document.getElementById('mgrNewPassword').value.trim();

      try {
        const res = await fetch('/api/manager/update-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentEmail, newName, newEmail, newPassword })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('🛡️ Manager master credentials updated successfully!', 'success');
          // Update cached user
          const currentUser = JSON.parse(localStorage.getItem('eduguard_user') || '{}');
          if (currentUser.role === 'manager') {
            currentUser.name = data.data.name;
            currentUser.email = data.data.email;
            localStorage.setItem('eduguard_user', JSON.stringify(currentUser));
            document.getElementById('headerUserName').textContent = currentUser.name;
          }
          this.loadManagerOverview();
        } else {
          window.showToast?.(data.message || 'Failed to update credentials', 'danger');
        }
      } catch (err) {
        window.showToast?.('Error updating manager credentials', 'danger');
      }
    });

    // 3. Force Reset Password of Any User
    document.getElementById('mgrOverrideUserPasswordForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = document.getElementById('mgrOverrideTargetUser').value.trim();
      const newPassword = document.getElementById('mgrOverrideNewPass').value.trim();

      try {
        const res = await fetch('/api/manager/change-user-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, newPassword })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.(`🔑 ${data.message}`, 'success');
          document.getElementById('mgrOverrideUserPasswordForm').reset();
          document.getElementById('mgrOverrideNewPass').value = 'EduGuard@2026';
        } else {
          window.showToast?.(data.message || 'Password override failed', 'danger');
        }
      } catch (err) {
        window.showToast?.('Error overriding password', 'danger');
      }
    });

    // 4. Save Global System Policies & Bypass Settings
    document.getElementById('mgrSystemSettingsForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const aiProctoringEnabled = document.getElementById('mgrSettingAiProctoring').checked;
      const autoApproveStudents = document.getElementById('mgrSettingAutoApprove').checked;
      const maxStudentsPerClass = parseInt(document.getElementById('mgrSettingMaxStudents').value, 10);
      const maxTeachersPerClass = parseInt(document.getElementById('mgrSettingMaxTeachers').value, 10);

      try {
        const res = await fetch('/api/manager/system-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiProctoringEnabled, autoApproveStudents, maxStudentsPerClass, maxTeachersPerClass })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('💾 Global system policies saved!', 'success');
        }
      } catch (err) {
        window.showToast?.('Error updating system policies', 'danger');
      }
    });

    // 5. Export Entire Database JSON
    document.getElementById('managerExportDbBtn')?.addEventListener('click', () => {
      window.open('/api/manager/export-db', '_blank');
      window.showToast?.('💾 Exporting JSON database backup...', 'info');
    });

    // 6. Master Emergency Broadcast
    document.getElementById('mgrBroadcastForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('mgrBroadcastMessage');
      const message = input.value.trim();
      if (!message) return;

      try {
        const res = await fetch('/api/manager/broadcast-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('📢 Emergency announcement broadcasted to all classrooms!', 'warning');
          input.value = '';
        }
      } catch (err) {
        window.showToast?.('Error broadcasting announcement', 'danger');
      }
    });

    // 7. Reset All Users
    document.getElementById('managerResetAllUsersBtn')?.addEventListener('click', async () => {
      if (!confirm('⚠️ Are you sure you want to reset all users to default accounts? This will remove custom registrations.')) return;
      try {
        const res = await fetch('/api/users/reset', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('User database reset to clean default accounts.', 'success');
          this.loadManagerOverview();
        }
      } catch (err) {
        window.showToast?.('Error resetting users', 'danger');
      }
    });

    // 8. Clear All Incident Logs
    document.getElementById('mgrClearAllLogsBtn')?.addEventListener('click', async () => {
      if (!confirm('Clear all recorded malpractice logs across the entire institution?')) return;
      try {
        const res = await fetch('/api/manager/incidents', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('All institutional malpractice logs cleared.', 'info');
          this.loadManagerOverview();
        }
      } catch (err) {
        window.showToast?.('Error clearing logs', 'danger');
      }
    });

    // 9. Search Users Roster
    document.getElementById('mgrUserSearchInput')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!this.overviewData || !this.overviewData.users) return;
      const filtered = this.overviewData.users.filter(u => 
        u.name.toLowerCase().includes(q) || 
        u.email.toLowerCase().includes(q) || 
        u.role.toLowerCase().includes(q)
      );
      this.renderUsersTable(filtered);
    });
  }

  async loadManagerOverview() {
    if (window.classroom?.currentRole !== 'manager') return;

    try {
      const res = await fetch('/api/manager/overview');
      const data = await res.json();
      if (data.success) {
        this.overviewData = data.data;
        this.renderMetrics(data.data.stats);
        this.renderSystemSettings(data.data.systemSettings);
        this.renderUsersTable(data.data.users);
        this.renderActiveRooms(data.data.activeRooms);
        this.renderIncidents(data.data.recentIncidents);
      }
    } catch (err) {
      console.error('Failed to load manager overview:', err);
    }
  }

  renderMetrics(stats) {
    if (!stats) return;
    document.getElementById('mgrTotalUsersVal').textContent = stats.totalUsers || 0;
    document.getElementById('mgrTotalStudentsVal').textContent = stats.totalStudents || 0;
    document.getElementById('mgrTotalTeachersVal').textContent = stats.totalTeachers || 0;
    document.getElementById('mgrActiveRoomsVal').textContent = stats.activeClassrooms || 0;
  }

  renderSystemSettings(settings) {
    if (!settings) return;
    const aiEl = document.getElementById('mgrSettingAiProctoring');
    const autoEl = document.getElementById('mgrSettingAutoApprove');
    const maxStuEl = document.getElementById('mgrSettingMaxStudents');
    const maxTeaEl = document.getElementById('mgrSettingMaxTeachers');

    if (aiEl) aiEl.checked = settings.aiProctoringEnabled !== false;
    if (autoEl) autoEl.checked = !!settings.autoApproveStudents;
    if (maxStuEl && settings.maxStudentsPerClass) maxStuEl.value = settings.maxStudentsPerClass;
    if (maxTeaEl && settings.maxTeachersPerClass) maxTeaEl.value = settings.maxTeachersPerClass;
  }

  renderUsersTable(users) {
    const tbody = document.getElementById('mgrUsersTableBody');
    if (!tbody) return;

    if (!users || users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b; padding:2rem;">No users matching search.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(u => {
      const roleColor = u.role === 'manager' ? '#8b5cf6' : (u.role === 'teacher' ? '#6366f1' : '#38bdf8');
      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <div class="user-avatar" style="width:26px; height:26px; font-size:0.75rem;">${u.name.charAt(0).toUpperCase()}</div>
              <strong>${u.name}</strong>
            </div>
          </td>
          <td style="font-family:monospace; font-size:0.82rem; color:#cbd5e1;">${u.email}</td>
          <td>
            <span class="status-pill" style="background:${roleColor}22; border:1px solid ${roleColor}66; color:${roleColor}; font-size:0.7rem; text-transform:uppercase;">
              ${u.role}
            </span>
          </td>
          <td style="font-size:0.8rem; color:#94a3b8;">${u.institution || 'Cambridge Academy'}</td>
          <td>
            <span class="status-pill status-focused" style="font-size:0.68rem;">✓ Verified</span>
          </td>
          <td style="text-align:right;">
            <div style="display:inline-flex; gap:4px;">
              <button class="btn-secondary" style="padding:4px 8px; font-size:0.72rem; color:#38bdf8; border-color:rgba(56,189,248,0.3);" onclick="document.getElementById('mgrOverrideTargetUser').value = '${u.email}'; document.getElementById('mgrOverrideNewPass').focus(); window.showToast('Selected user ${u.name} for password change', 'info');">
                🔑 Password
              </button>
              ${u.id === 'mgr-001' ? `
                <span style="font-size:0.72rem; color:#64748b; padding:4px;">Primary</span>
              ` : `
                <button class="btn-secondary" style="padding:4px 8px; font-size:0.72rem; color:#fb7185; border-color:rgba(244,63,94,0.3);" onclick="managerHub.deleteUser('${u.id}', '${u.name.replace(/'/g, "\\'")}')">
                  🗑️ Delete
                </button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async deleteUser(userId, userName) {
    if (!confirm(`Are you sure you want to permanently delete "${userName}" from the application?`)) return;

    try {
      const res = await fetch(`/api/manager/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        window.showToast?.(`User "${userName}" removed from system database.`, 'info');
        this.loadManagerOverview();
      } else {
        window.showToast?.(data.message || 'Failed to delete user', 'danger');
      }
    } catch (err) {
      window.showToast?.('Error deleting user', 'danger');
    }
  }

  renderActiveRooms(rooms) {
    const container = document.getElementById('mgrActiveRoomsContainer');
    if (!container) return;

    if (!rooms || rooms.length === 0) {
      container.innerHTML = `<div style="text-align:center; color:#64748b; padding:2rem; grid-column:1/-1;">No live sessions currently in progress.</div>`;
      return;
    }

    container.innerHTML = rooms.map(r => `
      <div style="background:rgba(15,23,42,0.85); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="live-pulse-dot"></div>
            <strong style="font-size:1rem; color:#fff; font-family:monospace;">${r.roomId}</strong>
          </div>
          <span class="status-pill status-focused">${r.participants.length} Active</span>
        </div>
        <div style="font-size:0.8rem; color:#cbd5e1;">${r.title}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; border-top:1px solid var(--border-subtle); padding-top:8px;">
          <span style="font-size:0.72rem; color:#94a3b8;">Concurrent Session</span>
          <button class="btn-secondary" style="padding:4px 8px; font-size:0.72rem; color:#fb7185; border-color:rgba(244,63,94,0.3);" onclick="managerHub.terminateRoom('${r.roomId}')">
            🛑 Force Close
          </button>
        </div>
      </div>
    `).join('');
  }

  async terminateRoom(roomId) {
    if (!confirm(`Force terminate classroom session ${roomId}? All connected participants will be disconnected.`)) return;

    try {
      const res = await fetch('/api/manager/rooms/terminate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast?.(`Classroom ${roomId} terminated by manager.`, 'warning');
        this.loadManagerOverview();
      }
    } catch (err) {
      window.showToast?.('Error terminating room', 'danger');
    }
  }

  renderIncidents(incidents) {
    const tbody = document.getElementById('mgrIncidentsTableBody');
    if (!tbody) return;

    if (!incidents || incidents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#64748b; padding:2rem;">Zero infractions recorded across all classes.</td></tr>`;
      return;
    }

    tbody.innerHTML = incidents.map(inc => `
      <tr>
        <td style="font-family:monospace; font-weight:700; color:#818cf8;">${inc.roomId}</td>
        <td><strong>${inc.studentName}</strong></td>
        <td><span class="status-pill status-danger">${inc.violationType}</span></td>
        <td><span style="color:#ef4444; font-weight:600; font-size:0.75rem;">${inc.severity}</span></td>
        <td style="font-size:0.75rem; color:#94a3b8;">${new Date(inc.timestamp).toLocaleTimeString()}</td>
      </tr>
    `).join('');
  }
}

window.managerHub = new ManagerHub();
