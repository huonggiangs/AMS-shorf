# Yêu cầu của w3-infra-wire cho agent khác

## a3-gateway (services/edge-gateway/src/manifest.ts)
1. Compose giờ chỉ mở công khai tiền tố `renditions/` của bucket media (R1-03, `MINIO_PUBLIC_PREFIXES`). Manifest hiện vẫn phát bản gốc `media/...` nên TV (Docker local) sẽ 403 với creative mới cho đến khi manifest phát rendition (URL dưới `renditions/<customer>/<creative>/`, sha256 của rendition) và chỉ phát creative `scan_state='clean'`. Tạm thời cho dev: `MINIO_PUBLIC_PREFIXES="renditions media"` trong `.env`.

## f1/f2 (scripts/setup.mjs)
1. `check-env`: từ chối khi `AMS_ENV != local` mà `GATEWAY_DEV_ENDPOINTS=1`; `setup` nên ghi `GATEWAY_DEV_ENDPOINTS=1` chỉ khi người dùng chọn chạy `make loadtest` (hiện mặc định 0, tools/sim cần đặt tay =1 trong .env ở local).
2. Sinh khóa cho `MEDIA_*`/`CLAMAV_*` không cần (mặc định trong compose).

## a1-api-core (R1-13)
1. Runtime nên tự từ chối `change-me*`/`CHANGE_ME*` cho SESSION_SECRET, FIELD_ENC_KEY, SEPAY_WEBHOOK_SECRET khi `NODE_ENV=production` hoặc `SEPAY_MODE=production` (compose `env-guard` chỉ chặn đường Docker).
2. Gateway không nên mount `/v1/dev/*` khi `AMS_ENV != local` (hiện chỉ kiểm cờ + runtime != cloudflare).
