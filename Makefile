# AMS - lệnh một dòng cho môi trường local (đặc tả mục 11.3).
# Windows không có make: dùng `scripts/ams.ps1 <lệnh>` (cùng tên lệnh).
SHELL := /bin/sh
COMPOSE_FILE := infra/docker/docker-compose.yml
DC := docker compose --env-file .env -f $(COMPOSE_FILE)
# Biến cho profile events: gateway/api ghi qua Redpanda và ClickHouse
EVENTS_ENV := CLICKHOUSE_URL=http://clickhouse:8123
N ?= 1000
S ?=

.DEFAULT_GOAL := help
.PHONY: help setup env-check up up-events up-obs seed bootstrap test load loadtest tunnel down reset logs ps doctor config build trust-ca

help: ## Liệt kê lệnh
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  make %-11s %s\n",$$1,$$2}'

setup: ## Kiểm tra Docker/RAM/CPU, tạo .env với khóa ngẫu nhiên
	@node scripts/setup.mjs setup

env-check:
	@node scripts/setup.mjs check-env

config: env-check ## Kiểm cú pháp docker compose (mọi profile)
	@$(DC) --profile '*' config -q && echo "docker compose config: hợp lệ"

build: env-check ## Build image các dịch vụ
	@$(DC) --profile core build

up: env-check ## Chạy profile core (postgres, redis, minio, mailpit, api, web-admin, edge-gateway, ingest-consumer, media-worker, clamav, proxy)
	@$(DC) --profile core up -d --build
	@node scripts/setup.mjs creds

up-events: env-check ## Thêm Redpanda + ClickHouse + ingest-consumer (cần ~32 GB RAM khuyến nghị)
	@$(EVENTS_ENV) $(DC) --profile core --profile events up -d --build

up-obs: env-check ## Thêm Grafana + OpenTelemetry Collector
	@$(DC) --profile core --profile obs up -d

seed: env-check ## Migration + seed theo AMS_ENV (local -> demo + in tài khoản; khác local -> bootstrap)
	@mode=$$(node scripts/setup.mjs seed-mode) || { echo "seed bị từ chối (xem thông báo trên)"; exit 3; }; \
	echo "seed mode: $$mode"; \
	$(DC) --profile core run --rm -e SEED=1 -e SEED_MODE=$$mode migrate-seed || exit $$?; \
	if [ "$$mode" = "demo" ]; then node scripts/setup.mjs creds; fi

bootstrap: env-check ## Cài đặt tối thiểu cho staging/production: một Super admin, KHÔNG dữ liệu demo (cần BOOTSTRAP_ADMIN_EMAIL)
	@$(DC) --profile core run --rm -e SEED=1 -e SEED_MODE=bootstrap migrate-seed

test: ## Typecheck + unit/contract (pnpm), rồi e2e nếu có (cần `make up`)
	pnpm -r typecheck
	pnpm -r test
	pnpm -r --if-present test:e2e

loadtest: ## Giả lập N thiết bị ảo: make loadtest N=20000
	@echo "Giả lập $(N) thiết bị tới gateway cục bộ (máy PC chỉ đại diện ~10-50 nghìn thiết bị, xem đặc tả 11.5)"
	pnpm --filter @ams/sim run loadtest -- --devices $(N) --gateway http://localhost:$${GATEWAY_PORT:-8788}

load: ## Do tai that (Postgres 16 + Redis 7 that, khong can Docker): ramp 250-1000 rps + doi 10k thiet bi x10 + do consumer. Ket qua: tools/load/results/
	nice -n -15 pnpm --filter @ams/load load -- --devices 50000 --ramp 250,500,1000 --fleet-devices 10000 --fleet-scale 0.1 --fleet-seconds 150 --out results/make-load.json
	nice -n -15 pnpm --filter @ams/load load -- --devices 20 --ramp "" --consumer-bench 4000 --out results/make-load-consumer.json

tunnel: env-check ## URL công khai tạm thời cho webhook SePay (Cloudflare quick tunnel)
	@$(DC) --profile core --profile tunnel up -d tunnel
	@sleep 6
	@node scripts/setup.mjs tunnel-url

down: ## Dừng container (giữ dữ liệu)
	@$(DC) --profile '*' down --remove-orphans

reset: ## XÓA TOÀN BỘ dữ liệu local (volume) rồi dừng. Hỏi xác nhận; bỏ hỏi: make reset YES=1
	@if [ "$(YES)" != "1" ]; then printf "Lệnh này XÓA Postgres/MinIO/Redis/Mailpit local. Gõ 'xoa' để tiếp tục: "; read a; [ "$$a" = "xoa" ] || { echo "Đã hủy."; exit 1; }; fi
	@$(DC) --profile '*' down -v --remove-orphans

logs: ## Xem log: make logs   hoặc   make logs S=api
	@$(DC) --profile '*' logs -f --tail=100 $(S)

ps: ## Trạng thái container
	@$(DC) --profile '*' ps -a

doctor: ## Chẩn đoán: công cụ, .env, container, cổng
	@node scripts/setup.mjs doctor

trust-ca: ## Xuất CA nội bộ của Caddy để cài vào máy (bỏ cảnh báo HTTPS)
	@$(DC) --profile core cp proxy:/data/caddy/pki/authorities/local/root.crt ./ams-local-root.crt
	@echo "Đã xuất ./ams-local-root.crt. Windows: nhấp đúp > Install Certificate > Trusted Root Certification Authorities."
