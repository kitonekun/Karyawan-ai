export const ROLES = {
  gudang: {
    title: 'Staf Stok Gudang', icon: '📦',
    tasks: ['Mencatat barang masuk & keluar gudang', 'Memperbarui jumlah stok setiap transaksi', 'Menyusun ringkasan posisi stok harian'],
    keywords: ['gudang', 'stok', 'barang', 'inventaris', 'inventory'],
  },
  keuangan: {
    title: 'Staf Laporan Keuangan', icon: '💰',
    tasks: ['Mencatat pemasukan & pengeluaran', 'Menyusun laporan laba/rugi bulanan', 'Merekap pengeluaran per kategori'],
    keywords: ['keuangan', 'uang', 'kas', 'akuntansi', 'pembukuan', 'laba', 'finance'],
  },
  pengawas_stok: {
    title: 'Pengawas Stok Menipis', icon: '🚨',
    tasks: ['Memantau barang yang stoknya di bawah batas minimum', 'Melaporkan barang yang perlu dipesan ulang', 'Menyarankan jumlah pemesanan ulang'],
    keywords: ['menipis', 'habis', 'restock', 'pengawas', 'pantau', 'monitor'],
  },
  penjualan: {
    title: 'Staf Penjualan', icon: '🛒',
    tasks: ['Mencatat penjualan & mengurangi stok', 'Menghitung omzet harian dan bulanan', 'Melaporkan produk terlaris'],
    keywords: ['jual', 'penjualan', 'sales', 'toko', 'omzet', 'kasir'],
  },
  cs: {
    title: 'Customer Service', icon: '💬',
    tasks: ['Menyiapkan template balasan pelanggan', 'Menginformasikan ketersediaan produk', 'Merangkum pertanyaan pelanggan'],
    keywords: ['pelanggan', 'customer', 'cs', 'komplain', 'keluhan'],
  },
  marketing: {
    title: 'Staf Pemasaran', icon: '📣',
    tasks: ['Membuat ide promosi dari produk yang stoknya berlebih', 'Menyusun caption media sosial', 'Merencanakan kampanye mingguan'],
    keywords: ['promosi', 'marketing', 'pemasaran', 'iklan', 'sosmed', 'konten'],
  },
  admin: {
    title: 'Admin & Penjadwalan', icon: '🗂️',
    tasks: ['Merangkum aktivitas semua karyawan', 'Menyusun agenda kerja harian', 'Mengingatkan hal yang belum ditindaklanjuti'],
    keywords: ['admin', 'jadwal', 'agenda', 'administrasi'],
  },
};

export const DEFAULT_ORDER = ['gudang', 'keuangan', 'pengawas_stok', 'penjualan', 'cs', 'marketing', 'admin'];

export const NAMES = [
  'Andi', 'Bunga', 'Citra', 'Dimas', 'Eka', 'Fajar', 'Gita', 'Hendra', 'Indah', 'Joko',
  'Kirana', 'Lukman', 'Maya', 'Nanda', 'Oki', 'Putri', 'Rizky', 'Sari', 'Teguh', 'Wulan',
];

export const isRole = (r) => Object.hasOwn(ROLES, r);
