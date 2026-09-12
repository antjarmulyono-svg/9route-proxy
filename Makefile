.PHONY: help install dev build start docker-up docker-down docker-logs docker-restart docker-build docker-update docker-rebuild docker-run clean \
	staging-up staging-down staging-logs staging-restart staging-rebuild staging-ps staging-shell staging-clean

# Default configuration
PORT ?= 20128
BASE_URL ?= http://localhost:$(PORT)

# --- Staging configuration ---
# Stack staging TERPISAH dari produksi. Produksi memakai container `9router`
# pada port 20128 + 443; staging memakai `9router-staging` pada 20129 saja.
# -p dan -f WAJIB ikut di setiap perintah agar Compose tidak pernah
# menyentuh stack produksi.
STAGING_PROJECT ?= 9router-staging
STAGING_FILE ?= docker-compose.staging.yml
STAGING_PORT ?= 20129
STAGING_COMPOSE = docker compose -p $(STAGING_PROJECT) -f $(STAGING_FILE)

help: ## Tampilkan daftar perintah yang tersedia
	@echo "========================================================"
	@echo "                9Router Management Commands             "
	@echo "========================================================"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependensi npm
	npm install

dev: ## Jalankan mode development lokal (port 20128)
	PORT=$(PORT) NEXT_PUBLIC_BASE_URL=$(BASE_URL) npm run dev

build: ## Build aplikasi Next.js (production build)
	npm run build

start: ## Jalankan server Next.js production lokal
	PORT=$(PORT) HOSTNAME=0.0.0.0 npm run start

# --- Docker Compose Commands ---

docker-up: ## Jalankan container dengan docker compose (background)
	docker compose up -d

docker-down: ## Hentikan dan hapus container docker compose
	docker compose down

docker-logs: ## Pantau log container docker compose
	docker compose logs -f 9router

docker-restart: ## Restart container docker compose
	docker compose restart

docker-update: ## Rebuild (pakai cache) lalu jalankan — pakai ini setelah mengubah kode
	docker compose up -d --build

docker-rebuild: ## Rebuild image lokal dari nol (--no-cache) dan jalankan docker compose
	docker compose down
	docker compose build --no-cache
	docker compose up -d

# --- Standalone Docker Commands ---

docker-build: ## Build image docker 9router lokal
	docker build -t 9router .

docker-run: ## Build & jalankan single container docker 9router (standalone)
	-docker stop 9router 2>/dev/null || true
	-docker rm 9router 2>/dev/null || true
	docker build -t 9router .
	docker run -d --name 9router -p $(PORT):$(PORT) --env-file .env -v 9router-data:/app/data 9router

# --- Staging Commands (TIDAK menyentuh container produksi) ---

staging-up: ## [STAGING] Build & jalankan stack staging di port 20129
	$(STAGING_COMPOSE) up -d --build

staging-down: ## [STAGING] Hentikan dan hapus container staging (volume tetap)
	$(STAGING_COMPOSE) down

staging-logs: ## [STAGING] Pantau log container staging
	$(STAGING_COMPOSE) logs -f 9router-staging

staging-restart: ## [STAGING] Restart container staging
	$(STAGING_COMPOSE) restart

staging-rebuild: ## [STAGING] Rebuild image staging dari nol (--no-cache) lalu jalankan
	$(STAGING_COMPOSE) down
	$(STAGING_COMPOSE) build --no-cache
	$(STAGING_COMPOSE) up -d

staging-ps: ## [STAGING] Status staging + pembanding container produksi
	@$(STAGING_COMPOSE) ps
	@echo ""
	@echo "--- container produksi (harus tetap berjalan, uptime tidak berubah) ---"
	@docker ps --filter name=^9router$$ --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'

staging-shell: ## [STAGING] Masuk ke shell container staging
	$(STAGING_COMPOSE) exec 9router-staging sh

staging-clean: ## [STAGING] Hapus container DAN volume data staging (destruktif, staging saja)
	$(STAGING_COMPOSE) down -v

clean: ## Bersihkan file build (.next, cache)
	rm -rf .next
