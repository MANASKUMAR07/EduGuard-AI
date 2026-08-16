/**
 * EduGuard AI - Real WebRTC Multi-User Video Mesh & Live Classroom Engine
 */

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

class ClassroomManager {
  constructor() {
    this.socket = null;
    this.currentRole = 'teacher';
    this.currentRoomId = 'CLASS-101';
    this.currentUser = {
      name: 'Dr. Evelyn Reed',
      id: 't-001',
      role: 'teacher'
    };

    this.localStream = null;
    this.peerConnections = {}; // socketId -> RTCPeerConnection
    this.remoteStreams = {}; // socketId -> MediaStream

    this.isMuted = false;
    this.isVideoOff = false;
    this.isScreenSharing = false;
    this.handRaised = false;

    // Whiteboard state
    this.isDrawing = false;
    this.brushColor = '#6366f1';
    this.brushSize = 3;
    this.lastX = 0;
    this.lastY = 0;

    this.proctor = null;
    this.activeIncidents = [];
    this.participants = [];

    this.initSocket();
    this.initClassroomDOM();
    this.initWhiteboard();
  }

  initSocket() {
    this.socket = io();

    this.socket.on('connect', () => {
      console.log('Connected to EduGuard signaling socket:', this.socket.id);
      if (this.currentRole === 'teacher') {
        this.joinRoom();
      } else {
        this.requestStudentJoin();
      }
    });

    // 1. Waiting for Teacher Approval (Student Side)
    this.socket.on('waiting-for-teacher-approval', (data) => {
      this.showWaitingLobbyScreen(true, data.roomId);
    });

    // 2. Admission Approved by Teacher (Student Side)
    this.socket.on('admission-approved', async (data) => {
      this.showWaitingLobbyScreen(false);
      window.showToast?.('🎉 Teacher admitted you into the live classroom!', 'success');
      try {
        await this.startCamera('localVideoFeed');
      } catch (err) {
        console.warn('Camera start error:', err);
      }
      this.joinRoom(data.roomId);
    });

    // 3. Admission Rejected by Teacher (Student Side)
    this.socket.on('admission-rejected', (data) => {
      this.showWaitingLobbyScreen(false);
      alert(`❌ Admission Declined:\n\n${data.message || 'The teacher declined your admission request.'}`);
      window.showToast?.('Admission request was declined by teacher.', 'danger');
    });

    // 4. Admission Request Received (Teacher Side)
    this.socket.on('admission-request-received', (reqData) => {
      if (this.currentRole === 'teacher') {
        this.handleStudentAdmissionKnock(reqData);
      }
    });

    // 4b. Session Concluded By Teacher (Automatic Disconnect for Students)
    this.socket.on('session-ended-by-teacher', (data) => {
      this.handleSessionEndedByTeacher(data);
    });

    // 5. Room Roster Update
    this.socket.on('room-roster-update', (data) => {
      this.participants = data.participants || [];
      this.renderParticipantGrid();
    });

    // 6. A new peer joined the room -> initiate WebRTC Offer
    this.socket.on('user-connected', async ({ socketId, name, role }) => {
      console.log(`User connected: ${name} (${socketId}). Creating WebRTC offer...`);
      await this.createPeerConnection(socketId, name, role, true);
    });

    // 7. Receive WebRTC Offer -> Respond with Answer
    this.socket.on('webrtc-offer', async ({ callerSocketId, callerName, callerRole, offer }) => {
      console.log(`Received WebRTC offer from ${callerName} (${callerSocketId})`);
      const pc = await this.createPeerConnection(callerSocketId, callerName, callerRole, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.socket.emit('webrtc-answer', {
        targetSocketId: callerSocketId,
        answer
      });
    });

    // 8. Receive WebRTC Answer
    this.socket.on('webrtc-answer', async ({ responderSocketId, answer }) => {
      const pc = this.peerConnections[responderSocketId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    // 9. Receive ICE Candidate
    this.socket.on('webrtc-ice-candidate', async ({ senderSocketId, candidate }) => {
      const pc = this.peerConnections[senderSocketId];
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('Error adding ICE candidate:', e);
        }
      }
    });

    // 10. User Disconnected -> close peer connection and remove tile
    this.socket.on('user-disconnected', ({ socketId, name }) => {
      console.log(`User disconnected: ${name} (${socketId})`);
      if (this.peerConnections[socketId]) {
        this.peerConnections[socketId].close();
        delete this.peerConnections[socketId];
      }
      delete this.remoteStreams[socketId];
      document.getElementById(`tile-${socketId}`)?.remove();
    });

    // 11. Malpractice Alert received by Teacher
    this.socket.on('malpractice-alert-teacher', (incident) => {
      this.activeIncidents.unshift(incident);
      this.renderIncidentStream();
      this.showTeacherTopAlert(incident);
      this.updateStudentStatusInGrid(incident.studentName, incident.violationType);

      if (this.proctor) {
        this.proctor.playAlarmSound('danger');
      }
    });

    // 12. Whiteboard sync
    this.socket.on('whiteboard-draw', (drawData) => this.drawRemoteLine(drawData));
    this.socket.on('whiteboard-clear', () => this.clearWhiteboardCanvas(false));

    // 13. Live chat
    this.socket.on('receive-chat', (msg) => this.appendChatMessage(msg));

    // 14. Hand raise status
    this.socket.on('student-hand-status', (data) => {
      if (this.currentRole === 'teacher' && data.raised) {
        window.showToast?.(`✋ ${data.name} raised their hand!`, 'info');
      }
      this.renderParticipantGrid();
    });

    // 15. Teacher direct alert
    this.socket.on('teacher-direct-warning', (data) => {
      if (this.currentRole === 'student') {
        if (this.proctor) this.proctor.playAlarmSound('danger');
        alert(`🚨 TEACHER ALERT (${data.teacherName}):\n\n${data.warningMessage}`);
      }
    });

    // 16. Teacher Remote Media Control (Received by Student)
    this.socket.on('teacher-control-media', async ({ mediaType, state, teacherName }) => {
      if (this.currentRole === 'student') {
        if (mediaType === 'audio') {
          this.isMuted = !state;
          if (this.localStream) {
            this.localStream.getAudioTracks().forEach(t => t.enabled = state);
          }
          window.showToast?.(state ? `🎙️ Teacher (${teacherName}) unmuted your microphone.` : `🔇 Teacher (${teacherName}) muted your microphone.`, state ? 'info' : 'warning');
        } else if (mediaType === 'video') {
          this.isVideoOff = !state;
          if (this.localStream) {
            this.localStream.getVideoTracks().forEach(t => t.enabled = state);
          }
          window.showToast?.(state ? `📹 Teacher (${teacherName}) enabled your camera.` : `🚫 Teacher (${teacherName}) turned off your camera.`, state ? 'info' : 'warning');
        }
      }
    });
  }

  requestStudentJoin(roomId) {
    const room = (roomId || this.currentRoomId || 'CLASS-101').toUpperCase();
    this.currentRoomId = room;
    if (this.socket && this.socket.connected) {
      this.socket.emit('student-request-join', {
        roomId: room,
        name: this.currentUser.name,
        studentId: this.currentUser.id,
        email: this.currentUser.email
      });
    }
  }

  handleStudentAdmissionKnock(reqData) {
    if (this.currentRole !== 'teacher') return;
    if (this.proctor) this.proctor.playAlarmSound('info');

    let tray = document.getElementById('teacherAdmissionTray');
    if (!tray) {
      tray = document.createElement('div');
      tray.id = 'teacherAdmissionTray';
      tray.className = 'admission-requests-tray';
      document.body.appendChild(tray);
    }

    const cardId = `req-card-${reqData.socketId.replace(/[^a-zA-Z0-9]/g, '')}`;
    if (document.getElementById(cardId)) return;

    const card = document.createElement('div');
    card.id = cardId;
    card.className = 'admission-knock-card';
    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div class="user-avatar" style="width:34px; height:34px; font-size:0.9rem;">${reqData.name.charAt(0).toUpperCase()}</div>
        <div>
          <strong style="font-size:0.85rem; color:#fff;">${reqData.name}</strong><br>
          <span style="font-size:0.72rem; color:#94a3b8;">Knocking to join (${new Date(reqData.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})})</span>
        </div>
      </div>
      <div style="display:flex; gap:6px; margin-top:8px;">
        <button class="btn-primary" style="padding:6px 12px; font-size:0.75rem; flex:1; justify-content:center;" onclick="classroom.decideAdmission('${reqData.socketId}', true, '${cardId}')">
          ✅ Admit
        </button>
        <button class="btn-secondary" style="padding:6px 12px; font-size:0.75rem; flex:1; justify-content:center; border-color:rgba(239,68,68,0.4); color:#fca5a5;" onclick="classroom.decideAdmission('${reqData.socketId}', false, '${cardId}')">
          ❌ Deny
        </button>
      </div>
    `;
    tray.appendChild(card);
    window.showToast?.(`🚪 Student ${reqData.name} requested to join the class!`, 'info');
  }

  decideAdmission(targetSocketId, approved, cardId) {
    this.socket.emit('teacher-decision-join', {
      targetSocketId,
      roomId: this.currentRoomId,
      approved
    });
    document.getElementById(cardId)?.remove();
    window.showToast?.(approved ? 'Student admitted to classroom.' : 'Admission declined.', approved ? 'success' : 'warning');
  }

  showWaitingLobbyScreen(show, roomId) {
    let lobby = document.getElementById('studentWaitingLobby');
    if (show) {
      if (!lobby) {
        lobby = document.createElement('div');
        lobby.id = 'studentWaitingLobby';
        lobby.className = 'waiting-lobby-screen';
        document.body.appendChild(lobby);
      }
      lobby.innerHTML = `
        <div class="waiting-lobby-card">
          <div class="waiting-spinner-ring"></div>
          <h2 style="font-size:1.4rem; font-weight:800; color:#fff; margin-top:1rem;">Waiting for Teacher Approval</h2>
          <p style="font-size:0.85rem; color:#94a3b8; margin-top:6px; line-height:1.5;">
            You have knocked to join class <strong style="color:#818cf8;">${roomId || this.currentRoomId}</strong>.<br>
            Please wait while the teacher accepts your admission request.
          </p>
          <div style="display:flex; justify-content:center; margin-top:1.25rem;">
            <button class="btn-secondary" onclick="document.getElementById('openRoomManagerBtn').click(); classroom.showWaitingLobbyScreen(false);">
              Cancel / Change Code
            </button>
          </div>
        </div>
      `;
      lobby.style.display = 'flex';
    } else if (lobby) {
      lobby.style.display = 'none';
    }
  }

  generateRandomRoomCode() {
    const prefixes = ['MATH', 'PHYS', 'CHEM', 'BIO', 'ENG', 'EDU', 'CS', 'AI'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${num}`;
  }

  async createPeerConnection(socketId, peerName, peerRole, isInitiator) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections[socketId] = pc;

    // Add local tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Handle ICE Candidate exchange
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc-ice-candidate', {
          targetSocketId: socketId,
          candidate: event.candidate
        });
      }
    };

    // Handle incoming remote media stream
    pc.ontrack = (event) => {
      console.log(`Received remote track (${event.track.kind}) from ${peerName} (${socketId})`);
      let remoteStream = this.remoteStreams[socketId];
      if (!remoteStream) {
        remoteStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream();
        this.remoteStreams[socketId] = remoteStream;
      }
      if (!remoteStream.getTracks().includes(event.track)) {
        remoteStream.addTrack(event.track);
      }
      this.renderRemoteVideoTile(socketId, peerName, peerRole, remoteStream);
    };

    // If initiator, create and send WebRTC offer
    if (isInitiator) {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pc.setLocalDescription(offer);

      this.socket.emit('webrtc-offer', {
        targetSocketId: socketId,
        offer
      });
    }

    return pc;
  }

  setRole(newRole, userName, userEmail) {
    this.currentRole = newRole;
    this.currentUser = {
      name: userName || (newRole === 'manager' ? 'Executive Manager' : (newRole === 'teacher' ? 'Dr. Evelyn Reed' : 'Alex Johnson')),
      email: userEmail || `${newRole}@eduguard.edu`,
      id: newRole === 'manager' ? 'mgr-001' : (newRole === 'teacher' ? 't-001' : 'stu-001'),
      role: newRole
    };

    const isTeacher = newRole === 'teacher' || newRole === 'manager';
    const isManager = newRole === 'manager';

    // 1. Toggle Teacher-Only, Manager-Only, and Student-Only UI Elements
    const teacherOnlyElements = document.querySelectorAll('.teacher-only, .teacher-only-nav');
    const studentOnlyElements = document.querySelectorAll('.student-only');
    const managerNav = document.getElementById('navManagerBtn');

    teacherOnlyElements.forEach(el => el.style.display = isTeacher ? '' : 'none');
    studentOnlyElements.forEach(el => el.style.display = isTeacher ? 'none' : '');
    if (managerNav) managerNav.style.display = isManager ? '' : 'none';

    // 2. Update Navigation Labels
    const navAsg = document.getElementById('navAssignmentsBtn');
    const navTasks = document.getElementById('navTasksBtn');
    if (navAsg) {
      navAsg.innerHTML = isTeacher ? '<span>📚</span> Homework & Grading' : '<span>📚</span> My Homework';
    }
    if (navTasks) {
      navTasks.innerHTML = isTeacher ? '<span>📋</span> Task Planner' : '<span>📋</span> My Study Tasks';
    }

    // 3. Switch view if on restricted tab or auto open manager view
    const activeNav = document.querySelector('.nav-tab-btn.active');
    if (!isTeacher && activeNav && activeNav.classList.contains('teacher-only-nav')) {
      document.querySelector('[data-view="classroom"]')?.click();
    }
    if (isManager) {
      document.querySelector('[data-view="manager"]')?.click();
      window.managerHub?.loadManagerOverview();
    }

    // 4. Update Header Profile Card
    document.getElementById('headerUserName').textContent = this.currentUser.name;
    document.getElementById('headerUserRole').textContent = isManager ? '🛡️ Executive Manager' : (isTeacher ? 'Teacher (Host & Proctor)' : 'Student Portal');
    document.getElementById('headerAvatarInitial').textContent = this.currentUser.name.charAt(0).toUpperCase();

    this.switchSidebarTab('chat');

    if (isManager) {
      if (this.proctor) this.proctor.stopMonitoring();
    } else if (isTeacher) {
      this.joinRoom(this.currentRoomId);
      this.startCamera('localVideoFeed');
      if (this.proctor) this.proctor.stopMonitoring();
    } else {
      // Students MUST knock and wait in the lobby until teacher approves
      this.showWaitingLobbyScreen(true, this.currentRoomId);
      this.requestStudentJoin(this.currentRoomId);
    }
  }

  switchSidebarTab(tab) {
    const chatBtn = document.getElementById('sidebarChatTabBtn');
    const studentsBtn = document.getElementById('sidebarStudentsTabBtn');
    const malpBtn = document.getElementById('sidebarMalpracticeTabBtn');

    const chatContent = document.getElementById('chatTabContent');
    const studentsContent = document.getElementById('studentsTabContent');
    const malpContent = document.getElementById('malpracticeTabContent');

    [chatBtn, studentsBtn, malpBtn].forEach(b => b?.classList.remove('active'));
    [chatContent, studentsContent, malpContent].forEach(c => {
      if (c) c.style.display = 'none';
    });

    if (tab === 'chat') {
      chatBtn?.classList.add('active');
      if (chatContent) chatContent.style.display = 'flex';
    } else if (tab === 'students' && this.currentRole === 'teacher') {
      studentsBtn?.classList.add('active');
      if (studentsContent) studentsContent.style.display = 'flex';
      this.renderParticipantGrid();
    } else if (tab === 'malpractice' && this.currentRole === 'teacher') {
      malpBtn?.classList.add('active');
      if (malpContent) malpContent.style.display = 'flex';
    }
  }

  joinRoom(roomId) {
    if (roomId) this.currentRoomId = roomId;
    if (!this.socket || !this.socket.connected) return;

    this.socket.emit('join-room', {
      roomId: this.currentRoomId,
      role: this.currentRole,
      name: this.currentUser.name,
      studentId: this.currentUser.id
    });
  }

  async startCamera(videoElementId = 'localVideoFeed') {
    const videoEl = document.getElementById(videoElementId);
    if (!videoEl) return;

    videoEl.muted = true;
    videoEl.autoplay = true;
    videoEl.playsInline = true;

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        let stream = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 }, facingMode: 'user' },
            audio: true
          });
        } catch (e1) {
          // Retry video only if microphone is unavailable
          console.warn('Audio+Video failed, retrying video only:', e1);
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (stream) {
          this.localStream = stream;
          videoEl.srcObject = stream;
          await videoEl.play().catch(e => console.warn('Auto-play caught:', e));

          // Replace / Add tracks to existing WebRTC peer connections
          Object.values(this.peerConnections).forEach(pc => {
            const senders = pc.getSenders();
            stream.getTracks().forEach(track => {
              const sender = senders.find(s => s.track && s.track.kind === track.kind);
              if (sender) {
                sender.replaceTrack(track);
              } else {
                pc.addTrack(track, stream);
              }
            });
          });

          // Mirror to proctoring center inspector video
          const inspectVideo = document.getElementById('inspectVideoFeed');
          if (inspectVideo) {
            inspectVideo.srcObject = stream;
            inspectVideo.play().catch(() => {});
          }

          // Start proctoring eye
          if (this.currentRole === 'student') {
            this.startStudentProctoring();
          }
          return;
        }
      }
      throw new Error('Camera access not supported on this browser/environment.');
    } catch (err) {
      console.warn('Webcam permission not granted or device not available:', err);
      window.showToast?.('Camera permission needed for live video & proctoring verification.', 'warning');
    }
  }

  startStudentProctoring() {
    const videoEl = document.getElementById('localVideoFeed');
    const canvasEl = document.getElementById('aiOverlayCanvas');

    if (!this.proctor) {
      this.proctor = new EduProctorEngine({
        videoElement: videoEl,
        canvasElement: canvasEl,
        onViolation: (violationData) => {
          this.socket.emit('malpractice-event', {
            ...violationData,
            studentName: this.currentUser.name,
            studentId: this.currentUser.id
          });
          window.showToast?.(`⚠️ Alert: ${violationData.violationType}`, 'danger');
        },
        onTelemetry: (telemetry) => {
          this.updateHUDTelemetry(telemetry);
        }
      });
    }

    this.proctor.startMonitoring(videoEl, canvasEl);
  }

  updateHUDTelemetry(t) {
    const telemetryBox = document.getElementById('inspectTelemetryBox');
    if (telemetryBox) {
      telemetryBox.innerHTML = `
        <div><strong>AI State:</strong> <span style="color:${t.faceDetected ? '#10b981' : '#ef4444'}">${t.gaze}</span></div>
        <div><strong>Focus Metric:</strong> ${t.focusScore}%</div>
        <div><strong>Tab Switched:</strong> ${t.tabSwitches} times</div>
        <div><strong>Posture Centroid:</strong> (${t.centroid.x.toFixed(2)}, ${t.centroid.y.toFixed(2)})</div>
      `;
    }

    const fill = document.getElementById('myFocusFill');
    const txt = document.getElementById('myFocusText');
    if (fill) fill.style.width = `${t.focusScore}%`;
    if (txt) txt.textContent = `${t.focusScore}%`;
  }

  renderParticipantGrid() {
    const students = this.participants.filter(p => p.role !== 'teacher');
    const countBadge = document.getElementById('liveStudentsCountBadge');
    const rosterCount = document.getElementById('studentsRosterCount');

    if (countBadge) countBadge.textContent = this.participants.length;
    if (rosterCount) rosterCount.textContent = students.length;

    const rosterList = document.getElementById('studentsRosterList');
    if (rosterList && this.currentRole === 'teacher') {
      if (students.length === 0) {
        rosterList.innerHTML = `
          <div style="text-align:center; color:#64748b; padding:1.5rem; font-size:0.8rem;">
            No students currently in session. Share Class Code <strong>${this.currentRoomId}</strong>.
          </div>
        `;
      } else {
        rosterList.innerHTML = students.map(s => {
          const mediaState = (this.remoteMediaStates && this.remoteMediaStates[s.socketId]) || { audio: true, video: true };
          return `
            <div style="background:rgba(15,23,42,0.9); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:8px 10px; display:flex; flex-direction:column; gap:6px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <div class="user-avatar" style="width:28px; height:28px; font-size:0.75rem;">${s.name.charAt(0).toUpperCase()}</div>
                  <div>
                    <strong style="font-size:0.82rem; color:#fff;">${s.name}</strong><br>
                    <span style="font-size:0.68rem; color:#34d399;">● Connected</span>
                  </div>
                </div>
                <button class="ctrl-btn btn-danger" style="padding:2px 8px; font-size:0.68rem;" onclick="classroom.sendDirectWarning('${s.name}', '${s.socketId}')">
                  ⚠️ Warn
                </button>
              </div>

              <!-- Interactive Mic & Cam Remote Switchers -->
              <div style="display:flex; gap:6px; margin-top:2px;">
                <button class="ctrl-btn" style="flex:1; justify-content:center; padding:4px 8px; font-size:0.72rem; ${mediaState.audio ? 'background:rgba(16,185,129,0.15); border-color:#10b981; color:#6ee7b7;' : 'background:rgba(239,68,68,0.15); border-color:#ef4444; color:#fca5a5;'}" onclick="classroom.remoteToggleStudentMedia('${s.socketId}', 'audio')">
                  ${mediaState.audio ? '🔇 Mute Mic' : '🎙️ Unmute Mic'}
                </button>
                <button class="ctrl-btn" style="flex:1; justify-content:center; padding:4px 8px; font-size:0.72rem; ${mediaState.video ? 'background:rgba(59,130,246,0.15); border-color:#3b82f6; color:#93c5fd;' : 'background:rgba(239,68,68,0.15); border-color:#ef4444; color:#fca5a5;'}" onclick="classroom.remoteToggleStudentMedia('${s.socketId}', 'video')">
                  ${mediaState.video ? '🚫 Cam Off' : '📹 Cam On'}
                </button>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  renderRemoteVideoTile(socketId, peerName, peerRole, remoteStream) {
    const grid = document.getElementById('classroomVideoGrid');
    if (!grid) return;

    let tile = document.getElementById(`tile-${socketId}`);
    const mediaState = (this.remoteMediaStates && this.remoteMediaStates[socketId]) || { audio: true, video: true };

    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'video-tile remote-tile';
      tile.id = `tile-${socketId}`;

      tile.innerHTML = `
        <video id="video-${socketId}" autoplay playsinline style="width:100%; height:100%; object-fit:cover; display:block;"></video>
        <div class="video-overlay-top">
          <div class="participant-tag">
            <span>${peerName}</span>
            <span style="font-size:0.68rem; color:${peerRole === 'teacher' ? '#818cf8' : '#38bdf8'}">(${peerRole})</span>
          </div>
          <div class="status-pill status-focused" id="pill-${socketId}">
            ● Live Stream
          </div>
        </div>
        <div class="video-overlay-bottom" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
          <div class="focus-meter-mini">
            <span>Status:</span>
            <span style="color:#34d399; font-weight:700;">Connected</span>
          </div>
          ${this.currentRole === 'teacher' ? `
            <div style="display:flex; gap:3px;">
              <button id="tile-mic-btn-${socketId}" class="ctrl-btn" style="padding:3px 7px; font-size:0.68rem; ${mediaState.audio ? 'color:#6ee7b7;' : 'color:#fca5a5;'}" onclick="classroom.remoteToggleStudentMedia('${socketId}', 'audio')" title="Teacher Mute/Unmute Student Mic">
                ${mediaState.audio ? '🔇 Mute' : '🎙️ Unmute'}
              </button>
              <button id="tile-cam-btn-${socketId}" class="ctrl-btn" style="padding:3px 7px; font-size:0.68rem; ${mediaState.video ? 'color:#93c5fd;' : 'color:#fca5a5;'}" onclick="classroom.remoteToggleStudentMedia('${socketId}', 'video')" title="Teacher Turn On/Off Student Camera">
                ${mediaState.video ? '🚫 Cam Off' : '📹 Cam On'}
              </button>
              <button class="ctrl-btn btn-danger" style="padding:3px 7px; font-size:0.68rem;" onclick="classroom.sendDirectWarning('${peerName}', '${socketId}')" title="Send Direct Warning">
                ⚠️ Warn
              </button>
            </div>
          ` : ''}
        </div>
      `;
      grid.appendChild(tile);
    }

    const videoEl = document.getElementById(`video-${socketId}`);
    if (videoEl && remoteStream) {
      if (videoEl.srcObject !== remoteStream) {
        videoEl.srcObject = remoteStream;
      }
      videoEl.play().catch(e => console.warn('Remote video play caught:', e));
    }
  }

  remoteToggleStudentMedia(targetSocketId, mediaType) {
    if (this.currentRole !== 'teacher') return;
    if (!this.remoteMediaStates) this.remoteMediaStates = {};
    if (!this.remoteMediaStates[targetSocketId]) {
      this.remoteMediaStates[targetSocketId] = { audio: true, video: true };
    }

    const currentState = this.remoteMediaStates[targetSocketId][mediaType];
    const newState = !currentState;
    this.remoteMediaStates[targetSocketId][mediaType] = newState;

    this.socket.emit('teacher-control-media', {
      targetSocketId,
      mediaType,
      state: newState
    });

    // Update Tile Buttons
    const micBtn = document.getElementById(`tile-mic-btn-${targetSocketId}`);
    const camBtn = document.getElementById(`tile-cam-btn-${targetSocketId}`);
    if (mediaType === 'audio' && micBtn) {
      micBtn.innerHTML = newState ? '🔇 Mute' : '🎙️ Unmute';
      micBtn.style.color = newState ? '#6ee7b7' : '#fca5a5';
    } else if (mediaType === 'video' && camBtn) {
      camBtn.innerHTML = newState ? '🚫 Cam Off' : '📹 Cam On';
      camBtn.style.color = newState ? '#93c5fd' : '#fca5a5';
    }

    // Refresh Roster list
    this.renderParticipantGrid();

    window.showToast?.(`Teacher commanded student ${mediaType === 'audio' ? (newState ? '🎙️ Mic UNMUTED' : '🔇 Mic MUTED') : (newState ? '📹 Cam ENABLED' : '🚫 Cam DISABLED')}.`, 'info');
  }

  muteAllStudents() {
    if (this.currentRole !== 'teacher') return;
    this.socket.emit('teacher-control-media', {
      roomId: this.currentRoomId,
      mediaType: 'audio',
      state: false
    });
    window.showToast?.('🔇 Teacher Muted All Students in classroom.', 'warning');
  }

  forceAllStudentCamsOn() {
    if (this.currentRole !== 'teacher') return;
    this.socket.emit('teacher-control-media', {
      roomId: this.currentRoomId,
      mediaType: 'video',
      state: true
    });
    window.showToast?.('📹 Teacher requested All Student Cameras ON for Proctoring.', 'info');
  }

  updateStudentStatusInGrid(studentName, violation) {
    // Find matching tile by student name
    const tiles = document.querySelectorAll('.remote-tile');
    tiles.forEach(tile => {
      if (tile.textContent.includes(studentName)) {
        tile.classList.add('malpractice-active');
        setTimeout(() => tile.classList.remove('malpractice-active'), 8000);

        const pill = tile.querySelector('.status-pill');
        if (pill) {
          pill.className = 'status-pill status-danger';
          pill.textContent = `✖ ${violation}`;
          setTimeout(() => {
            pill.className = 'status-pill status-focused';
            pill.textContent = '● Live Stream';
          }, 8000);
        }
      }
    });
  }

  showTeacherTopAlert(incident) {
    if (this.currentRole !== 'teacher') return;

    const banner = document.getElementById('globalAlertTicker');
    const txt = document.getElementById('globalAlertText');
    if (banner && txt) {
      banner.classList.remove('hidden');
      txt.innerHTML = `<strong>🚨 MALPRACTICE DETECTED:</strong> Student <u>${incident.studentName}</u> triggered <em>${incident.violationType}</em>! Evidence snapshot captured automatically.`;
      setTimeout(() => banner.classList.add('hidden'), 10000);
    }
  }

  renderIncidentStream() {
    const container = document.getElementById('malpracticeStreamContainer');
    if (!container) return;

    if (this.activeIncidents.length === 0) {
      container.innerHTML = `<div style="text-align:center; color:#64748b; padding:2rem; font-size:0.85rem;">Zero malpractice infractions recorded. AI monitoring active.</div>`;
      return;
    }

    container.innerHTML = this.activeIncidents.map(inc => `
      <div class="incident-card">
        <div class="incident-header">
          <span class="incident-student-name">${inc.studentName}</span>
          <span class="incident-time">${new Date(inc.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="incident-body">
          <span>⚠️ <strong>${inc.violationType}</strong></span>
        </div>
        <div style="font-size:0.75rem; color:#94a3b8;">${inc.details}</div>
        ${inc.snapshot ? `
          <img class="incident-snapshot-thumb" src="${inc.snapshot}" alt="Evidence Snapshot" onclick="classroom.previewSnapshotModal('${inc.snapshot}', '${inc.studentName}', '${inc.violationType}')" title="Click to view full snapshot" />
        ` : ''}
      </div>
    `).join('');

    const countBadge = document.getElementById('incidentsCountBadge');
    if (countBadge) countBadge.textContent = this.activeIncidents.length;
  }

  sendDirectWarning(studentName, targetSocketId) {
    const reason = prompt(`Enter direct alert message to send to ${studentName}:`, 'Please return your focus to the lecture and stop navigating away.');
    if (reason) {
      this.socket.emit('teacher-direct-warning', {
        targetSocketId,
        targetStudentName: studentName,
        warningMessage: reason
      });
      window.showToast?.(`Warning sent to ${studentName}`, 'success');
    }
  }

  previewSnapshotModal(snapshotSrc, studentName, violation) {
    const modal = document.getElementById('snapshotPreviewModal');
    const img = document.getElementById('snapshotModalImg');
    const title = document.getElementById('snapshotModalTitle');

    if (modal && img) {
      img.src = snapshotSrc;
      title.textContent = `Evidence Snapshot: ${studentName} - ${violation}`;
      modal.classList.add('active');
    }
  }

  initClassroomDOM() {
    // Hardware Microphone Toggle (Full Hardware Release / Privacy Indicator power off)
    document.getElementById('micToggleBtn')?.addEventListener('click', async (e) => {
      this.isMuted = !this.isMuted;
      const btn = e.currentTarget;

      if (this.isMuted) {
        // 1. Physically STOP all active audio tracks so hardware mic sensor releases completely
        if (this.localStream) {
          this.localStream.getAudioTracks().forEach(track => {
            track.stop(); // Releases audio hardware lock and turns off recording indicator
          });
        }

        // 2. Inform WebRTC peers that audio track is stopped
        Object.values(this.peerConnections).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
          if (sender) {
            sender.replaceTrack(null);
          }
        });

        btn.classList.remove('btn-active');
        btn.innerHTML = '🔇 Mic Muted';
        window.showToast?.('Microphone hardware turned off (recording released).', 'info');
      } else {
        // Re-acquire physical microphone device & re-attach live audio track
        btn.classList.add('btn-active');
        btn.innerHTML = '🎙️ Mic Active';
        window.showToast?.('Activating microphone...', 'info');

        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const newAudioTrack = audioStream.getAudioTracks()[0];

          if (this.localStream) {
            // Remove old stopped tracks
            this.localStream.getAudioTracks().forEach(t => this.localStream.removeTrack(t));
            this.localStream.addTrack(newAudioTrack);
          } else {
            this.localStream = audioStream;
          }

          // Re-attach new audio track to all active WebRTC peer connections
          Object.values(this.peerConnections).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (sender) {
              sender.replaceTrack(newAudioTrack);
            } else {
              pc.addTrack(newAudioTrack, this.localStream);
            }
          });

          window.showToast?.('Microphone active and streaming.', 'success');
        } catch (err) {
          console.warn('Failed to re-acquire microphone:', err);
          btn.classList.remove('btn-active');
          btn.innerHTML = '🔇 Mic Muted';
          this.isMuted = true;
          window.showToast?.('Could not access microphone device.', 'warning');
        }
      }
    });

    // Hardware Camera Toggle (Full Hardware Release / LED power off)
    document.getElementById('camToggleBtn')?.addEventListener('click', async (e) => {
      this.isVideoOff = !this.isVideoOff;
      const btn = e.currentTarget;

      if (this.isVideoOff) {
        // 1. Physically STOP all active video tracks so hardware sensor & LED power off completely
        if (this.localStream) {
          this.localStream.getVideoTracks().forEach(track => {
            track.stop(); // Releases hardware lock and turns off physical LED
          });
        }

        // 2. Clear video element source
        const localVideo = document.getElementById('localVideoFeed');
        if (localVideo) {
          localVideo.srcObject = null;
        }

        // 3. Inform WebRTC peers that video track is stopped
        Object.values(this.peerConnections).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(null);
          }
        });

        // 4. Clear overlay canvas
        const overlayCanvas = document.getElementById('aiOverlayCanvas');
        if (overlayCanvas) {
          const ctx = overlayCanvas.getContext('2d');
          ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }

        btn.classList.remove('btn-active');
        btn.innerHTML = '🚫 Cam Off';
        window.showToast?.('Camera hardware turned off (LED disabled).', 'info');
      } else {
        // Re-acquire physical camera device & restart video streaming
        btn.classList.add('btn-active');
        btn.innerHTML = '📹 Cam On';
        window.showToast?.('Initializing camera...', 'info');
        await this.startCamera('localVideoFeed');
      }
    });

    // Screen Share Toggle
    document.getElementById('screenShareBtn')?.addEventListener('click', async (e) => {
      try {
        if (!this.isScreenSharing) {
          const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          const screenTrack = screenStream.getVideoTracks()[0];

          Object.values(this.peerConnections).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(screenTrack);
          });

          const localVideo = document.getElementById('localVideoFeed');
          if (localVideo) localVideo.srcObject = screenStream;

          screenTrack.onended = () => {
            this.stopScreenSharing();
          };

          this.isScreenSharing = true;
          e.currentTarget.classList.add('btn-active');
          e.currentTarget.innerHTML = '🖥️ Stop Sharing';
          window.showToast?.('Screen sharing active', 'info');
        } else {
          this.stopScreenSharing();
        }
      } catch (err) {
        console.warn('Screen share canceled or failed', err);
      }
    });

    // Hand Raise Toggle
    document.getElementById('handRaiseBtn')?.addEventListener('click', (e) => {
      this.handRaised = !this.handRaised;
      this.socket.emit('toggle-hand', { raised: this.handRaised });
      e.currentTarget.classList.toggle('btn-active', this.handRaised);
      e.currentTarget.innerHTML = this.handRaised ? '✋ Hand Raised' : '✋ Raise Hand';
    });

    // Chat submit
    document.getElementById('chatForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('chatInput');
      const text = input.value.trim();
      if (text) {
        this.socket.emit('send-chat', { message: text });
        input.value = '';
      }
    });

    // Mode tab toggle (Video Grid vs Whiteboard)
    document.querySelectorAll('.mode-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.mode-tab-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const mode = e.currentTarget.dataset.mode;

        if (mode === 'whiteboard') {
          document.getElementById('classroomVideoGrid').style.display = 'none';
          document.getElementById('classroomWhiteboardStage').classList.add('active');
          this.resizeWhiteboard();
        } else {
          document.getElementById('classroomVideoGrid').style.display = 'grid';
          document.getElementById('classroomWhiteboardStage').classList.remove('active');
        }
      });
    });
  }

  stopScreenSharing() {
    this.isScreenSharing = false;
    const btn = document.getElementById('screenShareBtn');
    if (btn) {
      btn.classList.remove('btn-active');
      btn.innerHTML = '🖥️ Share Screen';
    }

    if (this.localStream) {
      const camTrack = this.localStream.getVideoTracks()[0];
      Object.values(this.peerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && camTrack) sender.replaceTrack(camTrack);
      });
      const localVideo = document.getElementById('localVideoFeed');
      if (localVideo) localVideo.srcObject = this.localStream;
    }
  }

  appendChatMessage(msg) {
    const box = document.getElementById('chatMessagesBox');
    if (!box) return;

    const isSelf = msg.senderName === this.currentUser.name;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSelf ? 'self' : msg.senderRole}`;
    bubble.innerHTML = `
      <div class="chat-sender">${isSelf ? 'You' : msg.senderName} (${msg.senderRole}) • ${msg.timestamp}</div>
      <div class="chat-text">${msg.message}</div>
    `;
    box.appendChild(bubble);
    box.scrollTop = box.scrollHeight;
  }

  // ==========================================
  // Interactive Whiteboard Engine
  // ==========================================
  initWhiteboard() {
    const canvas = document.getElementById('whiteboardCanvas');
    if (!canvas) return;

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
      };
    };

    canvas.addEventListener('mousedown', (e) => {
      this.isDrawing = true;
      const pos = getPos(e);
      this.lastX = pos.x;
      this.lastY = pos.y;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!this.isDrawing) return;
      const pos = getPos(e);

      this.drawLocalLine(this.lastX, this.lastY, pos.x, pos.y, this.brushColor, this.brushSize);

      this.socket.emit('whiteboard-draw', {
        x0: this.lastX,
        y0: this.lastY,
        x1: pos.x,
        y1: pos.y,
        color: this.brushColor,
        size: this.brushSize
      });

      this.lastX = pos.x;
      this.lastY = pos.y;
    });

    window.addEventListener('mouseup', () => this.isDrawing = false);

    document.getElementById('wbColorPicker')?.addEventListener('input', (e) => {
      this.brushColor = e.target.value;
    });

    document.getElementById('wbClearBtn')?.addEventListener('click', () => {
      this.clearWhiteboardCanvas(true);
    });
  }

  resizeWhiteboard() {
    const canvas = document.getElementById('whiteboardCanvas');
    if (canvas) {
      canvas.width = canvas.parentElement.clientWidth || 800;
      canvas.height = canvas.parentElement.clientHeight || 500;
    }
  }

  drawLocalLine(x0, y0, x1, y1, color, size) {
    const canvas = document.getElementById('whiteboardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  drawRemoteLine(data) {
    this.drawLocalLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size);
  }

  clearWhiteboardCanvas(broadcast = true) {
    const canvas = document.getElementById('whiteboardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (broadcast && this.socket) {
      this.socket.emit('whiteboard-clear');
    }
  }

  handleSessionEndedByTeacher(data) {
    console.log('[CLASSROOM] Session ended by teacher:', data);

    // Stop local media stream (camera & mic)
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try { track.stop(); } catch(e) {}
      });
      this.localStream = null;
    }
    const localVideo = document.getElementById('localVideoFeed');
    if (localVideo) {
      localVideo.srcObject = null;
    }

    // Close all active WebRTC peer connections
    Object.keys(this.peerConnections).forEach(socketId => {
      try {
        this.peerConnections[socketId].close();
      } catch (e) {}
      delete this.peerConnections[socketId];
    });

    this.participants = [];
    this.renderParticipantGrid();

    // If current user is a student, alert them and return to dashboard
    if (this.currentRole === 'student') {
      alert(`🔴 Class Concluded\n\n${data.message || 'The teacher has ended the live classroom session.'}\n\nYou have been automatically disconnected.`);
      window.showToast?.('The teacher has ended the classroom session.', 'warning');
      document.querySelector('[data-view="assignments"]')?.click();
    }
  }

  async leaveMeetingAndExportPdf() {
    const isTeacher = this.currentRole === 'teacher';
    const confirmMsg = isTeacher 
      ? `🔴 Conclude Classroom Session ${this.currentRoomId}?\n\nThis will automatically end the meeting for all connected students and generate the Official PDF Report with all violation logs and photo evidence.`
      : `Leave classroom session ${this.currentRoomId}?`;

    if (!confirm(confirmMsg)) return;

    window.showToast?.('📑 Concluding session for all students & compiling Official PDF Report...', 'info');

    if (isTeacher) {
      // Stop teacher local media (student notification happens via the REST endpoint below)
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          try { track.stop(); } catch(e) {}
        });
        this.localStream = null;
      }
      const localVideo = document.getElementById('localVideoFeed');
      if (localVideo) localVideo.srcObject = null;

      // 2. Close peer connections
      Object.keys(this.peerConnections).forEach(socketId => {
        try { this.peerConnections[socketId].close(); } catch(e){}
        delete this.peerConnections[socketId];
      });

      this.participants = [];
      this.renderParticipantGrid();

      // 3. Call API to archive session (this also broadcasts session-ended-by-teacher to all students)
      try {
        const res = await fetch('/api/reports/end-session-archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: this.currentRoomId,
            teacherName: this.currentUser?.name || 'Faculty Teacher',
            durationMinutes: 45
          })
        });
        const data = await res.json();
        if (data.success) {
          window.showToast?.('✅ Meeting ended for all students. PDF Report ready!', 'success');
          // Navigate to Reports tab
          document.querySelector('[data-view="reports"]')?.click();
          if (window.reportHub) {
            window.reportHub.renderReport(data.data);
            window.reportHub.load7DayPdfArchives();
          }
        }
      } catch (err) {
        console.error('Failed to archive session on exit:', err);
      }
    } else {
      // Student leaving individually
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          try { track.stop(); } catch(e) {}
        });
        this.localStream = null;
      }
      const localVideo = document.getElementById('localVideoFeed');
      if (localVideo) localVideo.srcObject = null;

      Object.keys(this.peerConnections).forEach(socketId => {
        try { this.peerConnections[socketId].close(); } catch(e){}
        delete this.peerConnections[socketId];
      });

      window.showToast?.('You have left the classroom session.', 'info');
      document.querySelector('[data-view="assignments"]')?.click();
    }
  }
}

window.ClassroomManager = ClassroomManager;
