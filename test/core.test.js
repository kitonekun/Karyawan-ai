import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTenant } from '../src/util.js';
import { parseCount, rolesMentioned, proposeTeam, handleManagerMessage, hire } from '../src/manager.js';
import { addItem, moveStock, runTask, runAll, financeSummary } from '../src/work.js';

const tenant = (max = 5) => emptyTenant({ name: 'PT Uji', code: 'X', maxEmployees: max });

test('parseCount memahami angka dan kata', () => {
  assert.equal(parseCount('3'), 3);
  assert.equal(parseCount('saya butuh tiga orang'), 3);
  assert.equal(parseCount('butuh 10 karyawan'), 10);
  assert.equal(parseCount('halo'), null);
});

test('peran diurutkan sesuai kebutuhan yang disebut', () => {
  assert.deepEqual(rolesMentioned('susun laporan keuangan lalu stok gudang'), ['keuangan', 'gudang']);
  const team = proposeTeam(tenant(), 3, '');
  assert.deepEqual(team.map((e) => e.name), ['Andi', 'Bunga', 'Citra']);
  assert.deepEqual(team.map((e) => e.role), ['gudang', 'keuangan', 'pengawas_stok']);
});

test('alur: tanya jumlah → usulan → setuju → karyawan aktif', () => {
  const t = tenant();
  handleManagerMessage(t, 'butuh 3');
  assert.equal(t.managerState.step, 'proposal');
  assert.equal(t.managerState.proposal.length, 3);
  handleManagerMessage(t, 'ganti B jadi pemasaran');
  assert.equal(t.managerState.proposal[1].role, 'marketing');
  handleManagerMessage(t, 'setuju');
  assert.equal(t.employees.length, 3);
  assert.equal(t.managerState.step, 'ask_count');
});

test('kuota paket dibatasi', () => {
  const t = tenant(2);
  const { message } = handleManagerMessage(t, '5 karyawan');
  assert.match(message.text, /maksimal 2/);
  assert.throws(() => hire(t, proposeTeam(t, 3)), /kuota/i);
});

test('pengawas melaporkan stok menipis dan penjualan masuk ke keuangan', () => {
  const t = tenant();
  hire(t, proposeTeam(t, 3));
  const item = addItem(t, { name: 'Beras', unit: 'karung', qty: 12, min: 10, price: 50000 });
  moveStock(t, item.id, { type: 'out', qty: 3, sale: true });
  assert.equal(item.qty, 9);
  assert.equal(t.alerts.filter((a) => !a.resolved).length, 1);
  assert.equal(t.alerts[0].by, 'Citra');
  assert.equal(financeSummary(t).income, 150000);
  moveStock(t, item.id, { type: 'in', qty: 20 });
  assert.equal(t.alerts.filter((a) => !a.resolved).length, 0);
  assert.throws(() => moveStock(t, item.id, { type: 'out', qty: 999 }), /hanya/);
});

test('setiap karyawan menghasilkan laporan', () => {
  const t = tenant(7);
  hire(t, proposeTeam(t, 7));
  addItem(t, { name: 'Gula', qty: 2, min: 5, price: 15000 });
  const reports = runAll(t);
  assert.equal(reports.length, 7);
  assert.equal(reports.at(-1).role, 'admin');
  assert.doesNotMatch(reports.at(-1).body, /belum ada/, 'rekap admin mencakup semua rekan, termasuk dirinya');
  assert.match(runTask(t, t.employees.find((e) => e.role === 'pengawas_stok').id).body, /Gula/);
});
