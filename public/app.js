const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const dt = (s) => new Date(s).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

let S = null; // state perusahaan dari server
let tab = 'manager';
let openEmp = null;

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  // 401 = belum/tidak lagi login, 403 = langganan dinonaktifkan: kembali ke layar masuk.
  if ((res.status === 401 || res.status === 403) && !url.includes('login')) {
    showLogin();
    if (res.status === 403) $('#loginError').textContent = data.error;
    throw new Error(data.error);
  }
  if (!res.ok) throw new Error(data.error || 'Gagal');
  return data;
}

function toast(text, err = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.add('hidden'), 3000);
}

/** Jalankan aksi yang mengembalikan state baru, lalu render ulang. */
async function act(method, url, body, okMsg, btn) {
  if (btn) btn.disabled = true;
  try {
    S = await api(method, url, body);
    render();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) { if (e.message) toast(e.message, true); return false; }
  finally { if (btn) btn.disabled = false; }
}

function showLogin() {
  $('#login').classList.remove('hidden');
  $('#app').classList.add('hidden');
  const kode = new URLSearchParams(location.search).get('kode');
  if (kode && !$('#loginForm').code.value) $('#loginForm').code.value = kode;
}

async function boot() {
  try { S = await api('GET', '/api/state'); } catch { return showLogin(); }
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  render();
}

// ---------- Render ----------
function render() {
  $('#companyName').textContent = S.name;
  $('#managerTitle').textContent = S.managerName;
  $('#empCount').textContent = S.employees.length || '';
  const open = S.alerts.filter((a) => !a.resolved);
  $('#alertCount').textContent = open.length || '';
  $('#quota').textContent = `Kuota karyawan: ${S.employees.length}/${S.maxEmployees}`;
  $('#aiMode').textContent = S.aiEnabled ? '🤖 Mode AI aktif' : '⚙️ Mode otomatis (tanpa AI)';
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + tab));
  renderManager(); renderOffice(); renderWarehouse(); renderFinance(); renderReports();
  if (openEmp) renderEmpChat();
}

function bubble(m, botName) {
  const user = m.from === 'user';
  return `<div class="msg ${user ? 'user' : 'bot'}">${user ? '' : `<span class="who">${esc(botName)}</span>`}${esc(m.text)}</div>`;
}

function renderManager() {
  const box = $('#managerChat');
  const lastProposalIdx = S.managerChat.findLastIndex((m) => m.proposal);
  const active = S.managerState.step === 'proposal';
  box.innerHTML = S.managerChat.map((m, i) => {
    let html = bubble(m, S.managerName);
    if (active && i === lastProposalIdx) html += proposalCard(m.proposal);
    return html;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function roleOptions(sel) {
  return Object.entries(S.roles).map(([k, r]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${r.icon} ${esc(r.title)}</option>`).join('');
}

function proposalCard(team) {
  return `<div class="proposal" id="proposal">
    <strong>Usulan tim — silakan ubah jika perlu</strong>
    ${team.map((e, i) => `<div class="proposal-row" data-i="${i}">
      <div class="letter">${String.fromCharCode(65 + i)}</div>
      <input class="p-name" value="${esc(e.name)}" placeholder="Nama" />
      <select class="p-role">${roleOptions(e.role)}</select>
      <textarea class="p-tasks" title="Satu tugas per baris">${esc(e.tasks.join('\n'))}</textarea>
    </div>`).join('')}
    <div class="proposal-actions">
      <button class="btn" data-act="cancel-proposal">Batal</button>
      <button class="btn primary" data-act="hire">✅ Setujui & Rekrut</button>
    </div>
  </div>`;
}

function lastReport(empId) { return S.reports.findLast((r) => r.employeeId === empId); }

function renderOffice() {
  const el = $('#employees');
  if (!S.employees.length) {
    el.innerHTML = `<div class="card empty">Belum ada karyawan. Buka <a href="#" data-goto="manager">Kepala Pengelola</a> dan sebutkan berapa karyawan yang Anda butuhkan.</div>`;
    return;
  }
  el.innerHTML = S.employees.map((e) => {
    const r = S.roles[e.role];
    const last = lastReport(e.id);
    return `<div class="card emp">
      <div class="emp-head"><div class="avatar">${r.icon}</div><div><strong>${esc(e.name)}</strong><div class="muted small">${esc(r.title)}</div><div class="status">● Aktif bekerja</div></div></div>
      <ul>${e.tasks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      ${last ? `<div class="last"><strong>${esc(last.title)}</strong> · ${dt(last.at)}\n${esc(last.body)}</div>` : '<div class="last muted">Belum ada laporan.</div>'}
      <div class="emp-actions">
        <button class="btn primary small" data-act="run" data-id="${e.id}">▶ Kerjakan tugas</button>
        <button class="btn small" data-act="chat" data-id="${e.id}">💬 Chat</button>
        <button class="btn small" data-act="edit-tasks" data-id="${e.id}">✏️ Tugas</button>
        <button class="btn small danger" data-act="fire" data-id="${e.id}">Berhentikan</button>
      </div>
    </div>`;
  }).join('');
}

function renderWarehouse() {
  $('#itemsTable').innerHTML = `<tr><th>Barang</th><th>Stok</th><th>Min</th><th>Harga</th><th>Status</th><th></th></tr>` +
    (S.items.length ? S.items.map((i) => {
      const low = i.qty <= i.min;
      return `<tr class="${low ? 'low' : ''}"><td>${esc(i.name)}</td><td>${i.qty} ${esc(i.unit)}</td><td>${i.min}</td><td>${rp(i.price)}</td>
        <td>${low ? '<span class="pill warn">Menipis</span>' : '<span class="pill ok">Aman</span>'}</td>
        <td class="actions">
          <button class="btn small" data-act="move-in" data-id="${i.id}">+ Masuk</button>
          <button class="btn small" data-act="move-out" data-id="${i.id}">− Keluar</button>
          <button class="btn small" data-act="sale" data-id="${i.id}">🛒 Jual</button>
          <button class="btn small danger" data-act="del-item" data-id="${i.id}">Hapus</button>
        </td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">Belum ada barang.</td></tr>');
  const mv = S.movements.slice(-30).reverse();
  $('#movesTable').innerHTML = `<tr><th>Waktu</th><th>Barang</th><th>Jenis</th><th>Jumlah</th><th>Dicatat oleh</th><th>Catatan</th></tr>` +
    (mv.length ? mv.map((m) => `<tr><td>${dt(m.at)}</td><td>${esc(m.itemName)}</td><td>${m.sale ? 'Penjualan' : m.type === 'in' ? 'Masuk' : 'Keluar'}</td>
      <td class="amount ${m.type === 'in' ? 'in' : 'out'}">${m.type === 'in' ? '+' : '−'}${m.qty}</td><td>${esc(m.by ?? '—')}</td><td>${esc(m.note)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Belum ada mutasi.</td></tr>');
}

function renderFinance() {
  const d = new Date();
  const month = S.transactions.filter((x) => { const a = new Date(x.at); return a.getMonth() === d.getMonth() && a.getFullYear() === d.getFullYear(); });
  const inc = month.filter((x) => x.type === 'income').reduce((s, x) => s + x.amount, 0);
  const exp = month.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amount, 0);
  $('#financeStats').innerHTML = [
    ['Pemasukan bulan ini', rp(inc), 'in'], ['Pengeluaran bulan ini', rp(exp), 'out'], [inc - exp >= 0 ? 'Laba bersih' : 'Rugi bersih', rp(Math.abs(inc - exp)), inc - exp >= 0 ? 'in' : 'out'],
  ].map(([l, v, c]) => `<div class="card stat"><div class="label">${l}</div><div class="value amount ${c}">${v}</div></div>`).join('');
  const tx = S.transactions.slice().reverse();
  $('#txTable').innerHTML = `<tr><th>Waktu</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Nominal</th></tr>` +
    (tx.length ? tx.map((x) => `<tr><td>${dt(x.at)}</td><td>${x.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</td><td>${esc(x.category)}</td><td>${esc(x.note)}</td>
      <td class="amount ${x.type === 'income' ? 'in' : 'out'}">${x.type === 'income' ? '+' : '−'}${rp(x.amount)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">Belum ada transaksi.</td></tr>');
}

function renderReports() {
  const open = S.alerts.filter((a) => !a.resolved).reverse();
  const watcher = S.employees.some((e) => e.role === 'pengawas_stok');
  $('#alerts').innerHTML = open.length
    ? open.map((a) => `<div class="alert"><div><strong>${esc(a.by)}</strong> melaporkan: ${esc(a.text)}<div class="muted small">${dt(a.at)}</div></div>
        <button class="btn small" data-act="resolve" data-id="${a.id}">Tandai selesai</button></div>`).join('')
    : `<div class="empty">${watcher ? 'Tidak ada stok menipis. ✅' : 'Rekrut "Pengawas Stok Menipis" agar stok yang menipis dilaporkan otomatis.'}</div>`;
  const reps = S.reports.slice(-40).reverse();
  $('#reports').innerHTML = reps.length
    ? reps.map((r) => `<div class="card report ${r.level}"><strong>${S.roles[r.role]?.icon ?? ''} ${esc(r.title)}</strong>
        <div class="muted small">${esc(r.employeeName)} · ${dt(r.at)}</div><pre>${esc(r.body)}</pre></div>`).join('')
    : '<div class="empty">Belum ada laporan. Klik "Mulai Hari Kerja" di menu Kantor.</div>';
}

function renderEmpChat() {
  const e = S.employees.find((x) => x.id === openEmp);
  if (!e) { $('#empDialog').close(); openEmp = null; return; }
  $('#empDialogTitle').textContent = `${S.roles[e.role].icon} ${e.name} — ${S.roles[e.role].title}`;
  const box = $('#empChat');
  box.innerHTML = e.chat.map((m) => bubble(m, e.name)).join('');
  box.scrollTop = box.scrollHeight;
}

// ---------- Events ----------
$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('POST', '/api/login', { code: ev.target.code.value });
    $('#loginError').textContent = '';
    boot();
  } catch (e) { $('#loginError').textContent = e.message; }
});

$('#logout').addEventListener('click', async () => { await api('POST', '/api/logout'); S = null; showLogin(); });

$('#nav').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-tab]');
  if (b) { tab = b.dataset.tab; render(); }
});

$('#managerForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = ev.target.text;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  if (!(await act('POST', '/api/manager/message', { text }, null, ev.submitter))) input.value = text;
});

$('#empForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = ev.target.text;
  const text = input.value.trim();
  if (!text || !openEmp) return;
  input.value = '';
  if (!(await act('POST', `/api/employees/${openEmp}/chat`, { text }, null, ev.submitter))) input.value = text;
});
$('#empDialogClose').addEventListener('click', () => { $('#empDialog').close(); });
$('#empDialog').addEventListener('close', () => { openEmp = null; });

$('#runAll').addEventListener('click', (ev) => act('POST', '/api/run-all', null, 'Semua karyawan sudah menyerahkan laporan. Lihat menu Laporan.', ev.currentTarget));

$('#itemForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  if (await act('POST', '/api/items', { ...f, price: f.price || 0 }, 'Barang ditambahkan', ev.submitter)) ev.target.reset();
});

$('#txForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  if (await act('POST', '/api/transactions', f, 'Transaksi dicatat', ev.submitter)) ev.target.reset();
});

document.addEventListener('change', (ev) => {
  if (!ev.target.matches('.p-role')) return;
  const row = ev.target.closest('.proposal-row');
  row.querySelector('.p-tasks').value = S.roles[ev.target.value].tasks.join('\n');
});

document.addEventListener('click', async (ev) => {
  const goto = ev.target.closest('[data-goto]');
  if (goto) { ev.preventDefault(); tab = goto.dataset.goto; return render(); }
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  const item = S.items.find((i) => i.id === id);
  switch (b.dataset.act) {
    case 'hire': {
      const employees = [...document.querySelectorAll('#proposal .proposal-row')].map((r) => ({
        name: r.querySelector('.p-name').value,
        role: r.querySelector('.p-role').value,
        tasks: r.querySelector('.p-tasks').value.split('\n'),
      }));
      return act('POST', '/api/manager/hire', { employees }, 'Karyawan berhasil direkrut!', b);
    }
    case 'cancel-proposal': return act('POST', '/api/manager/message', { text: 'batal' }, null, b);
    case 'run': return act('POST', `/api/employees/${id}/run`, null, 'Laporan diterima', b);
    case 'chat': openEmp = id; renderEmpChat(); return $('#empDialog').showModal();
    case 'edit-tasks': {
      const e = S.employees.find((x) => x.id === id);
      const v = prompt(`Tugas untuk ${e.name} (pisahkan dengan ; )`, e.tasks.join('; '));
      if (v !== null) return act('PUT', `/api/employees/${id}`, { tasks: v.split(';') }, 'Tugas diperbarui', b);
      return;
    }
    case 'fire': {
      const e = S.employees.find((x) => x.id === id);
      if (confirm(`Berhentikan ${e.name}?`)) return act('DELETE', `/api/employees/${id}`, null, `${e.name} diberhentikan`, b);
      return;
    }
    case 'move-in': case 'move-out': case 'sale': {
      const label = { 'move-in': 'masuk', 'move-out': 'keluar', sale: 'terjual' }[b.dataset.act];
      const qty = prompt(`Jumlah ${item.name} yang ${label} (${item.unit}):`);
      if (!qty) return;
      const note = b.dataset.act === 'sale' ? 'Penjualan' : (prompt('Catatan (opsional):') ?? '');
      return act('POST', `/api/items/${id}/move`, { type: b.dataset.act === 'move-in' ? 'in' : 'out', qty: Number(qty), note, sale: b.dataset.act === 'sale' }, 'Stok diperbarui', b);
    }
    case 'del-item':
      if (confirm(`Hapus ${item.name}?`)) return act('DELETE', `/api/items/${id}`, null, 'Barang dihapus', b);
      return;
    case 'resolve': return act('POST', `/api/alerts/${id}/resolve`, null, 'Peringatan ditutup', b);
  }
});

boot();
