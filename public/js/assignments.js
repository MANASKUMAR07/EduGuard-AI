/**
 * EduGuard AI - Homework, Assignment & Task Management System
 */

class AssignmentManager {
  constructor() {
    this.assignments = [];
    this.submissions = [];
    this.tasks = [];
    this.currentRole = 'student';
    this.currentSelectedAssignmentId = null;

    this.init();
  }

  async init() {
    await this.fetchAssignments();
    await this.fetchSubmissions();
    await this.fetchTasks();
    this.bindEvents();
    this.renderAssignments();
    this.renderTasks();
  }

  async fetchAssignments() {
    try {
      const res = await fetch('/api/assignments');
      const data = await res.json();
      if (data.success) {
        this.assignments = data.data || [];
      }
    } catch (e) {
      console.warn('Error fetching assignments:', e);
    }
  }

  async fetchSubmissions() {
    try {
      const res = await fetch('/api/submissions');
      const data = await res.json();
      if (data.success) {
        this.submissions = data.data || [];
      }
    } catch (e) {
      console.warn('Error fetching submissions:', e);
    }
  }

  async fetchTasks() {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (data.success) {
        this.tasks = data.data || [];
      }
    } catch (e) {
      console.warn('Error fetching tasks:', e);
    }
  }

  bindEvents() {
    // 1. Open Create Assignment Modal (Teacher)
    const openCreateAsgBtn = document.getElementById('openCreateAssignmentModalBtn') || document.getElementById('openCreateAssignmentBtn');
    openCreateAsgBtn?.addEventListener('click', () => {
      const modal = document.getElementById('createAssignmentModal');
      if (modal) {
        modal.classList.add('active');
        const dueInput = document.getElementById('asgDueDateInput');
        if (dueInput && !dueInput.value) {
          const futureDate = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0];
          dueInput.value = futureDate;
        }
      }
    });

    // 2. Create Assignment Form Submit (Teacher)
    document.getElementById('createAssignmentForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('asgTitleInput')?.value.trim();
      const subject = document.getElementById('asgSubjectInput')?.value.trim() || 'Mathematics';
      const totalPoints = parseInt(document.getElementById('asgPointsInput')?.value || '100', 10);
      const dueDate = document.getElementById('asgDueDateInput')?.value;
      const description = document.getElementById('asgDescInput')?.value.trim();

      if (!title || !description) {
        window.showToast?.('Please enter an assignment title and description.', 'warning');
        return;
      }

      try {
        const res = await fetch('/api/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            subject,
            totalPoints,
            dueDate,
            description,
            createdBy: window.classroom?.currentUser?.name || 'Dr. Evelyn Reed'
          })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('Assignment published successfully!', 'success');
          document.getElementById('createAssignmentForm')?.reset();
          document.getElementById('createAssignmentModal')?.classList.remove('active');
          await this.fetchAssignments();
          this.renderAssignments();
        } else {
          window.showToast?.(data.message || 'Failed to create assignment', 'danger');
        }
      } catch (err) {
        window.showToast?.('Error publishing assignment', 'danger');
      }
    });

    // 3. Submit Homework Form (Student)
    const submitForm = document.getElementById('submitAssignmentForm') || document.getElementById('submitHomeworkForm');
    submitForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const asgId = document.getElementById('submitAsgId')?.value || this.currentSelectedAssignmentId;
      const textContent = document.getElementById('submitTextContent')?.value.trim() || '';
      const fileInput = document.getElementById('submitFileInput');
      const studentName = window.classroom?.currentUser?.name || 'Alex Johnson';
      const studentId = window.classroom?.currentUser?.id || 'stu-001';

      if (!asgId) {
        window.showToast?.('No assignment selected for submission.', 'warning');
        return;
      }

      try {
        const formData = new FormData();
        formData.append('assignmentId', asgId);
        formData.append('studentId', studentId);
        formData.append('studentName', studentName);
        formData.append('submissionText', textContent);
        if (fileInput && fileInput.files[0]) {
          formData.append('submissionFile', fileInput.files[0]);
        }

        const res = await fetch('/api/submissions', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('Homework submitted successfully to your teacher!', 'success');
          submitForm.reset();
          document.getElementById('submitAssignmentModal')?.classList.remove('active');
          document.getElementById('submitHomeworkModal')?.classList.remove('active');
          await this.fetchSubmissions();
          this.renderAssignments();
        } else {
          window.showToast?.(data.message || 'Submission failed.', 'danger');
        }
      } catch (err) {
        window.showToast?.('Error submitting homework', 'danger');
      }
    });

    // 4. Open Create Task Modal (Student)
    document.getElementById('openCreateTaskModalBtn')?.addEventListener('click', () => {
      const modal = document.getElementById('createTaskModal');
      if (modal) {
        modal.classList.add('active');
        const due = document.getElementById('taskDueDateInput');
        if (due && !due.value) {
          due.value = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        }
      }
    });

    // 5. Create Task Form (Student)
    document.getElementById('createTaskForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('taskTitleInput')?.value.trim();
      const priority = document.getElementById('taskPriorityInput')?.value || 'medium';
      const dueDate = document.getElementById('taskDueDateInput')?.value;

      if (!title) return;

      try {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            priority,
            dueDate,
            status: 'todo',
            studentId: window.classroom?.currentUser?.id || 'stu-001'
          })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('Task added to your study board!', 'success');
          document.getElementById('createTaskForm')?.reset();
          document.getElementById('createTaskModal')?.classList.remove('active');
          await this.fetchTasks();
          this.renderTasks();
        }
      } catch (err) {
        window.showToast?.('Error saving task', 'danger');
      }
    });
  }

  renderAssignments() {
    const grid = document.getElementById('assignmentsCardsGrid') || document.getElementById('assignmentList');
    if (!grid) return;

    if (this.assignments.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 3rem; background: var(--bg-glass); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
          <div style="font-size: 2rem; margin-bottom: 8px;">📚</div>
          <strong style="color: #fff; font-size: 1.1rem;">No Active Homework Assignments</strong>
          <p style="font-size: 0.85rem; margin-top: 4px;">Check back later or ask your course instructor for upcoming tasks.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = this.assignments.map(asg => {
      const submissionsForAsg = this.submissions.filter(s => s.assignmentId === asg.id);
      const isTeacher = this.currentRole === 'teacher';
      const mySubmission = !isTeacher ? this.submissions.find(s => s.assignmentId === asg.id && s.studentName === (window.classroom?.currentUser?.name || 'Alex Johnson')) : null;

      return `
        <div class="assignment-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <span class="brand-badge" style="margin-left: 0; background: rgba(99, 102, 241, 0.2); color: #c7d2fe;">${asg.subject || 'General'}</span>
            <span style="font-size: 0.78rem; font-weight: 700; color: #34d399; background: rgba(16, 185, 129, 0.15); padding: 2px 8px; border-radius: 4px;">
              ${asg.totalPoints || 100} Points
            </span>
          </div>

          <h3 style="font-family: var(--font-heading); font-size: 1.1rem; font-weight: 700; color: #fff; line-height: 1.3;">
            ${asg.title}
          </h3>

          <p style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.5; flex: 1;">
            ${asg.description}
          </p>

          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 10px; margin-top: 6px;">
            <span>Due: <strong style="color: #fbbf24;">${asg.dueDate || 'Open'}</strong></span>
            <span>By: <strong>${asg.createdBy || 'Teacher'}</strong></span>
          </div>

          <div style="margin-top: 4px;">
            ${isTeacher ? `
              <button class="btn-primary" style="width: 100%; justify-content: center; font-size: 0.82rem;" onclick="window.assignmentHub.openSubmissionsReviewModal('${asg.id}', '${asg.title.replace(/'/g, "\\'")}')">
                👥 View Submissions (${submissionsForAsg.length})
              </button>
            ` : `
              ${mySubmission ? `
                <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 8px; text-align: center; font-size: 0.8rem; color: #34d399; font-weight: 700;">
                  ✓ Submitted (${mySubmission.grade ? `Grade: ${mySubmission.grade}/${asg.totalPoints}` : 'Pending Grading'})
                </div>
              ` : `
                <button class="btn-primary" style="width: 100%; justify-content: center; font-size: 0.82rem;" onclick="window.assignmentHub.openSubmitModal('${asg.id}', '${asg.title.replace(/'/g, "\\'")}')">
                  📤 Submit Solution
                </button>
              `}
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  openSubmitModal(assignmentId, title) {
    this.currentSelectedAssignmentId = assignmentId;
    const modal = document.getElementById('submitAssignmentModal') || document.getElementById('submitHomeworkModal');
    const titleEl = document.getElementById('submitModalTitle');
    const idInput = document.getElementById('submitAsgId');

    if (titleEl) titleEl.textContent = `Submit: ${title}`;
    if (idInput) idInput.value = assignmentId;
    if (modal) modal.classList.add('active');
  }

  openSubmissionsReviewModal(assignmentId, title) {
    const modal = document.getElementById('submissionsModal');
    const titleEl = document.getElementById('submissionsModalTitle');
    const listContainer = document.getElementById('submissionsListContainer');

    if (titleEl) titleEl.textContent = `Submissions: ${title}`;
    if (!listContainer) return;

    const subs = this.submissions.filter(s => s.assignmentId === assignmentId);
    if (subs.length === 0) {
      listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem 0;">No student submissions received yet.</div>`;
    } else {
      listContainer.innerHTML = subs.map(s => `
        <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #fff; font-size: 0.9rem;">${s.studentName}</strong>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${new Date(s.submittedAt || Date.now()).toLocaleString()}</span>
          </div>
          <p style="font-size: 0.82rem; color: #cbd5e1; background: rgba(0, 0, 0, 0.3); padding: 8px; border-radius: 6px;">
            ${s.submissionText || 'No text content provided.'}
          </p>
          <div style="display: flex; gap: 8px; align-items: center; justify-content: flex-end;">
            <input type="number" id="gradeInput-${s.id}" class="form-input" placeholder="Score" value="${s.grade || ''}" style="width: 80px; padding: 4px 8px; font-size: 0.8rem;" />
            <button class="btn-primary" style="padding: 6px 12px; font-size: 0.75rem;" onclick="window.assignmentHub.saveGrade('${s.id}')">
              💾 Save Grade
            </button>
          </div>
        </div>
      `).join('');
    }

    if (modal) modal.classList.add('active');
  }

  async saveGrade(submissionId) {
    const input = document.getElementById(`gradeInput-${submissionId}`);
    const grade = input ? input.value : null;
    if (!grade) {
      window.showToast?.('Please enter a grade score', 'warning');
      return;
    }

    try {
      const res = await fetch(`/api/submissions/${submissionId}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade, feedback: 'Graded by teacher' })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast?.('Grade saved and sent to student!', 'success');
        await this.fetchSubmissions();
        this.renderAssignments();
      }
    } catch (e) {
      window.showToast?.('Failed to save grade', 'danger');
    }
  }

  renderTasks() {
    const colTodo = document.getElementById('taskListTodo');
    const colInProgress = document.getElementById('taskListInProgress');
    const colDone = document.getElementById('taskListDone');

    if (!colTodo || !colInProgress || !colDone) return;

    const todoTasks = this.tasks.filter(t => t.status === 'todo');
    const inProgressTasks = this.tasks.filter(t => t.status === 'in_progress');
    const doneTasks = this.tasks.filter(t => t.status === 'done');

    const countTodo = document.getElementById('taskCountTodo');
    const countInProg = document.getElementById('taskCountInProgress');
    const countDone = document.getElementById('taskCountDone');
    if (countTodo) countTodo.textContent = todoTasks.length;
    if (countInProg) countInProg.textContent = inProgressTasks.length;
    if (countDone) countDone.textContent = doneTasks.length;

    const renderCard = (t) => `
      <div class="task-item-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <strong style="color: #fff; font-size: 0.88rem;">${t.title}</strong>
          <span style="font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; ${t.priority === 'high' ? 'background:rgba(239,68,68,0.2); color:#fca5a5;' : t.priority === 'medium' ? 'background:rgba(245,158,11,0.2); color:#fde68a;' : 'background:rgba(16,185,129,0.2); color:#6ee7b7;'}">
            ${(t.priority || 'medium').toUpperCase()}
          </span>
        </div>
        <div style="font-size: 0.72rem; color: var(--text-muted);">Due: ${t.dueDate || 'No date'}</div>
        <div style="display: flex; gap: 4px; margin-top: 4px; justify-content: flex-end;">
          ${t.status !== 'todo' ? `
            <button class="btn-secondary" style="padding: 2px 6px; font-size: 0.68rem;" onclick="window.assignmentHub.updateTaskStatus('${t.id}', 'todo')">← To Do</button>
          ` : ''}
          ${t.status !== 'in_progress' ? `
            <button class="btn-secondary" style="padding: 2px 6px; font-size: 0.68rem;" onclick="window.assignmentHub.updateTaskStatus('${t.id}', 'in_progress')">⚡ Active</button>
          ` : ''}
          ${t.status !== 'done' ? `
            <button class="btn-secondary" style="padding: 2px 6px; font-size: 0.68rem; color:#34d399;" onclick="window.assignmentHub.updateTaskStatus('${t.id}', 'done')">✓ Done</button>
          ` : ''}
          <button class="btn-secondary" style="padding: 2px 6px; font-size: 0.68rem; color:#fb7185;" onclick="window.assignmentHub.deleteTask('${t.id}')">🗑️</button>
        </div>
      </div>
    `;

    colTodo.innerHTML = todoTasks.length > 0 ? todoTasks.map(renderCard).join('') : '<div style="text-align:center; color:#64748b; font-size:0.75rem; padding:2rem 0;">No tasks</div>';
    colInProgress.innerHTML = inProgressTasks.length > 0 ? inProgressTasks.map(renderCard).join('') : '<div style="text-align:center; color:#64748b; font-size:0.75rem; padding:2rem 0;">No tasks in progress</div>';
    colDone.innerHTML = doneTasks.length > 0 ? doneTasks.map(renderCard).join('') : '<div style="text-align:center; color:#64748b; font-size:0.75rem; padding:2rem 0;">No completed tasks</div>';
  }

  async updateTaskStatus(taskId, newStatus) {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        await this.fetchTasks();
        this.renderTasks();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async deleteTask(taskId) {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      if (res.ok) {
        window.showToast?.('Task removed', 'info');
        await this.fetchTasks();
        this.renderTasks();
      }
    } catch (e) {
      console.error(e);
    }
  }
}

window.AssignmentManager = AssignmentManager;
window.assignmentHub = new AssignmentManager();
