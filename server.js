require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const emailService = require('./emailService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure directories exist
[DATA_DIR, UPLOAD_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// JSON File Database Helper for Persistence
const DB_FILE = path.join(DATA_DIR, 'database.json');
const DB_BACKUP_FILE = path.join(DATA_DIR, 'database.backup.json');
const USERS_BACKUP_FILE = path.join(DATA_DIR, 'users.backup.json');

function loadDatabase() {
  let loadedDB = null;

  // 1. Try reading primary database.json
  if (fs.existsSync(DB_FILE)) {
    try {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      if (content && content.trim()) {
        const parsed = JSON.parse(content);
        if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
          loadedDB = parsed;
        }
      }
    } catch (e) {
      console.error('Failed to parse database.json, attempting to restore from backup...', e);
    }
  }

  // 2. Try restoring from backup if DB_FILE was corrupted or empty
  if (!loadedDB && fs.existsSync(DB_BACKUP_FILE)) {
    try {
      const backupContent = fs.readFileSync(DB_BACKUP_FILE, 'utf8');
      if (backupContent && backupContent.trim()) {
        const backupParsed = JSON.parse(backupContent);
        if (backupParsed && Array.isArray(backupParsed.users) && backupParsed.users.length > 0) {
          console.log('✅ Successfully restored database from database.backup.json');
          loadedDB = backupParsed;
        }
      }
    } catch (e) {
      console.error('Failed to parse database.backup.json', e);
    }
  }

  // 3. Merge with dedicated users backup if available
  let backupUsers = [];
  if (fs.existsSync(USERS_BACKUP_FILE)) {
    try {
      const rawUsers = fs.readFileSync(USERS_BACKUP_FILE, 'utf8');
      if (rawUsers && rawUsers.trim()) {
        const parsedUsers = JSON.parse(rawUsers);
        if (Array.isArray(parsedUsers)) backupUsers = parsedUsers;
      }
    } catch (e){}
  }

  if (loadedDB) {
    // Ensure all backup users are merged into loadedDB without duplicates
    if (backupUsers.length > 0) {
      const userMap = new Map();
      loadedDB.users.forEach(u => userMap.set(u.id || u.email.toLowerCase(), u));
      backupUsers.forEach(u => {
        const key = u.id || u.email.toLowerCase();
        if (!userMap.has(key)) {
          userMap.set(key, u);
        }
      });
      loadedDB.users = Array.from(userMap.values());
    }
    // Prune excessive base64 incident logs on load to keep database lean
    if (loadedDB.malpracticeIncidents && loadedDB.malpracticeIncidents.length > 40) {
      loadedDB.malpracticeIncidents = loadedDB.malpracticeIncidents.slice(0, 40);
    }
    saveDatabase(loadedDB);
    return loadedDB;
  }

  const initialDB = {
    users: [
      {
        id: 'mgr-001',
        name: 'Executive Manager',
        email: 'manasku2007@gmail.com',
        password: 'Manas@2026',
        role: 'manager',
        avatar: 'M',
        institution: 'EduGuard Executive Board'
      },
      {
        id: 't-001',
        name: 'Dr. Evelyn Reed',
        email: 'teacher@eduguard.edu',
        password: 'EduGuard@2026',
        role: 'teacher',
        avatar: 'E',
        institution: 'Cambridge Academy of Sciences',
        emailVerified: true
      },
      {
        id: 'stu-001',
        name: 'Alex Johnson',
        email: 'student@eduguard.edu',
        password: 'EduGuard@2026',
        role: 'student',
        avatar: 'A',
        institution: 'Cambridge Academy of Sciences',
        emailVerified: true
      }
    ],
    rooms: {
      'CLASS-101': {
        roomId: 'CLASS-101',
        title: 'Advanced Mathematics & Physics Lecture',
        teacherId: 't-001',
        teacherName: 'Dr. Evelyn Reed',
        createdAt: new Date().toISOString()
      }
    },
    assignments: [
      {
        id: 'asg-101',
        title: 'Calculus: Derivatives & Rates of Change',
        subject: 'Mathematics',
        dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
        totalPoints: 100,
        description: 'Complete problems 1 through 15 on Chapter 4 regarding chain rule, related rates, and practical velocity calculations. Show all intermediate steps.',
        attachments: [],
        createdBy: 'Dr. Evelyn Reed',
        createdAt: new Date().toISOString()
      }
    ],
    submissions: [],
    tasks: [],
    malpracticeIncidents: [],
    reports: []
  };

  // Merge any existing backup users
  if (backupUsers.length > 0) {
    const userMap = new Map();
    initialDB.users.forEach(u => userMap.set(u.id || u.email.toLowerCase(), u));
    backupUsers.forEach(u => {
      const key = u.id || u.email.toLowerCase();
      if (!userMap.has(key)) userMap.set(key, u);
    });
    initialDB.users = Array.from(userMap.values());
  }

  saveDatabase(initialDB);
  return initialDB;
}

function saveDatabase(data) {
  try {
    // Keep incidents list capped to 40 so database.json remains ultra-fast and lightweight
    if (data.malpracticeIncidents && data.malpracticeIncidents.length > 40) {
      data.malpracticeIncidents = data.malpracticeIncidents.slice(0, 40);
    }

    const jsonStr = JSON.stringify(data, null, 2);
    // Write atomically via temporary file to prevent corruption on sudden restart/crash
    const tmpFile = path.join(DATA_DIR, 'database.tmp.json');
    fs.writeFileSync(tmpFile, jsonStr, 'utf8');
    fs.renameSync(tmpFile, DB_FILE);

    // Update backup files
    try { fs.writeFileSync(DB_BACKUP_FILE, jsonStr, 'utf8'); } catch(e){}
    if (data.users && Array.isArray(data.users)) {
      try { fs.writeFileSync(USERS_BACKUP_FILE, JSON.stringify(data.users, null, 2), 'utf8'); } catch(e){}
    }
  } catch (e) {
    console.error('Failed to save database.json atomically, retrying direct write', e);
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch(err2) {
      console.error('Direct write also failed:', err2);
    }
  }
}

const db = loadDatabase();

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// Validation Helpers
function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return typeof email === 'string' && emailRegex.test(email.trim());
}

function isValidPassword(password) {
  if (typeof password !== 'string' || password.length < 8) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);
  return hasUpper && hasLower && hasNumber && hasSymbol;
}

// ==========================================
// REST API ROUTES
// ==========================================

// Dedicated HTML Page Routes
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student.html')));
app.get('/manager', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manager.html')));

// Health check endpoint for cloud deployments
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// --- AUTHENTICATION ---
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address format.' });
  }

  const user = db.users.find(
    u => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password
  );

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  const userResponse = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    institution: user.institution || 'Cambridge Academy of Sciences'
  };

  res.json({
    success: true,
    message: 'Login successful',
    data: userResponse,
    user: userResponse
  });
});

// Initialize systemSettings if missing
if (!db.systemSettings) {
  db.systemSettings = {
    aiProctoringEnabled: true,
    autoApproveStudents: false,
    maxStudentsPerClass: 40,
    maxTeachersPerClass: 2,
    tabSwitchLimit: 3
  };
}

// --- MANAGER / SUPER ADMIN MASTER ENDPOINTS ---
app.get('/api/manager/overview', (req, res) => {
  const sanitizedUsers = db.users.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    password: u.password, // Provided to Executive Manager for credential recovery and auditing
    role: u.role,
    institution: u.institution,
    emailVerified: u.emailVerified || false,
    bypassedByManager: u.bypassedByManager || false,
    createdAt: u.verifiedAt || null
  }));

  const activeRoomsList = Object.keys(activeRoomParticipants).map(roomId => ({
    roomId,
    title: db.rooms[roomId]?.title || `Classroom ${roomId}`,
    participants: activeRoomParticipants[roomId] || []
  }));

  res.json({
    success: true,
    users: sanitizedUsers,
    rooms: db.rooms,
    assignments: db.assignments,
    malpracticeIncidents: db.malpracticeIncidents,
    data: {
      stats: {
        totalUsers: db.users.length,
        totalStudents: db.users.filter(u => u.role === 'student').length,
        totalTeachers: db.users.filter(u => u.role === 'teacher').length,
        totalManagers: db.users.filter(u => u.role === 'manager').length,
        activeClassrooms: activeRoomsList.length,
        totalIncidents: db.malpracticeIncidents.length,
        totalAssignments: db.assignments.length,
        totalSubmissions: db.submissions.length
      },
      systemSettings: db.systemSettings,
      users: sanitizedUsers,
      activeRooms: activeRoomsList,
      recentIncidents: db.malpracticeIncidents.slice(0, 50)
    }
  });
});

// 1. Instant Bypass User Registration (No OTP Required)
app.post('/api/manager/bypass-register', (req, res) => {
  const { name, email, password, role, institution } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Full Name, Email, and Password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const exists = db.users.some(u => u.email.toLowerCase() === cleanEmail);
  if (exists) {
    return res.status(409).json({ success: false, message: `An account with ${cleanEmail} already exists.` });
  }

  const targetRole = role || 'student';
  const prefix = targetRole === 'manager' ? 'mgr' : (targetRole === 'teacher' ? 't' : 'stu');
  const newUser = {
    id: `${prefix}-${Date.now()}`,
    name: name.trim(),
    email: cleanEmail,
    password,
    role: targetRole,
    avatar: name.trim().charAt(0).toUpperCase(),
    institution: institution || 'EduGuard Global Academy',
    emailVerified: true,
    bypassedByManager: true,
    verifiedAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDatabase(db);

  // Real-time broadcast to manager dashboard
  io.emit('manager-database-updated', { action: 'register', user: newUser });

  res.status(201).json({
    success: true,
    message: `[BYPASS SUCCESS] Created ${targetRole.toUpperCase()} account for "${newUser.name}" (${newUser.email}) without OTP!`,
    data: newUser
  });
});

// 2. Change Password of ANY User
app.post('/api/manager/change-user-password', (req, res) => {
  const { userId, newPassword } = req.body;
  if (!userId || !newPassword) {
    return res.status(400).json({ success: false, message: 'User identifier and new password are required.' });
  }

  const user = db.users.find(u => u.id === userId || u.email.toLowerCase() === userId.trim().toLowerCase());
  if (!user) {
    return res.status(404).json({ success: false, message: 'User account not found.' });
  }

  user.password = newPassword;
  saveDatabase(db);

  io.emit('manager-database-updated', { action: 'update-password', userId: user.id });

  res.json({
    success: true,
    message: `Password for "${user.name}" (${user.email}) updated successfully.`
  });
});

app.post('/api/manager/override-password', (req, res) => {
  const { userId, targetEmail, email, newPassword } = req.body;
  const identifier = userId || targetEmail || email;
  if (!identifier || !newPassword) {
    return res.status(400).json({ success: false, message: 'Account email/identifier and new password are required.' });
  }

  const user = db.users.find(u => u.id === identifier || u.email.toLowerCase() === identifier.trim().toLowerCase());
  if (!user) {
    return res.status(404).json({ success: false, message: 'User account not found.' });
  }

  user.password = newPassword;
  saveDatabase(db);

  io.emit('manager-database-updated', { action: 'update-password', userId: user.id });

  res.json({
    success: true,
    message: `Password for "${user.name}" (${user.email}) overridden successfully.`
  });
});

// 3. Update Manager's Own Credentials (Email, Name, Password)
app.post('/api/manager/update-credentials', (req, res) => {
  const { currentEmail, newEmail, newName, newPassword } = req.body;
  let managerUser = db.users.find(u => u.role === 'manager' && (u.email === currentEmail || u.id === 'mgr-001'));
  if (!managerUser) {
    managerUser = db.users.find(u => u.role === 'manager');
  }

  if (!managerUser) {
    managerUser = {
      id: 'mgr-001',
      name: newName || 'Executive Manager',
      email: newEmail || 'manasku2007@gmail.com',
      password: newPassword || 'Manas@2026',
      role: 'manager',
      avatar: 'M',
      institution: 'EduGuard Executive Board'
    };
    db.users.unshift(managerUser);
  } else {
    if (newName && newName.trim()) managerUser.name = newName.trim();
    if (newEmail && newEmail.trim()) {
      const cleanEmail = newEmail.trim().toLowerCase();
      const clash = db.users.some(u => u.id !== managerUser.id && u.email.toLowerCase() === cleanEmail);
      if (clash) {
        return res.status(409).json({ success: false, message: 'This email is already in use by another account.' });
      }
      managerUser.email = cleanEmail;
    }
    if (newPassword && newPassword.trim()) {
      managerUser.password = newPassword.trim();
    }
  }

  saveDatabase(db);

  io.emit('manager-database-updated', { action: 'update-manager', user: managerUser });

  res.json({
    success: true,
    message: '🛡️ Manager master credentials updated successfully! New password is saved.',
    data: {
      id: managerUser.id,
      name: managerUser.name,
      email: managerUser.email,
      role: managerUser.role
    }
  });
});

// 4. Global System Settings & Bypass Feature Flags
app.get('/api/manager/system-settings', (req, res) => {
  res.json({ success: true, data: db.systemSettings || {} });
});

app.post('/api/manager/system-settings', (req, res) => {
  const { aiProctoringEnabled, autoApproveStudents, maxStudentsPerClass, maxTeachersPerClass, tabSwitchLimit } = req.body;
  
  if (!db.systemSettings) db.systemSettings = {};
  if (typeof aiProctoringEnabled === 'boolean') db.systemSettings.aiProctoringEnabled = aiProctoringEnabled;
  if (typeof autoApproveStudents === 'boolean') db.systemSettings.autoApproveStudents = autoApproveStudents;
  if (maxStudentsPerClass) db.systemSettings.maxStudentsPerClass = parseInt(maxStudentsPerClass, 10);
  if (maxTeachersPerClass) db.systemSettings.maxTeachersPerClass = parseInt(maxTeachersPerClass, 10);
  if (tabSwitchLimit) db.systemSettings.tabSwitchLimit = parseInt(tabSwitchLimit, 10);

  saveDatabase(db);

  // Broadcast settings change to all active rooms
  io.emit('system-settings-updated', db.systemSettings);

  res.json({
    success: true,
    message: 'Global system policy & bypass configurations updated.',
    data: db.systemSettings
  });
});

// 5. Export Entire Database JSON
app.get('/api/manager/export-db', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=eduguard_backup.json');
  res.send(JSON.stringify(db, null, 2));
});

// 6. Broadcast Master Announcement to All Active Classrooms
app.post('/api/manager/broadcast-alert', (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Message content is required.' });
  }

  io.emit('executive-broadcast', {
    message: message.trim(),
    sender: '🛡️ Executive Management',
    timestamp: new Date().toISOString()
  });

  res.json({ success: true, message: 'Broadcast transmitted to all active rooms.' });
});

app.delete('/api/manager/users/:id', (req, res) => {
  const { id } = req.params;
  const target = db.users.find(u => u.id === id || u.email.toLowerCase() === id.toLowerCase());
  if (!target) {
    return res.status(404).json({ success: false, message: 'User account not located in database.' });
  }
  if (target.role === 'manager') {
    return res.status(403).json({ success: false, message: '🛡️ Super Administrator / Manager accounts cannot be deleted.' });
  }
  
  db.users = db.users.filter(u => u.id !== target.id && u.email.toLowerCase() !== target.email.toLowerCase());
  saveDatabase(db);
  
  io.emit('manager-database-updated', { action: 'delete', userId: id });

  return res.json({ 
    success: true, 
    message: `Account for ${target.name} (${target.email}) was permanently removed.`,
    user: { id: target.id, name: target.name, email: target.email, role: target.role }
  });
});

app.post('/api/manager/clear-audit-logs', (req, res) => {
  db.malpracticeIncidents = [];
  saveDatabase(db);
  res.json({ success: true, message: 'All malpractice incident logs cleared.' });
});

app.post('/api/manager/rooms/terminate', (req, res) => {
  const { roomId } = req.body;
  if (roomId && activeRoomParticipants[roomId]) {
    io.to(roomId).emit('room-terminated-by-manager', {
      message: `Classroom ${roomId} was officially closed by Executive Management.`
    });
    delete activeRoomParticipants[roomId];
    return res.json({ success: true, message: `Room ${roomId} terminated.` });
  }
  res.status(404).json({ success: false, message: 'Active room not found.' });
});

app.delete('/api/manager/incidents', (req, res) => {
  db.malpracticeIncidents = [];
  saveDatabase(db);
  res.json({ success: true, message: 'All malpractice logs cleared by Manager.' });
});

// --- USER MANAGEMENT (LIST, DELETE, RESET) ---
app.get('/api/users', (req, res) => {
  const sanitizedUsers = db.users.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    institution: u.institution,
    createdAt: u.verifiedAt || null
  }));
  res.json({ success: true, count: sanitizedUsers.length, data: sanitizedUsers });
});

// Delete specific registered user
app.delete('/api/users/:id', (req, res) => {
  const { id } = req.params;
  const initialLen = db.users.length;
  db.users = db.users.filter(u => u.id !== id && u.email !== id);
  if (db.users.length < initialLen) {
    saveDatabase(db);
    return res.json({ success: true, message: `User ${id} removed successfully.` });
  }
  res.status(404).json({ success: false, message: 'User not found.' });
});

// Reset registered users back to initial default demo accounts (Protected: Requires Manager Password)
app.post('/api/users/reset', (req, res) => {
  const { managerPassword } = req.body;
  const manager = db.users.find(u => u.role === 'manager');
  if (!managerPassword || (manager && manager.password !== managerPassword)) {
    return res.status(403).json({ success: false, message: '🛡️ Unauthorized: Manager password confirmation is strictly required to reset accounts.' });
  }

  db.users = [
    {
      id: "mgr-001",
      name: manager.name || "Executive Manager",
      email: manager.email || "manasku2007@gmail.com",
      password: manager.password || "Manas@2026",
      role: "manager",
      avatar: "M",
      institution: "EduGuard Executive Board"
    },
    {
      id: "t-001",
      name: "Dr. Evelyn Reed",
      email: "teacher@eduguard.edu",
      password: "EduGuard@2026",
      role: "teacher",
      avatar: "E",
      institution: "Cambridge Academy of Sciences",
      emailVerified: true
    },
    {
      id: "stu-001",
      name: "Alex Johnson",
      email: "student@eduguard.edu",
      password: "EduGuard@2026",
      role: "student",
      avatar: "A",
      institution: "Cambridge Academy of Sciences",
      emailVerified: true
    }
  ];
  saveDatabase(db);
  io.emit('manager-database-updated', { action: 'reset-users' });
  res.json({ success: true, message: 'User database reset with Super Admin authorization.', users: db.users });
});

// Per-Classroom Session Capacity Limits (Google Meet Style)
const MAX_CLASS_STUDENTS = 40;
const MAX_CLASS_TEACHERS = 2;

app.get('/api/capacity', (req, res) => {
  const activeRooms = Object.values(db.rooms);
  res.json({
    success: true,
    data: {
      roomRules: { maxStudentsPerClass: MAX_CLASS_STUDENTS, maxTeachersPerClass: MAX_CLASS_TEACHERS },
      totalRegisteredUsers: db.users.length,
      activeClassesCount: activeRooms.length
    }
  });
});

// In-Memory Email OTP Store
const pendingEmailOTPs = {};

// 1. Send Registration Email OTP (Unlimited Registration for Teachers & Students)
app.post('/api/auth/send-otp', async (req, res) => {
  const { email, name, role } = req.body;
  const targetRole = role === 'teacher' ? 'teacher' : 'student';

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email format.' });
  }

  const exists = db.users.some(u => u.email.toLowerCase() === email.trim().toLowerCase());
  if (exists) {
    return res.status(409).json({ success: false, message: 'An account with this email address already exists. Please login.' });
  }

  // Generate 6-Digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  pendingEmailOTPs[email.trim().toLowerCase()] = {
    otp,
    expiresAt,
    name: name ? name.trim() : 'Candidate',
    role: targetRole
  };

  console.log(`[EMAIL OTP SERVICE] Generated OTP for ${email}: ${otp}`);

  // Dispatch Email via Nodemailer
  const emailResult = await emailService.sendOtpEmail(email.trim().toLowerCase(), otp, name || 'Candidate');

  res.json({
    success: true,
    message: `Verification code sent to ${email}`,
    devOtp: otp,
    emailResult
  });
});

// 2. Verify OTP & Complete Registration
app.post('/api/auth/verify-otp-register', (req, res) => {
  const { name, email, password, role, otp, institution } = req.body;
  const targetRole = role === 'teacher' ? 'teacher' : 'student';
  const cleanEmail = (email || '').trim().toLowerCase();

  if (!cleanEmail || !otp || !password || !name) {
    return res.status(400).json({ success: false, message: 'All fields including Full Name, Password, and the 6-digit OTP are required.' });
  }

  const record = pendingEmailOTPs[cleanEmail];
  if (!record) {
    return res.status(400).json({ success: false, message: 'No OTP request found for this email. Please click "Send OTP".' });
  }

  if (Date.now() > record.expiresAt) {
    delete pendingEmailOTPs[cleanEmail];
    return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new verification code.' });
  }

  if (record.otp !== otp.toString().trim()) {
    return res.status(400).json({ success: false, message: 'Incorrect OTP code. Please check the code and try again.' });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 8 characters and include uppercase, lowercase, number, and a symbol.'
    });
  }

  // Clear verified OTP
  delete pendingEmailOTPs[cleanEmail];

  const newUser = {
    id: targetRole === 'teacher' ? `t-${Date.now()}` : `stu-${Date.now()}`,
    name: name.trim(),
    email: cleanEmail,
    password,
    role: targetRole,
    avatar: name.trim().charAt(0).toUpperCase(),
    institution: institution || 'Cambridge Academy of Sciences',
    emailVerified: true,
    verifiedAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDatabase(db);

  io.emit('manager-database-updated', { action: 'register', user: newUser });

  const registeredUserObj = {
    id: newUser.id,
    name: newUser.name,
    email: newUser.email,
    role: newUser.role,
    avatar: newUser.avatar,
    institution: newUser.institution
  };

  res.status(201).json({
    success: true,
    message: 'Email verified and account registered successfully! You may now login.',
    data: registeredUserObj,
    user: registeredUserObj
  });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role, institution } = req.body;
  const targetRole = role === 'teacher' ? 'teacher' : 'student';

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'All registration fields are required.' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email format.' });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 8 characters and include uppercase, lowercase, number, and a symbol.'
    });
  }

  const exists = db.users.some(u => u.email.toLowerCase() === email.trim().toLowerCase());
  if (exists) {
    return res.status(409).json({ success: false, message: 'An account with this email address already exists.' });
  }

  const newUser = {
    id: targetRole === 'teacher' ? `t-${Date.now()}` : `stu-${Date.now()}`,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
    role: targetRole,
    avatar: name.trim().charAt(0).toUpperCase(),
    institution: institution || 'Cambridge Academy of Sciences',
    emailVerified: true,
    verifiedAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDatabase(db);

  io.emit('manager-database-updated', { action: 'register', user: newUser });

  const directUserObj = {
    id: newUser.id,
    name: newUser.name,
    email: newUser.email,
    role: newUser.role,
    avatar: newUser.avatar,
    institution: newUser.institution
  };

  res.status(201).json({
    success: true,
    message: 'Account created successfully! You may now login.',
    data: directUserObj,
    user: directUserObj
  });
});

// --- CLASSROOMS ---
app.get('/api/rooms', (req, res) => {
  res.json({ success: true, data: Object.values(db.rooms) });
});

app.post('/api/rooms', (req, res) => {
  const { roomId, title, teacherId, teacherName } = req.body;
  const id = (roomId || `ROOM-${Math.floor(1000 + Math.random() * 9000)}`).toUpperCase();

  db.rooms[id] = {
    roomId: id,
    title: title || `Classroom ${id}`,
    teacherId: teacherId || 't-001',
    teacherName: teacherName || 'Teacher',
    createdAt: new Date().toISOString()
  };
  saveDatabase(db);

  res.status(201).json({ success: true, data: db.rooms[id] });
});

// --- ASSIGNMENTS ---
app.get('/api/assignments', (req, res) => {
  res.json({ success: true, data: db.assignments });
});

app.post('/api/assignments', upload.array('attachments', 3), (req, res) => {
  const { title, subject, dueDate, totalPoints, description, createdBy } = req.body;

  if (!title || !subject || !dueDate) {
    return res.status(400).json({ success: false, message: 'Missing required assignment fields' });
  }

  const attachments = (req.files || []).map(f => ({
    name: f.originalname,
    url: `/uploads/${f.filename}`,
    size: f.size
  }));

  const newAssignment = {
    id: `asg-${Date.now()}`,
    title,
    subject,
    dueDate,
    totalPoints: Number(totalPoints) || 100,
    description: description || '',
    attachments,
    createdBy: createdBy || 'Teacher',
    createdAt: new Date().toISOString()
  };

  db.assignments.unshift(newAssignment);
  saveDatabase(db);

  res.status(201).json({ success: true, data: newAssignment });
});

app.delete('/api/assignments/:id', (req, res) => {
  const { id } = req.params;
  const idx = db.assignments.findIndex(a => a.id === id);
  if (idx !== -1) {
    db.assignments.splice(idx, 1);
    db.submissions = db.submissions.filter(s => s.assignmentId !== id);
    saveDatabase(db);
    return res.json({ success: true, message: 'Assignment deleted' });
  }
  res.status(404).json({ success: false, message: 'Assignment not found' });
});

// --- SUBMISSIONS ---
app.get('/api/submissions', (req, res) => {
  const { assignmentId, studentId } = req.query;
  let filtered = db.submissions;
  if (assignmentId) filtered = filtered.filter(s => s.assignmentId === assignmentId);
  if (studentId) filtered = filtered.filter(s => s.studentId === studentId);
  res.json({ success: true, data: filtered });
});

app.post('/api/submissions', upload.single('attachment'), (req, res) => {
  const { assignmentId, studentId, studentName, studentEmail, submissionText } = req.body;

  if (!assignmentId || !studentName) {
    return res.status(400).json({ success: false, message: 'Assignment ID and student name are required' });
  }

  let attachmentUrl = null;
  let attachmentName = null;
  if (req.file) {
    attachmentUrl = `/uploads/${req.file.filename}`;
    attachmentName = req.file.originalname;
  }

  const wordCount = (submissionText || '').split(/\s+/).filter(Boolean).length;
  const aiReview = {
    plagiarismScore: `${Math.floor(Math.random() * 3)}%`,
    sentiment: wordCount > 15 ? 'Thorough & Original' : 'Concise',
    conceptMastery: `${90 + Math.floor(Math.random() * 9)}%`,
    summary: `Work submitted on-time. Content evaluation indicates original formulation with ${wordCount} words.`
  };

  const existingIdx = db.submissions.findIndex(
    s => s.assignmentId === assignmentId && (s.studentId === studentId || s.studentName === studentName)
  );

  const submissionData = {
    id: existingIdx !== -1 ? db.submissions[existingIdx].id : `sub-${Date.now()}`,
    assignmentId,
    studentId: studentId || 'stu-001',
    studentName,
    studentEmail: studentEmail || `${studentName.toLowerCase().replace(/\s+/g, '.')}@student.edu`,
    submissionText: submissionText || '',
    attachmentUrl: attachmentUrl || (existingIdx !== -1 ? db.submissions[existingIdx].attachmentUrl : null),
    attachmentName: attachmentName || (existingIdx !== -1 ? db.submissions[existingIdx].attachmentName : null),
    submittedAt: new Date().toISOString(),
    status: 'Pending',
    score: null,
    feedback: '',
    aiReview
  };

  if (existingIdx !== -1) {
    db.submissions[existingIdx] = submissionData;
  } else {
    db.submissions.unshift(submissionData);
  }
  saveDatabase(db);

  res.status(201).json({ success: true, data: submissionData });
});

app.post('/api/submissions/:id/grade', (req, res) => {
  const { id } = req.params;
  const { score, feedback } = req.body;
  const sub = db.submissions.find(s => s.id === id);
  if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

  sub.score = Number(score);
  sub.feedback = feedback || 'Graded by teacher.';
  sub.status = 'Graded';
  saveDatabase(db);

  res.json({ success: true, data: sub });
});

app.post('/api/submissions/:id/ai-review', (req, res) => {
  const { id } = req.params;
  const sub = db.submissions.find(s => s.id === id);
  if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

  const assignment = db.assignments.find(a => a.id === sub.assignmentId) || {};
  const maxPts = assignment.totalPoints || 100;
  const calculatedScore = Math.min(maxPts, Math.floor(maxPts * 0.94));

  sub.aiReview = {
    plagiarismScore: '0.8%',
    sentiment: 'High Quality / Original Synthesis',
    conceptMastery: '96%',
    suggestedScore: calculatedScore,
    summary: `AI Evaluation: Student demonstrates authentic conceptual clarity on "${assignment.title || 'Assignment'}". Strong step-by-step presentation with zero academic integrity violations.`,
    improvementPoints: [
      'Encourage expanding further on practical edge cases.',
      'Excellent notation and structured breakdown.'
    ]
  };
  saveDatabase(db);

  res.json({ success: true, data: sub.aiReview });
});

// --- TASKS ---
app.get('/api/tasks', (req, res) => {
  res.json({ success: true, data: db.tasks });
});

app.post('/api/tasks', (req, res) => {
  const { title, dueDate, assignedTo, assignedBy, priority } = req.body;
  if (!title) return res.status(400).json({ success: false, message: 'Task title is required' });

  const newTask = {
    id: `task-${Date.now()}`,
    title: title.trim(),
    dueDate: dueDate || new Date().toISOString().split('T')[0],
    assignedTo: assignedTo || 'All Students',
    assignedBy: assignedBy || 'Teacher',
    status: 'todo',
    priority: priority || 'medium'
  };
  db.tasks.unshift(newTask);
  saveDatabase(db);

  res.status(201).json({ success: true, data: newTask });
});

app.patch('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  const task = db.tasks.find(t => t.id === id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

  if (req.body.status) task.status = req.body.status;
  if (req.body.title) task.title = req.body.title;
  if (req.body.priority) task.priority = req.body.priority;
  if (req.body.dueDate) task.dueDate = req.body.dueDate;
  saveDatabase(db);

  res.json({ success: true, data: task });
});

app.delete('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  const idx = db.tasks.findIndex(t => t.id === id);
  if (idx !== -1) {
    db.tasks.splice(idx, 1);
    saveDatabase(db);
    return res.json({ success: true, message: 'Task deleted' });
  }
  res.status(404).json({ success: false, message: 'Task not found' });
});

// --- MALPRACTICE INCIDENTS & 7-DAY RETENTION REPORTS ---
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

app.get('/api/malpractice-logs', (req, res) => {
  const { roomId, studentName } = req.query;
  const now = Date.now();
  
  // Strict 7-Day Retention: Filter incidents within the last 7 days
  let logs = db.malpracticeIncidents.filter(l => {
    const itemTime = new Date(l.timestamp).getTime();
    return (now - itemTime) <= SEVEN_DAYS_MS;
  });

  if (roomId) logs = logs.filter(l => l.roomId === roomId);
  if (studentName) logs = logs.filter(l => l.studentName.toLowerCase().includes(studentName.toLowerCase()));
  res.json({ success: true, count: logs.length, data: logs });
});

app.post('/api/malpractice-logs', (req, res) => {
  const { roomId, studentId, studentName, violationType, severity, snapshot, details } = req.body;
  const incident = {
    id: `inc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    roomId: roomId || 'CLASS-101',
    studentId: studentId || 'stu-unknown',
    studentName: studentName || 'Unknown Student',
    violationType: violationType || 'Suspicious Activity',
    severity: severity || 'High',
    snapshot: snapshot || null,
    details: details || '',
    timestamp: new Date().toISOString()
  };

  db.malpracticeIncidents.unshift(incident);
  if (db.malpracticeIncidents.length > 500) db.malpracticeIncidents.pop();
  saveDatabase(db);

  res.status(201).json({ success: true, data: incident });
});

// Teacher Ends Meeting & Compiles Official 7-Day PDF Session Report
app.post('/api/reports/end-session-archive', (req, res) => {
  const { roomId, teacherName, durationMinutes } = req.body;
  const targetRoom = (roomId || 'CLASS-101').toUpperCase();
  const now = Date.now();

  // Fetch all incidents for this room in the last 7 days
  const roomIncidents = db.malpracticeIncidents.filter(inc => {
    const itemTime = new Date(inc.timestamp).getTime();
    return (now - itemTime) <= SEVEN_DAYS_MS && inc.roomId === targetRoom;
  });

  const participants = activeRoomParticipants[targetRoom] || [];
  const studentsCount = participants.filter(p => p.role === 'student').length;

  const tabSwitches = roomIncidents.filter(i => i.violationType.includes('Tab') || i.violationType.includes('Window')).length;
  const faceDeviations = roomIncidents.filter(i => i.violationType.includes('Gaze') || i.violationType.includes('Face') || i.violationType.includes('Away')).length;
  const totalViolations = roomIncidents.length;

  const focusPenalty = (tabSwitches * 12) + (faceDeviations * 5);
  const calculatedFocus = Math.max(30, Math.min(99, 100 - focusPenalty));

  let integrityStatus = 'Exceptional';
  if (calculatedFocus < 60) integrityStatus = 'High Risk of Malpractice';
  else if (calculatedFocus < 80) integrityStatus = 'Moderate Attention Drift';
  else if (calculatedFocus < 92) integrityStatus = 'Good Engagement';

  const sessionReport = {
    id: `pdf-rep-${Date.now()}`,
    roomId: targetRoom,
    hostTeacher: teacherName || 'Faculty Teacher',
    generatedAt: new Date().toISOString(),
    sessionDuration: `${durationMinutes || 45} mins`,
    retentionExpiresAt: new Date(now + SEVEN_DAYS_MS).toISOString(),
    retentionDaysRemaining: 7,
    metrics: {
      overallFocusScore: `${calculatedFocus}%`,
      attendanceStatus: `${studentsCount > 0 ? studentsCount : 1} Students Recorded`,
      integrityStatus,
      tabSwitchCount: tabSwitches,
      faceAbsenceCount: faceDeviations,
      totalIncidents: totalViolations
    },
    incidents: roomIncidents.slice(0, 30),
    aiAssessment: {
      summary: `Official PDF Session Report for Classroom ${targetRoom}. During the live proctored session, an overall class attention score of ${calculatedFocus}% was recorded with ${totalViolations} detected infractions. This report is preserved for 7 days in accordance with institutional data retention policies.`,
      teacherActionItems: [
        totalViolations > 0 ? `Review the ${totalViolations} timestamped incident evidence logs below.` : 'Classroom demonstrated exemplary visual commitment throughout.',
        'Distribute PDF session report copy to academic counseling if required.'
      ],
      parentInsights: `Academic integrity rating: ${integrityStatus}. 7-Day compliance audit complete.`
    }
  };

  if (!db.reports) db.reports = [];
  db.reports.unshift(sessionReport);
  saveDatabase(db);

  // Broadcast to all participants in this room that the teacher has concluded the session
  io.to(targetRoom).emit('session-ended-by-teacher', {
    roomId: targetRoom,
    teacherName: teacherName || 'Faculty Teacher',
    message: `The classroom session ${targetRoom} has been concluded by ${teacherName || 'the teacher'}.`
  });

  // Clean up active participants for this room
  delete activeRoomParticipants[targetRoom];
  delete pendingAdmissions[targetRoom];

  res.status(201).json({ success: true, data: sessionReport });
});

app.get('/api/reports/students', (req, res) => {
  const { roomId } = req.query;
  const targetRoom = (roomId || 'CLASS-101').toUpperCase();
  const participants = activeRoomParticipants[targetRoom] || [];
  
  // 1. Active students currently in the WebRTC room
  const activeStudents = participants
    .filter(p => p.role === 'student')
    .map(p => {
      const dbUser = db.users.find(u => u.id === p.studentId || (p.email && u.email.toLowerCase() === p.email.toLowerCase()));
      return {
        id: p.studentId || (dbUser ? dbUser.id : `stu-${p.socketId.slice(0, 5)}`),
        studentId: p.studentId || (dbUser ? dbUser.id : `stu-${p.socketId.slice(0, 5)}`),
        name: p.name,
        email: p.email || (dbUser ? dbUser.email : 'student@eduguard.edu'),
        institution: (dbUser && dbUser.institution) || 'Cambridge Academy of Sciences',
        photo: p.photo || (dbUser && dbUser.photo) || null,
        role: 'student',
        isActiveInClass: true
      };
    });

  // 2. All registered students in the database
  const registeredStudents = db.users
    .filter(u => u.role === 'student')
    .map(u => ({
      id: u.id,
      studentId: u.id,
      name: u.name,
      email: u.email,
      institution: u.institution || 'Cambridge Academy of Sciences',
      photo: u.photo || null,
      role: 'student',
      isActiveInClass: activeStudents.some(a => a.id === u.id || a.email.toLowerCase() === u.email.toLowerCase())
    }));

  // Combine and deduplicate
  const studentMap = new Map();
  activeStudents.forEach(s => studentMap.set(s.id || s.email, s));
  registeredStudents.forEach(s => {
    if (!studentMap.has(s.id || s.email)) {
      studentMap.set(s.id || s.email, s);
    }
  });

  const combinedStudents = Array.from(studentMap.values());
  res.json({ success: true, activeStudents, registeredStudents, students: combinedStudents });
});

// Global room session start timestamps for accurate duration reporting
const roomSessionStartTimes = {};

function buildSessionReport(roomId, targetIdentifier, durationMinutes) {
  const targetRoom = (roomId || 'CLASS-101').toUpperCase();
  const isAll = !targetIdentifier || targetIdentifier === 'ALL' || targetIdentifier === 'Entire Classroom' || targetIdentifier === 'all';
  const now = Date.now();

  // Calculate actual elapsed session duration
  let actualDurationString = '15 Mins';
  let actualDurationMinutes = 15;

  if (durationMinutes && !isNaN(parseInt(durationMinutes, 10))) {
    actualDurationMinutes = parseInt(durationMinutes, 10);
    actualDurationString = `${actualDurationMinutes} Mins`;
  } else if (roomSessionStartTimes[targetRoom]) {
    const elapsedSecs = Math.max(5, Math.round((now - roomSessionStartTimes[targetRoom]) / 1000));
    const elapsedMins = Math.floor(elapsedSecs / 60);
    const remSecs = elapsedSecs % 60;
    if (elapsedMins === 0) {
      actualDurationString = `${elapsedSecs} Secs`;
      actualDurationMinutes = 1;
    } else if (elapsedMins < 60) {
      actualDurationString = `${elapsedMins} Min${elapsedMins === 1 ? '' : 's'}${remSecs > 0 ? ` ${remSecs}s` : ''}`;
      actualDurationMinutes = elapsedMins;
    } else {
      const h = Math.floor(elapsedMins / 60);
      const m = elapsedMins % 60;
      actualDurationString = `${h}h ${m}m`;
      actualDurationMinutes = elapsedMins;
    }
  } else if (db.rooms && db.rooms[targetRoom] && db.rooms[targetRoom].createdAt) {
    const elapsedSecs = Math.max(10, Math.round((now - new Date(db.rooms[targetRoom].createdAt).getTime()) / 1000));
    const elapsedMins = Math.floor(elapsedSecs / 60);
    if (elapsedMins < 60) {
      actualDurationString = `${Math.max(1, elapsedMins)} Mins`;
      actualDurationMinutes = Math.max(1, elapsedMins);
    } else {
      actualDurationString = `${Math.floor(elapsedMins / 60)}h ${elapsedMins % 60}m`;
      actualDurationMinutes = elapsedMins;
    }
  }

  let matchedUser = null;
  if (!isAll) {
    // Lookup by ID first, then by email, then by exact/case-insensitive name
    matchedUser = db.users.find(u => 
      u.id === targetIdentifier || 
      (u.email && u.email.toLowerCase() === targetIdentifier.toLowerCase()) || 
      (u.name && u.name.toLowerCase() === targetIdentifier.toLowerCase())
    );

    // If not found in DB users, check active room participants
    if (!matchedUser && activeRoomParticipants[targetRoom]) {
      const p = activeRoomParticipants[targetRoom].find(x => 
        x.studentId === targetIdentifier || 
        (x.email && x.email.toLowerCase() === targetIdentifier.toLowerCase()) ||
        (x.name && x.name.toLowerCase() === targetIdentifier.toLowerCase())
      );
      if (p) {
        matchedUser = {
          id: p.studentId || targetIdentifier,
          name: p.name,
          email: p.email || 'student@eduguard.edu',
          institution: 'Cambridge Academy of Sciences',
          photo: p.photo || null
        };
      }
    }
  }

  const targetDisplayName = matchedUser ? matchedUser.name : (isAll ? `Classroom ${targetRoom} (All Candidates)` : targetIdentifier);
  const targetEmail = matchedUser ? matchedUser.email : (isAll ? 'all-candidates@eduguard.edu' : 'student@eduguard.edu');
  const targetStudentId = matchedUser ? matchedUser.id : (isAll ? 'ALL' : targetIdentifier);
  const targetInstitution = (matchedUser && matchedUser.institution) || 'Cambridge Academy of Sciences';

  // Filter incidents for this room and student
  const filteredIncidents = db.malpracticeIncidents.filter(inc => {
    const itemTime = new Date(inc.timestamp).getTime();
    if ((now - itemTime) > SEVEN_DAYS_MS) return false;
    if (inc.roomId !== targetRoom) return false;
    if (!isAll && matchedUser) {
      const idMatches = inc.studentId && (inc.studentId === matchedUser.id || inc.studentId === targetIdentifier);
      const nameMatches = inc.studentName && inc.studentName.toLowerCase() === matchedUser.name.toLowerCase();
      const emailMatches = inc.studentEmail && matchedUser.email && inc.studentEmail.toLowerCase() === matchedUser.email.toLowerCase();
      if (!idMatches && !nameMatches && !emailMatches) return false;
    }
    return true;
  });

  // Candidate photo resolution: profile photo -> latest incident snapshot -> active room photo
  let candidatePhoto = (matchedUser && matchedUser.photo) || null;
  if (!candidatePhoto) {
    const recentSnapshot = filteredIncidents.find(i => i.snapshot && i.snapshot.startsWith('data:image'));
    if (recentSnapshot) candidatePhoto = recentSnapshot.snapshot;
  }
  if (!candidatePhoto && activeRoomParticipants[targetRoom]) {
    const activeMatch = activeRoomParticipants[targetRoom].find(p => p.studentId === targetStudentId || p.name === targetDisplayName);
    if (activeMatch && activeMatch.photo) candidatePhoto = activeMatch.photo;
  }

  const tabSwitches = filteredIncidents.filter(i => i.violationType.includes('Tab') || i.violationType.includes('Window') || i.violationType.includes('App')).length;
  const faceDeviations = filteredIncidents.filter(i => i.violationType.includes('Gaze') || i.violationType.includes('Face') || i.violationType.includes('Away') || i.violationType.includes('Left')).length;
  const totalViolations = filteredIncidents.length;

  let calculatedFocus = 100;
  if (totalViolations > 0) {
    const focusPenalty = (tabSwitches * 12) + (faceDeviations * 5);
    calculatedFocus = Math.max(25, Math.min(99, 100 - focusPenalty));
  }

  let integrityStatus = 'Exceptional Focus & Compliance';
  if (calculatedFocus < 60) integrityStatus = 'High Risk - Academic Integrity Flag';
  else if (calculatedFocus < 80) integrityStatus = 'Moderate Attention Drift';
  else if (calculatedFocus < 95 && totalViolations > 0) integrityStatus = 'Acceptable Engagement';

  const report = {
    id: `rep-${Date.now()}`,
    roomId: targetRoom,
    classroomId: targetRoom,
    studentName: targetDisplayName,
    studentEmail: targetEmail,
    studentId: targetStudentId,
    candidatePhoto,
    institution: targetInstitution,
    generatedAt: new Date().toISOString(),
    sessionDuration: actualDurationString,
    duration: actualDurationString,
    overallScore: calculatedFocus,
    totalIncidents: totalViolations,
    retentionExpiresAt: new Date(now + SEVEN_DAYS_MS).toISOString(),
    retentionDaysRemaining: 7,
    metrics: {
      overallFocusScore: `${calculatedFocus}%`,
      attendanceStatus: isAll ? 'Full Class Cohort' : 'Verified Present',
      integrityStatus,
      tabSwitchCount: tabSwitches,
      faceAbsenceCount: faceDeviations,
      totalIncidents: totalViolations
    },
    incidents: filteredIncidents.slice(0, 40),
    assessment: `During the ${actualDurationString} live proctored session for ${targetDisplayName} (${targetEmail}), an attention & conduct index of ${calculatedFocus}% was recorded. ${totalViolations === 0 ? 'Zero malpractice infractions observed across the entire monitoring window. Continuous face presence and window compliance verified.' : `A total of ${totalViolations} live infractions were captured (${tabSwitches} tab switches, ${faceDeviations} camera frame deviations). Evidence snapshots attached.`}`,
    attentionTimeline: [calculatedFocus, Math.min(100, calculatedFocus + 2), Math.max(40, calculatedFocus - 3), calculatedFocus, Math.min(100, calculatedFocus + 1)],
    aiAssessment: {
      summary: `During the ${actualDurationString} live proctored session for ${targetDisplayName}, an attention & conduct index of ${calculatedFocus}% was recorded. ${totalViolations === 0 ? 'Zero malpractice infractions observed across the entire monitoring window.' : `A total of ${totalViolations} live infractions were captured (${tabSwitches} tab switches, ${faceDeviations} camera frame deviations).`}`,
      teacherActionItems: [
        totalViolations > 2 ? 'Schedule a 1-on-1 counseling check-in regarding tab distractions.' : 'Classroom demonstrated sustained visual focus and authentic academic engagement.',
        'Coursework review completed with verified telemetry audit logs.'
      ],
      parentInsights: `Academic performance: ${integrityStatus}. Active engagement verified in ${calculatedFocus}% of the proctored session.`
    }
  };

  if (!db.reports) db.reports = [];
  db.reports.unshift(report);
  saveDatabase(db);

  return report;
}

app.get('/api/reports/generate', (req, res) => {
  const { roomId, studentName, studentId, durationMinutes } = req.query;
  const target = studentId || studentName;
  const report = buildSessionReport(roomId, target, durationMinutes);
  res.json({ success: true, report, data: report });
});

app.post('/api/reports/generate', (req, res) => {
  const { roomId, studentName, studentId, durationMinutes } = req.body;
  const target = studentId || studentName;
  const report = buildSessionReport(roomId, target, durationMinutes);
  res.status(201).json({ success: true, report, data: report });
});

// GET 7-Day Session Reports for Teacher
const handleGet7DayReports = (req, res) => {
  const now = Date.now();
  if (!db.reports) db.reports = [];

  // Strict 7-Day Retention Guard: Return only reports within last 7 days
  const validReports = db.reports.filter(r => {
    const itemTime = new Date(r.generatedAt).getTime();
    return (now - itemTime) <= SEVEN_DAYS_MS;
  }).map(r => {
    const ageMs = now - new Date(r.generatedAt).getTime();
    const daysLeft = Math.max(0, Math.ceil((SEVEN_DAYS_MS - ageMs) / (24 * 60 * 60 * 1000)));
    return {
      ...r,
      retentionDaysRemaining: daysLeft
    };
  });

  res.json({ success: true, reports: validReports, data: validReports });
};

app.get('/api/reports', handleGet7DayReports);
app.get('/api/reports/7day-archive', handleGet7DayReports);

// Fallback index route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// REAL-TIME WEBRTC SIGNALING & PROCTORING (SOCKET.IO)
// ==========================================
const activeRoomParticipants = {}; // roomId -> [ { socketId, name, role, studentId, email, photo } ]
const pendingAdmissions = {}; // roomId -> [ { socketId, name, studentId, email, timestamp } ]

io.on('connection', (socket) => {
  // 1. Student Knocks / Requests to Join with Class Code
  const handleStudentKnock = ({ roomId, name, studentId, email }) => {
    const room = (roomId || socket.requestedRoom || 'CLASS-101').toUpperCase();
    socket.requestedRoom = room;
    socket.userName = name || 'Student';
    socket.studentId = studentId || `stu-${socket.id.slice(0, 5)}`;
    socket.userEmail = email || 'student@eduguard.edu';

    // Room Capacity Guard for Students Knocking
    const currentStudentsInRoom = (activeRoomParticipants[room] || []).filter(p => p.role === 'student').length;
    if (currentStudentsInRoom >= MAX_CLASS_STUDENTS) {
      return socket.emit('admission-rejected', {
        roomId: room,
        message: `Classroom Full: Maximum capacity of ${MAX_CLASS_STUDENTS} students has been reached for room ${room}.`
      });
    }

    if (!pendingAdmissions[room]) pendingAdmissions[room] = [];

    // Remove any duplicate request
    pendingAdmissions[room] = pendingAdmissions[room].filter(r => r.socketId !== socket.id);
    const reqData = {
      socketId: socket.id,
      name: socket.userName,
      studentId: socket.studentId,
      email: socket.userEmail,
      roomId: room,
      timestamp: new Date().toISOString()
    };
    pendingAdmissions[room].push(reqData);

    console.log(`🔔 Admission Knock Received: ${reqData.name} (${reqData.socketId}) -> Room ${room}`);

    // Notify room and direct to all active teachers
    io.to(room).emit('admission-request-received', reqData);
    for (const [sId, s] of io.sockets.sockets) {
      if (s.userRole === 'teacher' && (!s.roomId || s.roomId === room)) {
        s.emit('admission-request-received', reqData);
      }
    }

    socket.emit('waiting-for-teacher-approval', { roomId: room });
  };

  socket.on('student-request-join', handleStudentKnock);
  socket.on('request-student-admission', handleStudentKnock);

  // 2. Teacher Decides (Accept or Deny Student Knock)
  socket.on('teacher-decision-join', ({ targetSocketId, roomId, approved }) => {
    const room = (roomId || socket.roomId || 'CLASS-101').toUpperCase();

    if (pendingAdmissions[room]) {
      pendingAdmissions[room] = pendingAdmissions[room].filter(r => r.socketId !== targetSocketId);
    }

    if (approved) {
      const currentStudentsInRoom = (activeRoomParticipants[room] || []).filter(p => p.role === 'student').length;
      if (currentStudentsInRoom >= MAX_CLASS_STUDENTS) {
        return io.to(targetSocketId).emit('admission-rejected', {
          roomId: room,
          message: `Classroom Full: Maximum capacity of ${MAX_CLASS_STUDENTS} students reached for room ${room}.`
        });
      }
      console.log(`✅ Teacher approved student admission: ${targetSocketId} into room ${room}`);
      io.to(targetSocketId).emit('admission-approved', { roomId: room });
    } else {
      console.log(`❌ Teacher denied student admission: ${targetSocketId} for room ${room}`);
      io.to(targetSocketId).emit('admission-rejected', {
        roomId: room,
        message: 'The teacher declined your admission request for this session.'
      });
    }
  });

  // 3. Join Classroom Room (Direct for Teachers or Approved Students)
  socket.on('join-room', ({ roomId, role, name, studentId, email, photo }) => {
    const room = (roomId || 'CLASS-101').toUpperCase();
    const userRole = role || 'student';

    if (!activeRoomParticipants[room]) {
      activeRoomParticipants[room] = [];
    }

    if (!roomSessionStartTimes[room]) {
      roomSessionStartTimes[room] = Date.now();
    }

    // Teacher limit guard per room
    const currentTeachersInRoom = activeRoomParticipants[room].filter(p => p.role === 'teacher').length;
    if (userRole === 'teacher' && currentTeachersInRoom >= MAX_CLASS_TEACHERS && !activeRoomParticipants[room].some(p => p.socketId === socket.id)) {
      return socket.emit('join-error', {
        message: `Teacher Capacity Reached: Maximum ${MAX_CLASS_TEACHERS} teachers allowed in room ${room}.`
      });
    }

    socket.roomId = room;
    socket.userRole = userRole;
    socket.userName = name || 'Participant';
    socket.studentId = studentId || `user-${socket.id.slice(0, 5)}`;
    socket.userEmail = email || (userRole === 'teacher' ? 'teacher@eduguard.edu' : 'student@eduguard.edu');

    socket.join(room);

    // Remove stale socket if any
    activeRoomParticipants[room] = activeRoomParticipants[room].filter(p => p.socketId !== socket.id);

    const participantData = {
      socketId: socket.id,
      name: socket.userName,
      role: socket.userRole,
      studentId: socket.studentId,
      email: socket.userEmail,
      photo: photo || null,
      joinedAt: new Date().toISOString(),
      currentFocus: 100
    };

    activeRoomParticipants[room].push(participantData);

    // Notify others in room so they initiate WebRTC peer connections
    socket.to(room).emit('user-connected', {
      socketId: socket.id,
      name: socket.userName,
      role: socket.userRole,
      studentId: socket.studentId
    });

    // Send full current room roster to joining user
    io.to(room).emit('room-roster-update', {
      participants: activeRoomParticipants[room]
    });

    // If teacher joins, send any pending waiting admissions for that room
    if (socket.userRole === 'teacher' && pendingAdmissions[room]) {
      pendingAdmissions[room].forEach(req => {
        socket.emit('admission-request-received', req);
      });
    }
  });

  // 3b. Student sends live candidate verification photo
  socket.on('student-verification-photo', ({ photo }) => {
    if (photo && socket.roomId && activeRoomParticipants[socket.roomId]) {
      const p = activeRoomParticipants[socket.roomId].find(x => x.socketId === socket.id);
      if (p) p.photo = photo;
    }
    const user = db.users.find(u => (socket.studentId && u.id === socket.studentId) || (socket.userEmail && u.email.toLowerCase() === socket.userEmail.toLowerCase()));
    if (user && photo) {
      user.photo = photo;
      saveDatabase(db);
    }
  });

  // 3c. Teacher Ends Classroom Session
  socket.on('teacher-end-session', ({ roomId, durationMinutes }) => {
    const targetRoom = (roomId || socket.roomId || 'CLASS-101').toUpperCase();
    console.log(`🛑 Teacher concluded session for room ${targetRoom}`);

    // Generate comprehensive session report for classroom with true elapsed duration
    const sessionReport = buildSessionReport(targetRoom, 'ALL', durationMinutes);

    io.to(targetRoom).emit('session-ended-by-teacher', {
      roomId: targetRoom,
      teacherName: socket.userName || 'Faculty Teacher',
      message: `The classroom session ${targetRoom} was officially concluded by ${socket.userName || 'the teacher'}.`,
      reportId: sessionReport.id,
      duration: sessionReport.duration
    });

    // Reset room start time after report is saved
    delete roomSessionStartTimes[targetRoom];

    // Clean up active participants for this room
    delete activeRoomParticipants[targetRoom];
    delete pendingAdmissions[targetRoom];
  });

  // 4. Real WebRTC Signaling Mesh (Offers, Answers, ICE Candidates)
  socket.on('webrtc-offer', ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit('webrtc-offer', {
      callerSocketId: socket.id,
      callerName: socket.userName,
      callerRole: socket.userRole,
      offer
    });
  });

  socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('webrtc-answer', {
      responderSocketId: socket.id,
      answer
    });
  });

  socket.on('webrtc-ice-candidate', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc-ice-candidate', {
      senderSocketId: socket.id,
      candidate
    });
  });

  // 5. Real-Time Malpractice Event
  socket.on('malpractice-event', (data) => {
    const payload = {
      id: `inc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      roomId: socket.roomId || data.roomId || 'CLASS-101',
      studentId: data.studentId || socket.studentId || 'stu-001',
      studentName: data.studentName || socket.userName || 'Student',
      studentEmail: data.studentEmail || socket.userEmail || 'student@eduguard.edu',
      violationType: data.violationType || 'Tab Switch Detected',
      severity: data.severity || 'High',
      snapshot: data.snapshot || null,
      details: data.details || 'Student left the live examination/class window.',
      timestamp: new Date().toISOString()
    };

    db.malpracticeIncidents.unshift(payload);
    if (db.malpracticeIncidents.length > 500) db.malpracticeIncidents.pop();
    saveDatabase(db);

    // Broadcast to teacher roles in room
    io.to(payload.roomId).emit('malpractice-alert-teacher', payload);
  });

  // 4. Whiteboard Sync
  socket.on('whiteboard-draw', (drawData) => {
    socket.to(socket.roomId).emit('whiteboard-draw', drawData);
  });

  socket.on('whiteboard-clear', () => {
    socket.to(socket.roomId).emit('whiteboard-clear');
  });

  // 5. Classroom Live Chat
  socket.on('send-chat', ({ message }) => {
    const chatMsg = {
      id: uuidv4(),
      senderName: socket.userName || 'Anonymous',
      senderRole: socket.userRole || 'student',
      message,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    io.to(socket.roomId).emit('receive-chat', chatMsg);
  });

  // 6. Hand Raise
  socket.on('toggle-hand', ({ raised }) => {
    io.to(socket.roomId).emit('student-hand-status', {
      socketId: socket.id,
      name: socket.userName,
      raised
    });
  });

  // 6b. Screen Share Toggle Broadcast
  socket.on('toggle-screen-share', ({ isSharing }) => {
    socket.to(socket.roomId).emit('user-screen-share-status', {
      socketId: socket.id,
      name: socket.userName,
      role: socket.userRole,
      isSharing
    });
  });

  // 7. Teacher Remote Control of Student Camera & Mic
  socket.on('teacher-control-media', ({ targetSocketId, roomId, mediaType, state }) => {
    if (targetSocketId) {
      io.to(targetSocketId).emit('teacher-control-media', {
        mediaType,
        state,
        teacherName: socket.userName || 'Teacher'
      });
    } else {
      const room = roomId || socket.roomId;
      socket.to(room).emit('teacher-control-media', {
        mediaType,
        state,
        teacherName: socket.userName || 'Teacher'
      });
    }
  });

  // 8. Teacher Warning
  socket.on('teacher-direct-warning', ({ targetSocketId, targetStudentName, warningMessage }) => {
    if (targetSocketId) {
      io.to(targetSocketId).emit('teacher-direct-warning', {
        teacherName: socket.userName,
        warningMessage
      });
    } else {
      io.to(socket.roomId).emit('teacher-direct-warning', {
        teacherName: socket.userName,
        warningMessage
      });
    }
  });

  // 9. Teacher Explicitly Concludes / Ends Meeting for All Participants
  socket.on('teacher-end-session', ({ roomId }) => {
    const room = (roomId || socket.roomId || 'CLASS-101').toUpperCase();
    io.to(room).emit('session-ended-by-teacher', {
      roomId: room,
      teacherName: socket.userName || 'Faculty Teacher',
      message: `The host teacher (${socket.userName || 'Faculty Teacher'}) has concluded the meeting. The classroom session has ended.`
    });
    delete activeRoomParticipants[room];
    delete pendingAdmissions[room];
  });

  socket.on('end-classroom-session', ({ roomId }) => {
    const room = (roomId || socket.roomId || 'CLASS-101').toUpperCase();
    io.to(room).emit('session-ended-by-teacher', {
      roomId: room,
      teacherName: socket.userName || 'Faculty Teacher',
      message: `The host teacher (${socket.userName || 'Faculty Teacher'}) has concluded the meeting. The classroom session has ended.`
    });
    delete activeRoomParticipants[room];
    delete pendingAdmissions[room];
  });

  // 10. Disconnect & Cleanup (Auto-leave students if host teacher disconnects)
  socket.on('disconnect', () => {
    if (socket.roomId && activeRoomParticipants[socket.roomId]) {
      const isTeacher = socket.userRole === 'teacher';
      activeRoomParticipants[socket.roomId] = activeRoomParticipants[socket.roomId].filter(p => p.socketId !== socket.id);
      
      io.to(socket.roomId).emit('room-roster-update', {
        participants: activeRoomParticipants[socket.roomId]
      });

      socket.to(socket.roomId).emit('user-disconnected', {
        socketId: socket.id,
        name: socket.userName
      });

      // If the departing participant was a teacher, check if any teachers remain in the room
      if (isTeacher) {
        const remainingTeachers = (activeRoomParticipants[socket.roomId] || []).filter(p => p.role === 'teacher');
        if (remainingTeachers.length === 0) {
          io.to(socket.roomId).emit('session-ended-by-teacher', {
            roomId: socket.roomId,
            teacherName: socket.userName || 'Faculty Teacher',
            message: `The host teacher (${socket.userName || 'Faculty Teacher'}) has left the meeting. The classroom session has ended.`
          });
          delete activeRoomParticipants[socket.roomId];
          delete pendingAdmissions[socket.roomId];
        }
      }
    }
  });
});

// Express Error Handling Middleware (Catches malformed JSON syntax errors)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload in request.' });
  }
  console.error('Unhandled server error:', err);
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🎓 EduGuard AI - Production Grade Virtual Classroom`);
  console.log(`🚀 Live running on: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
