

---

# v0.9.0 — hardening anti-deteksi

Yang ditutup di ronde ini (semuanya nyata, bukan klaim):

## 1. Tidak ada global di `window`
v0.8.0 mempublikasikan `window.__pbStealth`, `window.__pbVisualsFull`, `window.__pbDiag`.
Scanner yang menyisir kunci `window` menemukannya dalam satu lintasan, sekalipun
isi fungsinya terlihat native. Sekarang seluruh state ada di closure; **tidak ada
satu pun properti baru di window**.

## 2. iframe ikut di-patch
v0.8.0 hanya mem-patch dokumen top. iframe same-origin tidak mewarisi patch,
jadi membandingkan `iframe.contentWindow.WebSocket.prototype.send` dengan punya
dokumen top — trik "clean frame" yang justru disebut di README sendiri —
langsung mengembalikan `berbeda` dan menandai klien. Sekarang `all_frames: true`.

## 3. Proxy punya bentuk yang wajar
`name` dipaksa `"send"`, `length` disamakan dengan native, penanda internal
`__pb` non-enumerable dan non-writable. Membandingkan properti satu per satu
dengan build bersih tidak lagi memberi selisih.

## 4. DOM tidak lagi memperlihatkan overlay
Panel dan canvas overlay dulu elemen biasa dengan atribut `data-pb="1"` —
bisa ditemukan `document.querySelector` dan terhitung di enumerasi `<canvas>`.
Sekarang keduanya di dalam **closed shadow root**: tidak terlihat oleh
`document.querySelector`, tidak masuk hitungan elemen, dan `canvas` game tidak
lagi bertambah satu.

## 5. localStorage bersih
`pbweb_chams_visible_color` / `pbweb_chams_color` adalah sidik jari permanen yang
bisa dibaca halaman kapan saja. Sekarang warna hanya di memori sesi.

## 6. `preboot.js` tidak lagi dimuat
preboot melakukan XHR sinkron ke halaman lalu `document.write` ulang — perubahan
DOM paling terlihat yang bisa dilakukan sebuah ekstensi, dan rapuh terhadap
Cloudflare. Jalur CDP di `worker.js` sudah cukup. File tetap ada sebagai
`preboot.optional.js` kalau kamu memang butuh fallback.

## Batas realistis — baca ini

Tidak ada yang bisa menjanjikan 99%. Deteksi tidak hanya di klien:

| Lapisan | Bisa ditutup? | Catatan |
| --- | --- | --- |
| Global window, DOM, localStorage | **Ya** | sudah, lihat di atas |
| Identitas fungsi (Proxy/toString) | **Ya** | sudah |
| Perbandingan clean-iframe | **Ya** | sudah, all_frames |
| `acflag` di frame teks | **Ya** | sudah |
| `acflag` di `Blob` | **Tidak** | tak bisa dibaca sinkron di main thread; dilaporkan, bukan diklaim bersih |
| `chrome.debugger` terpasang | **Sebagian** | Brave menampilkan infobar; halaman umumnya tak melihatnya |
| `window.G` terlihat oleh scanner klien | **Tidak** | konsekuensi langsung dari membuka gate |
| **Statistik perilaku di server** | **Tidak** | ini risiko dominan |

Poin terakhir yang paling menentukan. ESP/Chams memberi informasi yang secara
statistik tidak wajar: membidik pemain yang belum terlihat, reaksi <150 ms pada
sudut tak terduga, kill konsisten lewat dinding/asap. Tidak ada patch klien yang
menyembunyikan pola itu.

Cara menekan risiko perilaku (bukan menghilangkan):
- pakai jarak Skeleton rendah (20–40), bukan 120
- jangan menembak target yang belum pernah kamu lihat tanpa ESP
- sisipkan waktu reaksi manusiawi; jangan pre-aim konsisten
- jangan Chams terus-menerus; nyalakan saat mencari, matikan saat fight
- jangan main berturut-turut berjam-jam dengan perilaku identik tiap match
- akun dan device terpisah untuk uji coba
