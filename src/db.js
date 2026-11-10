import fs from 'node:fs';
import path from 'node:path';
import { emptyTenant } from './util.js';
import { addItem, addTransaction } from './work.js';

const FILE = process.env.DB_FILE || path.join(process.cwd(), 'data', 'db.json');
let state;

export function db() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    state = { tenants: [], sessions: {} };
    seedDemo(state);
    save();
  }
  return state;
}

export function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
  dailyBackup();
}

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(FILE), 'backups');
const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);

/** Satu salinan per hari (db-YYYY-MM-DD.json), hanya BACKUP_KEEP hari terakhir yang disimpan. */
function dailyBackup() {
  try {
    const target = path.join(BACKUP_DIR, `db-${new Date().toISOString().slice(0, 10)}.json`);
    if (fs.existsSync(target)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.copyFileSync(FILE, target);
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -BACKUP_KEEP);
    for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f));
  } catch (err) {
    console.error('Backup harian gagal:', err.message);
  }
}

function seedDemo(s) {
  const t = emptyTenant({ name: 'Toko Sembako Demo', code: 'DEMO123', maxEmployees: 7 });
  for (const it of [
    { name: 'Beras 5kg', unit: 'karung', qty: 40, min: 10, price: 75000 },
    { name: 'Minyak Goreng 2L', unit: 'botol', qty: 6, min: 12, price: 36000 },
    { name: 'Gula Pasir 1kg', unit: 'pack', qty: 25, min: 15, price: 17000 },
    { name: 'Telur Ayam', unit: 'kg', qty: 3, min: 8, price: 28000 },
    { name: 'Mie Instan', unit: 'dus', qty: 60, min: 10, price: 115000 },
  ]) addItem(t, it);
  addTransaction(t, { type: 'expense', amount: 1500000, category: 'Sewa Toko', note: 'Sewa bulan ini' });
  addTransaction(t, { type: 'expense', amount: 4200000, category: 'Pembelian Stok', note: 'Belanja grosir' });
  s.tenants.push(t);
}
