# Spec: Port MIBP Feature Suite to 9Router Staging

## Objective
Mengintegrasikan fitur unggulan dari fork `mhiqrambg/9router-mibp-version` ke dalam codebase 9Router lokal dan memverifikasinya secara aman di lingkungan STAGING (port 20129) tanpa menyentuh container produksi (port 20128).

Modul yang diimplementasikan:
1. **Module 1: Test Harness & Usage Isolation (`isolateDataDir` + `usageProviders !p.hidden`)**
   - Mencegah test suite vitest mengotori database riil SQLite `data.sqlite`.
   - Membersihkan leak provider tersembunyi tanpa autentikasi di halaman Usage.
2. **Module 2: Proxy Pool Fitness & Geo Probe (`proxy-fitness`)**
   - Monitoring kestabilan IP keluar proxy pool (`poolGeo`).
   - Registry status fitness proxy (`proxyPoolFitness`) dengan Smart Rotation.
   - Halaman dashboard dedicated `/dashboard/proxy-fitness`.
   - Probe multi-endpoint & background state sweeper.
3. **Module 3: Freebuff Provider Integration (`freebuff`)**
   - Executor Codebuff/Freebuff dengan sistem kuota Freebucks.
   - OAuth integration + usage tracking.

## Tech Stack & Environment
- Runtime: Node.js 22 (Alpine), Next.js 16 (Webpack)
- Persistent: Better-sqlite3 (`data.sqlite`)
- Staging Stack: `docker-compose.staging.yml`, port 20129, container `9router-staging`
- Production Stack: `docker-compose.yml`, port 20128, container `9router` (UNTOUCHED)

## Commands
- Build: `npm run build`
- Test Gate: `npm run test:gate`
- Unit Test Focused: `./tests/node_modules/.bin/vitest run tests/unit/proxy-pool-fitness.test.js`
- Staging Deploy: `docker compose -p 9router-staging -f docker-compose.staging.yml up -d --build`
- Staging Health: `curl -s http://127.0.0.1:20129/api/health`

## Boundaries
- Always: Jalankan di branch `feature/mibp-staging`.
- Always: Build dan tes di port 20129.
- Never: Mengubah atau me-restart container `9router` (port 20128) atau volume `9router-data`.

## Success Criteria
1. `npm run test:gate` lolos tanpa regresi.
2. Unit test `test-data-dir-isolation`, `proxy-pool-fitness`, `pool-geo`, dan `usage-provider-list` pass.
3. Halaman `/dashboard/proxy-fitness` dapat diakses di `http://10.10.123.206:20129`.
4. Endpoint staging `http://127.0.0.1:20129/api/health` merespons `{"ok":true}`.
