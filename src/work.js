import { ROLES } from './roles.js';
import { newId, now, rupiah, UserError } from './util.js';

const DAY = 24 * 3600 * 1000;
const findByRole = (t, role) => t.employees.find((e) => e.role === role);
const recent = (list, ms) => list.filter((x) => Date.now() - Date.parse(x.at) <= ms);
const thisMonth = (list) => {
  const d = new Date();
  return list.filter((x) => { const a = new Date(x.at); return a.getMonth() === d.getMonth() && a.getFullYear() === d.getFullYear(); });
};

function num(v, field, { min = 0, integer = false } = {}) {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) throw new UserError(`${field} tidak valid`);
  return n;
}

export function addItem(t, { name, unit = 'pcs', qty = 0, min = 0, price = 0 }) {
  name = String(name ?? '').trim();
  if (!name) throw new UserError('Nama barang wajib diisi');
  if (t.items.some((i) => i.name.toLowerCase() === name.toLowerCase())) throw new UserError('Barang sudah ada');
  const item = {
    id: newId(), name, unit: String(unit || 'pcs').trim(),
    qty: num(qty, 'Stok', { integer: true }), min: num(min, 'Stok minimum', { integer: true }), price: num(price, 'Harga'),
  };
  t.items.push(item);
  checkLowStock(t);
  return item;
}

export function removeItem(t, itemId) {
  t.items = t.items.filter((i) => i.id !== itemId);
  t.alerts = t.alerts.filter((a) => a.itemId !== itemId);
}

/** type 'in' = barang masuk, 'out' = barang keluar. sale=true juga mencatat pemasukan. */
export function moveStock(t, itemId, { type, qty, note = '', sale = false }) {
  const item = t.items.find((i) => i.id === itemId);
  if (!item) throw new UserError('Barang tidak ditemukan', 404);
  if (type !== 'in' && type !== 'out') throw new UserError('Jenis mutasi harus in/out');
  qty = num(qty, 'Jumlah', { min: 1, integer: true });
  if (type === 'out' && qty > item.qty) throw new UserError(`Stok ${item.name} hanya ${item.qty} ${item.unit}`);
  const isSale = !!sale && type === 'out';
  item.qty += type === 'in' ? qty : -qty;
  const by = (isSale && findByRole(t, 'penjualan')) || findByRole(t, 'gudang');
  t.movements.push({ id: newId(), itemId, itemName: item.name, type, qty, note: String(note), sale: isSale, at: now(), by: by?.name ?? null });
  if (isSale && item.price > 0) {
    addTransaction(t, { type: 'income', amount: qty * item.price, category: 'Penjualan', note: `${qty} ${item.unit} ${item.name}` });
  }
  checkLowStock(t);
  return item;
}

export function addTransaction(t, { type, amount, category = 'Umum', note = '' }) {
  if (type !== 'income' && type !== 'expense') throw new UserError('Jenis transaksi harus income/expense');
  const tx = { id: newId(), type, amount: num(amount, 'Nominal', { min: 1 }), category: String(category || 'Umum').trim(), note: String(note), at: now() };
  t.transactions.push(tx);
  return tx;
}

export const lowItems = (t) => t.items.filter((i) => i.qty <= i.min);
export const reorderQty = (i) => Math.max(i.min * 2 - i.qty, 1);

/** Pengawas stok membuat peringatan otomatis; peringatan selesai sendiri saat stok pulih. */
export function checkLowStock(t) {
  for (const a of t.alerts) {
    const item = t.items.find((i) => i.id === a.itemId);
    if (!a.resolved && (!item || item.qty > item.min)) { a.resolved = true; a.resolvedAt = now(); }
  }
  const watcher = findByRole(t, 'pengawas_stok');
  if (!watcher) return [];
  const created = [];
  for (const item of lowItems(t)) {
    if (t.alerts.some((a) => a.itemId === item.id && !a.resolved)) continue;
    const alert = {
      id: newId(), itemId: item.id, by: watcher.name, at: now(), resolved: false,
      text: `${item.name} tinggal ${item.qty} ${item.unit} (minimum ${item.min}). Saran pesan ulang ${reorderQty(item)} ${item.unit}.`,
    };
    t.alerts.push(alert);
    created.push(alert);
  }
  return created;
}

export function financeSummary(t, list = thisMonth(t.transactions)) {
  const income = list.filter((x) => x.type === 'income').reduce((s, x) => s + x.amount, 0);
  const expense = list.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amount, 0);
  const byCat = {};
  for (const x of list) {
    const k = `${x.type === 'income' ? '+' : '-'} ${x.category}`;
    byCat[k] = (byCat[k] ?? 0) + x.amount;
  }
  return { income, expense, profit: income - expense, byCat };
}

function salesStats(t, ms) {
  const sales = recent(t.movements.filter((m) => m.sale), ms);
  const per = {};
  for (const m of sales) per[m.itemName] = (per[m.itemName] ?? 0) + m.qty;
  const top = Object.entries(per).sort((a, b) => b[1] - a[1]);
  return { count: sales.length, units: sales.reduce((s, m) => s + m.qty, 0), top };
}

const REPORTERS = {
  gudang(t) {
    const units = t.items.reduce((s, i) => s + i.qty, 0);
    const value = t.items.reduce((s, i) => s + i.qty * i.price, 0);
    const mv = recent(t.movements, DAY);
    const lines = [
      `Jumlah jenis barang: ${t.items.length}`,
      `Total unit di gudang: ${units}`,
      `Nilai persediaan: ${rupiah(value)}`,
      `Mutasi 24 jam terakhir: ${mv.filter((m) => m.type === 'in').length} masuk, ${mv.filter((m) => m.type === 'out').length} keluar`,
      '', 'Posisi stok:',
      ...(t.items.length ? t.items.map((i) => `• ${i.name}: ${i.qty} ${i.unit}${i.qty <= i.min ? ' ⚠️' : ''}`) : ['• Gudang masih kosong']),
    ];
    return { title: 'Ringkasan Stok Gudang', body: lines.join('\n') };
  },
  keuangan(t) {
    const f = financeSummary(t);
    const all = financeSummary(t, t.transactions);
    const month = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    const lines = [
      `Periode: ${month}`,
      `Pemasukan: ${rupiah(f.income)}`,
      `Pengeluaran: ${rupiah(f.expense)}`,
      `${f.profit >= 0 ? 'Laba' : 'Rugi'} bersih: ${rupiah(Math.abs(f.profit))}`,
      '', 'Rincian per kategori:',
      ...(Object.keys(f.byCat).length ? Object.entries(f.byCat).map(([k, v]) => `• ${k}: ${rupiah(v)}`) : ['• Belum ada transaksi bulan ini']),
      '', `Saldo kumulatif sejak awal: ${rupiah(all.profit)}`,
    ];
    return { title: 'Laporan Keuangan Bulanan', body: lines.join('\n'), level: f.profit < 0 ? 'warning' : 'info' };
  },
  pengawas_stok(t) {
    checkLowStock(t);
    const low = lowItems(t);
    if (!low.length) return { title: 'Pemantauan Stok', body: 'Semua stok aman, tidak ada barang di bawah batas minimum. ✅' };
    return {
      title: `Peringatan: ${low.length} barang stok menipis`, level: 'warning',
      body: ['Barang yang perlu segera dipesan ulang:', ...low.map((i) => `• ${i.name}: sisa ${i.qty} ${i.unit} (min ${i.min}) → pesan ${reorderQty(i)} ${i.unit}`)].join('\n'),
    };
  },
  penjualan(t) {
    const d = salesStats(t, DAY);
    const m = salesStats(t, 30 * DAY);
    const omzet = financeSummary(t, recent(t.transactions.filter((x) => x.category === 'Penjualan'), DAY)).income;
    return {
      title: 'Laporan Penjualan',
      body: [
        `Hari ini: ${d.count} transaksi, ${d.units} unit, omzet ${rupiah(omzet)}`,
        `30 hari: ${m.count} transaksi, ${m.units} unit`,
        '', 'Produk terlaris (30 hari):',
        ...(m.top.length ? m.top.slice(0, 5).map(([n, q], i) => `${i + 1}. ${n} — ${q} unit`) : ['Belum ada penjualan tercatat']),
      ].join('\n'),
    };
  },
  cs(t) {
    const lines = ['Template balasan ketersediaan produk:'];
    for (const i of t.items) {
      lines.push(i.qty > 0
        ? `• "Halo Kak, ${i.name} ready ${i.qty} ${i.unit}${i.price ? ` dengan harga ${rupiah(i.price)}` : ''}. Silakan diorder 🙏"`
        : `• "Mohon maaf Kak, ${i.name} sedang kosong. Kami kabari begitu restock ya 🙏"`);
    }
    if (!t.items.length) lines.push('• Belum ada produk di gudang.');
    return { title: 'Template Balasan Pelanggan', body: lines.join('\n') };
  },
  marketing(t) {
    const over = t.items.filter((i) => i.qty > i.min).sort((a, b) => (b.qty - b.min) - (a.qty - a.min)).slice(0, 3);
    if (!over.length) return { title: 'Ide Promosi', body: 'Belum ada produk dengan stok berlebih untuk dipromosikan.' };
    return {
      title: 'Ide Promosi Minggu Ini',
      body: ['Fokus promosi pada produk dengan stok paling banyak:', ...over.map((i, n) =>
        `${n + 1}. ${i.name} (stok ${i.qty} ${i.unit})\n   Caption: "Stok melimpah! ${i.name} siap kirim hari ini${i.price ? `, cuma ${rupiah(i.price)}` : ''}. Order sekarang sebelum kehabisan! 🔥"`)].join('\n'),
    };
  },
  admin(t, self) {
    const open = t.alerts.filter((a) => !a.resolved);
    return {
      title: 'Agenda & Rekap Kantor',
      body: [
        `Karyawan aktif: ${t.employees.length}`,
        ...t.employees.map((e) => {
          if (e === self) return `• ${e.name} (${ROLES[e.role].title}) — sedang menyusun laporan ini`;
          const last = t.reports.findLast((r) => r.employeeId === e.id);
          return `• ${e.name} (${ROLES[e.role].title}) — laporan terakhir: ${last ? new Date(last.at).toLocaleString('id-ID') : 'belum ada'}`;
        }),
        '', 'Agenda hari ini:',
        open.length ? `• Tindak lanjuti ${open.length} peringatan stok menipis` : '• Tidak ada peringatan stok terbuka',
        '• Cek laporan keuangan dan penjualan',
        '• Pastikan semua barang masuk/keluar sudah dicatat',
      ].join('\n'),
    };
  },
};

export function runTask(t, employeeId) {
  const emp = t.employees.find((e) => e.id === employeeId);
  if (!emp) throw new UserError('Karyawan tidak ditemukan', 404);
  const r = REPORTERS[emp.role](t, emp);
  const report = { id: newId(), employeeId: emp.id, employeeName: emp.name, role: emp.role, level: r.level ?? 'info', title: r.title, body: r.body, at: now() };
  t.reports.push(report);
  if (t.reports.length > 300) t.reports.splice(0, t.reports.length - 300);
  return report;
}

export function runAll(t) {
  // Admin terakhir agar rekapnya mencakup laporan rekan lain.
  const order = [...t.employees].sort((a, b) => (a.role === 'admin') - (b.role === 'admin'));
  return order.map((e) => runTask(t, e.id));
}

/** Jawaban karyawan tanpa AI: cocokkan kata kunci ke laporan yang relevan. */
export function ruleBasedEmployeeReply(t, emp, text) {
  const s = text.toLowerCase();
  const pick = [
    [/menipis|habis|restock|pesan ulang/, 'pengawas_stok'],
    [/stok|gudang|barang/, 'gudang'],
    [/keuangan|laba|rugi|uang|kas|pengeluaran|pemasukan/, 'keuangan'],
    [/jual|omzet|laris/, 'penjualan'],
    [/promo|caption|iklan/, 'marketing'],
    [/pelanggan|balas|template/, 'cs'],
    [/agenda|jadwal|rekap/, 'admin'],
  ].find(([re]) => re.test(s));
  if (/laporan/.test(s) && !pick) return replyWith(t, emp, emp.role);
  if (!pick || /tugas|kerja apa|siapa kamu|perkenalkan/.test(s)) {
    return `Saya ${emp.name}, ${ROLES[emp.role].title}. Tugas saya:\n${emp.tasks.map((x) => `• ${x}`).join('\n')}\n\nCoba tanya soal stok, keuangan, penjualan, atau minta "laporan".`;
  }
  return replyWith(t, emp, pick[1]);
}

function replyWith(t, emp, role) {
  const r = REPORTERS[role](t);
  const prefix = role === emp.role ? 'Siap, ini laporannya:' : `Itu bagian ${ROLES[role].title}, tapi ini datanya:`;
  return `${prefix}\n\n${r.title}\n${r.body}`;
}

export function snapshot(t) {
  return {
    perusahaan: t.name,
    karyawan: t.employees.map((e) => ({ nama: e.name, jabatan: ROLES[e.role].title })),
    barang: t.items.map(({ name, unit, qty, min, price }) => ({ name, unit, qty, min, price })),
    stokMenipis: lowItems(t).map((i) => i.name),
    keuanganBulanIni: financeSummary(t),
    mutasiTerakhir: t.movements.slice(-15).map(({ itemName, type, qty, sale, at }) => ({ itemName, type, qty, sale, at })),
  };
}
