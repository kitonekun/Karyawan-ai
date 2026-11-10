const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Gagal'), { status: res.status });
  return data;
}
function toast(t, err) { const el = $('#toast'); el.textContent = t; el.className = 'toast' + (err ? ' err' : ''); setTimeout(() => el.classList.add('hidden'), 3000); }

async function load() {
  try {
    const list = await api('GET', '/api/admin/tenants');
    $('#login').classList.add('hidden'); $('#panel').classList.remove('hidden');
    $('#tenants').innerHTML = '<tr><th>Perusahaan</th><th>Kode akses</th><th>Karyawan / Kuota</th><th>Barang</th><th>Status</th><th></th></tr>' +
      list.map((t) => `<tr><td>${esc(t.name)}<div class="muted small">sejak ${new Date(t.createdAt).toLocaleDateString('id-ID')}</div></td>
        <td><code>${esc(t.code)}</code></td><td>${t.employees} / ${t.maxEmployees}</td><td>${t.items}</td>
        <td>${t.active ? '<span class="pill ok">Aktif</span>' : '<span class="pill warn">Nonaktif</span>'}</td>
        <td class="actions">
          <button class="btn small" data-act="quota" data-id="${t.id}" data-max="${t.maxEmployees}">Ubah kuota</button>
          <button class="btn small" data-act="toggle" data-id="${t.id}" data-active="${t.active}">${t.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
          <button class="btn small" data-act="code" data-id="${t.id}">Kode baru</button>
          <button class="btn small danger" data-act="delete" data-id="${t.id}" data-name="${esc(t.name)}">Hapus</button>
        </td></tr>`).join('');
  } catch (e) {
    if (e.status === 401) { $('#login').classList.remove('hidden'); $('#panel').classList.add('hidden'); } else toast(e.message, true);
  }
}

$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try { await api('POST', '/api/admin/login', { password: ev.target.password.value }); load(); }
  catch (e) { $('#loginError').textContent = e.message; }
});
$('#newTenant').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const t = await api('POST', '/api/admin/tenants', { name: ev.target.name.value, maxEmployees: Number(ev.target.maxEmployees.value) });
    toast(`Terdaftar. Kode akses: ${t.code}`); ev.target.reset(); load();
  } catch (e) { toast(e.message, true); }
});
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const url = `/api/admin/tenants/${b.dataset.id}`;
  try {
    if (b.dataset.act === 'quota') {
      const v = prompt('Kuota karyawan baru (1–50):', b.dataset.max);
      if (!v) return;
      await api('PATCH', url, { maxEmployees: Number(v) });
    } else if (b.dataset.act === 'toggle') await api('PATCH', url, { active: b.dataset.active !== 'true' });
    else if (b.dataset.act === 'code') { if (!confirm('Buat kode akses baru? Kode lama tidak berlaku lagi.')) return; await api('PATCH', url, { regenerateCode: true }); }
    else if (b.dataset.act === 'delete') { if (!confirm(`Hapus ${b.dataset.name} beserta semua datanya?`)) return; await api('DELETE', url); }
    load();
  } catch (e) { toast(e.message, true); }
});
load();
