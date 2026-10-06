# Musikku

Musikku adalah pemutar musik pribadi untuk koleksi file yang kamu miliki. Aplikasi tidak menyediakan, mengunduh, atau mencari musik dari sumber eksternal. Semua file tetap berada di server milikmu.

## Fitur

- Unggah MP3, M4A, FLAC, WAV, dan OGG tanpa batas ukuran per file; impor tetap dibatasi kapasitas penyimpanan yang tersedia.
- Metadata, cover, dan lirik tertanam dibaca saat unggah; file `.lrc` senama diutamakan.
- Tambah folder musik secara rekursif; lirik `.lrc` lokal ikut diimpor dan tersimpan bersama metadata lagu.
- Library lagu, album, artis, pencarian, pengurutan, playlist, favorit, dan antrean.
- Streaming privat dengan HTTP Range untuk seek, seek 5/15 detik, durasi, dan pemulihan posisi terakhir.
- Tampilan lirik tersinkron dari file lokal atau tag audio, impor/edit `.lrc`/`.txt`, offset sinkronisasi, dan ukuran font. Musikku tidak mengambil lirik dari internet.
- Player responsif, kontrol media keyboard, Media Session, shuffle, repeat, dan posisi terakhir.
- Sesi owner memakai Argon2id dan JWT di cookie httpOnly.

## Menjalankan untuk pengembangan

Persyaratan: Node.js 22 atau lebih baru dan npm. SQLite memakai `better-sqlite3`; Windows yang tidak mempunyai binary prebuilt untuk versi Node terpilih mungkin memerlukan Visual Studio C++ Build Tools.

```powershell
npm install
Copy-Item .env.example .env
```

Ganti `JWT_SECRET` dengan string acak minimal 32 karakter dan `OWNER_PASSWORD` dengan kata sandi panjang/unik di `.env`. Server membuat akun owner saat pertama dijalankan; mengganti `OWNER_PASSWORD` setelah akun dibuat tidak mereset hash akun tersebut.

```powershell
npm run dev
```

Frontend tersedia di <http://localhost:5173>; API berjalan di port 3001. File `.env` berada di root monorepo. Data lokal bawaan tersimpan di `server/data/` relatif terhadap server: SQLite, `music/`, dan `covers/`.

## Perintah

```powershell
npm run dev          # Vite dan Express
npm run build        # Build server dan client
npm start            # Jalankan server production (client/dist disajikan oleh Express)
npm test             # Unit dan integration tests server
npm run lint         # ESLint
npm run format       # Format dengan Prettier
npm run format:check # Periksa format
npm audit            # Audit dependency
```

Setelan utama ada di `.env.example`: `PORT`, `HOST`, `DATA_DIRECTORY`, `DATABASE_PATH`, `JWT_SECRET`, `JWT_TTL_SECONDS`, `OWNER_USERNAME`, `OWNER_PASSWORD`, `CLIENT_ORIGIN`, dan `MUSIKKU_UPDATE_URL` (opsional, untuk feed update desktop). Migrasi SQLite dijalankan otomatis saat startup.

## Aplikasi desktop Windows

Musikku juga dapat dikemas sebagai installer Windows `.exe` menggunakan Electron. Persyaratan untuk membuat installer adalah Windows x64, Node.js 24.x, dan npm. Installer menyertakan runtime Node 24 dan dependensi produksi backend, termasuk dependensi yang npm hoist ke root workspace; pengguna tidak perlu memasang Node.js atau Visual Studio Build Tools. Aplikasi desktop membuat sesi lokal secara otomatis dan langsung membuka player; tidak ada layar setup atau login.

```powershell
npm install
npm run desktop:dist
```

Alias singkat yang sama untuk membuat installer:

```powershell
npm run dist
```

Installer NSIS akan dibuat di `release/Musikku-Setup-1.0.0.exe`. Jalankan installer lalu buka Musikku dari shortcut Start Menu atau Desktop. Akun owner lokal dibuat otomatis dengan password acak yang tidak ditampilkan; autentikasi desktop menggunakan token satu kali per proses backend dan cookie sesi httpOnly. Lagu, database, dan sesi desktop tersimpan di folder data aplikasi.

Pembaruan otomatis desktop menggunakan generic HTTPS update feed. Isi `MUSIKKU_UPDATE_URL` di `.env` dengan URL direktori publik tempat file update akan dihosting sebelum membuat installer. Naikkan versi `version` di `package.json`, lalu jalankan `npm run desktop:dist`. Salin `latest.yml`, file installer `.exe`, dan file `.blockmap` yang dihasilkan di `release/` ke direktori feed tersebut. Aplikasi terpasang akan memeriksa versi baru saat dibuka; pengguna bisa mengunduh update dan memilih **Restart & Install**. Tanpa `MUSIKKU_UPDATE_URL`, installer tetap berfungsi tetapi tidak memeriksa update.

Database dan musik desktop tersimpan di folder data aplikasi Windows milik pengguna (`%APPDATA%\\musikku\\data`); folder ini terpisah dari data mode pengembangan dan tidak dihapus saat aplikasi diperbarui. Cadangkan folder data tersebut saat Musikku ditutup. Backend desktop hanya menerima koneksi dari komputer lokal. Untuk mencoba shell desktop tanpa membuat installer, jalankan `npm run desktop:dev`.

## Docker

```powershell
Copy-Item .env.example .env
# Atur JWT_SECRET dan OWNER_PASSWORD di .env, lalu:
docker compose up --build -d
```

Buka <http://localhost:3001>. Compose menyimpan database dan musik pada `./data` host yang di-mount sebagai `/data` di container.

## Backup dan pemulihan

Hentikan aplikasi terlebih dahulu agar salinan SQLite konsisten, lalu salin seluruh direktori data. Database dan media harus dicadangkan bersama.

```powershell
docker compose stop
Copy-Item -Recurse data backup-musikku
docker compose start
```

Untuk pemulihan, hentikan container, simpan salinan data lama, salin isi backup kembali ke `data/`, lalu jalankan ulang Compose. Untuk instalasi non-Docker, hentikan proses Node sebelum menyalin direktori yang diatur oleh `DATA_DIRECTORY`.

## Keamanan dan privasi

- Semua endpoint API selain login memerlukan sesi owner.
- Login dan unggah dibatasi laju; file diperiksa berdasarkan magic bytes, bukan MIME browser.
- Cookie sesi httpOnly, same-site strict, dan secure di mode production.
- CORS dibatasi ke `CLIENT_ORIGIN`; jangan mengekspos Musikku ke jaringan publik tanpa memahami risiko dan memasang TLS/proteksi jaringan.
- Jangan unggah musik yang tidak kamu miliki atau tidak berlisensi untuk digunakan.
