# Digi-Laptop

Web app operasional untuk DIGITAL LAPTOP JOMBANG: role pemilik/operator/teknisi, cabang, penerimaan borongan, barcode, QC dan repair, stok, kasir, tiket servis, dan klaim garansi. App dibuat sebagai Vite SPA + PWA. Data bersama disimpan di Supabase; Vercel hanya menyajikan aplikasi.

## Menjalankan di komputer

1. Install Node.js 20.19+ atau 22.12+.
2. Jalankan `npm install`.
3. Pastikan `.env.local` memiliki `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY` untuk project Digi-Laptop.
4. Jalankan `npm run dev` dan buka alamat lokal yang ditampilkan.

Project Supabase target: `pklfnrxcczvphxzzmrwx` (region Singapore). Skema dan Row Level Security sudah disiapkan di project tersebut. Salinan skema sumber ada di `supabase/schema.sql`.

## Akun dan cabang

- Masuk menggunakan email dan kata sandi akun yang sudah dibuat. Untuk mendapatkan akun, hubungi admin toko.
- Pemilik membuka **Pengaturan Aplikasi → Tambah akun**, lalu mengisi nama, email, password, role **Admin Pusat**, **Operator**, atau **Teknisi**, dan cabang. Akun langsung aktif. Dari daftar anggota, pemilik dapat mengubah data/akses/password atau menghapus akun.

## Alur penerimaan, QC, dan repair

1. Pemilik mencatat supplier dan jumlah laptop borongan di **Penerimaan & barcode**. Sistem membuat barcode unik per laptop dan mencetak semua label; satu batch boleh berisi merek dan model yang berbeda.
2. Admin Pusat memindai barcode satu per satu untuk mencatat produk/model, spesifikasi, modal tunai per unit, serial, dan kondisi/minus. Biaya pembelian tunai masuk ke Keuangan dan modal stok setelah dicatat di QC.
3. Unit yang perlu perbaikan diteruskan ke antrean teknisi. Teknisi mencatat progres dan sparepart, lalu menyerahkan unit kembali ke Admin Pusat untuk QC akhir dan serah terima fisik. Unit normal juga menunggu konfirmasi serah terima sebelum siap dijual atau dimutasi.
4. Saat laptop bergaransi terjual, sistem membuat **kode QR garansi internal** yang berbeda dari barcode stok. Staf dapat mencetak QR dan memindainya dari halaman **Garansi** untuk melihat status, tanggal berlaku, pelanggan, dan nomor nota. Pelanggan tidak perlu memindai QR.
5. Semua halaman mengacu pada data cabang yang sama. Perubahan penerimaan, QC, repair, penjualan, dan stok disiarkan ke anggota tim secara langsung.

## Pelanggan, supplier, dan keuangan

- Form penerimaan laptop hanya meminta supplier dan jumlah. Supplier terdaftar dapat dipilih atau dibuat; data supplier disimpan di tab **Supplier**. Dua huruf awal nama supplier dipakai pada label barcode, misalnya **AS-DL-…** untuk Asep.
- Penjualan dapat dicatat lunas atau tempo. Piutang penjualan dan servis dikelola bersama kontak pada tab **Pelanggan**; pembayaran berikutnya memperbarui saldo dan kas masuk.
- Semua pembelian laptop borongan bersifat tunai. Admin Pusat mencatat modal per unit saat QC; sistem menghitung total belanja batch dan mencatat satu pengeluaran pembelian. Tab **Supplier** hanya menyimpan data kontak supplier.
- Halaman **Keuangan** mencatat pengeluaran dan pemasukan lain, merangkum kas masuk/keluar bulan ini, serta menyediakan filter **Semua cabang** untuk pemilik. Operator hanya melihat cabangnya.
- Produk baru wajib memiliki foto. Foto dapat dipilih dari file PC/galeri ponsel atau diambil langsung dengan kamera; produk lama dapat dilengkapi dari tombol **Foto/Ganti foto**. Gambar tersimpan di Supabase Storage dan dipakai di halaman stok.
- Beranda menampilkan laptop terlaris dan stok laptop siap jual per merek berdasarkan cabang terpilih. Daftar produk mendukung filter merek dan urutan harga terendah/tertinggi.
- Arah visual aplikasi **Graphite Pro** memakai logo toko di area merek dan ikon instalasi PWA.

## Akses berdasarkan role

- **Pemilik:** dashboard, penerimaan & barcode, QC & repair, produk & stok, garansi, pelanggan & supplier, keuangan, dan pengelolaan cabang/operator. Tidak ada menu kasir.
- **Admin Pusat:** penerimaan laptop borongan, QC awal dan akhir, serah terima fisik, stok Pusat, mutasi, dan katalog.
- **Operator:** dashboard, penerimaan & barcode, produk & stok, kasir, servis pelanggan, garansi, pelanggan & supplier, dan keuangan untuk cabangnya.
- **Teknisi:** antrean perbaikan laptop dan servis pelanggan untuk Cabang Pusat/cabangnya. QC awal borongan dilakukan Admin Pusat; teknisi mengerjakan unit yang diteruskan ke antrean repair.

## Deploy ke Vercel

Import repo GitHub `nullnamenymous-creator/digi-laptop` sebagai project Vercel. Gunakan preset **Vite**, perintah build `npm run build`, dan output directory `dist`. Tambahkan environment variables berikut pada Vercel (Production, Preview, dan Development):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Setelah deploy pertama, tambahkan domain custom di **Project Settings → Domains** Vercel dan ikuti nilai DNS yang ditampilkan Vercel. Tambahkan URL domain ke **Supabase → Authentication → URL Configuration → Site URL / Redirect URLs** supaya konfirmasi email mengarah kembali ke domain app.

## Catatan operasi

- Publishable key memang digunakan pada browser. Jangan pernah menaruh Supabase secret/service-role key di frontend atau repository.
- Foto kondisi awal dan bukti penyerahan servis diunggah ke bucket privat `service-evidence`.
- PWA meng-cache kerangka app untuk membuka layar saat offline. Kasir dapat menyimpan antrean transaksi di perangkat dan mengirimkannya saat koneksi kembali; penerimaan, stok, QC, servis, dan keuangan tetap membutuhkan koneksi. Antrean lokal hanya ada di perangkat itu, dan konflik stok harus diperiksa operator.

- Migrasi `20261120120000_bulk_laptop_intake_cash_qc.sql` menambahkan penerimaan laptop borongan, pencatatan QC per barcode, dan pengeluaran tunai pembelian. Jalankan migrasi ini pada Supabase sebelum memakai versi aplikasi yang menggunakannya.
