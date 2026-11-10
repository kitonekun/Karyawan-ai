# Panduan Kontribusi

## Menjalankan secara lokal

```bash
npm start        # http://localhost:3000
npm run check    # cek sintaks semua file JavaScript
npm test         # tes otomatis
```

Tidak ada dependensi yang perlu diinstal (cukup Node.js 18+).

## Alur kerja

1. Buat branch dari `main`, jangan commit langsung ke `main`.
2. Perubahan perilaku harus disertai tes di `test/`.
3. Pastikan `npm run check` dan `npm test` lulus.
4. Buka pull request dengan template yang tersedia. CI menjalankan tes di Node 18, 20, dan 22.
5. Merge hanya setelah CI hijau.

## Struktur kode

| Folder/file | Isi |
| --- | --- |
| `src/server.js` | Server HTTP, rute API, sesi, dan header keamanan |
| `src/manager.js` | Kepala Pengelola: percakapan rekrut, usulan tim, kuota |
| `src/work.js` | Pekerjaan karyawan: stok, transaksi, peringatan, laporan |
| `src/roles.js` | Daftar jabatan, tugas bawaan, dan nama karyawan |
| `src/db.js` | Penyimpanan JSON dan backup harian |
| `src/ai.js` | Integrasi AI opsional (API kompatibel OpenAI) |
| `public/` | Landing page, aplikasi perusahaan (`/kantor`), dan panel admin |

## Gaya kode

- JavaScript modern (ES modules), tanpa framework dan tanpa build step.
- Jangan menulis script inline di HTML karena akan diblokir Content-Security-Policy. Letakkan di file `.js` di `public/`.
- Teks yang dilihat pengguna ditulis dalam Bahasa Indonesia.
- Format mengikuti `.editorconfig` (2 spasi, LF).
