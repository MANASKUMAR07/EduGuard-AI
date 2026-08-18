/**
 * EduGuard AI - Executive Manager & Super Admin Controller
 */

class ManagerHub {
  constructor() {
    this.overviewData = null;
    this.allUsers = [];
    this.currentRoleFilter = 'all';
    this.searchQuery = '';
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadManagerOverview();
  }

  bindEvents() {
    // 1. Instant Bypass User Registration (No OTP)
    const bypassForm = document.getElementById('mgrBypassRegisterForm') || document.getElementById('mgrBypassRegForm');
    bypassForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (document.getElementById('mgrNewName') || document.getElementById('bypassRegName'))?.value.trim();
      const email = (document.getElementById('mgrNewEmail') || document.getElementById('bypassRegEmail'))?.value.trim();
      const role = (document.getElementById('mgrNewRole') || document.getElementById('bypassRegRole'))?.value || 'student';
      const password = (document.getElementById('mgrNewPassword') || document.getElementById('bypassRegPassword'))?.value || 'EduGuard@2026';

      try {
        const res = await fetch('/api/manager/bypass-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, role, password })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.(`⚡ ${data.message || 'User provisioned successfully!'}`, 'success');
          bypassForm.reset();
          const pwdInput = document.getElementById('mgrNewPassword') || document.getElementById('bypassRegPassword');
          if (pwdInput) pwdInput.value = 'EduGuard@2026';
          this.loadManagerOverview();
        } else {
          window.showToast?.(data.message || 'Bypass registration failed.', 'danger');
        }
      } catch (err) {
        window.showToast?.('Error during user provisioning', 'danger');
      }
    });

    // 2. Global Password Override
    document.getElementById('mgrPasswordOverrideForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetEmail = document.getElementById('mgrOverrideEmail')?.value.trim();
      const newPassword = document.getElementById('mgrOverrideNewPassword')?.value;

      try {
        const res = await fetch('/api/manager/override-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetEmail, newPassword })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('Password successfully overridden!', 'success');
          document.getElementById('mgrPasswordOverrideForm').reset();
        } else {
          window.showToast?.(data.message || 'Password override failed.', 'danger');
        }
      } catch (e) {
        window.showToast?.('Error overriding password.', 'danger');
      }
    });

    // 3. Save System Policies
    document.getElementById('mgrSavePoliciesBtn')?.addEventListener('click', async () => {
      const requireOtp = document.getElementById('policyRequireOtp')?.checked ?? true;
      const autoFlagGaze = document.getElementById('policyAutoFlagGaze')?.checked ?? true;
      const dataRetention = document.getElementById('policyDataRetention')?.checked ?? true;

      try {
        const res = await fetch('/api/manager/system-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requireOtp, autoFlagGaze, dataRetention })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('System security policy settings updated.', 'success');
        }
      } catch (e) {
        window.showToast?.('Failed to save policy settings.', 'danger');
      }
    });

    // 4. Emergency Broadcast
    document.getElementById('mgrBroadcastForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('mgrBroadcastMessage');
      const message = input?.value.trim();
      if (!message) return;

      try {
        const res = await fetch('/api/manager/broadcast-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('Emergency broadcast transmitted across all classrooms!', 'success');
          input.value = '';
        }
      } catch (e) {
        window.showToast?.('Failed to send broadcast.', 'danger');
      }
    });

    // 5. Export Database
    document.getElementById('mgrExportDbBtn')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/manager/export-db');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `eduguard-database-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.showToast?.('Database backup exported successfully.', 'success');
      } catch (e) {
        window.showToast?.('Database export failed.', 'danger');
      }
    });

    // 6. Reset System Logs
    document.getElementById('mgrResetSystemBtn')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset all temporary system activity logs?')) {
        try {
          const res = await fetch('/api/manager/clear-audit-logs', { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            window.showToast?.('System logs cleared.', 'info');
            this.loadManagerOverview();
          }
        } catch (e) {
          window.showToast?.('Failed to clear logs.', 'danger');
        }
      }
    });

    // 7. Clear Logs Button
    document.getElementById('mgrClearLogsBtn')?.addEventListener('click', async () => {
      if (confirm('Clear all malpractice incident records?')) {
        try {
          const res = await fetch('/api/manager/clear-audit-logs', { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            window.showToast?.('Malpractice audit logs cleared.', 'info');
            this.loadManagerOverview();
          }
        } catch (e) {
          window.showToast?.('Failed to clear logs.', 'danger');
        }
      }
    });

    // 8. User Search Filter
    document.getElementById('mgrSearchUsersInput')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.filterAndRenderUsers();
    });

    // 9. Role Filter Buttons (All, Teachers, Students, Managers)
    document.querySelectorAll('.mgr-filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = btn.dataset.filter || 'all';
        this.currentRoleFilter = filter;
        
        // Update active class on filter buttons
        document.querySelectorAll('.mgr-filter-btn').forEach(b => {
          b.classList.remove('active');
          b.style.background = 'transparent';
          b.style.color = 'var(--text-muted)';
        });
        btn.classList.add('active');
        btn.style.background = 'var(--accent-primary)';
        btn.style.color = '#fff';

        this.filterAndRenderUsers();
      });
    });
  }

  async loadManagerOverview() {
    try {
      const res = await fetch('/api/manager/overview');
      const data = await res.json();
      if (data.success) {
        this.overviewData = data;
        const usersList = data.users || (data.data && data.data.users) || [];
        this.allUsers = usersList;
        this.renderMetrics(data);
        this.updateFilterCounts(usersList);
        this.filterAndRenderUsers();
        
        const logsList = data.malpracticeIncidents || (data.data && data.data.recentIncidents) || [];
        this.renderLogsTable(logsList);
      }
    } catch (e) {
      console.warn('Error loading manager overview:', e);
    }
  }

  updateFilterCounts(users) {
    const total = users.length;
    const teachers = users.filter(u => u.role === 'teacher').length;
    const students = users.filter(u => u.role === 'student').length;
    const managers = users.filter(u => u.role === 'manager').length;

    const cntAll = document.getElementById('cntAll');
    const cntTeachers = document.getElementById('cntTeachers');
    const cntStudents = document.getElementById('cntStudents');
    const cntManagers = document.getElementById('cntManagers');
    const badgeCount = document.getElementById('mgrUsersBadgeCount');

    if (cntAll) cntAll.textContent = total;
    if (cntTeachers) cntTeachers.textContent = teachers;
    if (cntStudents) cntStudents.textContent = students;
    if (cntManagers) cntManagers.textContent = managers;
    if (badgeCount) badgeCount.textContent = `${total} Registered Account${total === 1 ? '' : 's'}`;
  }

  renderMetrics(data) {
    const totalUsers = document.getElementById('mgrTotalUsersCount');
    const activeRooms = document.getElementById('mgrActiveRoomsCount');
    const totalAsg = document.getElementById('mgrTotalAsgCount');
    const totalLogs = document.getElementById('mgrTotalLogsCount');

    const usersCount = (data.users && data.users.length) || (data.data && data.data.stats && data.data.stats.totalUsers) || 0;
    const roomsCount = (data.rooms && Object.keys(data.rooms).length) || (data.data && data.data.stats && data.data.stats.activeClassrooms) || 0;
    const asgCount = (data.assignments && data.assignments.length) || (data.data && data.data.stats && data.data.stats.totalAssignments) || 0;
    const logsCount = (data.malpracticeIncidents && data.malpracticeIncidents.length) || (data.data && data.data.stats && data.data.stats.totalIncidents) || 0;

    if (totalUsers) totalUsers.textContent = usersCount;
    if (activeRooms) activeRooms.textContent = roomsCount;
    if (totalAsg) totalAsg.textContent = asgCount;
    if (totalLogs) totalLogs.textContent = logsCount;
  }

  filterAndRenderUsers() {
    let filtered = [...this.allUsers];

    // 1. Role Filter
    if (this.currentRoleFilter !== 'all') {
      filtered = filtered.filter(u => u.role === this.currentRoleFilter);
    }

    // 2. Search Query Filter
    if (this.searchQuery) {
      filtered = filtered.filter(u => 
        (u.name || '').toLowerCase().includes(this.searchQuery) ||
        (u.email || '').toLowerCase().includes(this.searchQuery) ||
        (u.role || '').toLowerCase().includes(this.searchQuery) ||
        (u.institution || '').toLowerCase().includes(this.searchQuery) ||
        (u.id || '').toLowerCase().includes(this.searchQuery)
      );
    }

    this.renderUsersTable(filtered);
  }

  renderUsersTable(users) {
    const tbody = document.getElementById('mgrUsersTableBody');
    if (!tbody) return;

    if (users.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; color:var(--text-muted); padding:2rem;">
            <div style="font-size:2rem; margin-bottom:8px;">🔍</div>
            <p style="font-weight:600; color:#fff;">No accounts match the current filter or search criteria.</p>
            <p style="font-size:0.8rem; margin-top:4px;">Try selecting another role tab or clear your search query.</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = users.map(u => {
      const isManager = u.role === 'manager';
      const isTeacher = u.role === 'teacher';
      const isStudent = u.role === 'student';
      
      const avatarGradient = isManager 
        ? 'linear-gradient(135deg, #ef4444, #f59e0b)' 
        : (isTeacher ? 'linear-gradient(135deg, #8b5cf6, #ec4899)' : 'linear-gradient(135deg, #06b6d4, #3b82f6)');
      
      const roleBadge = isManager
        ? '<span class="status-pill status-danger" style="font-size:0.72rem; font-weight:700;">🛡️ MANAGER</span>'
        : (isTeacher 
          ? '<span class="status-pill status-warning" style="font-size:0.72rem; font-weight:700;">👩‍🏫 TEACHER</span>' 
          : '<span class="status-pill status-focused" style="font-size:0.72rem; font-weight:700;">👨‍🎓 STUDENT</span>');

      const verifiedBadge = u.bypassedByManager 
        ? '<span style="color:#f59e0b; font-size:0.75rem;" title="Provisioned via Super Admin Bypass">⚡ Bypass Verified</span>'
        : '<span style="color:#10b981; font-size:0.75rem;" title="Email Verified">✓ Verified</span>';

      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.06); transition:background 0.2s ease;">
          <td style="padding:12px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <div class="user-avatar" style="width:34px; height:34px; border-radius:50%; background:${avatarGradient}; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.85rem; color:#fff; flex-shrink:0;">
                ${(u.name || 'U').charAt(0).toUpperCase()}
              </div>
              <div>
                <strong style="color:#fff; font-size:0.9rem;">${u.name}</strong>
                <div style="font-family:var(--font-mono); font-size:0.7rem; color:var(--text-dim);">${u.id || 'N/A'}</div>
              </div>
            </div>
          </td>
          <td style="padding:12px;">
            ${roleBadge}
          </td>
          <td style="padding:12px;">
            <span style="font-family:var(--font-mono); font-size:0.82rem; color:#cbd5e1;">${u.email}</span>
          </td>
          <td style="padding:12px; font-size:0.82rem; color:var(--text-muted);">
            ${u.institution || 'Cambridge Academy of Sciences'}
          </td>
          <td style="padding:12px;">
            ${verifiedBadge}
          </td>
          <td style="padding:12px; text-align:right;">
            <div style="display:flex; justify-content:flex-end; align-items:center; gap:8px;">
              ${!isManager ? `
                <button 
                  class="btn-secondary" 
                  style="padding:5px 10px; font-size:0.75rem; color:#fbbf24; border-color:rgba(245,158,11,0.4);" 
                  title="Override password for this user"
                  onclick="window.managerHub.quickResetPassword('${u.email}')">
                  🔑 Reset Pwd
                </button>
                <button 
                  class="btn-secondary" 
                  style="padding:5px 12px; font-size:0.75rem; font-weight:700; color:#fff; background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.5); border-radius:var(--radius-xs); cursor:pointer; transition:all 0.2s ease;" 
                  title="Permanently remove user"
                  onmouseover="this.style.background='rgba(239,68,68,0.4)'"
                  onmouseout="this.style.background='rgba(239,68,68,0.2)'"
                  onclick="window.managerHub.deleteUser('${u.id}', '${u.name.replace(/'/g, "\\'")}', '${u.role}')">
                  🗑️ Remove
                </button>
              ` : `
                <span class="status-pill" style="background:rgba(255,255,255,0.06); border:1px solid var(--border-subtle); color:var(--text-muted); font-size:0.72rem;">
                  🛡️ Protected Admin
                </span>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  renderLogsTable(logs) {
    const tbody = document.getElementById('mgrLogsTableBody');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Zero active violation records in system.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="font-size:0.78rem; color:var(--text-muted); padding:10px 12px;">${new Date(l.timestamp || Date.now()).toLocaleString()}</td>
        <td style="padding:10px 12px;"><strong style="color:#fff;">${l.studentName}</strong></td>
        <td style="padding:10px 12px;"><span style="font-family:var(--font-mono); color:#a5b4fc;">${l.roomId || 'CLASS-101'}</span></td>
        <td style="padding:10px 12px;"><span class="status-pill status-danger">⚠️ ${l.violationType}</span></td>
        <td style="padding:10px 12px;">
          ${l.snapshot ? `
            <img src="${l.snapshot}" alt="Evidence" style="width:70px; height:50px; object-fit:cover; border-radius:4px; border:1px solid rgba(239,68,68,0.4);" />
          ` : '<span style="font-size:0.75rem; color:var(--text-muted);">No Photo</span>'}
        </td>
      </tr>
    `).join('');
  }

  quickResetPassword(email) {
    const overrideInput = document.getElementById('mgrOverrideEmail');
    const pwdInput = document.getElementById('mgrOverrideNewPassword');
    if (overrideInput) {
      overrideInput.value = email;
      overrideInput.focus();
      overrideInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.showToast?.(`Selected account "${email}" for password override.`, 'info');
    }
  }

  async deleteUser(userId, userName, userRole) {
    const roleLabel = (userRole || 'user').toUpperCase();
    const confirmed = confirm(`⚠️ PERMISSION ACTION: REMOVE USER\n\nAre you sure you want to permanently delete the ${roleLabel} account for "${userName}"?\n\nThis will remove their institutional access and credentials.`);
    
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/manager/users/${encodeURIComponent(userId)}`, { 
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      
      if (data.success) {
        window.showToast?.(`🗑️ Account for "${userName}" has been permanently removed.`, 'success');
        await this.loadManagerOverview();
      } else {
        window.showToast?.(data.message || 'Failed to remove user account.', 'danger');
      }
    } catch (e) {
      console.error('Error removing user account:', e);
      window.showToast?.('Network error while removing user account.', 'danger');
    }
  }
}

window.ManagerHub = ManagerHub;
window.managerHub = new ManagerHub();
