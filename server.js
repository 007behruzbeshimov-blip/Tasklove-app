'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------------------
// Sozlamalar
// ---------------------------------------------------------------------------

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, 'tasklove.db');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const COOKIE_NAME = 'tasklove_session';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MODES = new Set(['solo', 'shared', 'open']);
const CATEGORIES = new Set(['date', 'care', 'home', 'adventure', 'surprise', 'other']);
const EMOJIS = new Set([
  '🌷', '🌹', '💌', '🦋', '🍒', '🌙', '🔥', '🐚', '🧸', '🍓',
  '🪐', '🕊️', '💋', '🐈‍⬛', '🌻', '🍷', '🎈', '🌵',
]);
const ACCENTS = new Set([
  '#b84a5f', '#d5684d', '#b7792e', '#4d846e',
  '#6968a8', '#975481', '#466b8a', '#b64d78',
]);

// ---------------------------------------------------------------------------
// Ma'lumotlar bazasi
// ---------------------------------------------------------------------------

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    emoji         TEXT NOT NULL DEFAULT '🌷',
    accent        TEXT NOT NULL DEFAULT '#b84a5f',
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS tasks (
    id             TEXT PRIMARY KEY,
    creator_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    mode           TEXT NOT NULL CHECK (mode IN ('solo', 'shared', 'open')),
    category       TEXT NOT NULL DEFAULT 'other',
    due_date       TEXT,
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
    completed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    completer_name TEXT,
    completed_at   TEXT,
    created_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);

  CREATE TABLE IF NOT EXISTS task_participants (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_participants_user ON task_participants(user_id);

  CREATE TABLE IF NOT EXISTS completions (
    id            TEXT PRIMARY KEY,
    task_id       TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_title    TEXT NOT NULL,
    creator_name  TEXT NOT NULL,
    task_mode     TEXT NOT NULL,
    task_category TEXT NOT NULL,
    points        INTEGER NOT NULL DEFAULT 1 CHECK (points >= 0),
    completed_at  TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_completions_one_per_task
    ON completions(task_id) WHERE task_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_completions_user ON completions(user_id, completed_at);
  CREATE INDEX IF NOT EXISTS idx_completions_date ON completions(completed_at);
`);

const statements = {
  sessionByHash: db.prepare(`
    SELECT s.expires_at, u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  createSession: db.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `),
  usersWithPoints: db.prepare(`
    SELECT
      u.id, u.username, u.display_name, u.bio, u.emoji, u.accent, u.created_at,
      COALESCE(SUM(c.points), 0) AS points,
      COUNT(c.id) AS completed_count
    FROM users u
    LEFT JOIN completions c ON c.user_id = u.id
    GROUP BY u.id
    ORDER BY points DESC, completed_count DESC, u.created_at ASC
  `),
  tasksWithUsers: db.prepare(`
    SELECT
      t.*,
      creator.username AS creator_username,
      creator.display_name AS creator_display_name,
      creator.emoji AS creator_emoji,
      creator.accent AS creator_accent,
      completer.username AS completer_username,
      completer.display_name AS completer_display_name,
      completer.emoji AS completer_emoji,
      completer.accent AS completer_accent
    FROM tasks t
    JOIN users creator ON creator.id = t.creator_id
    LEFT JOIN users completer ON completer.id = t.completed_by
    ORDER BY
      CASE WHEN t.status = 'active' THEN 0 ELSE 1 END,
      t.created_at DESC
  `),
  allParticipants: db.prepare(`
    SELECT
      tp.task_id,
      u.id, u.username, u.display_name, u.emoji, u.accent
    FROM task_participants tp
    JOIN users u ON u.id = tp.user_id
    ORDER BY u.display_name COLLATE NOCASE ASC
  `),
  allCompletions: db.prepare(`
    SELECT id, user_id, task_id, task_title, creator_name, task_mode, task_category, points, completed_at
    FROM completions
    ORDER BY completed_at DESC
  `),
  taskById: db.prepare(`
    SELECT t.*, u.display_name AS creator_display_name, u.username AS creator_username
    FROM tasks t
    JOIN users u ON u.id = t.creator_id
    WHERE t.id = ?
  `),
  participantsOfTask: db.prepare('SELECT user_id FROM task_participants WHERE task_id = ?'),
  insertUser: db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, bio, emoji, accent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateUserProfile: db.prepare(`
    UPDATE users SET display_name = ?, bio = ?, emoji = ?, accent = ? WHERE id = ?
  `),
  insertTask: db.prepare(`
    INSERT INTO tasks (id, creator_id, title, description, mode, category, due_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertParticipant: db.prepare('INSERT INTO task_participants (task_id, user_id) VALUES (?, ?)'),
  completeTask: db.prepare(`
    UPDATE tasks
    SET status = 'completed', completed_by = ?, completer_name = ?, completed_at = ?
    WHERE id = ? AND status = 'active'
  `),
  insertCompletion: db.prepare(`
    INSERT INTO completions
      (id, task_id, user_id, task_title, creator_name, task_mode, task_category, points, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `),
  deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  deleteTasksByCreator: db.prepare('DELETE FROM tasks WHERE creator_id = ?'),
  deleteMyParticipations: db.prepare('DELETE FROM task_participants WHERE user_id = ?'),
  participantCount: db.prepare('SELECT COUNT(*) AS count FROM task_participants WHERE task_id = ?'),
  activeTasksForParticipant: db.prepare(`
    SELECT t.id, t.mode
    FROM tasks t
    JOIN task_participants tp ON tp.task_id = t.id
    WHERE tp.user_id = ? AND t.status = 'active' AND t.creator_id <> ?
  `),
};

// ---------------------------------------------------------------------------
// Kichik yordamchilar
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const nowIso = () => new Date().toISOString();
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomId = () => crypto.randomUUID();
const randomToken = () => crypto.randomBytes(32).toString('base64url');

function parseCookies(header = '') {
  const result = {};
  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=');
    if (index < 0) continue;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function passwordMatches(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Parol mavjud bo'lmagan holatda ham taxminan bir xil vaqt sarflash uchun.
const DUMMY_PASSWORD_HASH = passwordHash('this-is-only-a-timing-placeholder');

function cleanText(value, { field, min = 0, max, required = true }) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} to'ldirilishi kerak.`);
    return '';
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} matn bo'lishi kerak.`);
  const text = value.trim();
  if (required && text.length < min) {
    throw new HttpError(400, `${field} kamida ${min} belgidan iborat bo'lishi kerak.`);
  }
  if (text.length > max) throw new HttpError(400, `${field} ${max} belgidan oshmasligi kerak.`);
  return text;
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    bio: row.bio || '',
    emoji: row.emoji || '🌷',
    accent: row.accent || '#b84a5f',
    created_at: row.created_at,
    points: Number(row.points || 0),
    completed_count: Number(row.completed_count || 0),
  };
}

function miniUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    emoji: row.emoji || '🌷',
    accent: row.accent || '#b84a5f',
  };
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sessionCookie(token, req) {
  const isSecure = process.env.COOKIE_SECURE === '1'
    || req.headers['x-forwarded-proto'] === 'https';
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure ? '; Secure' : ''}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getAuth(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const tokenHash = sha256(token);
  const row = statements.sessionByHash.get(tokenHash);
  if (!row) return null;

  if (Date.parse(row.expires_at) <= Date.now()) {
    statements.deleteSession.run(tokenHash);
    return null;
  }

  return { token, tokenHash, user: row };
}

function requireAuth(req) {
  const auth = getAuth(req);
  if (!auth) throw new HttpError(401, 'Avval hisobingizga kiring.');
  return auth;
}

function assertSameOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    const parsed = new URL(origin);
    if (parsed.host !== req.headers.host) {
      throw new HttpError(403, "So'rov boshqa manbadan yuborilgan.");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "Noto'g'ri so'rov manbasi.");
  }
}

async function readJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "So'rov hajmi juda katta.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new HttpError(400, "So'rov ma'lumotlari noto'g'ri.");
  }
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

const rateBuckets = new Map();

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new HttpError(429, "Juda ko'p urinish. Birozdan so'ng qayta harakat qiling.");
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Real-vaqt (Server-Sent Events)
// ---------------------------------------------------------------------------

const sseClients = new Set();
let presenceTimer = null;

function sseWrite(res, event, payload) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // Buzilgan ulanish keyingi tozalashda olib tashlanadi.
  }
}

function broadcast(event, payload) {
  for (const client of sseClients) {
    sseWrite(client.res, event, payload);
  }
}

function onlineUserIds() {
  return [...new Set([...sseClients].map((client) => client.userId))];
}

function schedulePresence() {
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    broadcast('presence', { onlineUserIds: onlineUserIds() });
  }, 80);
  presenceTimer.unref?.();
}

function broadcastSync(data) {
  broadcast('sync', { ...data, at: nowIso() });
}

function closeStreams({ userId = null, tokenHash = null } = {}) {
  for (const client of sseClients) {
    const matches = (userId && client.userId === userId)
      || (tokenHash && client.tokenHash === tokenHash);
    if (!matches) continue;
    try {
      client.res.end();
    } catch {
      // ulanish allaqachon yopilgan
    }
    sseClients.delete(client);
  }
  schedulePresence();
}

function handleEvents(req, res) {
  const auth = requireAuth(req);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2500\n\n');

  const client = {
    res,
    userId: auth.user.id,
    tokenHash: auth.tokenHash,
    connectedAt: Date.now(),
  };
  sseClients.add(client);

  sseWrite(res, 'ready', {
    onlineUserIds: onlineUserIds(),
    serverTime: nowIso(),
  });
  schedulePresence();

  const cleanup = () => {
    if (!sseClients.has(client)) return;
    sseClients.delete(client);
    schedulePresence();
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

setInterval(() => {
  for (const client of sseClients) {
    try {
      client.res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
  schedulePresence();
}, 20_000).unref();

// Har daqiqada muddati o'tgan sessiyalarni tozalash.
setInterval(() => {
  try {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
  } catch (error) {
    console.error('Sessiyalarni tozalashda xato:', error);
  }
}, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Holat (state)
// ---------------------------------------------------------------------------

function buildState(auth) {
  const rawUsers = statements.usersWithPoints.all();
  const users = rawUsers.map(publicUser);
  const me = users.find((user) => user.id === auth.user.id);

  if (!me) throw new HttpError(401, 'Hisob topilmadi.');

  const participantRows = statements.allParticipants.all();
  const participantsByTask = new Map();
  for (const row of participantRows) {
    if (!participantsByTask.has(row.task_id)) participantsByTask.set(row.task_id, []);
    participantsByTask.get(row.task_id).push(miniUser(row));
  }

  const tasks = statements.tasksWithUsers.all().map((row) => {
    const participants = participantsByTask.get(row.id) || [];
    const participantIds = new Set(participants.map((participant) => participant.id));
    const isCreator = row.creator_id === me.id;
    const isParticipant = participantIds.has(me.id);
    const canComplete = row.status === 'active'
      && !isCreator
      && (row.mode === 'open' || isParticipant);

    const completer = row.completed_by
      ? {
          id: row.completed_by,
          username: row.completer_username,
          display_name: row.completer_display_name,
          emoji: row.completer_emoji || '🕊️',
          accent: row.completer_accent || '#8a7770',
        }
      : row.completer_name
        ? {
            id: null,
            username: null,
            display_name: row.completer_name,
            emoji: '🕊️',
            accent: '#8a7770',
          }
        : null;

    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      mode: row.mode,
      category: row.category,
      due_date: row.due_date,
      status: row.status,
      created_at: row.created_at,
      completed_at: row.completed_at,
      creator: {
        id: row.creator_id,
        username: row.creator_username,
        display_name: row.creator_display_name,
        emoji: row.creator_emoji,
        accent: row.creator_accent,
      },
      participants,
      participant_ids: [...participantIds],
      completer,
      can_complete: canComplete,
      can_delete: isCreator && row.status === 'active',
      is_creator: isCreator,
      is_participant: isParticipant,
    };
  });

  const completions = statements.allCompletions.all().map((row) => ({
    id: row.id,
    user_id: row.user_id,
    task_id: row.task_id,
    task_title: row.task_title,
    creator_name: row.creator_name,
    task_mode: row.task_mode,
    task_category: row.task_category,
    points: Number(row.points),
    completed_at: row.completed_at,
  }));

  const onlineIds = onlineUserIds();
  const totalPoints = users.reduce((sum, user) => sum + user.points, 0);
  const activeTasks = tasks.filter((task) => task.status === 'active').length;
  const completedTasks = tasks.filter((task) => task.status === 'completed').length;

  return {
    me,
    users,
    tasks,
    completions,
    onlineUserIds: onlineIds,
    stats: {
      totalUsers: users.length,
      totalPoints,
      activeTasks,
      completedTasks,
      myCompleted: me.completed_count,
    },
    serverTime: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function handleRegister(req, res, body) {
  rateLimit(`register:${clientIp(req)}`, 8, 60 * 60 * 1000);

  const name = cleanText(body.name, { field: 'Ism', min: 2, max: 40 });
  const usernameRaw = cleanText(body.username, { field: 'Taxallus', min: 3, max: 20 })
    .toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  if (!USERNAME_RE.test(usernameRaw)) {
    throw new HttpError(
      400,
      "Taxallus 3–20 belgidan iborat bo'lib, faqat lotin harflari, raqamlar va pastki chiziqdan (_) tashkil topishi kerak.",
    );
  }
  if (password.length < 8) throw new HttpError(400, "Parol kamida 8 belgidan iborat bo'lishi kerak.");
  if (password.length > 128) throw new HttpError(400, "Parol juda uzun.");

  if (statements.userByUsername.get(usernameRaw)) {
    throw new HttpError(409, 'Bu taxallus allaqachon band. Boshqasini tanlang.');
  }

  const id = randomId();
  const createdAt = nowIso();
  const emoji = [...EMOJIS][Math.floor(Math.random() * EMOJIS.size)];
  const accent = [...ACCENTS][Math.floor(Math.random() * ACCENTS.size)];
  const bio = 'Hali bu yerda biror so‘z yozilmagan. Lekin kim biladi…';

  try {
    statements.insertUser.run(
      id,
      usernameRaw,
      passwordHash(password),
      name,
      bio,
      emoji,
      accent,
      createdAt,
    );
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      throw new HttpError(409, 'Bu taxallus allaqachon band. Boshqasini tanlang.');
    }
    throw error;
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  statements.createSession.run(sha256(token), id, createdAt, expiresAt);

  res.setHeader('Set-Cookie', sessionCookie(token, req));
  broadcastSync({
    kind: 'user.joined',
    actorId: id,
    actorName: name,
  });

  return sendJson(res, 201, {
    user: {
      id,
      username: usernameRaw,
      display_name: name,
      emoji,
      accent,
      bio,
    },
  });
}

async function handleLogin(req, res, body) {
  rateLimit(`login:${clientIp(req)}`, 30, 10 * 60 * 1000);

  const usernameRaw = cleanText(body.username, { field: 'Taxallus', max: 20 }).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  const user = statements.userByUsername.get(usernameRaw);
  const ok = passwordMatches(password, user?.password_hash || DUMMY_PASSWORD_HASH) && Boolean(user);
  if (!ok) throw new HttpError(401, "Taxallus yoki parol noto'g'ri.");

  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const token = randomToken();
  statements.createSession.run(sha256(token), user.id, createdAt, expiresAt);

  // Eski sinib qolgan sessiyalarni vaqti-vaqti bilan olib tashlaymiz.
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(createdAt);

  res.setHeader('Set-Cookie', sessionCookie(token, req));
  return sendJson(res, 200, {
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      emoji: user.emoji,
      accent: user.accent,
      bio: user.bio,
    },
  });
}

async function handleLogout(req, res) {
  const auth = getAuth(req);
  if (auth) {
    statements.deleteSession.run(auth.tokenHash);
    closeStreams({ tokenHash: auth.tokenHash });
  }
  res.setHeader('Set-Cookie', clearSessionCookie());
  schedulePresence();
  return sendJson(res, 200, { ok: true });
}

async function handleCreateTask(req, res, auth, body) {
  const title = cleanText(body.title, { field: 'Vazifa nomi', min: 3, max: 100 });
  const description = cleanText(body.description, {
    field: 'Tavsif',
    max: 600,
    required: false,
  });
  const mode = String(body.mode || '');
  if (!MODES.has(mode)) throw new HttpError(400, "Vazifa turi noto'g'ri.");

  const category = String(body.category || 'other');
  if (!CATEGORIES.has(category)) throw new HttpError(400, "Vazifa bo'limi noto'g'ri.");

  let dueDate = null;
  if (body.due_date !== undefined && body.due_date !== null && body.due_date !== '') {
    if (typeof body.due_date !== 'string' || !DATE_RE.test(body.due_date)) {
      throw new HttpError(400, "Muddat noto'g'ri formatda.");
    }
    const date = new Date(`${body.due_date}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== body.due_date) {
      throw new HttpError(400, "Muddat sanasi mavjud emas.");
    }
    dueDate = body.due_date;
  }

  let participantIds = Array.isArray(body.participant_ids) ? body.participant_ids : [];
  participantIds = [...new Set(participantIds.filter((id) => typeof id === 'string' && id))];

  if (participantIds.length > 50) throw new HttpError(400, "Juda ko'p ishtirokchi tanlandi.");
  if (mode === 'solo' && participantIds.length !== 1) {
    throw new HttpError(400, 'Shaxsiy vazifa uchun bitta odamni tanlang.');
  }
  if (mode === 'shared' && participantIds.length < 1) {
    throw new HttpError(400, "Birgalikdagi vazifa uchun kamida bitta odamni tanlang.");
  }
  if (participantIds.includes(auth.user.id)) {
    throw new HttpError(400, "O'zingizga vazifa tashlay olmaysiz.");
  }

  if (mode !== 'open') {
    const found = [];
    for (const id of participantIds) {
      const user = statements.userById.get(id);
      if (!user) throw new HttpError(400, 'Tanlangan odamlardan biri topilmadi.');
      found.push(user);
    }
    participantIds = found.map((user) => user.id);
  } else {
    participantIds = [];
  }

  const taskId = randomId();
  const createdAt = nowIso();

  db.exec('BEGIN IMMEDIATE');
  try {
    statements.insertTask.run(
      taskId,
      auth.user.id,
      title,
      description,
      mode,
      category,
      dueDate,
      createdAt,
    );
    for (const userId of participantIds) {
      statements.insertParticipant.run(taskId, userId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  broadcastSync({
    kind: 'task.created',
    actorId: auth.user.id,
    actorName: auth.user.display_name,
    taskId,
    title,
    mode,
    recipients: participantIds,
  });

  return sendJson(res, 201, { taskId });
}

async function handleCompleteTask(res, auth, taskId) {
  const task = statements.taskById.get(taskId);
  if (!task) throw new HttpError(404, 'Bunday vazifa topilmadi.');
  if (task.status === 'completed') {
    throw new HttpError(409, 'Bu vazifa allaqachon yakunlangan. Kimdir sizdan tezroq bo‘ldi.');
  }
  if (task.creator_id === auth.user.id) {
    throw new HttpError(403, "O'z vazifangizni o'zingiz bajara olmaysiz. Bu o'yin qoidasi.");
  }

  const participantIds = statements.participantsOfTask.all(task.id).map((row) => row.user_id);
  if (task.mode !== 'open' && !participantIds.includes(auth.user.id)) {
    throw new HttpError(403, "Bu vazifa sizga tegishli emas.");
  }

  const completedAt = nowIso();
  const completionId = randomId();

  db.exec('BEGIN IMMEDIATE');
  try {
    // Vazifa shu tranzaksiya ichida qayta o'qiladi — ikki kishi bir paytda
    // bosgan bo'lsa ham faqat bittasi g'olib bo'ladi.
    const fresh = statements.taskById.get(taskId);
    if (!fresh || fresh.status !== 'active') {
      throw new HttpError(409, 'Bu vazifa allaqachon yakunlangan. Kimdir sizdan tezroq bo‘ldi.');
    }

    const freshParticipants = statements.participantsOfTask
      .all(taskId)
      .map((row) => row.user_id);
    if (fresh.mode !== 'open' && !freshParticipants.includes(auth.user.id)) {
      throw new HttpError(403, "Bu vazifa sizga tegishli emas.");
    }

    const result = statements.completeTask.run(
      auth.user.id,
      auth.user.display_name,
      completedAt,
      taskId,
    );
    if (result.changes !== 1) {
      throw new HttpError(409, 'Bu vazifa allaqachon yakunlangan. Kimdir sizdan tezroq bo‘ldi.');
    }

    statements.insertCompletion.run(
      completionId,
      taskId,
      auth.user.id,
      fresh.title,
      fresh.creator_display_name,
      fresh.mode,
      fresh.category,
      completedAt,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  broadcastSync({
    kind: 'task.completed',
    actorId: auth.user.id,
    actorName: auth.user.display_name,
    taskId,
    title: task.title,
    mode: task.mode,
    recipients: [...new Set([task.creator_id, ...participantIds])],
  });

  return sendJson(res, 200, { ok: true, pointsEarned: 1 });
}

async function handleDeleteTask(res, auth, taskId) {
  const task = statements.taskById.get(taskId);
  if (!task) throw new HttpError(404, 'Bunday vazifa topilmadi.');
  if (task.creator_id !== auth.user.id) {
    throw new HttpError(403, "Faqat o'zingiz yaratgan vazifani o'chira olasiz.");
  }
  if (task.status === 'completed') {
    throw new HttpError(409, "Bajarilgan vazifa tarixni saqlash uchun o'chirilmaydi.");
  }

  const participantIds = statements.participantsOfTask.all(taskId).map((row) => row.user_id);
  statements.deleteTask.run(taskId);
  broadcastSync({
    kind: 'task.deleted',
    actorId: auth.user.id,
    actorName: auth.user.display_name,
    taskId,
    title: task.title,
    recipients: participantIds,
  });
  return sendJson(res, 200, { ok: true });
}

async function handleUpdateProfile(req, res, auth, body) {
  const current = statements.userById.get(auth.user.id);
  if (!current) throw new HttpError(401, 'Hisob topilmadi.');

  const displayName = body.display_name === undefined
    ? current.display_name
    : cleanText(body.display_name, { field: 'Ism', min: 2, max: 40 });
  const bio = body.bio === undefined
    ? current.bio
    : cleanText(body.bio, { field: 'Bio', max: 180, required: false });
  const emoji = body.emoji === undefined ? current.emoji : String(body.emoji);
  const accent = body.accent === undefined ? current.accent : String(body.accent);

  if (!EMOJIS.has(emoji)) throw new HttpError(400, "Avatar belgisi noto'g'ri.");
  if (!ACCENTS.has(accent)) throw new HttpError(400, "Rang noto'g'ri.");

  statements.updateUserProfile.run(displayName, bio, emoji, accent, auth.user.id);
  broadcastSync({
    kind: 'profile.updated',
    actorId: auth.user.id,
    actorName: displayName,
  });

  return sendJson(res, 200, { ok: true });
}

async function handleDeleteAccount(req, res, auth, body) {
  const password = typeof body.password === 'string' ? body.password : '';
  const confirm = typeof body.confirm === 'string' ? body.confirm.trim() : '';

  const me = statements.userById.get(auth.user.id);
  if (!me || !passwordMatches(password, me.password_hash)) {
    throw new HttpError(403, "Parol noto'g'ri.");
  }
  if (confirm !== me.username) {
    throw new HttpError(400, "Tasdiqlash uchun taxallusingizni to'liq yozing.");
  }

  const taskCount = db
    .prepare('SELECT COUNT(*) AS count FROM tasks WHERE creator_id = ?')
    .get(me.id).count;

  db.exec('BEGIN IMMEDIATE');
  try {
    // Foydalanuvchi yaratgan vazifalar butunlay o'chadi. Ularni boshqalar
    // bajargan bo'lsa, ularning tarixi completions jadvalida saqlanib qoladi
    // (task_id NULL bo'ladi), shunda boshqa odamlarning ballari yo'qolmaydi.
    statements.deleteTasksByCreator.run(me.id);

    // Boshqalar yaratgan, tugallanmagan vazifalardagi ishtirokni olib tashlaymiz.
    const activeAssigned = statements.activeTasksForParticipant.all(me.id, me.id);
    statements.deleteMyParticipations.run(me.id);

    for (const task of activeAssigned) {
      const remaining = Number(statements.participantCount.get(task.id).count);
      if (remaining === 0 && task.mode !== 'open') {
        statements.deleteTask.run(task.id);
      }
    }

    // sessions, bajargan tasklar tarixi va boshqa bog'lanishlar CASCADE / SET NULL
    // qoidalari orqali o'chadi. Boshqalar bajargan vazifalarning nusxalari qoladi.
    statements.deleteUser.run(me.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  closeStreams({ userId: me.id });
  res.setHeader('Set-Cookie', clearSessionCookie());
  broadcastSync({
    kind: 'user.deleted',
    actorId: me.id,
    actorName: me.display_name,
    deletedTaskCount: Number(taskCount),
  });
  schedulePresence();

  return sendJson(res, 200, { ok: true });
}

async function handleApi(req, res, url) {
  setSecurityHeaders(res);
  assertSameOrigin(req);

  const route = url.pathname;
  const method = req.method;

  if (route === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      name: 'tasklove',
      time: nowIso(),
    });
  }

  if (route === '/api/auth/register' && method === 'POST') {
    return handleRegister(req, res, await readJson(req));
  }

  if (route === '/api/auth/login' && method === 'POST') {
    return handleLogin(req, res, await readJson(req));
  }

  if (route === '/api/auth/logout' && method === 'POST') {
    return handleLogout(req, res);
  }

  if (route === '/api/events' && method === 'GET') {
    return handleEvents(req, res);
  }

  const auth = requireAuth(req);

  if (route === '/api/state' && method === 'GET') {
    return sendJson(res, 200, buildState(auth));
  }

  if (route === '/api/auth/me' && method === 'GET') {
    const state = buildState(auth);
    return sendJson(res, 200, state.me);
  }

  if (route === '/api/profile' && (method === 'PATCH' || method === 'PUT')) {
    return handleUpdateProfile(req, res, auth, await readJson(req));
  }

  if (route === '/api/account' && method === 'DELETE') {
    return handleDeleteAccount(req, res, auth, await readJson(req));
  }

  if (route === '/api/tasks' && method === 'POST') {
    return handleCreateTask(req, res, auth, await readJson(req));
  }

  const completeMatch = route.match(/^\/api\/tasks\/([a-f0-9-]+)\/complete$/);
  if (completeMatch && method === 'POST') {
    return handleCompleteTask(res, auth, completeMatch[1]);
  }

  const deleteMatch = route.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
  if (deleteMatch && method === 'DELETE') {
    return handleDeleteTask(res, auth, deleteMatch[1]);
  }

  throw new HttpError(404, 'Bunday API manzili mavjud emas.');
}

// ---------------------------------------------------------------------------
// Statik fayllar
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return sendJson(res, 405, { error: 'Bu usul qo‘llab-quvvatlanmaydi.' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(res, 400, { error: 'Manzil noto‘g‘ri.' });
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return sendJson(res, 403, { error: 'Ruxsat yo‘q.' });
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return sendJson(res, 404, { error: 'Fayl topilmadi.' });
  }
  if (!stat.isFile()) return sendJson(res, 404, { error: 'Fayl topilmadi.' });

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const cacheControl = ext === '.woff2'
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';

  setSecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
    'Last-Modified': stat.mtime.toUTCString(),
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    const url = new URL(req.url || '/', `http://${host}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    if (res.headersSent) {
      try {
        res.end();
      } catch {
        // nothing
      }
      return;
    }

    setSecurityHeaders(res);
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }

    console.error('Kutilmagan xato:', error);
    sendJson(res, 500, { error: 'Serverda kutilmagan xato yuz berdi.' });
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 65_000;

server.listen(PORT, HOST, () => {
  const shownHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n  tasklove. tayyor — http://${shownHost}:${PORT}`);
  console.log(`  Ma'lumotlar: ${DB_PATH}\n`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} band. Boshqa PORT bilan urinib ko'ring.`);
  } else {
    console.error('Server xatosi:', error);
  }
  process.exit(1);
});

function shutdown() {
  console.log('\n  Server yopilmoqda…');
  for (const client of sseClients) {
    try {
      client.res.end();
    } catch {
      // ignore
    }
  }
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
