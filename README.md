# Digi-Laptop

Web app operasional untuk DIGITAL LAPTOP JOMBANG: role pemilik/operator/teknisi, cabang, penerimaan borongan, barcode, QC dan repair, stok, kasir, tiket servis, dan klaim garansi. App dibuat sebagai Vite SPA + PWA. Data bersama disimpan di Supabase; Vercel hanya menyajikan aplikasi.

## Menjalankan di komputer

1. Install Node.js 20.19+ atau 22.12+.
2. Jalankan `npm install`.
3. Pastikan `.env.local` memiliki `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY` untuk project Digi-Laptop.
4. Jalankan `npm run dev` dan buka alamat lokal yang ditampilkan.

Project Supabase target: `pklfnrxcczvphxzzmrwx` (region Singapore). Skema dan Row Level Security sudah disiapkan di project tersebut. Salinan skema sumber ada di `supabase/schema.sql`.

## Akun dan cabang

- Buat akun pertama melalui **Buat akun**. Setelah konfirmasi email dan masuk, lengkapi penyiapan DIGITAL LAPTOP JOMBANG serta nama cabang yang benar.
- Pemilik membuka **Pengaturan Aplikasi → Tambah akun**, lalu mengisi nama, email, password, role **Operator** atau **QC**, dan cabang. Akun langsung aktif. Dari daftar anggota, pemilik dapat mengubah data/akses/password atau menghapus akun.

## Alur penerimaan, QC, dan repair

1. Pemilik/operator mencatat penerimaan di **Penerimaan & barcode**. Laptop mendapatkan barcode stok unik per unit; lembar label dapat dicetak sekaligus sebelum laptop masuk rak. Produk selain laptop langsung masuk stok.
2. Teknisi membuka **QC & repair**, memindai barcode stok, memasukkan serial/barcode supplier, dan mencatat hasil pemeriksaan. Unit laptop belum tersedia bagi kasir sampai lolos QC.
3. Unit bermasalah masuk papan repair. Teknisi mencatat progres, memakai sparepart dari stok cabang, lalu mengirim unit ke QC akhir. Hanya unit yang lolos QC akhir masuk stok jual.
4. Saat laptop bergaransi terjual, sistem membuat **kode QR garansi internal** yang berbeda dari barcode stok. Staf dapat mencetak QR dan memindainya dari halaman **Garansi** untuk melihat status, tanggal berlaku, pelanggan, dan nomor nota. Pelanggan tidak perlu memindai QR.
5. Semua halaman mengacu pada data cabang yang sama. Perubahan penerimaan, QC, repair, penjualan, dan stok disiarkan ke anggota tim secara langsung.

## Pelanggan, supplier, dan keuangan

- Barang baru dapat dibuat langsung di form **Penerimaan & barcode**; tidak perlu membuat produk lebih dulu. Supplier terdaftar dipilih otomatis; supplier baru dapat dibuat di form yang sama. Dua huruf awal nama supplier dipakai sebagai awalan barcode, misalnya **AS-DL-…** untuk Asep.
- Penjualan dapat dicatat lunas atau tempo. Piutang penjualan dan servis dikelola bersama kontak pada tab **Pelanggan**; pembayaran berikutnya memperbarui saldo dan kas masuk.
- Penerimaan barang mencatat nilai nota, pembayaran awal, dan jatuh tempo. Sisa hutang tampil pada tab **Supplier**; pelunasan tercatat sebagai kas keluar.
- Halaman **Keuangan** mencatat pengeluaran dan pemasukan lain, merangkum kas masuk/keluar bulan ini, serta menyediakan filter **Semua cabang** untuk pemilik. Operator hanya melihat cabangnya.
- Produk baru wajib memiliki foto. Foto dapat dipilih dari file PC/galeri ponsel atau diambil langsung dengan kamera; produk lama dapat dilengkapi dari tombol **Foto/Ganti foto**. Gambar tersimpan di Supabase Storage dan dipakai di halaman stok.
- Beranda menampilkan laptop terlaris dan stok laptop siap jual per merek berdasarkan cabang terpilih. Daftar produk mendukung filter merek dan urutan harga terendah/tertinggi.
- Arah visual aplikasi **Graphite Pro** memakai logo toko di area merek dan ikon instalasi PWA.

## Akses berdasarkan role

- **Pemilik:** dashboard, penerimaan & barcode, produk & stok, garansi, pelanggan & supplier, keuangan, dan pengelolaan cabang/operator. Tidak ada menu kasir atau QC & repair.
- **Operator:** dashboard, penerimaan & barcode, produk & stok, kasir, servis pelanggan, garansi, pelanggan & supplier, dan keuangan untuk cabangnya.
- **Teknisi:** halaman QC & repair serta antrean servis pelanggan untuk cabangnya. Teknisi hanya mengubah tiket yang ditugaskan kepadanya atau belum ditugaskan.

## Deploy ke Vercel

Import repo GitHub `nullnamenymous-creator/digi-laptop` sebagai project Vercel. Gunakan preset **Vite**, perintah build `npm run build`, dan output directory `dist`. Tambahkan environment variables berikut pada Vercel (Production, Preview, dan Development):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Setelah deploy pertama, tambahkan domain custom di **Project Settings → Domains** Vercel dan ikuti nilai DNS yang ditampilkan Vercel. Tambahkan URL domain ke **Supabase → Authentication → URL Configuration → Site URL / Redirect URLs** supaya konfirmasi email mengarah kembali ke domain app.

## Catatan operasi

- Publishable key memang digunakan pada browser. Jangan pernah menaruh Supabase secret/service-role key di frontend atau repository.
- Foto kondisi awal dan bukti penyerahan servis diunggah ke bucket privat `service-evidence`.
- PWA meng-cache kerangka app untuk membuka layar saat offline. Kasir dapat menyimpan antrean transaksi di perangkat dan mengirimkannya saat koneksi kembali; penerimaan, stok, QC, servis, dan keuangan tetap membutuhkan koneksi. Antrean lokal hanya ada di perangkat itu, dan konflik stok harus diperiksa operator.

- Total nota barang masuk dihitung otomatis di database dari jumlah unit dikali harga modal per unit. Nilai sisa masuk ke saldo hutang supplier; harga modal per unit produk terdaftar otomatis terisi sebagai nilai awal.
