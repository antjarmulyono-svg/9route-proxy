- [ ] Task 1.1: Agregasi time-series client activity di repo database
  - Acceptance: Fungsi `getClientActivityStats(period, ip)` tersedia dan mengembalikan array titik grafik `{ time, label, requests, ... }`.
  - Verify: Test run via node script / unit test.
  - Files: `src/lib/db/repos/clientsRepo.js`

- [ ] Task 1.2: Endpoint API `/api/clients/activity-stats`
  - Acceptance: Request `GET /api/clients/activity-stats?period=24h` mengembalikan JSON `{ ok: true, stats: [...] }`.
  - Verify: curl endpoint via local port 20128.
  - Files: `src/app/api/clients/activity-stats/route.js`

- [ ] Task 2.1: Komponen Grafik `ClientActivityTab`
  - Acceptance: Visualisasi grafik Recharts AreaChart responsif, interaktif (tooltip, legend, dropdown filter client IP, filter periode).
  - Verify: Render tanpa error komponen.
  - Files: `src/app/(dashboard)/dashboard/clients/components/ClientActivityTab.js`

- [ ] Task 3.1: Tambahkan SegmentedControl tab navigasi pada Client Page
  - Acceptance: Tab `Connections` dan `Usage & Activity` bisa di-klik untuk berganti tampilan secara instan.
  - Verify: Klik tab berpindah view dengan lancar.
  - Files: `src/app/(dashboard)/dashboard/clients/ClientsPageClient.js`

- [ ] Task 4.1: Jalankan regression gate
  - Acceptance: `npm run test:gate` lulus (0 regresi).
  - Verify: Terminal exit code 0.

- [ ] Task 4.2: Build dan update container docker
  - Acceptance: Container `9router` terupdate melalui `make docker-update` dan berjalan sehat.
  - Verify: `docker ps` dan curl `/api/health`.
