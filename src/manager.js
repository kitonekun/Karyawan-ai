import { ROLES, DEFAULT_ORDER, NAMES, isRole } from './roles.js';
import { newId, now, UserError } from './util.js';
import { checkLowStock } from './work.js';

export const MANAGER_NAME = 'Pak Bima';
const MAX_NEW = 20;

const WORDS = { satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11, seorang: 1 };

export function parseCount(text) {
  const m = text.match(/\b(\d{1,3})\b/);
  if (m) return Number(m[1]);
  const s = text.toLowerCase();
  for (const [w, n] of Object.entries(WORDS)) if (new RegExp(`\\b${w}\\b`).test(s)) return n;
  return null;
}

/** Peran yang disebut dalam teks, urut sesuai posisi kemunculannya. */
export function rolesMentioned(text) {
  const s = text.toLowerCase();
  return DEFAULT_ORDER
    .map((r) => ({ r, pos: Math.min(...ROLES[r].keywords.map((k) => { const m = s.match(new RegExp(`\\b${k}`)); return m ? m.index : Infinity; })) }))
    .filter((x) => x.pos < Infinity)
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.r);
}

export const remainingQuota = (t) => Math.max(t.maxEmployees - t.employees.length, 0);

export function proposeTeam(t, count, needsText = '') {
  const wanted = rolesMentioned(needsText);
  const have = new Set(t.employees.map((e) => e.role));
  const rest = DEFAULT_ORDER.filter((r) => !wanted.includes(r));
  // Peran yang diminta dulu, lalu peran yang belum dimiliki, lalu sisanya.
  const order = [...wanted, ...rest.filter((r) => !have.has(r)), ...rest.filter((r) => have.has(r))];
  const usedNames = new Set(t.employees.map((e) => e.name));
  const names = NAMES.filter((n) => !usedNames.has(n));
  return Array.from({ length: count }, (_, i) => {
    const role = order[i % order.length];
    return { name: names[i] ?? `Karyawan ${t.employees.length + i + 1}`, role, tasks: [...ROLES[role].tasks] };
  });
}

const letter = (i) => String.fromCharCode(65 + i);

function proposalText(team) {
  const lines = team.map((e, i) => `${letter(i)}. ${e.name} — ${ROLES[e.role].icon} ${ROLES[e.role].title}\n${e.tasks.map((x) => `   • ${x}`).join('\n')}`);
  return `Saya sudah siapkan ${team.length} karyawan untuk Anda:\n\n${lines.join('\n\n')}\n\n` +
    'Ketik "setuju" untuk merekrut, atau minta perubahan, misalnya "ganti B jadi pemasaran" atau "fokus penjualan dan promosi". ' +
    'Anda juga bisa mengubah nama, jabatan, dan tugas langsung di kartu usulan.';
}

function msg(from, text, extra = {}) {
  return { id: newId(), from, text, at: now(), ...extra };
}

export function greeting(t) {
  return `Halo! Saya ${MANAGER_NAME}, Kepala Pengelola Karyawan AI di kantor ${t.name}. ` +
    `Anda butuh berapa karyawan? (sisa kuota paket Anda: ${remainingQuota(t)} karyawan)`;
}

export function ensureGreeting(t) {
  if (!t.managerChat.length) t.managerChat.push(msg('manager', greeting(t)));
}

function teamSummary(t) {
  if (!t.employees.length) return 'Belum ada karyawan. Sebutkan berapa karyawan yang Anda butuhkan.';
  const open = t.alerts.filter((a) => !a.resolved).length;
  return `Tim Anda saat ini (${t.employees.length} orang):\n` +
    t.employees.map((e) => `• ${e.name} — ${ROLES[e.role].title}`).join('\n') +
    `\n\nPeringatan stok terbuka: ${open}. Sisa kuota: ${remainingQuota(t)} karyawan. ` +
    'Sebutkan jumlah jika ingin menambah karyawan.';
}

function makeProposal(t, count, text) {
  const left = remainingQuota(t);
  if (count < 1) return { text: 'Jumlah karyawan minimal 1.' };
  if (count > Math.min(left, MAX_NEW)) {
    return { text: left === 0
      ? `Kuota paket Anda (${t.maxEmployees} karyawan) sudah penuh. Hubungi penyedia layanan untuk upgrade paket.`
      : `Paket Anda hanya menyisakan ${left} karyawan. Silakan sebutkan jumlah maksimal ${left}.` };
  }
  const team = proposeTeam(t, count, text);
  t.managerState = { step: 'proposal', count, proposal: team };
  return { text: proposalText(team), proposal: team };
}

const YES = /^(ya|iya|y|ok|oke|okay|setuju|lanjut|rekrut|deal|sip|siap|gas)\b/i;
const CANCEL = /^(batal|tidak|nggak|gak|cancel|ulang)\b/i;
const CHANGE = /(?:ganti|ubah)\s+(\S+)\s+(?:jadi|menjadi|ke|sebagai)\s+(.+)/i;

/**
 * Proses pesan pengguna ke kepala pengelola.
 * understood=false artinya boleh dijawab AI (jika tersedia).
 */
export function handleManagerMessage(t, rawText) {
  const text = String(rawText ?? '').trim().slice(0, 1000);
  if (!text) throw new UserError('Pesan kosong');
  ensureGreeting(t);
  t.managerChat.push(msg('user', text));
  const reply = (r, understood = true) => {
    const m = msg('manager', r.text, r.proposal ? { proposal: r.proposal } : {});
    t.managerChat.push(m);
    if (t.managerChat.length > 200) t.managerChat.splice(0, t.managerChat.length - 200);
    return { message: m, understood };
  };
  const st = t.managerState;

  if (st.step === 'proposal') {
    // Permintaan ubah dicek lebih dulu: "oke ganti B jadi gudang" tidak boleh langsung merekrut.
    const ch = text.match(CHANGE);
    if (!ch && YES.test(text)) return reply({ text: hire(t, st.proposal) });
    if (!ch && CANCEL.test(text)) {
      t.managerState = { step: 'ask_count' };
      return reply({ text: 'Baik, usulan dibatalkan. Kalau butuh karyawan lagi, sebutkan saja jumlahnya.' });
    }
    if (ch) {
      const key = ch[1].toLowerCase();
      const idx = st.proposal.findIndex((e, i) => e.name.toLowerCase() === key || letter(i).toLowerCase() === key);
      const [role] = rolesMentioned(ch[2]);
      if (idx < 0) return reply({ text: `Saya tidak menemukan karyawan "${ch[1]}" di usulan. Gunakan huruf (A, B, ...) atau namanya.` });
      if (!role) return reply({ text: `Jabatan "${ch[2]}" belum tersedia. Pilihan: ${Object.values(ROLES).map((r) => r.title).join(', ')}.` });
      st.proposal[idx] = { ...st.proposal[idx], role, tasks: [...ROLES[role].tasks] };
      return reply({ text: proposalText(st.proposal), proposal: st.proposal });
    }
    const count = parseCount(text);
    if (count !== null || rolesMentioned(text).length) return reply(makeProposal(t, count ?? st.count, text));
    return reply({ text: 'Ketik "setuju" untuk merekrut tim di atas, "batal" untuk membatalkan, atau sebutkan kebutuhan Anda agar saya susun ulang.' }, false);
  }

  const count = parseCount(text);
  if (count !== null) return reply(makeProposal(t, count, text));
  if (/tim|karyawan|status|laporan|ringkas/i.test(text)) return reply({ text: teamSummary(t) });
  if (rolesMentioned(text).length) {
    return reply({ text: `Siap, saya catat kebutuhan Anda. Berapa karyawan yang Anda butuhkan? (sisa kuota: ${remainingQuota(t)})` }, false);
  }
  return reply({ text: `Anda butuh berapa karyawan? Jawab dengan angka, misalnya "3" atau "3 karyawan untuk stok gudang dan keuangan". Sisa kuota: ${remainingQuota(t)}.` }, false);
}

export function hire(t, team) {
  if (!Array.isArray(team) || !team.length) throw new UserError('Usulan karyawan kosong');
  if (team.length > remainingQuota(t)) throw new UserError(`Melebihi kuota. Sisa kuota: ${remainingQuota(t)} karyawan`);
  const names = new Set(t.employees.map((e) => e.name.toLowerCase()));
  const clean = team.map((e) => {
    const name = String(e?.name ?? '').trim().slice(0, 40);
    if (!name) throw new UserError('Nama karyawan wajib diisi');
    if (names.has(name.toLowerCase())) throw new UserError(`Nama ${name} sudah dipakai`);
    names.add(name.toLowerCase());
    if (!isRole(e.role)) throw new UserError(`Jabatan tidak dikenal: ${e.role}`);
    const tasks = (Array.isArray(e.tasks) ? e.tasks : []).map((x) => String(x).trim().slice(0, 200)).filter(Boolean);
    return { name, role: e.role, tasks: tasks.length ? tasks : [...ROLES[e.role].tasks] };
  });
  const hired = clean.map((e) => ({
    id: newId(), ...e, hiredAt: now(),
    chat: [{ id: newId(), from: 'employee', at: now(), text: `Halo, saya ${e.name}, ${ROLES[e.role].title}. Siap bekerja! Tanyakan apa saja seputar tugas saya.` }],
  }));
  t.employees.push(...hired);
  t.managerState = { step: 'ask_count' };
  checkLowStock(t);
  return `Selamat! ${hired.map((e) => e.name).join(', ')} sudah resmi bergabung dan mulai bekerja. ` +
    'Lihat menu "Kantor" untuk memberi perintah dan membaca laporan mereka. Sebutkan jumlah lagi jika ingin menambah karyawan.';
}

/** Rekrut dari kartu usulan (hasil edit pengguna), sekaligus mencatatnya di percakapan. */
export function hireFromProposal(t, team) {
  const text = hire(t, team);
  t.managerChat.push(msg('manager', text));
  return text;
}
