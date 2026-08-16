/**
 * EduGuard AI - Homework, Assignment & Task Management System
 */

class AssignmentManager {
  constructor() {
    this.assignments = [];
    this.submissions = [];
    this.tasks = [];
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
        this.assignments = data.data;
      }
    } catch (e) {
      console.error('Error fetching assignments', e);
    }
  }

  async fetchSubmissions() {
    try {
      const res = await fetch('/api/submissions');
      const data = await res.json();
      if (data.success) {
        this.submissions = data.data;
      }
    } catch (e) {
      console.error('Error fetching submissions', e);
    }
  }

  async fetchTasks() {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (data.success) {
        this.tasks = data.data;
      }
    } catch (e) {
      console.error('Error fetching tasks', e);
    }
  }

  bindEvents() {
    // Open Create Assignment Modal (Teacher)
    document.getElementById('openCreateAssignmentBtn')?.addEventListener('click', () => {
      const modal = document.getElementById('createAssignmentModal');
      if (modal) modal.classList.add('active');
    });

    // Create Assignment Form Submission
    document.getElementById('createAssignmentForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const title = form.title.value.trim();
      const subject = form.subject.value.trim();
      const dueDate = form.dueDate.value;
      const totalPoints = form.totalPoints.value;
      const description = form.description.value.trim();

      try {
        const res = await fetch('/api/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            subject,
            dueDate,
            totalPoints,
            description,
            createdBy: window.classroom?.currentUser?.name || 'Dr. Evelyn Reed'
          })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('Assignment published successfully!', 'success');
          form.reset();
          document.getElementById('createAssignmentModal')?.classList.remove('active');
          await this.fetchAssignments();
          this.renderAssignments();
        }
      } catch (err) {
        window.showToast?.('Failed to create assignment', 'danger');
      }
    });

    // Submit Homework Form (Student)
    document.getElementById('submitHomeworkForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const assignmentId = form.assignmentId.value;
      const submissionText = form.submissionText.value.trim();
      const studentName = window.classroom?.currentUser?.name || 'Alex Johnson';
      const studentId = window.classroom?.currentUser?.id || 'stu-101';

      try {
        const res = await fetch('/api/submissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assignmentId,
            studentId,
            studentName,
            submissionText
          })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('Homework submitted successfully to Dr. Evelyn Reed!', 'success');
          form.reset();
          document.getElementById('submitHomeworkModal')?.classList.remove('active');
          await this.fetchSubmissions();
          this.renderAssignments();
        }
      } catch (err) {
        window.showToast?.('Failed to submit homework', 'danger');
      }
    });

    // Create Task Form
    document.getElementById('createTaskForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const title = form.taskTitle.value.trim();
      const dueDate = form.taskDueDate.value;
      const priority = form.taskPriority.value;

      try {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            dueDate,
            priority,
            assignedTo: window.classroom?.currentUser?.name || 'Alex Johnson',
            assignedBy: window.classroom?.currentRole === 'teacher' ? 'Dr. Evelyn Reed' : 'Self'
          })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('Task added to Planner', 'success');
          form.reset();
          document.getElementById('createTaskModal')?.classList.remove('active');
          await this.fetchTasks();
          this.renderTasks();
        }
      } catch (err) {
        window.showToast?.('Failed to add task', 'danger');
      }
    });

    // Open Task Modal Button
    document.getElementById('openCreateTaskBtn')?.addEventListener('click', () => {
      document.getElementById('createTaskModal')?.classList.add('active');
    });
  }

  renderAssignments() {
    const container = document.getElementById('assignmentCardsGrid');
    if (!container) return;

    if (this.assignments.length === 0) {
      container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:3rem; color:#64748b;">No homework assignments found.</div>`;
      return;
    }

    const isTeacher = window.classroom?.currentRole === 'teacher';
    const currentStudentName = window.classroom?.currentUser?.name || 'Alex Johnson';

    container.innerHTML = this.assignments.map(asg => {
      // Find submission for current student or total submissions for teacher
      const studentSub = this.submissions.find(s => s.assignmentId === asg.id && s.studentName === currentStudentName);
      const totalSubs = this.submissions.filter(s => s.assignmentId === asg.id).length;

      return `
        <div class="assignment-card">
          <div class="assignment-tag-row">
            <span class="subject-badge">${asg.subject}</span>
            <span class="due-date-pill">⏳ Due: ${asg.dueDate}</span>
          </div>

          <h3 class="asg-title">${asg.title}</h3>
          <p class="asg-desc">${asg.description || 'Complete the assigned exercises with full working step-by-step.'}</p>

          <div class="asg-footer">
            <span class="points-text">💯 ${asg.totalPoints} Points</span>
            
            ${isTeacher ? `
              <button class="btn-primary" style="padding:6px 14px; font-size:0.8rem;" onclick="assignmentHub.openSubmissionsReviewModal('${asg.id}', '${asg.title.replace(/'/g, "\\'")}')">
                📑 View Submissions (${totalSubs})
              </button>
            ` : `
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                ${studentSub ? `
                  <button class="btn-primary" style="padding:6px 12px; font-size:0.78rem; background:${studentSub.status === 'Graded' ? '#10b981' : 'var(--accent-primary)'}" onclick="assignmentHub.viewMySubmissionStatus('${studentSub.id}')">
                    ${studentSub.status === 'Graded' ? `🏆 Graded (${studentSub.score}/${asg.totalPoints})` : '✅ Submitted (View)'}
                  </button>
                  <button class="btn-secondary" style="padding:6px 12px; font-size:0.78rem;" onclick="assignmentHub.openStudentSubmitModal('${asg.id}', '${asg.title.replace(/'/g, "\\'")}', ${asg.totalPoints})">
                    ✏️ Resubmit
                  </button>
                ` : `
                  <button class="btn-primary" style="padding:6px 14px; font-size:0.8rem;" onclick="assignmentHub.openStudentSubmitModal('${asg.id}', '${asg.title.replace(/'/g, "\\'")}', ${asg.totalPoints})">
                    📤 Submit Homework
                  </button>
                `}
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  openStudentSubmitModal(assignmentId, title, maxPoints) {
    const modal = document.getElementById('submitHomeworkModal');
    if (!modal) return;

    document.getElementById('submitModalAsgTitle').textContent = title;
    document.getElementById('submitModalAsgId').value = assignmentId;
    modal.classList.add('active');
  }

  viewMySubmissionStatus(submissionId) {
    const sub = this.submissions.find(s => s.id === submissionId);
    if (!sub) return;

    const modal = document.getElementById('viewSubmissionModal');
    if (!modal) return;

    document.getElementById('viewSubStudentName').textContent = sub.studentName;
    document.getElementById('viewSubText').textContent = sub.submissionText || 'Attached document submitted.';
    document.getElementById('viewSubStatus').textContent = sub.status;
    document.getElementById('viewSubScore').textContent = sub.score !== null ? `${sub.score} Pts` : 'Not Graded Yet';
    document.getElementById('viewSubFeedback').textContent = sub.feedback || 'Teacher has not submitted feedback yet.';

    // AI Review Box
    const aiBox = document.getElementById('viewSubAIReview');
    if (sub.aiReview) {
      aiBox.innerHTML = `
        <div style="background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.3); border-radius:8px; padding:10px; font-size:0.8rem;">
          <div style="color:#818cf8; font-weight:700; margin-bottom:4px;">🤖 AI Plagiarism & Quality Scan</div>
          <div><strong>Plagiarism Index:</strong> ${sub.aiReview.plagiarismScore} | <strong>Concept Mastery:</strong> ${sub.aiReview.conceptMastery}</div>
          <div style="margin-top:4px; color:#cbd5e1;">${sub.aiReview.summary}</div>
        </div>
      `;
    } else {
      aiBox.innerHTML = '';
    }

    modal.classList.add('active');
  }

  openSubmissionsReviewModal(assignmentId, title) {
    const modal = document.getElementById('teacherSubmissionsModal');
    if (!modal) return;

    document.getElementById('teacherSubModalTitle').textContent = `Submissions for: ${title}`;
    const listContainer = document.getElementById('teacherSubmissionsList');

    const relevantSubs = this.submissions.filter(s => s.assignmentId === assignmentId);

    if (relevantSubs.length === 0) {
      listContainer.innerHTML = `<div style="text-align:center; padding:2rem; color:#64748b;">No student submissions received yet for this assignment.</div>`;
    } else {
      listContainer.innerHTML = relevantSubs.map(sub => `
        <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:12px; padding:1.2rem; display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="font-size:1rem; color:#fff;">${sub.studentName}</strong>
              <span style="font-size:0.75rem; color:#94a3b8; margin-left:8px;">${new Date(sub.submittedAt).toLocaleString()}</span>
            </div>
            <span class="status-pill ${sub.status === 'Graded' ? 'status-focused' : 'status-warning'}">${sub.status}</span>
          </div>

          <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; font-size:0.85rem; color:#cbd5e1;">
            ${sub.submissionText || 'Submission PDF attachment uploaded.'}
          </div>

          <!-- AI Auto Review Badge -->
          <div style="background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.3); border-radius:8px; padding:8px 12px; font-size:0.8rem; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <span style="color:#22d3ee; font-weight:700;">✨ AI Pre-Evaluation:</span>
              <span style="color:#94a3b8; margin-left:6px;">Plagiarism: ${sub.aiReview?.plagiarismScore || '0%'} | Mastery: ${sub.aiReview?.conceptMastery || '95%'}</span>
            </div>
            <button class="ctrl-btn" style="padding:4px 10px; font-size:0.75rem;" onclick="assignmentHub.runAIAutoReview('${sub.id}')">
              ⚡ Regenerate AI Feedback
            </button>
          </div>

          <!-- Grading Inputs -->
          <div style="display:flex; gap:10px; align-items:center; margin-top:6px;">
            <input type="number" id="gradeScoreInput-${sub.id}" placeholder="Score" value="${sub.score || ''}" style="width:90px;" class="form-input" />
            <input type="text" id="gradeFeedbackInput-${sub.id}" placeholder="Teacher Feedback..." value="${sub.feedback || ''}" class="form-input" style="flex:1;" />
            <button class="btn-primary" style="padding:8px 16px; font-size:0.8rem;" onclick="assignmentHub.submitGrade('${sub.id}')">
              💾 Save Grade
            </button>
          </div>
        </div>
      `).join('');
    }

    modal.classList.add('active');
  }

  async runAIAutoReview(submissionId) {
    try {
      const res = await fetch(`/api/submissions/${submissionId}/ai-review`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        window.showToast?.('AI evaluation refreshed!', 'success');
        const feedbackInput = document.getElementById(`gradeFeedbackInput-${submissionId}`);
        const scoreInput = document.getElementById(`gradeScoreInput-${submissionId}`);
        if (feedbackInput) feedbackInput.value = data.data.summary;
        if (scoreInput && !scoreInput.value) scoreInput.value = data.data.suggestedScore || 95;
      }
    } catch (e) {
      window.showToast?.('AI review failed', 'danger');
    }
  }

  async submitGrade(submissionId) {
    const score = document.getElementById(`gradeScoreInput-${submissionId}`)?.value;
    const feedback = document.getElementById(`gradeFeedbackInput-${submissionId}`)?.value;

    if (!score) {
      window.showToast?.('Please specify a numerical score', 'danger');
      return;
    }

    try {
      const res = await fetch(`/api/submissions/${submissionId}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, feedback })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast?.('Grade & feedback successfully dispatched to student!', 'success');
        await this.fetchSubmissions();
        this.renderAssignments();
      }
    } catch (e) {
      window.showToast?.('Failed to save grade', 'danger');
    }
  }

  // ==========================================
  // Task Planner & Kanban Board
  // ==========================================
  renderTasks() {
    const todoCol = document.getElementById('kanbanTodoCol');
    const inProgCol = document.getElementById('kanbanInProgCol');
    const doneCol = document.getElementById('kanbanDoneCol');

    if (!todoCol || !inProgCol || !doneCol) return;

    todoCol.innerHTML = '';
    inProgCol.innerHTML = '';
    doneCol.innerHTML = '';

    this.tasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'task-card-item';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <span class="task-priority-tag priority-${task.priority}">${task.priority}</span>
          <button style="background:none; border:none; color:#64748b; cursor:pointer; font-size:1rem;" onclick="assignmentHub.deleteTask('${task.id}')">✕</button>
        </div>
        <div style="font-weight:700; font-size:0.9rem; color:#fff;">${task.title}</div>
        <div style="font-size:0.75rem; color:#94a3b8; display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
          <span>📅 ${task.dueDate}</span>
          <select style="background:#111625; color:#94a3b8; border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:0.72rem; padding:2px 4px;" onchange="assignmentHub.updateTaskStatus('${task.id}', this.value)">
            <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To Do</option>
            <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>
      `;

      if (task.status === 'in_progress') inProgCol.appendChild(card);
      else if (task.status === 'completed') doneCol.appendChild(card);
      else todoCol.appendChild(card);
    });
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
