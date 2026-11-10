import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-'));
process.env.DB_FILE = path.join(dir, 'db.json');
process.env.ADMIN_PASSWORD = 'rahasia-tes';
const { server } = await import('../src/server.js');

let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(method, url, body, cookie) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const sid = res.headers.get('set-cookie')?.match(/^[^;]+/)?.[0];
  return { status: res.status, data: await res.json().catch(() => null), cookie: sid };
}

test('halaman: landing, kantor (dengan/tanpa garis miring), admin', async () => {
  for (const p of ['/', '/kantor', '/kantor/', '/admin']) assert.equal((await fetch(base + p)).status, 200, p);
  assert.equal((await fetch(base + '/tidak-ada')).status, 404);
});

test('body JSON bukan objek ditolak dengan 400, bukan 500', async () => {
  assert.equal((await call('POST', '/api/login', 'null')).status, 400);
  assert.equal((await call('POST', '/api/login', '[1]')).status, 400);
  assert.equal((await call('POST', '/api/login', '{rusak')).status, 400);
});

test('alur perusahaan lewat API + kode baru mengeluarkan sesi lama', async () => {
  const admin = (await call('POST', '/api/admin/login', { password: 'rahasia-tes' })).cookie;
  assert.ok(admin);
  const t = (await call('POST', '/api/admin/tenants', { name: 'PT Tes', maxEmployees: 3 }, admin)).data;
  const user = (await call('POST', '/api/login', { code: t.code.toLowerCase() })).cookie;
  assert.ok(user, 'kode tidak peka huruf besar/kecil');

  let r = await call('POST', '/api/manager/message', { text: '3 karyawan' }, user);
  assert.equal(r.data.managerState.proposal.length, 3);
  r = await call('POST', '/api/manager/message', { text: 'oke ganti B jadi penjualan' }, user);
  assert.equal(r.data.employees.length, 0, '"oke ganti ..." harus mengubah usulan, bukan merekrut');
  assert.equal(r.data.managerState.proposal[1].role, 'penjualan');
  r = await call('POST', '/api/manager/message', { text: 'setuju' }, user);
  assert.equal(r.data.employees.length, 3);
  assert.equal(r.data.code, undefined, 'kode akses tidak dikirim ke perusahaan');

  r = await call('POST', '/api/run-all', undefined, user);
  assert.equal(r.data.reports.length, 3);

  await call('PATCH', `/api/admin/tenants/${t.id}`, { active: false }, admin);
  assert.equal((await call('GET', '/api/state', undefined, user)).status, 403);
  // Satu browser yang login admin dan perusahaan sekaligus tetap mendapat status perusahaan.
  assert.equal((await call('GET', '/api/state', undefined, `${admin}; ${user}`)).status, 403);
  assert.equal((await call('GET', '/api/admin/tenants', undefined, user)).status, 401);
  await call('PATCH', `/api/admin/tenants/${t.id}`, { active: true }, admin);

  await call('PATCH', `/api/admin/tenants/${t.id}`, { regenerateCode: true }, admin);
  assert.equal((await call('GET', '/api/state', undefined, user)).status, 401);
});

test('URL rusak dibalas 400 dan server tetap hidup', async () => {
  for (const p of ['/api/employees/%E0%A4%A/run', '/api/items/%/move']) {
    assert.equal((await call('POST', p, {})).status, 400, p);
  }
  for (const p of ['/%', '/%E0%A4%A', '/.git/config', '/data/db.json']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  assert.equal((await call('GET', '/api/health')).status, 200);
});

test('header keamanan ada di halaman dan API', async () => {
  for (const p of ['/', '/api/health']) {
    const res = await fetch(base + p);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'(;|$)/, p);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', p);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', p);
  }
});

test('health check tidak membuka data dan backup harian dibuat', async () => {
  const { status, data } = await call('GET', '/api/health');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(data).sort(), ['status', 'uptimeSeconds', 'version']);
  await call('POST', '/api/admin/login', { password: 'rahasia-tes' });
  const files = fs.readdirSync(path.join(dir, 'backups'));
  assert.deepEqual(files, [`db-${new Date().toISOString().slice(0, 10)}.json`]);
});

test('login dibatasi setelah 10 kali gagal', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/api/admin/login', { password: 'salah' })).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'rahasia-tes' })).status, 429);
});
