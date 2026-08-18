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

      // Process any queued ICE candidates
      if (pc._queuedCandidates && pc._queuedCandidates.length > 0) {
        for (const c of pc._queuedCandidates) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){}
        }
        pc._queuedCandidates = [];
      }

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

        // Process any queued ICE candidates
        if (pc._queuedCandidates && pc._queuedCandidates.length > 0) {
          for (const c of pc._queuedCandidates) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){}
          }
          pc._queuedCandidates = [];
        }
      }
    });

    // 9. Receive ICE Candidate
    this.socket.on('webrtc-ice-candidate', async ({ senderSocketId, candidate }) => {
      const pc = this.peerConnections[senderSocketId];
      if (pc && candidate) {
        try {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            if (!pc._queuedCandidates) pc._queuedCandidates = [];
            pc._queuedCandidates.push(candidate);
          }
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

    // 1. Ensure local camera and microphone stream is fully active BEFORE joining room signaling
    try {
      await this.startCamera('localVideoFeed');
    } catch (err) {
      console.warn('Camera start on admission error:', err);
    }

    // 2. Join room signaling mesh with localStream ready to attach to peer connections
    this.joinRoom(room);
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
            <button class="btn-primary" style="width: 100%; justify-content: center; padding: 10px; font-size: 0.88rem;" onclick="window.classroom.showWaitingLobbyScreen(false); window.classroom.startCamera('localVideoFeed').then(() => { window.classroom.joinRoom('${room}'); window.showToast('✅ Admitted to classroom!', 'success'); });">
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
        try {
          pc.addTrack(track, this.localStream);
        } catch (e) {
          console.warn('Error adding track to peer connection:', e);
        }
      });
    }

    pc.ontrack = (event) => {
      console.log(`📡 Remote media track received (${event.track.kind}) from ${peerName} (${socketId})`);
      let remoteStream = event.streams && event.streams[0];
      if (!remoteStream) {
        if (!this.remoteStreams[socketId]) {
          this.remoteStreams[socketId] = new MediaStream();
        }
        this.remoteStreams[socketId].addTrack(event.track);
        remoteStream = this.remoteStreams[socketId];
      } else {
        this.remoteStreams[socketId] = remoteStream;
      }
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

  setRole(newRole, userName = '', userEmail = '', userId = '') {
    this.cleanupSession();
    this.isAuthenticated = true;
    this.currentRole = newRole;

    let sessionUser = null;
    try {
      const raw = localStorage.getItem('eduguard_user');
      if (raw) sessionUser = JSON.parse(raw);
    } catch(e){}

    const finalName = userName || (sessionUser && sessionUser.name) || (newRole === 'teacher' ? 'Dr. Evelyn Reed' : 'Alex Johnson');
    const finalEmail = userEmail || (sessionUser && sessionUser.email) || (newRole === 'teacher' ? 'teacher@eduguard.edu' : 'student@eduguard.edu');
    const finalId = userId || (sessionUser && sessionUser.id) || (newRole === 'teacher' ? 't-001' : 'stu-001');

    this.currentUser = {
      name: finalName,
      email: finalEmail,
      id: finalId,
      role: newRole,
      institution: (sessionUser && sessionUser.institution) || 'Cambridge Academy of Sciences'
    };

    const tileName = document.getElementById('localTileName');
    if (tileName) {
      tileName.textContent = `${this.currentUser.name} (You)`;
    }

    const isTeacher = newRole === 'teacher' || newRole === 'manager';
    const isManager = newRole === 'manager';

    if (isManager) {
      if (this.proctor) this.proctor.stopMonitoring();
    } else if (isTeacher) {
      this.joinRoom(this.currentRoomId);
      this.startCamera('localVideoFeed');
      if (this.proctor) this.proctor.stopMonitoring();
    } else {
      // Students knock, preview camera locally and wait in lobby
      this.showWaitingLobbyScreen(true, this.currentRoomId);
      this.startCamera('localVideoFeed');
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
      studentId: this.currentUser.id,
      email: this.currentUser.email
    });

    const label1 = document.getElementById('currentRoomCodeLabel');
    const label2 = document.getElementById('stageRoomId');
    if (label1) label1.textContent = this.currentRoomId;
    if (label2) label2.textContent = this.currentRoomId;
  }

  async startCamera(videoElementId = 'localVideoFeed') {
    const videoEl = document.getElementById(videoElementId);
    if (!videoEl) return;

    // Reset local stream safely
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    // 4-Step Resilient WebRTC Device Constraint Fallback Chain
    const constraintPresets = [
      { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
      { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: true },
      { video: true, audio: false },
      { video: false, audio: true }
    ];

    let stream = null;
    for (const constraints of constraintPresets) {
      try {
        console.log('Attempting getUserMedia with constraints:', constraints);
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream) {
          console.log(`✅ getUserMedia succeeded with video=${stream.getVideoTracks().length > 0}, audio=${stream.getAudioTracks().length > 0}`);
          break;
        }
      } catch (err) {
        console.warn('getUserMedia preset failed:', constraints, err.name, err.message);
      }
    }

    if (!stream) {
      window.showToast?.('Camera / Microphone permission denied or device not found.', 'warning');
      return;
    }

    this.localStream = stream;
    videoEl.srcObject = stream;
    try {
      await videoEl.play();
    } catch(e) {
      console.warn('Local video play warning:', e);
    }

    // Replace tracks or add to all active peer connections
    for (const [peerId, pc] of Object.entries(this.peerConnections)) {
      try {
        const senders = pc.getSenders();
        let needsRenegotiation = false;

        this.localStream.getTracks().forEach(track => {
          const sender = senders.find(s => s.track && s.track.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track).catch(err => console.warn('replaceTrack warning:', err));
          } else {
            pc.addTrack(track, this.localStream);
            needsRenegotiation = true;
          }
        });

        // Automatically renegotiate offer if new track types were added
        if (needsRenegotiation && this.socket && (this.currentRole === 'teacher' || this.currentRole === 'student')) {
          console.log(`Renegotiating WebRTC offer for peer ${peerId} after local camera started...`);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.socket.emit('webrtc-offer', { targetSocketId: peerId, offer });
        }
      } catch(err) {
        console.warn('Error syncing tracks with peer:', peerId, err);
      }
    }

    if (this.currentRole === 'student') {
      this.startStudentProctoring();
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
              studentEmail: this.currentUser.email,
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

    // Capture initial candidate verification photo after camera stabilizes
    setTimeout(() => {
      if (this.proctor && this.socket) {
        const photo = this.proctor.captureCurrentSnapshot();
        if (photo) {
          this.socket.emit('student-verification-photo', { photo });
        }
      }
    }, 2500);
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
    } else {
      const nameEl = document.getElementById(`nameLabel-${socketId}`);
      if (nameEl && peerName) nameEl.textContent = peerName;
    }

    const videoEl = document.getElementById(`video-${socketId}`);
    if (videoEl && remoteStream) {
      if (videoEl.srcObject !== remoteStream) {
        videoEl.srcObject = remoteStream;
      }
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          console.warn('Remote video playback pending user gesture:', e);
          const resumeAudioOnInteract = () => {
            videoEl.play().catch(() => {});
            window.removeEventListener('click', resumeAudioOnInteract);
            window.removeEventListener('keydown', resumeAudioOnInteract);
          };
          window.addEventListener('click', resumeAudioOnInteract, { once: true });
          window.addEventListener('keydown', resumeAudioOnInteract, { once: true });
        });
      }
    }
  }

  togglePinTile(targetId) {
    const grid = document.getElementById('videoGridContainer') || document.getElementById('classroomVideoGrid');
    if (!grid) return;

    const tileId = targetId === 'local' ? 'localVideoTile' : `tile-${targetId}`;
    const targetTile = document.getElementById(tileId);
    const pinBtn = document.getElementById(`pinBtn-${targetId}`);
    const floatingUnpin = document.getElementById('floatingUnpinBtn');

    if (this.pinnedTileId === targetId) {
      // Already pinned -> Unpin back to grid
      this.unpinCurrentStage();
    } else {
      // Pin this specific video / screen share
      this.pinnedTileId = targetId;
      grid.classList.add('pinned-active');

      const allTiles = Array.from(document.querySelectorAll('.video-tile'));
      let assignedPip = false;

      allTiles.forEach(t => {
        if (t.id === tileId) {
          t.classList.add('is-pinned');
          t.classList.remove('is-pip-camera', 'is-thumbnail');
        } else {
          t.classList.remove('is-pinned');
          // Designate the other active camera tile as floating PiP in bottom-right corner
          if (!assignedPip) {
            t.classList.add('is-pip-camera');
            t.classList.remove('is-thumbnail');
            assignedPip = true;
          } else {
            t.classList.remove('is-pip-camera');
            t.classList.add('is-thumbnail');
          }
        }
      });

      document.querySelectorAll('.pin-tile-btn').forEach(btn => btn.innerHTML = '📌 Pin');
      if (pinBtn) pinBtn.innerHTML = '✖️ Unpin';
      if (floatingUnpin) floatingUnpin.style.display = 'inline-flex';
      window.showToast?.('📌 Spotlight active: Full screen stage with bottom-right camera view.', 'success');
    }
  }

  unpinCurrentStage() {
    const grid = document.getElementById('videoGridContainer') || document.getElementById('classroomVideoGrid');
    const floatingUnpin = document.getElementById('floatingUnpinBtn');
    this.pinnedTileId = null;

    if (grid) {
      grid.classList.remove('pinned-active');
    }
    document.querySelectorAll('.video-tile').forEach(t => {
      t.classList.remove('is-pinned', 'is-pip-camera', 'is-thumbnail');
    });
    document.querySelectorAll('.pin-tile-btn').forEach(btn => btn.innerHTML = '📌 Pin');
    if (floatingUnpin) floatingUnpin.style.display = 'none';

    // If whiteboard was pinned, reset whiteboard pin button
    const wbPinBtn = document.getElementById('wbPinBtn');
    if (wbPinBtn) {
      wbPinBtn.innerHTML = '📌 Spotlight';
      wbPinBtn.classList.remove('active');
    }

    window.showToast?.('Restored standard multi-video grid view.', 'info');
  }

  togglePinWhiteboard() {
    const wbContainer = document.getElementById('whiteboardContainer') || document.getElementById('classroomWhiteboardStage');
    const videoGrid = document.getElementById('videoGridContainer') || document.getElementById('classroomVideoGrid');
    const floatingUnpin = document.getElementById('floatingUnpinBtn');
    const wbPinBtn = document.getElementById('wbPinBtn');

    if (this.pinnedTileId === 'whiteboard') {
      this.unpinCurrentStage();
    } else {
      this.pinnedTileId = 'whiteboard';
      // Switch to whiteboard view
      document.getElementById('modeWhiteboardBtn')?.click();
      if (floatingUnpin) floatingUnpin.style.display = 'inline-flex';
      if (wbPinBtn) {
        wbPinBtn.innerHTML = '✖️ Unpin';
        wbPinBtn.classList.add('active');
      }
      window.showToast?.('🎨 Whiteboard spotlighted to full stage.', 'success');
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

  setupEventListeners() {
    // 1. Audio Toggle
    const audioBtn = document.getElementById('ctrlToggleAudioBtn') || document.getElementById('micToggleBtn');
    audioBtn?.addEventListener('click', () => {
      this.isAudioMuted = !this.isAudioMuted;
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isAudioMuted);
      }
      audioBtn.classList.toggle('btn-danger', this.isAudioMuted);
      audioBtn.classList.toggle('btn-active', !this.isAudioMuted);
      const label = document.getElementById('audioBtnLabel');
      if (label) label.textContent = this.isAudioMuted ? 'Mic Muted' : 'Mic Active';
      if (this.socket) {
        this.socket.emit('toggle-audio', { muted: this.isAudioMuted });
      }
      window.showToast?.(this.isAudioMuted ? 'Microphone muted' : 'Microphone unmuted', 'info');
    });

    // 2. Video Toggle
    const videoBtn = document.getElementById('ctrlToggleVideoBtn') || document.getElementById('camToggleBtn');
    videoBtn?.addEventListener('click', () => {
      this.isVideoOff = !this.isVideoOff;
      if (this.localStream) {
        this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isVideoOff);
      }
      videoBtn.classList.toggle('btn-danger', this.isVideoOff);
      videoBtn.classList.toggle('btn-active', !this.isVideoOff);
      const label = document.getElementById('videoBtnLabel');
      if (label) label.textContent = this.isVideoOff ? 'Cam Off' : 'Cam On';
      if (this.socket) {
        this.socket.emit('toggle-video', { videoOff: this.isVideoOff });
      }
      window.showToast?.(this.isVideoOff ? 'Camera turned off' : 'Camera turned on', 'info');
    });

    // 3. Screen Share
    const screenBtn = document.getElementById('ctrlShareScreenBtn') || document.getElementById('screenShareBtn');
    screenBtn?.addEventListener('click', async () => {
      try {
        if (!this.isScreenSharing) {
          const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
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

          // Update button label & active highlighting immediately
          screenBtn.classList.add('btn-active', 'btn-danger');
          screenBtn.innerHTML = '<span>🛑</span> <span>Stop Sharing</span>';
          screenBtn.setAttribute('title', 'Click to stop sharing your screen');

          if (this.socket) {
            this.socket.emit('toggle-screen-share', { isSharing: true });
          }
          // Automatically spotlight/pin screen share
          this.togglePinTile('local');
          window.showToast?.('🖥️ Screen sharing started & spotlighted on stage.', 'success');
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
      if (this.pinnedTileId === 'whiteboard') {
        this.unpinCurrentStage();
      }
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
      btn.classList.remove('btn-active', 'btn-danger');
      btn.innerHTML = '<span>🖥️</span> <span>Share Screen</span>';
      btn.setAttribute('title', 'Share Screen');
    }
    document.getElementById('localVideoTile')?.classList.remove('is-screen-sharing');
    if (this.socket) {
      this.socket.emit('toggle-screen-share', { isSharing: false });
    }
    if (this.pinnedTileId === 'local') {
      this.unpinCurrentStage();
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
    window.showToast?.('Screen sharing stopped.', 'info');
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

    this.resizeWhiteboard();

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
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

      // Auto-extend canvas downwards if drawing near bottom
      if (pos.y > canvas.height - 250) {
        this.extendWhiteboardHeight(800, false);
      }
    });

    window.addEventListener('mouseup', () => this.isDrawing = false);

    // Touch support for tablets/phones
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDrawing = true;
        const pos = getPos(e.touches[0]);
        this.lastX = pos.x;
        this.lastY = pos.y;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (!this.isDrawing || e.touches.length !== 1) return;
      e.preventDefault();
      const pos = getPos(e.touches[0]);
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
    }, { passive: false });

    canvas.addEventListener('touchend', () => this.isDrawing = false);

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
      if (confirm('Clear the entire whiteboard canvas? This cannot be undone.')) {
        this.clearWhiteboardCanvas(true);
      }
    });
  }

  scrollWhiteboardTop() {
    const area = document.getElementById('whiteboardScrollArea');
    if (area) area.scrollTo({ top: 0, behavior: 'smooth' });
  }

  scrollWhiteboardBottom() {
    const area = document.getElementById('whiteboardScrollArea');
    if (area) area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' });
  }

  extendWhiteboardHeight(extraPx = 1000, notify = true) {
    const canvas = document.getElementById('whiteboardCanvas');
    if (!canvas) return;

    // Snapshot existing drawings
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, 0, 0);

    // Expand canvas height
    const newHeight = canvas.height + extraPx;
    canvas.height = newHeight;
    canvas.style.height = `${newHeight}px`;

    // Restore drawings
    const ctx = canvas.getContext('2d');
    ctx.drawImage(tempCanvas, 0, 0);

    if (notify) {
      window.showToast?.(`Extended canvas by ${extraPx}px downward. Scroll down to continue writing.`, 'info');
      const area = document.getElementById('whiteboardScrollArea');
      if (area) area.scrollBy({ top: 400, behavior: 'smooth' });
    }
  }

  resizeWhiteboard() {
    const canvas = document.getElementById('whiteboardCanvas');
    const scrollArea = document.getElementById('whiteboardScrollArea') || canvas?.parentElement;
    if (!canvas || !scrollArea) return;

    const targetWidth = Math.max(1200, scrollArea.clientWidth || 1200);
    const targetHeight = Math.max(3000, (scrollArea.clientHeight || 600) * 3);

    if (!canvas.width || canvas.width < targetWidth) {
      canvas.width = targetWidth;
      canvas.style.width = `${targetWidth}px`;
    }
    if (!canvas.height || canvas.height < targetHeight) {
      canvas.height = targetHeight;
      canvas.style.height = `${targetHeight}px`;
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
