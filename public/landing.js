document.getElementById('year').textContent = new Date().getFullYear();
// Tombol kontak diarahkan ke WhatsApp jika CONTACT_WHATSAPP diatur di server; jika tidak, tetap ke demo/harga.
try {
  const { whatsapp } = await (await fetch('/api/config')).json();
  if (whatsapp) {
    for (const a of document.querySelectorAll('.js-contact')) {
      const plan = a.dataset.plan;
      const text = plan ? `Halo, saya tertarik menyewa karyawan AI paket ${plan}.` : 'Halo, saya ingin tahu lebih lanjut tentang Kantor Karyawan AI.';
      a.href = `https://wa.me/${whatsapp}?text=${encodeURIComponent(text)}`;
      a.target = '_blank';
      a.rel = 'noopener';
    }
  }
} catch {}
