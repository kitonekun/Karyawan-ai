import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, save } from './db.js';
import { ROLES } from './roles.js';
import { emptyTenant, UserError, newId, now } from './util.js';
import { MANAGER_NAME, ensureGreeting, handleManagerMessage, hireFromProposal, remainingQuota } from './manager.js';
import * as work from './work.js';
import { aiEnabled, chatAI } from './ai.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD belum diatur, memakai bawaan "admin123". Segera ganti untuk produksi.');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// Dikirim di setiap respons. Semua script ada di file terpisah sehingga CSP tidak perlu 'unsafe-inline' untuk script.
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};
const STARTED = Date.now();
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const sendJson = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 200_000) throw new UserError('Data terlalu besar', 413);
    chunks.push(c);
  }
  if (!chunks.length) return {};
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new UserError('JSON tidak valid'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UserError('JSON harus berupa objek');
  return data;
}

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));

// Cookie admin terpisah agar login panel penyedia tidak mengeluarkan login perusahaan di browser yang sama.
const TENANT_COOKIE = 'sid', ADMIN_COOKIE = 'asid';

function startSession(res, data, name = TENANT_COOKIE) {
  const token = crypto.randomBytes(24).toString('hex');
  const sessions = db().sessions;
  // Sesi kedaluwarsa dibuang di sini; tanpa ini setiap kunjungan demo menumpuk selamanya di db.json.
  for (const [k, v] of Object.entries(sessions)) if (Date.now() - Date.parse(v.at) > SESSION_MS) delete sessions[k];
  sessions[token] = { ...data, at: now() };
  save();
  res.setHeader('set-cookie', `${name}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
}

const SESSION_MS = 30 * 24 * 3600 * 1000;
function session(req, name = TENANT_COOKIE) {
  const sid = cookies(req)[name];
  const s = sid && Object.hasOwn(db().sessions, sid) ? db().sessions[sid] : null;
  if (!s) return null;
  if (Date.now() - Date.parse(s.at) > SESSION_MS) { delete db().sessions[sid]; return null; }
  return s;
}

const dropTenantSessions = (tenantId) => {
  const s = db().sessions;
  for (const [k, v] of Object.entries(s)) if (v.tenantId === tenantId) delete s[k];
};

// Batasi tebakan kode/sandi: 10 kali gagal per IP dalam 15 menit.
const failedLogins = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000, LOGIN_MAX = 10;
function clientIp(req) {
  const ip = req.socket.remoteAddress || '';
  // Di belakang reverse proxy lokal (Nginx), pakai IP asli dari X-Forwarded-For.
  const fwd = /^(::1|127\.|::ffff:127\.)/.test(ip) && req.headers['x-forwarded-for'];
  return fwd ? String(fwd).split(',')[0].trim() : ip;
}
function guardLogin(req) {
  const f = failedLogins.get(clientIp(req));
  if (f && Date.now() - f.since < LOGIN_WINDOW && f.count >= LOGIN_MAX) {
    throw new UserError('Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.', 429);
  }
}
function loginFailed(req, message) {
  const ip = clientIp(req);
  if (failedLogins.size > 10_000) {
    for (const [k, v] of failedLogins) if (Date.now() - v.since >= LOGIN_WINDOW) failedLogins.delete(k);
  }
  const f = failedLogins.get(ip);
  if (!f || Date.now() - f.since >= LOGIN_WINDOW) failedLogins.set(ip, { since: Date.now(), count: 1 });
  else f.count++;
  return new UserError(message, 401);
}

function currentTenant(req) {
  const s = session(req);
  const t = s?.tenantId && db().tenants.find((x) => x.id === s.tenantId);
  if (!t) throw new UserError('Silakan masuk dengan kode perusahaan', 401);
  if (!t.active) throw new UserError('Langganan perusahaan ini sedang nonaktif. Hubungi penyedia layanan.', 403);
  return t;
}

function requireAdmin(req) {
  if (!session(req, ADMIN_COOKIE)?.admin) throw new UserError('Khusus admin penyedia', 401);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const tenantView = (t) => {
  const { code, ...rest } = t;
  return { ...rest, remainingQuota: remainingQuota(t), roles: ROLES, managerName: MANAGER_NAME, aiEnabled: aiEnabled() };
};

const adminView = (t) => ({
  id: t.id, name: t.name, code: t.code, active: t.active, maxEmployees: t.maxEmployees, createdAt: t.createdAt,
  employees: t.employees.length, items: t.items.length, reports: t.reports.length,
});

const genCode = () => Array.from(crypto.randomBytes(8), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

function findEmployee(t, id) {
  const e = t.employees.find((x) => x.id === id);
  if (!e) throw new UserError('Karyawan tidak ditemukan', 404);
  return e;
}

// [method, pattern, handler(req, params, body, res)] — handler yang mengembalikan tenant mengirim state terbaru.
const routes = [
  // Untuk pemantauan uptime di VPS; sengaja tidak membuka data apa pun.
  ['GET', '/api/health', () => {
    db();
    return { status: 'ok', version: VERSION, uptimeSeconds: Math.round((Date.now() - STARTED) / 1000) };
  }],
  ['GET', '/api/config', () => ({ whatsapp: (process.env.CONTACT_WHATSAPP || '').replace(/\D/g, ''), aiEnabled: aiEnabled() })],
  ['POST', '/api/login', (req, p, body, res) => {
    guardLogin(req);
    const t = db().tenants.find((x) => safeEqual(x.code, String(body.code ?? '').trim().toUpperCase()));
    if (!t) throw loginFailed(req, 'Kode perusahaan tidak ditemukan');
    if (!t.active) throw new UserError('Langganan perusahaan ini sedang nonaktif.', 403);
    startSession(res, { tenantId: t.id });
    return { ok: true };
  }],
  ['POST', '/api/logout', (req, p, body, res) => {
    delete db().sessions[cookies(req).sid];
    save();
    res.setHeader('set-cookie', 'sid=; Path=/; Max-Age=0');
    return { ok: true };
  }],
  ['GET', '/api/state', (req) => {
    const t = currentTenant(req);
    ensureGreeting(t);
    return t;
  }],
  ['POST', '/api/manager/message', async (req, p, body) => {
    const t = currentTenant(req);
    const { message, understood } = handleManagerMessage(t, body.text);
    if (!understood && aiEnabled()) {
      const sys = `Kamu adalah ${MANAGER_NAME}, kepala pengelola karyawan AI untuk perusahaan "${t.name}". ` +
        'Tugasmu menanyakan berapa karyawan yang dibutuhkan, lalu mengusulkan nama dan pembagian tugas. ' +
        `Jabatan yang tersedia: ${Object.values(ROLES).map((r) => r.title).join(', ')}. ` +
        `Sisa kuota: ${remainingQuota(t)}. Jawab singkat dalam Bahasa Indonesia dan arahkan pengguna menyebutkan jumlah karyawan ` +
        '(jika sudah ada usulan, arahkan untuk mengetik "setuju" atau meminta perubahan).';
      const ai = await chatAI(sys, t.managerChat.slice(0, -2), body.text);
      if (ai) message.text = ai;
    }
    return t;
  }],
  ['POST', '/api/manager/hire', (req, p, body) => {
    const t = currentTenant(req);
    hireFromProposal(t, body.employees);
    return t;
  }],
  ['DELETE', '/api/employees/:id', (req, p) => {
    const t = currentTenant(req);
    const e = findEmployee(t, p.id);
    t.employees = t.employees.filter((x) => x !== e);
    t.managerChat.push({ id: newId(), from: 'manager', at: now(), text: `${e.name} (${ROLES[e.role].title}) telah diberhentikan. Sisa kuota: ${remainingQuota(t)} karyawan.` });
    return t;
  }],
  ['PUT', '/api/employees/:id', (req, p, body) => {
    const t = currentTenant(req);
    const e = findEmployee(t, p.id);
    if (Array.isArray(body.tasks)) {
      const tasks = body.tasks.map((x) => String(x).trim().slice(0, 200)).filter(Boolean);
      if (!tasks.length) throw new UserError('Minimal satu tugas');
      e.tasks = tasks;
    }
    return t;
  }],
  ['POST', '/api/employees/:id/run', (req, p) => {
    const t = currentTenant(req);
    work.runTask(t, findEmployee(t, p.id).id);
    return t;
  }],
  ['POST', '/api/run-all', (req) => {
    const t = currentTenant(req);
    if (!t.employees.length) throw new UserError('Belum ada karyawan');
    work.runAll(t);
    return t;
  }],
  ['POST', '/api/employees/:id/chat', async (req, p, body) => {
    const t = currentTenant(req);
    const e = findEmployee(t, p.id);
    const text = String(body.text ?? '').trim().slice(0, 1000);
    if (!text) throw new UserError('Pesan kosong');
    const sys = `Kamu adalah ${e.name}, ${ROLES[e.role].title} (karyawan AI) di perusahaan "${t.name}". ` +
      `Tugasmu: ${e.tasks.join('; ')}. Jawab dalam Bahasa Indonesia, ringkas dan profesional, hanya berdasarkan data perusahaan berikut. ` +
      `Jangan mengarang angka.\nDATA: ${JSON.stringify(work.snapshot(t))}`;
    const answer = (await chatAI(sys, e.chat, text)) ?? work.ruleBasedEmployeeReply(t, e, text);
    e.chat.push({ id: newId(), from: 'user', text, at: now() }, { id: newId(), from: 'employee', text: answer, at: now() });
    if (e.chat.length > 100) e.chat.splice(0, e.chat.length - 100);
    return t;
  }],
  ['POST', '/api/items', (req, p, body) => { const t = currentTenant(req); work.addItem(t, body); return t; }],
  ['DELETE', '/api/items/:id', (req, p) => { const t = currentTenant(req); work.removeItem(t, p.id); return t; }],
  ['POST', '/api/items/:id/move', (req, p, body) => { const t = currentTenant(req); work.moveStock(t, p.id, body); return t; }],
  ['POST', '/api/transactions', (req, p, body) => { const t = currentTenant(req); work.addTransaction(t, body); return t; }],
  ['POST', '/api/alerts/:id/resolve', (req, p) => {
    const t = currentTenant(req);
    const a = t.alerts.find((x) => x.id === p.id);
    if (!a) throw new UserError('Peringatan tidak ditemukan', 404);
    Object.assign(a, { resolved: true, resolvedAt: now() });
    return t;
  }],

  // Panel penyedia (pemilik layanan sewa)
  ['POST', '/api/admin/login', (req, p, body, res) => {
    guardLogin(req);
    if (!safeEqual(body.password ?? '', ADMIN_PASSWORD)) throw loginFailed(req, 'Kata sandi salah');
    startSession(res, { admin: true }, ADMIN_COOKIE);
    return { ok: true };
  }],
  ['GET', '/api/admin/tenants', (req) => { requireAdmin(req); return db().tenants.map(adminView); }],
  ['POST', '/api/admin/tenants', (req, p, body) => {
    requireAdmin(req);
    const name = String(body.name ?? '').trim().slice(0, 80);
    if (!name) throw new UserError('Nama perusahaan wajib diisi');
    const max = Number(body.maxEmployees ?? 5);
    if (!Number.isInteger(max) || max < 1 || max > 50) throw new UserError('Kuota karyawan 1–50');
    const t = emptyTenant({ name, code: genCode(), maxEmployees: max });
    db().tenants.push(t);
    return adminView(t);
  }],
  ['PATCH', '/api/admin/tenants/:id', (req, p, body) => {
    requireAdmin(req);
    const t = db().tenants.find((x) => x.id === p.id);
    if (!t) throw new UserError('Perusahaan tidak ditemukan', 404);
    if (typeof body.active === 'boolean') t.active = body.active;
    if (body.maxEmployees !== undefined) {
      const max = Number(body.maxEmployees);
      if (!Number.isInteger(max) || max < Math.max(1, t.employees.length) || max > 50) throw new UserError(`Kuota harus ${Math.max(1, t.employees.length)}–50`);
      t.maxEmployees = max;
    }
    if (body.regenerateCode) { t.code = genCode(); dropTenantSessions(t.id); }
    return adminView(t);
  }],
  ['DELETE', '/api/admin/tenants/:id', (req, p) => {
    requireAdmin(req);
    const s = db();
    s.tenants = s.tenants.filter((x) => x.id !== p.id);
    dropTenantSessions(p.id);
    return { ok: true };
  }],
];

function decodeParam(s) {
  try { return decodeURIComponent(s); } catch { throw new UserError('Alamat tidak valid'); }
}

function match(method, url) {
  for (const [m, pattern, fn] of routes) {
    if (m !== method) continue;
    const a = pattern.split('/'), b = url.split('/');
    if (a.length !== b.length) continue;
    const params = {};
    if (a.every((seg, i) => (seg.startsWith(':') ? ((params[seg.slice(1)] = decodeParam(b[i])), true) : seg === b[i]))) return [fn, params];
  }
  return null;
}

function serveStatic(req, res, pathname) {
  const pages = { '/': 'landing.html', '/kantor': 'index.html', '/admin': 'admin.html' };
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const rel = pages[clean] ?? clean.slice(1);
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Tidak ditemukan'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

export const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  // Semua penanganan di dalam try: satu request bermasalah tidak boleh mematikan server untuk semua penyewa.
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
    const found = match(req.method, pathname);
    if (!found) return sendJson(res, 404, { error: 'Endpoint tidak ditemukan' });
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const result = await found[0](req, found[1], body, res);
    if (req.method !== 'GET' || result?.managerChat) save();
    sendJson(res, 200, result?.managerChat ? tenantView(result) : result);
  } catch (err) {
    if (!(err instanceof UserError)) console.error(err);
    if (res.headersSent) return res.end();
    sendJson(res, err.status || 500, { error: err instanceof UserError ? err.message : 'Terjadi kesalahan server' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  db();
  server.listen(PORT, () => {
    console.log(`Kantor Karyawan AI berjalan di http://localhost:${PORT}  (aplikasi perusahaan: /kantor)`);
    console.log(`Panel penyedia: http://localhost:${PORT}/admin  |  Kode demo perusahaan: DEMO123`);
    console.log(aiEnabled() ? 'Mode AI aktif.' : 'Mode tanpa AI (atur AI_API_KEY untuk jawaban AI).');
  });
}
