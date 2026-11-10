# Kebijakan Keamanan

## Melaporkan celah keamanan

**Jangan laporkan celah keamanan lewat issue publik.**

Gunakan fitur **Report a vulnerability** di tab *Security* repositori ini
(GitHub Private Vulnerability Reporting), atau hubungi pemilik repositori secara langsung.

Sertakan:
- jenis celah dan dampaknya (misalnya akses data perusahaan lain, melewati login);
- langkah reproduksi atau contoh permintaan HTTP;
- versi atau commit yang diuji.

Kami akan mengonfirmasi laporan dalam 3 hari kerja dan memberi kabar perkembangan
sampai perbaikan dirilis.

## Versi yang didukung

Hanya versi terbaru di branch `main` yang menerima perbaikan keamanan.

## Perlindungan yang sudah ada

- Data setiap perusahaan penyewa terpisah; akses lewat kode perusahaan.
- Sesi berbasis cookie `HttpOnly` + `SameSite=Lax`, berlaku 30 hari. Sesi admin dan sesi perusahaan memakai cookie terpisah.
- Kode akses dan kata sandi dibandingkan dengan waktu konstan (`timingSafeEqual`).
- Login dikunci 15 menit setelah 10 kali gagal per IP.
- Membuat kode baru, menonaktifkan, atau menghapus perusahaan langsung mencabut aksesnya.
- Header keamanan di setiap respons: `Content-Security-Policy` (tanpa script inline),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Seluruh teks pengguna di-escape sebelum ditampilkan; batas ukuran body 200 KB; path file statis dibatasi ke folder `public/`.
- Backup data harian otomatis (14 hari terakhir).

## Tanggung jawab saat deploy

- Wajib mengatur `ADMIN_PASSWORD` yang kuat. Tanpa itu, sandi bawaan `admin123` dipakai.
- Jalankan di belakang HTTPS (misalnya Nginx + certbot).
- Simpan `data/` dan `data/backups/` di luar akses publik, lalu salin backup ke lokasi lain secara berkala.
