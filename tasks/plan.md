# Implementation Plan: MIBP Features Port to Staging

## Overview
Implementasi fitur terpilih dari `mhiqrambg/9router-mibp-version` secara bertahap pada branch `feature/mibp-staging`, diverifikasi via unit test, lalu dideploy ke container staging (port 20129).

## Task List

### Phase 1: Test Isolation & Usage Guard (Fondasi)
- [ ] Task 1.1: Port `tests/setup/isolateDataDir.js` dan kaitkan ke `tests/vitest.config.js`.
- [ ] Task 1.2: Tambahkan guard test `tests/unit/test-data-dir-isolation.test.js`.
- [ ] Task 1.3: Port `src/shared/utils/usageProviders.js` (filter `!p.hidden`) dan pasang unit test `tests/unit/usage-provider-list.test.js`.

### Phase 2: Proxy Pool Fitness & Geo Probe Core
- [ ] Task 2.1: Port `open-sse/services/proxyPoolFitness.js` dan unit test `tests/unit/proxy-pool-fitness.test.js`.
- [ ] Task 2.2: Port `open-sse/services/poolGeo.js` dan unit test `tests/unit/pool-geo.test.js`.
- [ ] Task 2.3: Port `src/lib/network/poolEgressProbe.js` & `src/lib/network/stateSweeper.js` untuk probing IP keluar.
- [ ] Task 2.4: Integrasikan smart rotation pada `src/lib/network/connectionProxy.js` agar memfilter unfit pool.

### Phase 3: Dashboard Proxy Fitness UI
- [ ] Task 3.1: Tambahkan API routes `/api/proxy-pools/fitness` atau router helper terkait.
- [ ] Task 3.2: Port halaman dashboard `src/app/(dashboard)/dashboard/proxy-fitness/page.js`.
- [ ] Task 3.3: Daftarkan menu "Proxy Pool Fitness" di `src/shared/components/Sidebar.js`.

### Phase 4: Verifikasi & Deployment Staging
- [ ] Task 4.1: Jalankan `npm run test:gate` dan verifikasi 0 regresi.
- [ ] Task 4.2: Build image staging dan deploy:
  `docker compose -p 9router-staging -f docker-compose.staging.yml up -d --build`
- [ ] Task 4.3: Verifikasi API health port 20129 dan pastikan dashboard staging aktif.
