.PHONY: help install dev build start docker-up docker-down docker-logs docker-restart docker-build docker-update docker-rebuild docker-run clean

# Default configuration
PORT ?= 20128
BASE_URL ?= http://localhost:$(PORT)

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

clean: ## Bersihkan file build (.next, cache)
	rm -rf .next
