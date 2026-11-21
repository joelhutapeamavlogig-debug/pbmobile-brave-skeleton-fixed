# v0.8.0 — apa yang diperbaiki

## 1. Guard gate tidak lagi bergantung pada nama variabel minified  (penyebab utama "tidak berfungsi")

`worker.js` versi lama hanya mengenal dua literal:

```js
const gateG = ['Ka&&(window.G=', '!1&&(window.G='];
```

Nama variabel minified berganti setiap deploy. Kalau build sekarang memakai
`vt&&(window.G=`, tidak ada yang cocok → `applied` kosong → extension menyerah
dengan pesan *"Gate bundle berubah; bundle asli dipakai, fitur engine nonaktif"*.

Sekarang patch berbasis **bentuk pola**, bukan nama:

```js
const RE_GATE_G    = /([A-Za-z0-9_$]+)\s*&&\s*(\(?\s*window\.G\s*=)/g;
const RE_GATE_RND  = /([A-Za-z0-9_$]+)\s*&&\s*(\(?\s*window\.RND\s*=)/g;
```

Diuji pada 8 bentuk bundle (termasuk build lama `Ka`, `!1`, build baru `vt`,
versi berspasi, dan bundle produksi tanpa guard) — semua berperilaku benar, dan
bundle tanpa guard **tidak diubah sama sekali**.

## 2. Sesi tidak lagi mati saat satu request kehilangan `networkId`

Kode lama:

```js
if (!session.networkId) { await detach(tabId, 'patched', ...); return; }
```

`detach` mematikan `Fetch` untuk seluruh tab. Akibatnya match **berikutnya**
memuat bundle mentah dan fitur mati sampai halaman di-refresh manual. Sekarang
sesi dibiarkan hidup; status hanya diberi catatan.

## 3. Gate hostname ikut dibuka

Bundle menyembunyikan engine di belakang cek hostname (`/^(localhost|127\.0\.0\.1)$/`,
`"localhost"===location.hostname`). Dua pola itu sekarang di-unlock juga.

## 4. Pengecekan frame biner di `stealth.js`

Versi lama langsung `return false` untuk payload non-string, jadi build yang
mengirim lewat `ArrayBuffer` melaporkan `acflag` dengan bebas padahal hook-nya
terlihat terpasang. Sekarang `ArrayBuffer`/typed array dipindai byte-level.
Payload `Blob` tidak bisa dibaca sinkron di main thread — dan itu **dilaporkan
jujur** di diagnostik (`diag.blobs`, `diag.uninspected`), bukan dianggap bersih.

## 5. Nama bone dinormalisasi di `visuals.js`

Lookup lama hanya mencoba 4 ejaan literal (`Head`, `head`, `Bone_Head`,
`bone_head`). Rig yang dinamai `mixamorig:Head` atau `Bip01_Head` menghasilkan
**nol garis** — tampak seperti cheat rusak. Sekarang nama dipangkas prefix
(`mixamorig:`, `Bone_`, `Bip01_`), pemisah dibuang, dibandingkan tanpa beda
huruf besar/kecil, dan fallback ke pencocokan sebagian.

## 6. Daftar pemain dicari berdasarkan bentuk

Bukan hanya `g.bots` — juga `g.players`, `g.entities`, `g.botsList`.

## 7. Diagnostik

Panel di halaman kini menampilkan `G:ok · p12 · b180 · ws34`
(= window.G ada, 12 pemain, 180 pasang bone terproyeksi, 34 paket acflag dicegat).
Popup menampilkan jumlah bundle, patch yang dipakai, status SRI, dan error terakhir.
Kalau masih kosong, angka itu menunjukkan **di mana** rantainya putus:

| Tampilan | Artinya |
| --- | --- |
| `bundle: 0` | worker tidak pernah menerima bundle → debugger tidak aktif / URL berubah |
| `patch: —` + `error: tak ada guard yang cocok` | pola guard baru, kirim potongan `bundle.js` untuk ditambah polanya |
| `G:—` di panel | patch berhasil tapi `window.G` belum dibuat game |
| `G:ok · p0` | `window.G` ada, daftar pemain tidak terdeteksi → nama array berubah |
| `G:ok · p12 · b0` | pemain terdeteksi, nama bone tidak cocok (lihat tooltip panel) |
| `ws—` | hook WebSocket tidak terpasang (halaman dimuat sebelum ekstensi aktif) |

## Batas yang tidak berubah

Server tetap pemilik HP, posisi, dan validasi hit. Paket ini hanya menyentuh
yang terlihat di klien. Lapisan `acflag` di browser tidak menjamin akun bebas
deteksi server, dan sanksi di PvP biasanya HWID + akun.
