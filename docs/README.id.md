<div align="center">

# opencode-adapter

**Paparkan model gratis OpenCode Zen sebagai provider yang kompatibel dengan OpenAI untuk 9Router.**
Tanpa akun OpenCode, tanpa API key, tanpa langganan — adapter adaptif lokal maupun server.

Model gratis · sinkronisasi live adaptif · klien teratestasi · kompatibel OpenAI · tanpa dependensi

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](../LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](../package.json)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI--compatible-6ea8fe?style=flat-square)](https://platform.openai.com/docs/api-reference/chat)
[![9Router](https://img.shields.io/badge/integrates-9Router-8b5cf6?style=flat-square)](https://9router.com)
[![OpenCode](https://img.shields.io/badge/upstream-opencode.ai-18181b?style=flat-square)](https://opencode.ai)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=flat-square)](https://github.com/Hazz-i/opencode-adapter/pulls)

[English](../README.md) · [Indonesia](README.id.md) · [Español](README.es.md) · [日本語](README.ja.md) · [中文](README.zh.md)

</div>

---

## Apa itu

OpenCode menyediakan **free tier** — sekumpulan model yang dapat digunakan tanpa biaya. Aksesnya diproteksi oleh gateway:
permintaan biasa akan ditolak dengan `403 FreeTierError: "OpenCode's free tier can only be used from within OpenCode"` kecuali request membawa fingerprint klien resmi.

`opencode-adapter` mereproduksi fingerprint tersebut ke dalam adapter kecil dengan **auto-discovery adaptif**, sehingga **9Router — dan aplikasi apa pun yang terhubung ke 9Router — dapat memanggil model-model gratis ini secara otomatis tanpa perlu menambah model manual.**

```
Klien OpenAI ──▶ 9Router :20128/v1 ──▶ provider-node "OpenCode Free"
             ──▶ adapter :8790/v1 ──▶ opencode.ai/zen/v1  (Bearer public + attestasi)
```

> Lihat **[STRUCTURE.md](../STRUCTURE.md)** untuk arsitektur lengkap, peta berkas, dan diagram alur data.

---

## Model Gratis Adaptif (Auto-Sync)

OpenCode sering melakukan rotasi model (menghentikan model lama dan merilis model baru). **Adapter ini secara otomatis memeriksa OpenCode Zen** (`/models`) saat startup dan setiap 30 menit di background:

| Model | Endpoint | Konteks | Catatan |
|-------|----------|---------|---------|
| `cat-jam-free` | chat/completions | 1M | model baru, terdeteksi otomatis |
| `big-pickle` | chat/completions | 200K | penalaran umum |
| `ling-3.1-flash-free` | chat/completions | 262K | flash cepat |
| `longcat-2.5-preview-free` | chat/completions | 1M | konteks panjang |
| `mimo-v2.6-flash-free` | chat/completions | 200K | flash ringkas |
| `nemotron-3.5-lightning-free` | chat/completions | 262K | latensi rendah |
| `space-bunny-free` | chat/completions | 1M | output 512K |
| `step-5-preview-free` | chat/completions | 1M | andalan StepFun, teks+gambar+video |
| `muse-spark-1.2-contributor-free` | responses | 1M | model contributor |
| `muse-spark-1.3-contributor-free` | responses | 1M | model contributor |

**Otomatis Dikeluarkan**: Model yang sudah kadaluarsa (seperti `fledge-alpha-free` atau `exo-free`) akan otomatis dihapus dari daftar rute.

**Tidak Diproksi**: `jev-1.13-free` (menggunakan protokol SystemOne; ditangani langsung oleh 9Router).

Jalankan `node src/cli.js list` untuk melihat daftar live terkini.

---

## Mulai Cepat (Setup Lokal)

Membutuhkan **Node.js >= 18**. Tanpa dependensi pihak ketiga.

```bash
git clone https://github.com/Hazz-i/opencode-adapter.git
cd opencode-adapter

# 1. jalankan adapter (http://127.0.0.1:8790/v1)
node src/adapter.js

# 2. di terminal lain, daftarkan ke 9Router lokal
node src/connect-9router.js
```

### Coba model langsung via CLI

```bash
node src/cli.js ask cat-jam-free "Jelaskan apa itu closures dalam 1 baris"
node src/cli.js check          # uji seluruh model aktif
```

---

## Panduan Setup pada Server yang 9Router-nya Sudah Dideploy (Remote / VPS)

Jika 9Router kamu sudah berjalan di server / VPS (contoh: `https://nine.domain-kamu.com`), pilih salah satu metode berikut:

### Pilihan A: Jalankan Adapter di VPS yang Sama (Sangat Direkomendasikan)

Menjalankan adapter di server yang sama dengan 9Router adalah solusi terbaik karena latensi paling rendah dan tidak perlu membuka port adapter ke internet publik:

1. **Clone repo ini di VPS kamu:**
   ```bash
   git clone https://github.com/Hazz-i/opencode-adapter.git
   cd opencode-adapter
   ```

2. **Jalankan adapter di background (menggunakan PM2 / Systemd):**
   ```bash
   npm install -g pm2 # jika belum ada
   pm2 start src/adapter.js --name opencode-adapter
   pm2 save
   ```
   Atau menggunakan nohup:
   ```bash
   nohup node src/adapter.js > adapter.log 2>&1 &
   ```

3. **Daftarkan provider ke 9Router:**
   Jalankan script konektor langsung di dalam VPS:
   ```bash
   node src/connect-9router.js
   ```
   Atau masukkan manual melalui Web Dashboard (Pilihan B).

---

### Pilihan B: Tambah Manual Lewat Web Dashboard 9Router (Tanpa Script CLI)

Jika kamu memiliki akses ke Dashboard Web 9Router, kamu tidak wajib menggunakan script `connect-9router.js`:

1. Buka browser: `https://nine.domain-kamu.com/dashboard`
2. Masuk ke menu **Providers** / **Provider Nodes** ➔ klik **Add Provider** (atau Add Custom Node).
3. Isi kolom sebagai berikut:
   - **Name**: `OpenCode Free`
   - **Prefix**: `ocfree`
   - **Type**: `openai-compatible`
   - **Base URL**: `http://127.0.0.1:8790/v1` *(jika adapter berada di VPS yang sama)* atau URL tunnel publik kamu
   - **API Key**: `sk-opencode-free`
   - **API Type**: `chat`
4. Klik **Save**.
5. Model live akan otomatis muncul di bawah prefix `ocfree/...`. Kamu dapat mengklik tombol **Refresh Models** pada kartu provider kapan saja untuk memaksa update instan.

---

### Pilihan C: Adapter di Laptop Lokal + 9Router di VPS Cloud (Menggunakan Tunnel)

Jika kamu ingin adapter tetap berjalan di laptop lokal sementara 9Router ada di VPS:

1. Jalankan adapter di laptop:
   ```bash
   node src/adapter.js
   ```

2. Buka tunnel untuk port `8790` ke publik menggunakan Cloudflare Tunnel atau ngrok:
   ```bash
   npx cloudflared tunnel --url http://127.0.0.1:8790
   # atau: ngrok http 8790
   ```
   Kamu akan mendapatkan URL HTTPS publik (contoh: `https://adapter-kamu.trycloudflare.com`).

3. Di Web Dashboard 9Router VPS kamu, set **Base URL** provider ke:
   ```
   https://adapter-kamu.trycloudflare.com/v1
   ```

---

## Cara Kerja Fingerprint Gate

Gateway upstream hanya melayani model gratis ke klien resmi OpenCode. Adapter menginjeksikan header & body berikut:

| Sinyal | Nilai |
|--------|-------|
| `User-Agent` | `opencode/<versi>` (versi >= 1.17) |
| `x-opencode-client` | `desktop` |
| `x-opencode-session` | `ses_<12 hex><14 base62>` — stabil per sesi/identitas |
| `x-opencode-request` | `msg_<12 hex><14 base62>` — deterministik per giliran |
| `Authorization` | `Bearer public` |
| `stream` (body) | `true` — permintaan non-stream ditolak |
| `tools` (body) | `bash`, `glob`, `grep`, `read` — kuartet fingerprint |

Semua modul berada di [`src/opencode_free.js`](../src/opencode_free.js) dan diverifikasi oleh `npm test`.

---

## Tata Letak Proyek

```
opencode-adapter/
├── src/
│   ├── opencode_free.js     # attestasi, id, shaping, auto-sync model, complete()
│   ├── adapter.js           # server HTTP kompatibel OpenAI (:8790/v1) auto-refresh 30 menit
│   ├── connect-9router.js   # daftarkan provider ke 9Router dengan auto-load .env
│   ├── cli.js               # list / ask / check
│   └── selftest.js          # uji unit offline + live
├── docs/                    # dokumentasi multibahasa
├── STRUCTURE.md             # topologi arsitektur dan peta berkas
└── package.json
```

---

## Pengujian

```bash
npm test              # offline: 11 pemeriksaan, instan
npm run test:live     # verifikasi langsung ke server opencode.ai
```

---

## Lisensi

[MIT](../LICENSE) © 2026 Hazz-i
