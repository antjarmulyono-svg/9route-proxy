- [x] Task 1.1: Setup test isolation `tests/setup/isolateDataDir.js`
  - Acceptance: Test runner tidak menulis ke ~/.9router real DB.
  - Verify: vitest run `tests/unit/test-data-dir-isolation.test.js` pass.
  - Files: `tests/setup/isolateDataDir.js`, `tests/vitest.config.js`, `tests/unit/test-data-dir-isolation.test.js`

- [x] Task 1.2: Usage Provider filter `!p.hidden`
  - Acceptance: Hidden provider seperti `devin-cli`, `mimo-free` tidak muncul di usage list.
  - Verify: vitest run `tests/unit/usage-provider-list.test.js` pass.
  - Files: `src/shared/utils/usageProviders.js`, `tests/unit/usage-provider-list.test.js`

- [x] Task 2.1: Implementasi Proxy Pool Fitness Registry
  - Acceptance: `markPoolUnfit`, `isPoolFit`, `fitPoolIds` bekerja dengan TTL expiry.
  - Verify: vitest run `tests/unit/proxy-pool-fitness.test.js` pass.
  - Files: `open-sse/services/proxyPoolFitness.js`, `tests/unit/proxy-pool-fitness.test.js`

- [x] Task 2.2: Implementasi Pool Geo & Stability Egress
  - Acceptance: Cache geo egress mendeteksi kestabilan IP per pool.
  - Verify: vitest run `tests/unit/pool-geo.test.js` pass.
  - Files: `open-sse/services/poolGeo.js`, `tests/unit/pool-geo.test.js`

- [x] Task 2.3: Integrasikan Smart Rotation di Connection Proxy
  - Acceptance: `pickProxyPoolId` menyaring pool yang unfit saat mode smart.
  - Verify: unit test `tests/unit/proxy-pool-fitness.test.js` pass.
  - Files: `src/lib/network/connectionProxy.js`

- [x] Task 3.1: Halaman Dashboard Proxy Fitness
  - Acceptance: Halaman `/dashboard/proxy-fitness` aktif, menampilkan status kesehatan pool, geo, dan latency probe.
  - Verify: Render UI dan navigasi sidebar.
  - Files: `src/app/(dashboard)/dashboard/proxy-fitness/page.js`, `src/shared/components/Sidebar.js`

- [x] Task 4.1: Quality Gate & Test Regression
  - Acceptance: `npm run test:gate` pass dengan 0 regresi.
  - Verify: Terminal exit 0.

- [x] Task 4.2: Build & Deploy ke Container Staging
  - Acceptance: `docker compose -p 9router-staging -f docker-compose.staging.yml up -d --build` berhasil.
  - Verify: `curl -s http://127.0.0.1:20129/api/health` return `{"ok":true}`.
