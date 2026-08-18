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
    this.isAuthenticated = false;
    this.currentRole = null;
    this.currentRoomId = 'CLASS-101';
    this.currentUser = {
      name: '',
      id: '',
      role: '',
      email: ''
    };

    this.localStream = null;
    this.peerConnections = {}; // socketId -> RTCPeerConnection
    this.remoteStreams = {}; // socketId -> MediaStream
    this.remoteMediaStates = {}; // socketId -> { audio: bool, video: bool }

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
    this.pinnedTileId = null;

    this.initSocket();
    this.initClassroomDOM();
    this.initWhiteboard();
  }

  initSocket() {
    try {
      this.socket = io();
    } catch (e) {
      console.warn('Socket.IO connection failed or offline:', e);
      return;
    }

    this.socket.on('connect', () => {
      console.log('Connected to EduGuard signaling socket:', this.socket.id);
      if (this.currentRole === 'teacher') {
        this.joinRoom(this.currentRoomId);
      } else if (this.currentRole === 'student') {
        this.requestStudentJoin(this.currentRoomId);
      }
    });

    // 1. Admission Approved (Student Side)
    this.socket.on('admission-approved', async (data) => {
      this.handleStudentAdmissionSuccess(data);
    });

    // 2. Admission Rejected (Student Side)
    this.socket.on('admission-rejected', (data) => {
      this.handleStudentAdmissionDenied(data);
    });

    // 3. Admission Request Sent (Waiting Screen for Student)
    this.socket.on('admission-request-pending', (data) => {
      window.showToast?.(`Admission request sent to teacher host (${data.roomId}). Waiting for permission...`, 'info');
    });

    // 4. Admission Request Received (Teacher Side)
    this.socket.on('admission-request-received', (reqData) => {
      if (this.currentRole === 'teacher') {
        this.handleStudentAdmissionKnock(reqData);
      }
    });

    // 4b. Session Concluded By Teacher
    this.socket.on('session-ended-by-teacher', (data) => {
      this.handleSessionEndedByTeacher(data);
    });

    // 4c. Peer Screen Share Status
    this.socket.on('user-screen-share-status', ({ socketId, name, role, isSharing }) => {
      const tile = document.getElementById(`tile-${socketId}`);
      const badge = document.getElementById(`screenBadge-${socketId}`);
      if (isSharing) {
        tile?.classList.add('is-screen-sharing');
        if (badge) badge.style.display = 'inline-flex';
        window.showToast?.(`🖥️ ${name} (${role}) started screen sharing. Click "📌 Pin" to spotlight.`, 'info');
        if (!this.pinnedTileId) {
          this.togglePinTile(socketId);
        }
      } else {
        tile?.classList.remove('is-screen-sharing');
        if (badge) badge.style.display = 'none';
        if (this.pinnedTileId === socketId) {
          this.togglePinTile(socketId);
        }
      }
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
    if (!this.socket) return;

    const emitKnock = () => {
      console.log('🚪 Emitting student admission knock for room:', room);
      const payload = {
        roomId: room,
        name: this.currentUser.name || 'Alex Johnson',
        studentId: this.currentUser.id || 'stu-001',
        email: this.currentUser.email || 'student@eduguard.edu'
      };
      this.socket.emit('student-request-join', payload);
      this.socket.emit('request-student-admission', payload);
    };

    if (this.socket.connected) {
      emitKnock();
    } else {
      this.socket.once('connect', emitKnock);
    }
  }

  handleStudentAdmissionKnock(reqData) {
    if (this.currentRole !== 'teacher') return;
    if (this.proctor) this.proctor.playAlarmSound('info');

    window.showToast?.(`🚪 Student Knock: ${reqData.name || 'Student'} is requesting to enter the classroom!`, 'info');

    let tray = document.getElementById('admissionRequestsTray') || document.getElementById('teacherAdmissionTray');
    if (!tray) {
      tray = document.createElement('div');
      tray.id = 'admissionRequestsTray';
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
        <div class="user-avatar" style="width:34px; height:34px; font-size:0.9rem; background:linear-gradient(135deg,#3b82f6,#8b5cf6);">${(reqData.name || 'S').charAt(0).toUpperCase()}</div>
        <div style="flex:1;">
          <strong style="font-size:0.88rem; color:#fff; display:block;">${reqData.name}</strong>
          <span style="font-size:0.72rem; color:#94a3b8;">${reqData.email || 'Candidate'} • ${new Date(reqData.timestamp || Date.now()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
        </div>
      </div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn-primary" style="padding:6px 12px; font-size:0.78rem; flex:1; justify-content:center; background:#10b981; border-color:#059669;" onclick="window.classroom.decideAdmission('${reqData.socketId}', true, '${cardId}')">
          ✅ Admit
        </button>
        <button class="btn-secondary" style="padding:6px 12px; font-size:0.78rem; flex:1; justify-content:center; border-color:rgba(239,68,68,0.4); color:#fca5a5;" onclick="window.classroom.decideAdmission('${reqData.socketId}', false, '${cardId}')">
          ❌ Deny
        </button>
      </div>
    `;
    tray.appendChild(card);
  }

  decideAdmission(targetSocketId, approved, cardId) {
    if (!this.socket) return;
    this.socket.emit('teacher-decision-join', {
      targetSocketId,
      roomId: this.currentRoomId,
      approved
    });
    document.getElementById(cardId)?.remove();
    window.showToast?.(approved ? 'Student admitted to classroom.' : 'Admission declined.', approved ? 'success' : 'warning');
  }

  async handleStudentAdmissionSuccess(data) {
    console.log('✅ Student admission approved by host:', data);
    const room = (data?.roomId || this.currentRoomId || 'CLASS-101').toUpperCase();
    this.currentRoomId = room;

    // Immediately dismiss the waiting lobby modal
    this.showWaitingLobbyScreen(false);

    window.showToast?.('🎉 Host admitted you to the proctored classroom!', 'success');

    // Join room signaling mesh
    this.joinRoom(room);

    // Start local camera and AI proctoring
    try {
      await this.startCamera('localVideoFeed');
    } catch (err) {
      console.warn('Camera start on admission error:', err);
    }
  }

  handleStudentAdmissionDenied(data) {
    this.showWaitingLobbyScreen(false);
    alert(`❌ Admission Declined:\n\n${data?.message || 'The teacher declined your admission request for this session.'}`);
    window.showToast?.('Admission request was declined by teacher.', 'danger');
    window.location.href = '/student.html';
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
      const room = roomId || this.currentRoomId || 'CLASS-101';
      const studentName = this.currentUser.name || 'Alex Johnson';
      const studentEmail = this.currentUser.email || 'student@eduguard.edu';

      lobby.innerHTML = `
        <div class="waiting-lobby-card" style="max-width: 480px; text-align: center; border: 1px solid rgba(99, 102, 241, 0.4); box-shadow: 0 20px 50px rgba(0,0,0,0.8), 0 0 35px rgba(99, 102, 241, 0.25);">
          <div style="position: relative; width: 64px; height: 64px; margin: 0 auto;">
            <div class="waiting-spinner-ring" style="width: 64px; height: 64px; border-width: 4px;"></div>
            <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">👨‍🎓</div>
          </div>
          
          <h2 style="font-family: var(--font-heading); font-size: 1.5rem; font-weight: 800; color: #fff; margin-top: 1.2rem; letter-spacing: -0.5px;">
            Waiting for Teacher Approval
          </h2>
          
          <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px; margin: 1.2rem 0; text-align: left; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem;">
              <span style="color: #94a3b8;">Candidate:</span>
              <strong style="color: #fff;">${studentName}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem;">
              <span style="color: #94a3b8;">Email:</span>
              <span style="color: #cbd5e1; font-family: var(--font-mono); font-size: 0.78rem;">${studentEmail}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem;">
              <span style="color: #94a3b8;">Target Classroom:</span>
              <span style="background: rgba(99, 102, 241, 0.2); color: #c7d2fe; font-weight: 700; font-family: var(--font-mono); padding: 2px 8px; border-radius: 6px;">${room}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem;">
              <span style="color: #94a3b8;">Status:</span>
              <span style="color: #fbbf24; font-weight: 700; display: flex; align-items: center; gap: 5px;">
                <span class="live-pulse-dot" style="background:#fbbf24; box-shadow:0 0 8px #fbbf24; width:7px; height:7px;"></span>
                Knocking... Pending Host Approval
              </span>
            </div>
          </div>

          <p style="font-size: 0.82rem; color: #94a3b8; line-height: 1.5; margin-bottom: 1.4rem;">
            The teacher host (<strong>Dr. Evelyn Reed</strong>) has been notified of your admission request. You will automatically be admitted once approved.
          </p>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button class="btn-primary" style="width: 100%; justify-content: center; padding: 10px; font-size: 0.88rem;" onclick="window.classroom.showWaitingLobbyScreen(false); window.classroom.joinRoom('${room}'); window.classroom.startCamera('localVideoFeed'); window.showToast('✅ Admitted to classroom!', 'success');">
              ⚡ Instant Admit (Demo Simulation)
            </button>
            <div style="display: flex; gap: 8px;">
              <button class="btn-secondary" style="flex: 1; justify-content: center; font-size: 0.78rem;" onclick="window.location.href='/teacher.html'">
                👩‍🏫 Open Teacher Suite
              </button>
              <button class="btn-secondary" style="flex: 1; justify-content: center; font-size: 0.78rem;" onclick="window.location.href='/index.html'">
                🚪 Exit to Login
              </button>
            </div>
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

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      this.remoteStreams[socketId] = remoteStream;
      this.renderRemoteVideoTile(socketId, peerName, peerRole, remoteStream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit('webrtc-ice-candidate', {
          targetSocketId: socketId,
          candidate: event.candidate
        });
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.socket) {
        this.socket.emit('webrtc-offer', {
          targetSocketId: socketId,
          callerName: this.currentUser.name,
          callerRole: this.currentRole,
          offer
        });
      }
    }

    return pc;
  }

  cleanupSession() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try { track.stop(); } catch(e){}
      });
      this.localStream = null;
    }
    const localVideo = document.getElementById('localVideoFeed');
    if (localVideo) localVideo.srcObject = null;

    Object.values(this.peerConnections).forEach(pc => {
      try { pc.close(); } catch(e){}
    });
    this.peerConnections = {};
    this.remoteStreams = {};

    if (this.proctor) {
      this.proctor.stopMonitoring();
      this.proctor = null;
    }

    this.showWaitingLobbyScreen(false);
  }

  setRole(newRole, userName = '', userEmail = '') {
    this.cleanupSession();
    this.isAuthenticated = true;
    this.currentRole = newRole;
    this.currentUser = {
      name: userName || (newRole === 'teacher' ? 'Dr. Evelyn Reed' : 'Alex Johnson'),
      email: userEmail || (newRole === 'teacher' ? 'teacher@eduguard.edu' : 'student@eduguard.edu'),
      id: newRole === 'teacher' ? 't-001' : 'stu-001',
      role: newRole
    };

    const isTeacher = newRole === 'teacher' || newRole === 'manager';
    const isManager = newRole === 'manager';

    if (isManager) {
      if (this.proctor) this.proctor.stopMonitoring();
    } else if (isTeacher) {
      this.joinRoom(this.currentRoomId);
      this.startCamera('localVideoFeed');
      if (this.proctor) this.proctor.stopMonitoring();
    } else {
      // Students knock and wait in lobby
      this.showWaitingLobbyScreen(true, this.currentRoomId);
      this.requestStudentJoin(this.currentRoomId);
    }
  }

  joinRoom(roomId) {
    if (roomId) this.currentRoomId = roomId.toUpperCase();
    if (!this.socket) return;
    this.socket.emit('join-room', {
      roomId: this.currentRoomId,
      role: this.currentRole,
      name: this.currentUser.name,
      studentId: this.currentUser.id
    });

    const label1 = document.getElementById('currentRoomCodeLabel');
    const label2 = document.getElementById('stageRoomId');
    if (label1) label1.textContent = this.currentRoomId;
    if (label2) label2.textContent = this.currentRoomId;
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
          console.warn('Audio+Video failed, retrying video only:', e1);
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (stream) {
          this.localStream = stream;
          videoEl.srcObject = stream;
          await videoEl.play().catch(e => console.warn('Auto-play caught:', e));

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

          // Mirror to proctoring center inspector video if present
          const inspectVideo = document.getElementById('proctorInspectVideo') || document.getElementById('inspectVideoFeed');
          if (inspectVideo) {
            inspectVideo.srcObject = stream;
            inspectVideo.play().catch(() => {});
          }

          // Start proctoring engine for student
          if (this.currentRole === 'student') {
            this.startStudentProctoring();
          }
          return;
        }
      }
    } catch (err) {
      console.warn('Webcam permission not granted or device not available:', err);
      window.showToast?.('Camera permission needed for live video & proctoring verification.', 'warning');
    }
  }

  startStudentProctoring() {
    const videoEl = document.getElementById('localVideoFeed');
    const canvasEl = document.getElementById('localAiCanvas') || document.getElementById('aiOverlayCanvas');

    if (!window.EduProctorEngine) return;

    if (!this.proctor) {
      this.proctor = new EduProctorEngine({
        videoElement: videoEl,
        canvasElement: canvasEl,
        onViolation: (violationData) => {
          if (this.socket) {
            this.socket.emit('malpractice-event', {
              ...violationData,
              studentName: this.currentUser.name,
              studentId: this.currentUser.id,
              roomId: this.currentRoomId
            });
          }
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
    const hudGaze = document.getElementById('hudHeadPose');
    const hudFocus = document.getElementById('hudFocusMeter');
    const hudSwitches = document.getElementById('hudTabSwitches');
    if (hudGaze) hudGaze.textContent = t.gaze;
    if (hudFocus) hudFocus.textContent = `${t.focusScore}%`;
    if (hudSwitches) hudSwitches.textContent = `${t.tabSwitches}`;

    const fill = document.getElementById('studentFocusFill');
    const txt = document.getElementById('studentFocusText');
    if (fill) fill.style.width = `${t.focusScore}%`;
    if (txt) txt.textContent = `${t.focusScore}%`;
  }

  renderParticipantGrid() {
    const countBadge = document.getElementById('studentCountBadge') || document.getElementById('liveStudentsCountBadge');
    if (countBadge) countBadge.textContent = this.participants.length;

    const rosterList = document.getElementById('studentsRosterList');
    if (rosterList) {
      if (this.participants.length === 0) {
        rosterList.innerHTML = `<div style="text-align:center; color:#64748b; padding:1rem; font-size:0.8rem;">No active participants.</div>`;
      } else {
        rosterList.innerHTML = this.participants.map(s => `
          <div style="background:rgba(15,23,42,0.9); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:8px 10px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div class="user-avatar" style="width:28px; height:28px; font-size:0.75rem;">${(s.name || 'U').charAt(0).toUpperCase()}</div>
              <div>
                <strong style="font-size:0.82rem; color:#fff;">${s.name}</strong><br>
                <span style="font-size:0.68rem; color:${s.role === 'teacher' ? '#818cf8' : '#34d399'};">● ${s.role.toUpperCase()}</span>
              </div>
            </div>
            ${this.currentRole === 'teacher' && s.role !== 'teacher' ? `
              <button class="ctrl-btn btn-danger" style="padding:2px 8px; font-size:0.68rem;" onclick="window.classroom.sendDirectWarning('${s.name}', '${s.socketId}')">
                ⚠️ Warn
              </button>
            ` : ''}
          </div>
        `).join('');
      }
    }
  }

  renderRemoteVideoTile(socketId, peerName, peerRole, remoteStream) {
    const grid = document.getElementById('videoGridContainer') || document.getElementById('classroomVideoGrid');
    if (!grid) return;

    let tile = document.getElementById(`tile-${socketId}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'video-tile remote-tile';
      tile.id = `tile-${socketId}`;
      tile.innerHTML = `
        <video id="video-${socketId}" autoplay playsinline style="width:100%; height:100%; object-fit:cover; display:block;"></video>
        <div class="video-overlay-top">
          <div class="participant-tag">
            <span id="nameLabel-${socketId}">${peerName}</span>
            <span style="font-size:0.68rem; color:${peerRole === 'teacher' ? '#818cf8' : '#38bdf8'}">(${peerRole})</span>
            <span id="screenBadge-${socketId}" style="display:none;" class="screen-share-badge">🖥️ Sharing</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <button class="pin-tile-btn" id="pinBtn-${socketId}" onclick="window.classroom.togglePinTile('${socketId}')" title="Pin / Spotlight this screen">
              📌 Pin
            </button>
            <div class="status-pill status-focused" id="pill-${socketId}">
              ● Live Stream
            </div>
          </div>
        </div>
        <div class="video-overlay-bottom">
          <div class="focus-meter-mini">
            <span>Connected</span>
          </div>
        </div>
      `;
      grid.appendChild(tile);
    }

    const videoEl = document.getElementById(`video-${socketId}`);
    if (videoEl && remoteStream) {
      videoEl.srcObject = remoteStream;
      videoEl.play().catch(e => console.warn('Remote video play caught:', e));
    }
  }

  togglePinTile(targetId) {
    const grid = document.getElementById('videoGridContainer') || document.getElementById('classroomVideoGrid');
    if (!grid) return;

    const tileId = targetId === 'local' ? 'localVideoTile' : `tile-${targetId}`;
    const targetTile = document.getElementById(tileId);
    const pinBtn = document.getElementById(`pinBtn-${targetId}`);

    if (this.pinnedTileId === targetId) {
      // Already pinned -> Unpin back to grid
      this.pinnedTileId = null;
      grid.classList.remove('pinned-active');
      document.querySelectorAll('.video-tile').forEach(t => t.classList.remove('is-pinned', 'is-thumbnail'));
      document.querySelectorAll('.pin-tile-btn').forEach(btn => btn.innerHTML = '📌 Pin');
      window.showToast?.('Restored standard multi-video grid view.', 'info');
    } else {
      // Pin this specific video / screen share
      this.pinnedTileId = targetId;
      grid.classList.add('pinned-active');
      document.querySelectorAll('.video-tile').forEach(t => {
        if (t.id === tileId) {
          t.classList.add('is-pinned');
          t.classList.remove('is-thumbnail');
        } else {
          t.classList.remove('is-pinned');
          t.classList.add('is-thumbnail');
        }
      });
      document.querySelectorAll('.pin-tile-btn').forEach(btn => btn.innerHTML = '📌 Pin');
      if (pinBtn) pinBtn.innerHTML = '✖️ Unpin';
      window.showToast?.('📌 Pinned screen share to full stage view.', 'success');
    }
  }

  handleSessionEndedByTeacher(data) {
    console.log('Classroom session concluded by teacher host:', data);
    if (this.currentRole === 'student') {
      try {
        this.cleanupSession();
      } catch (e) {
        console.warn('Cleanup session error:', e);
      }
      alert(`🔴 CLASSROOM CONCLUDED\n\n${data?.message || 'The host teacher has left the meeting. You have been automatically logged out of the session.'}`);
      window.location.href = '/student.html';
    }
  }

  sendDirectWarning(studentName, targetSocketId) {
    const reason = prompt(`Enter direct alert message to send to ${studentName}:`, 'Please return your focus to the lecture.');
    if (reason && this.socket) {
      this.socket.emit('teacher-direct-warning', {
        targetSocketId,
        targetStudentName: studentName,
        warningMessage: reason
      });
      window.showToast?.(`Warning sent to ${studentName}`, 'success');
    }
  }

  muteAllStudents() {
    if (this.currentRole !== 'teacher' || !this.socket) return;
    this.socket.emit('teacher-control-media', {
      roomId: this.currentRoomId,
      mediaType: 'audio',
      state: false
    });
    window.showToast?.('🔇 Muted all students in classroom.', 'warning');
  }

  forceAllStudentCamsOn() {
    if (this.currentRole !== 'teacher' || !this.socket) return;
    this.socket.emit('teacher-control-media', {
      roomId: this.currentRoomId,
      mediaType: 'video',
      state: true
    });
    window.showToast?.('📹 Requested all student cameras ON.', 'info');
  }

  showTeacherTopAlert(incident) {
    const ticker = document.getElementById('globalAlertTicker');
    const txt = document.getElementById('globalAlertText');
    if (ticker && txt) {
      txt.innerHTML = `🚨 <strong>MALPRACTICE ALERT:</strong> ${incident.studentName} - ${incident.violationType} (${incident.details})`;
      ticker.classList.remove('hidden');
    }
  }

  renderIncidentStream() {
    const container = document.getElementById('sidebarIncidentsList') || document.getElementById('malpracticeStreamContainer');
    const badge = document.getElementById('alertCountBadge');
    if (badge) badge.textContent = this.activeIncidents.length;
    if (!container) return;

    if (this.activeIncidents.length === 0) {
      container.innerHTML = `<div style="text-align:center; color:#64748b; padding:1.5rem 0; font-size:0.8rem;">No malpractice incidents logged in this session.</div>`;
      return;
    }

    container.innerHTML = this.activeIncidents.map(inc => `
      <div class="incident-card">
        <div class="incident-header">
          <span class="incident-student-name">${inc.studentName}</span>
          <span class="incident-time">${new Date(inc.timestamp || Date.now()).toLocaleTimeString()}</span>
        </div>
        <div style="font-size:0.82rem; font-weight:700; color:#fb7185;">⚠️ ${inc.violationType}</div>
        <div style="font-size:0.75rem; color:#94a3b8;">${inc.details}</div>
      </div>
    `).join('');
  }

  updateStudentStatusInGrid(studentName, violation) {
    const tiles = document.querySelectorAll('.video-tile');
    tiles.forEach(tile => {
      if (tile.textContent.includes(studentName)) {
        tile.classList.add('malpractice-active');
        setTimeout(() => tile.classList.remove('malpractice-active'), 5000);
      }
    });
  }

  initClassroomDOM() {
    // 1. Audio Toggle Button
    const audioBtn = document.getElementById('ctrlToggleAudioBtn') || document.getElementById('micToggleBtn');
    audioBtn?.addEventListener('click', async () => {
      this.isMuted = !this.isMuted;
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
      }
      audioBtn.classList.toggle('btn-active', !this.isMuted);
      const label = document.getElementById('audioBtnLabel');
      if (label) label.textContent = this.isMuted ? 'Mic Muted' : 'Mic Active';
      window.showToast?.(this.isMuted ? 'Microphone muted.' : 'Microphone active.', 'info');
    });

    // 2. Video Toggle Button
    const videoBtn = document.getElementById('ctrlToggleVideoBtn') || document.getElementById('camToggleBtn');
    videoBtn?.addEventListener('click', async () => {
      this.isVideoOff = !this.isVideoOff;
      if (this.localStream) {
        this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isVideoOff);
      }
      videoBtn.classList.toggle('btn-active', !this.isVideoOff);
      const label = document.getElementById('videoBtnLabel');
      if (label) label.textContent = this.isVideoOff ? 'Cam Off' : 'Cam On';
      window.showToast?.(this.isVideoOff ? 'Camera turned off.' : 'Camera turned on.', 'info');
    });

    // 3. Screen Share
    const screenBtn = document.getElementById('ctrlShareScreenBtn') || document.getElementById('screenShareBtn');
    screenBtn?.addEventListener('click', async () => {
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
          document.getElementById('localVideoTile')?.classList.add('is-screen-sharing');

          screenTrack.onended = () => this.stopScreenSharing();
          this.isScreenSharing = true;
          screenBtn.classList.add('btn-active');
          if (this.socket) {
            this.socket.emit('toggle-screen-share', { isSharing: true });
          }
          // Automatically spotlight/pin screen share
          this.togglePinTile('local');
          window.showToast?.('🖥️ Screen sharing active & spotlighted', 'info');
        } else {
          this.stopScreenSharing();
        }
      } catch (err) {
        console.warn('Screen share canceled or failed', err);
      }
    });

    // 4. Hand Raise (Student)
    const handBtn = document.getElementById('ctrlRaiseHandBtn') || document.getElementById('handRaiseBtn');
    handBtn?.addEventListener('click', () => {
      this.handRaised = !this.handRaised;
      if (this.socket) {
        this.socket.emit('toggle-hand', { raised: this.handRaised, name: this.currentUser.name });
      }
      handBtn.classList.toggle('btn-active', this.handRaised);
      const label = document.getElementById('raiseHandLabel');
      if (label) label.textContent = this.handRaised ? 'Hand Raised' : 'Raise Hand';
    });

    // 5. Teacher Command Buttons
    document.getElementById('ctrlMuteAllBtn')?.addEventListener('click', () => this.muteAllStudents());
    document.getElementById('ctrlRequestCamsBtn')?.addEventListener('click', () => this.forceAllStudentCamsOn());
    document.getElementById('ctrlEndClassBtn')?.addEventListener('click', () => {
      if (confirm('End this classroom session for all students and generate final report?')) {
        if (this.socket) {
          this.socket.emit('teacher-end-session', { roomId: this.currentRoomId });
        }
        window.showToast?.('Classroom session ended.', 'success');
        document.querySelector('[data-view="reports"]')?.click();
      }
    });

    // 6. Mode Tabs (Video vs Whiteboard)
    const modeVideoBtn = document.getElementById('modeVideoBtn');
    const modeWbBtn = document.getElementById('modeWhiteboardBtn');
    const videoGrid = document.getElementById('videoGridContainer') || document.getElementById('classroomVideoGrid');
    const wbContainer = document.getElementById('whiteboardContainer') || document.getElementById('classroomWhiteboardStage');

    modeVideoBtn?.addEventListener('click', () => {
      modeVideoBtn.classList.add('active');
      modeWbBtn?.classList.remove('active');
      if (videoGrid) videoGrid.style.display = 'grid';
      if (wbContainer) wbContainer.style.display = 'none';
    });

    modeWbBtn?.addEventListener('click', () => {
      modeWbBtn.classList.add('active');
      modeVideoBtn?.classList.remove('active');
      if (videoGrid) videoGrid.style.display = 'none';
      if (wbContainer) wbContainer.style.display = 'flex';
      this.resizeWhiteboard();
    });

    // 7. Sidebar Tabs (Chat vs Students vs Alerts)
    document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.sidebar-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const chatPanel = document.getElementById('sidebarPanelChat');
        const studentsPanel = document.getElementById('sidebarPanelStudents');
        const alertsPanel = document.getElementById('sidebarPanelAlerts');

        if (chatPanel) chatPanel.style.display = tab === 'chat' ? 'flex' : 'none';
        if (studentsPanel) studentsPanel.style.display = tab === 'students' ? 'block' : 'none';
        if (alertsPanel) alertsPanel.style.display = tab === 'alerts' ? 'block' : 'none';
      });
    });

    // 8. Chat Form
    const chatForm = document.getElementById('chatInputForm') || document.getElementById('chatForm');
    chatForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('chatMessageInput') || document.getElementById('chatInput');
      const text = input?.value.trim();
      if (text && this.socket) {
        const msg = {
          roomId: this.currentRoomId,
          senderName: this.currentUser.name || 'User',
          senderRole: this.currentRole || 'student',
          message: text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        this.socket.emit('send-chat', msg);
        this.appendChatMessage(msg);
        if (input) input.value = '';
      }
    });
  }

  stopScreenSharing() {
    this.isScreenSharing = false;
    const btn = document.getElementById('ctrlShareScreenBtn') || document.getElementById('screenShareBtn');
    if (btn) {
      btn.classList.remove('btn-active');
      btn.innerHTML = '<span>🖥️</span> Share Screen';
    }
    document.getElementById('localVideoTile')?.classList.remove('is-screen-sharing');
    if (this.socket) {
      this.socket.emit('toggle-screen-share', { isSharing: false });
    }
    if (this.pinnedTileId === 'local') {
      this.togglePinTile('local');
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
      <div class="chat-sender">${isSelf ? 'You' : msg.senderName} (${msg.senderRole || ''}) • ${msg.timestamp || ''}</div>
      <div class="chat-text">${msg.message}</div>
    `;
    box.appendChild(bubble);
    box.scrollTop = box.scrollHeight;
  }

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

      const isEraser = this.currentTool === 'eraser';
      const drawColor = this.brushColor || '#6366f1';
      const drawSize = this.brushSize || 4;

      this.drawLocalLine(this.lastX, this.lastY, pos.x, pos.y, drawColor, drawSize, isEraser);

      if (this.socket) {
        this.socket.emit('whiteboard-draw', {
          roomId: this.currentRoomId,
          x0: this.lastX,
          y0: this.lastY,
          x1: pos.x,
          y1: pos.y,
          color: drawColor,
          size: drawSize,
          isEraser
        });
      }

      this.lastX = pos.x;
      this.lastY = pos.y;
    });

    window.addEventListener('mouseup', () => this.isDrawing = false);

    // Color Swatches Palette
    document.querySelectorAll('.wb-color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.wb-color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        this.brushColor = dot.dataset.color || '#6366f1';
        this.currentTool = 'pen';
        document.getElementById('wbPenBtn')?.classList.add('active');
        document.getElementById('wbEraserBtn')?.classList.remove('active');
      });
    });

    // Custom Color Picker
    document.getElementById('wbColorPicker')?.addEventListener('input', (e) => {
      this.brushColor = e.target.value;
      this.currentTool = 'pen';
      document.querySelectorAll('.wb-color-dot').forEach(d => d.classList.remove('active'));
      document.getElementById('wbPenBtn')?.classList.add('active');
      document.getElementById('wbEraserBtn')?.classList.remove('active');
    });

    // Pen Tool Button
    document.getElementById('wbPenBtn')?.addEventListener('click', () => {
      this.currentTool = 'pen';
      document.getElementById('wbPenBtn')?.classList.add('active');
      document.getElementById('wbEraserBtn')?.classList.remove('active');
    });

    // Stroke / Precision Eraser Button
    document.getElementById('wbEraserBtn')?.addEventListener('click', () => {
      this.currentTool = 'eraser';
      document.getElementById('wbEraserBtn')?.classList.add('active');
      document.getElementById('wbPenBtn')?.classList.remove('active');
    });

    // Stroke Thickness Selector
    document.getElementById('wbStrokeSizeSelect')?.addEventListener('change', (e) => {
      this.brushSize = parseInt(e.target.value, 10) || 4;
    });

    // Clear All Canvas
    document.getElementById('wbClearBtn')?.addEventListener('click', () => {
      this.clearWhiteboardCanvas(true);
    });
  }

  resizeWhiteboard() {
    const canvas = document.getElementById('whiteboardCanvas');
    if (canvas && canvas.parentElement) {
      canvas.width = canvas.parentElement.clientWidth || 800;
      canvas.height = canvas.parentElement.clientHeight || 500;
    }
  }

  drawLocalLine(x0, y0, x1, y1, color, size, isEraser = false) {
    const canvas = document.getElementById('whiteboardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineWidth = isEraser ? (size * 3 || 18) : (size || 4);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color || '#6366f1';
    }

    ctx.stroke();
    ctx.restore();
  }

  drawRemoteLine(data) {
    this.drawLocalLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size, data.isEraser);
  }

  clearWhiteboardCanvas(emit = true) {
    const canvas = document.getElementById('whiteboardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (emit && this.socket) {
      this.socket.emit('whiteboard-clear', { roomId: this.currentRoomId });
    }
  }
}

// Instantiate globally
window.ClassroomManager = ClassroomManager;
window.classroom = new ClassroomManager();
