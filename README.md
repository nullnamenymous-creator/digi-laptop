# Digi-Laptop

Web app operasional untuk DIGITAL LAPTOP JOMBANG: role pemilik/operator/teknisi, cabang, penerimaan borongan, barcode, QC dan repair, stok, kasir, tiket servis, klaim garansi, serta katalog publik. App dibuat sebagai Vite SPA + PWA. Data bersama disimpan di Supabase; Vercel hanya menyajikan aplikasi.

## Menjalankan di komputer

1. Install Node.js 20.19+ atau 22.12+.
2. Jalankan `npm install`.
3. Pastikan `.env.local` memiliki `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY` untuk project Digi-Laptop.
4. Jalankan `npm run dev` dan buka alamat lokal yang ditampilkan.

Project Supabase target: `pklfnrxcczvphxzzmrwx` (region Singapore). Skema dan Row Level Security sudah disiapkan di project tersebut. Salinan skema sumber ada di `supabase/schema.sql`.

## Akun dan cabang

- Buat akun pertama melalui **Buat akun**. Setelah konfirmasi email dan masuk, lengkapi penyiapan DIGITAL LAPTOP JOMBANG serta nama cabang yang benar.
- Pemilik membuat undangan tim dari menu **Cabang & operator**. Pilih **Operator** untuk penerimaan, kasir, dan servis pelanggan; pilih **Teknisi** untuk halaman QC dan repair. Undangan membatasi anggota ke cabang yang dipilih.
- Akun anggota tim belum dibuat dari Supabase Admin API, jadi undangan tampil di aplikasi dan operator/teknisi perlu mendaftar dengan email undangan tersebut.

## Alur penerimaan, QC, dan repair

1. Pemilik/operator membuat batch di **Penerimaan & barcode**. Laptop mendapatkan barcode unik per unit; lembar label dapat dicetak sekaligus sebelum laptop masuk rak. Produk selain laptop langsung masuk stok.
2. Teknisi membuka **QC & repair**, memindai barcode, memasukkan serial/barcode supplier, dan mencatat hasil pemeriksaan. Unit laptop belum tersedia bagi kasir sampai lolos QC.
3. Unit bermasalah masuk papan repair. Teknisi mencatat progres, memakai sparepart dari stok cabang, lalu mengirim unit ke QC akhir. Hanya unit yang lolos QC akhir masuk stok jual.
4. Semua halaman mengacu pada data cabang yang sama. Perubahan penerimaan, QC, repair, dan stok disiarkan ke anggota tim secara langsung.

## Pelanggan, supplier, dan keuangan

- Barang baru dapat dibuat langsung di form **Penerimaan & barcode**; tidak perlu membuat produk lebih dulu. Supplier terdaftar dipilih otomatis; supplier baru dapat dibuat di form yang sama. Dua huruf awal nama supplier dipakai sebagai awalan barcode, misalnya **AS-DL-…** untuk Asep.
- Penjualan dapat dicatat lunas atau tempo. Piutang penjualan dan servis dikelola bersama kontak pada tab **Pelanggan**; pembayaran berikutnya memperbarui saldo dan kas masuk.
- Penerimaan barang mencatat nilai nota, pembayaran awal, dan jatuh tempo. Sisa hutang tampil pada tab **Supplier**; pelunasan tercatat sebagai kas keluar.
- Halaman **Keuangan** mencatat pengeluaran dan pemasukan lain, merangkum kas masuk/keluar bulan ini, serta menyediakan filter **Semua cabang** untuk pemilik. Operator hanya melihat cabangnya.
- Produk baru wajib memiliki foto. Foto dapat dipilih dari file PC/galeri ponsel atau diambil langsung dengan kamera; produk lama dapat dilengkapi dari tombol **Foto/Ganti foto**. Gambar tersimpan di Supabase Storage dan dipakai di stok serta portal katalog.
- Beranda menampilkan laptop terlaris dan stok laptop siap jual per merek berdasarkan cabang terpilih. Daftar produk mendukung filter merek dan urutan harga terendah/tertinggi.
- Arah visual aplikasi **Graphite Pro** memakai logo toko di area merek dan ikon instalasi PWA.

## Akses berdasarkan role

- **Pemilik:** ringkasan, penerimaan & barcode, produk & stok, garansi, pelanggan & supplier, keuangan, dan pengelolaan cabang/operator. Tidak ada menu kasir atau QC & repair.
- **Operator:** ringkasan, penerimaan & barcode, produk & stok, kasir, servis pelanggan, garansi, pelanggan & supplier, dan keuangan untuk cabangnya.
- **Teknisi:** hanya halaman QC & repair untuk cabangnya.

## Deploy ke Vercel

Import repo GitHub `nullnamenymous-creator/digi-laptop` sebagai project Vercel. Gunakan preset **Vite**, perintah build `npm run build`, dan output directory `dist`. Tambahkan environment variables berikut pada Vercel (Production, Preview, dan Development):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Setelah deploy pertama, tambahkan domain custom di **Project Settings → Domains** Vercel dan ikuti nilai DNS yang ditampilkan Vercel. Tambahkan URL domain ke **Supabase → Authentication → URL Configuration → Site URL / Redirect URLs** supaya konfirmasi email mengarah kembali ke domain app.

## Catatan operasi

- Publishable key memang digunakan pada browser. Jangan pernah menaruh Supabase secret/service-role key di frontend atau repository.
- Foto kondisi awal dan bukti penyerahan servis diunggah ke bucket privat `service-evidence`.
- PWA meng-cache kerangka app untuk membuka layar saat offline. Perubahan stok dan transaksi membutuhkan koneksi dan tidak disimpan antrean offline.
- Portal publik tersedia di `/catalog` dan hanya menampilkan produk yang pemilik tandai **Publikasikan**.

- Total nota barang masuk dihitung otomatis di database dari jumlah unit dikali harga modal per unit. Nilai sisa masuk ke saldo hutang supplier; harga modal per unit produk terdaftar otomatis terisi sebagai nilai awal.
