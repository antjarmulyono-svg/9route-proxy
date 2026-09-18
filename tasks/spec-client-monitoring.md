# Spec: Client Connections Monitoring & Usage Activity Analytics

## Objective
Menambahkan tabulasi navigasi di halaman `Client Connections & IP Monitoring` (`/dashboard/clients`):
1. **Tab 1: Connections** (Halaman daftar tabel IP klien, toggle routing, filter MITM/CLI, dan modal tambah/edit yang sudah ada).
2. **Tab 2: Usage & Activity Monitoring** (Informasi aktivitas aktif real-time + visualisasi grafik tren naik-turun request/traffic per-client).

## Fitur & Detail Komponen

### 1. Tab Navigasi Halaman Utama
- Menggunakan `SegmentedControl` konsisten dengan halaman Usage (`/dashboard/usage`).
- Tab:
  - `Connections` (icon: `devices` atau `dns`)
  - `Usage & Activity` (icon: `monitoring` atau `show_chart`)

### 2. Tab "Usage & Activity"
- **Top Metrics Strip**:
  - Total Active Clients (1 jam terakhir).
  - Peak Request Rate / Highest Traffic Client.
  - Total Tokens/Requests terlayani per IP.
- **Client Traffic Chart (Grafik Naik/Turun Request per Client)**:
  - Menggunakan library `Recharts` (`ResponsiveContainer`, `AreaChart`/`LineChart`).
  - Dropdown filter: Pilih Client IP (`All Clients` atau spesifik IP misalnya `127.0.0.1`, `10.10.123.206`).
  - Periode: `1h` (per menit), `24h` (per jam), `7d` (per hari).
  - Menampilkan kurva aktivitas naik/turun request secara real-time / time-series.
- **Client Usage Breakdown Table**:
  - Ringkasan per client IP: IP, Komputer/Alias, Total Request, Estimasi Tokens/Cost, Status aktifitas terkini, Last active spike.

### 3. Backend & Data Model
- **Endpoint API**:
  - `GET /api/clients/activity-stats?period=24h&ip=all`
  - Menyediakan data time-series per interval (bucket) per IP dari database `clients` dan `usageHistory`/activity log.
- **Database & Persistence**:
  - Mengagregasikan log request dari data yang ada di database tanpa membebani disk/IO SQLite (menggunakan query ringkas ber-index).

## Success Criteria
- [ ] User dapat berpindah antar tab `Connections` dan `Usage & Activity` dengan mulus tanpa reload halaman.
- [ ] Grafik time-series Recharts menampilkan data naik/turun request per client secara akurat.
- [ ] Filter client IP di grafik berfungsi dinamis.
- [ ] Semua fungsi existing (tambah IP, edit alias, toggle routing, auto-refresh) di tab `Connections` tetap berfungsi normal.
- [ ] `npm run test:gate` lolos tanpa regresi.
