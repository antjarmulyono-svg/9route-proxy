# Implementation Plan: Client Connections Tabs & Usage Activity Chart

## Overview
Menambahkan sistem tabulasi pada halaman `/dashboard/clients` dan dashboard pemantauan visual dengan grafik time-series untuk melihat tren aktivitas request per client IP.

## Task List

### Phase 1: Backend Data Aggregation API
- [ ] Task 1.1: Buat fungsi agregasi time-series client activity di repo (`src/lib/db/repos/clientsRepo.js` atau `usageRepo.js`).
  - Hitung request per bucket waktu (`1h` interval 2m, `24h` interval 1h, `7d` interval 1d).
  - Simpan / ambil data agregasi per IP.
- [ ] Task 1.2: Buat route endpoint `GET /api/clients/activity-stats`.
  - Dukung query params `period` dan `ip`.

### Phase 2: Frontend Client Activity Component & Chart
- [ ] Task 2.1: Buat komponen `ClientActivityTab.js` di `src/app/(dashboard)/dashboard/clients/components/`.
  - Buat visualisasi grafik `AreaChart` / `LineChart` dengan Recharts untuk tren naik-turun request client.
  - Dropdown selector untuk memilih client IP atau aggregate semua client.
  - Filter periode waktu (`1h`, `24h`, `7d`).
  - Summary cards aktivitas klien aktif.

### Phase 3: Integrasi Tabulasi di Halaman Client Connections
- [ ] Task 3.1: Tambahkan `SegmentedControl` di `ClientsPageClient.js` untuk beralih antara tab `Connections` dan `Usage & Activity`.
- [ ] Task 3.2: Render `ClientActivityTab` ketika tab `Usage & Activity` aktif, dan tetap pertahankan tabel koneksi di tab `Connections`.

### Phase 4: Verifikasi & Deployment
- [ ] Task 4.1: Jalankan `npm run test:gate` untuk memastikan tidak ada regresi.
- [ ] Task 4.2: Build dan deploy container dengan `make docker-update`.
- [ ] Task 4.3: Verifikasi fungsionalitas dan tampilan grafik.
