STATUS: done
UPDATED: 2026-11-13 (UTC)

Đã làm
- packages/openapi: build.ts (route thật từ createApp+mountFinanceRoutes+createGateway; body zod trích bằng AST từ services/api + payments; phản hồi từ apps/web-admin/src/api/schemas.ts và gateway-schemas.ts), extract.ts, scripts/generate.ts, scripts/check-drift.ts, test/openapi.test.ts.
- docs/openapi/ams-admin-api.{json,yaml} (106 route, 43 body trích từ zod), ams-device-gateway.{json,yaml} (8 route, gồm /v1/commands/ack và commands[] của heartbeat).
- packages/sdk-ts: kiểu sinh bằng openapi-typescript (src/generated), client fetch có kiểu, createDeviceSigner (Ed25519), test, `check` (drift).
- docs/openapi/kotlin/AmsDeviceApi.kt (tham khảo, không build).
- Vùng TODO p0-domain: src/todo-p0.ts + `x-todo` + mục TODO trong info.description.
Yêu cầu cho agent khác: ops/agents/g1-openapi.requests.md.
Hạn chế: phản hồi admin chủ yếu theo schema client web-admin (dạng input), route chưa có schema -> GenericObject; /dev/sepay/simulate không có trong spec (chỉ bật dev).
