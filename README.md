# Digi-Laptop

Web app operasional untuk DIGITAL LAPTOP JOMBANG: role pemilik/operator, cabang, produk, barcode dan stok, kasir, tiket servis, klaim garansi, serta katalog publik. App dibuat sebagai Vite SPA + PWA. Data bersama disimpan di Supabase; Vercel hanya menyajikan aplikasi.

## Menjalankan di komputer

1. Install Node.js 20.19+ atau 22.12+.
2. Jalankan `npm install`.
3. Pastikan `.env.local` memiliki `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY` untuk project Digi-Laptop.
4. Jalankan `npm run dev` dan buka alamat lokal yang ditampilkan.

Project Supabase target: `pklfnrxcczvphxzzmrwx` (region Singapore). Skema dan Row Level Security sudah disiapkan di project tersebut. Salinan skema sumber ada di `supabase/schema.sql`.

## Akun dan cabang

- Buat akun pertama melalui **Buat akun**. Setelah konfirmasi email dan masuk, lengkapi penyiapan DIGITAL LAPTOP JOMBANG serta nama cabang yang benar.
- Pemilik membuat undangan operator dari menu **Cabang & operator**. Operator membuat akun memakai email yang diundang; role operator mendapat akses kasir dan servis pada cabang yang dipilih.
- Akun operator belum dibuat dari Supabase Admin API, jadi undangan tampil di aplikasi dan operator perlu mendaftar dengan email undangan tersebut.

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
