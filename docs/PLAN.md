# AMS: kế hoạch đa agent và hợp đồng kỹ thuật (nguồn sự thật cho mọi agent)

Đặc tả gốc: `docs/DAC-TA-GIAO-VIEC-AGENT.md` (đọc mục liên quan). Prototype giao diện: `prototype/` + `styles/app.css`. Token: `docs/DESIGN-TOKENS.md`.
Tài liệu này **thắng** đặc tả khi mâu thuẫn về cấu trúc mã nguồn hoặc phạm vi phiên này.

## 1. Phạm vi phiên này ("Giai đoạn 0 lát cắt dọc")

Làm được và kiểm chứng được trong môi trường không có Docker daemon (chỉ Node 22, pnpm, redis-server, psql client, pglite):

- Monorepo pnpm + TypeScript, **một mã nguồn nhiều môi trường** qua `packages/runtime`.
- DB (Postgres/D1 dùng chung migration SQL), seed lấy từ prototype.
- API quản trị + cổng khách hàng: đăng nhập + TOTP, RBAC kiểm ở máy chủ, audit log, khách hàng, hợp đồng, chiến dịch, duyệt, media (presigned), ví + SePay webhook + tự kích hoạt, người dùng/phân quyền.
- Edge gateway: register/pair/heartbeat/manifest/events (Ed25519, idempotent) + bộ giả lập thiết bị.
- Web admin React + Vite + TS giữ giao diện prototype, nối API thật.
- Docker Compose + Makefile + Caddy; cấu hình Cloudflare (wrangler, Terraform, CI); bộ test.
- Tài liệu: kiến trúc, bảng chi phí 100k/1M/10M/50M, đề xuất thương mại, handoff.

**Ngoài phạm vi (ghi vào backlog trong handoff, không giả vờ đã làm):** app Android TV/Tizen/webOS, player thang máy, connector LED Novastar/Colorlight thật, kết nối đối tác RTB thật (chưa có tài liệu), VNPay/MoMo thật, hóa đơn điện tử thật, tải 1M+ thiết bị, ClickHouse/Redpanda chạy thật (chỉ viết DDL + adapter giao diện, kiểm bằng bản memory).

## 2. Quy ước chung (bắt buộc)

- Node 22, pnpm workspaces, TypeScript strict, ESM. Test bằng `vitest`. Lint nhẹ (tsc --noEmit là cổng chính).
- Framework HTTP: **Hono** (chạy Node bằng `@hono/node-server` và Workers). Validate bằng `zod`.
- **Không ORM.** SQL thuần, tập con chạy được cả PostgreSQL 16 và SQLite/D1:
  - id `TEXT` (ULID/UUIDv7 sinh ở ứng dụng), thời gian `TEXT` ISO-8601 UTC, tiền `BIGINT` (đồng, số nguyên, **không float**), boolean `INTEGER 0/1`, JSON lưu `TEXT`.
  - Placeholder viết `?`; adapter Postgres đổi sang `$1..$n`. Không dùng `RETURNING *` đặc thù, không `FOR UPDATE`; chống đua bằng câu lệnh nguyên tử có điều kiện (`UPDATE ... WHERE ... AND available >= ?`, kiểm `rowsAffected`) và ràng buộc `UNIQUE`.
  - Migration: `packages/db/migrations/NNNN_name.sql` chạy tuần tự, một bảng `_migrations`.
- Mọi mã nghiệp vụ chỉ nhận `deps: Runtime` (xem §3), **không import trực tiếp** pg/ioredis/D1.
- Lỗi API: `{ "error": { "code": "string_snake", "message": "tiếng Việt cho người", "details"?: any } }`, HTTP đúng nghĩa (400/401/403/404/409/422/429).
- Giao diện, thông báo, nhật ký: **tiếng Việt** (có hỗ trợ en ở web). Mã, tên biến, commit: tiếng Anh.
- Bí mật chỉ qua biến môi trường; không commit `.env`; không log PII; MST/số tài khoản ngân hàng mã hóa theo trường (AES-GCM, khóa `FIELD_ENC_KEY`).
- Agent **không chạy lệnh git** (không commit/push/branch); chủ agent chính làm. Chỉ ghi trong thư mục được giao (bảng §6). Cần sửa chỗ khác: ghi yêu cầu vào `ops/agents/<id>.requests.md` và nêu trong báo cáo cuối.
- Mỗi agent giữ nhật ký ngắn `ops/agents/<id>.md` (đang làm gì, xong gì, chặn gì), cập nhật tối thiểu ở đầu, giữa và cuối. Báo cáo cuối (trả về cho agent chính) tối đa ~25 dòng: đã làm, kiểm chứng bằng lệnh nào và kết quả thật, chưa làm, rủi ro.
- Không khẳng định "đã chạy/đã pass" nếu chưa chạy lệnh và thấy kết quả. Ghi đúng cả lỗi còn tồn tại.

## 3. Hợp đồng `packages/runtime`

```ts
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  tx<T>(fn: (t: Db) => Promise<T>): Promise<T>;       // giao dịch; lồng nhau không bắt buộc
  dialect: 'postgres' | 'sqlite';
}
export interface Kv { get(k: string): Promise<string|null>; set(k: string, v: string, ttlSec?: number): Promise<void>; del(k: string): Promise<void>; incr(k: string, ttlSec?: number): Promise<number>; }
export interface Queue<T = unknown> { send(topic: string, msg: T): Promise<void>; subscribe(topic: string, handler: (msg: T) => Promise<void>): void; } // memory/redis/redpanda/CF Queues
export interface ObjectStore { putSigned(key: string, contentType: string, ttlSec: number): Promise<{url: string; headers: Record<string,string>}>; getSigned(key: string, ttlSec: number): Promise<string>; put(key: string, body: Uint8Array, contentType: string): Promise<void>; get(key: string): Promise<Uint8Array|null>; head(key: string): Promise<{size:number; contentType:string}|null>; }
export interface Mailer { send(m: {to: string; subject: string; html: string; text?: string}): Promise<void>; }
export interface EventStore { append(table: 'heartbeat'|'ad_impression'|'proof_of_play', rows: Record<string,unknown>[]): Promise<void>; countImpressions(campaignId: string, sinceIso?: string): Promise<number>; }
export interface Clock { now(): Date; }
export interface Config { runtime: 'docker'|'cloudflare'|'k8s'|'test'; env: Record<string,string|undefined>; }
export interface Runtime { db: Db; kv: Kv; queue: Queue; objects: ObjectStore; mail: Mailer; events: EventStore; clock: Clock; config: Config; id(): string /* ULID */; }
```

Bản cài đặt: `createTestRuntime()` (pglite + memory), `createDockerRuntime(env)` (pg, ioredis, kho tệp fs trên volume (`OBJECT_STORE=fs`) hoặc S3, SMTP→Mailpit, EventStore ghi bảng Postgres `ev_*` hoặc ClickHouse khi `CLICKHOUSE_URL`), `createCloudflareRuntime(env)` (D1, KV, Queues, R2, EventStore→Queue/Analytics Engine). Bản Cloudflare phải **biên dịch được** (`tsc`) dù chưa chạy thật ở đây.

## 4. Hợp đồng API (tiền tố)

Auth cookie `ams_session` (HttpOnly, SameSite=Lax) + header `X-CSRF-Token` cho phương thức ghi; trả JSON.

**Auth:** `POST /auth/login {email,password}` → `{mfa_required, mfa_token?}` hoặc phiên · `POST /auth/mfa/verify {mfa_token,code}` · `POST /auth/mfa/enroll` · `POST /auth/logout` · `GET /auth/me` (người dùng + ma trận quyền + customer scope) · `POST /auth/invite/accept {token,password}`.

**Admin `/admin/v1`** (mỗi route khai báo `module` + `action` cần quyền: view|write|approve|delete): `devices` (GET list phân trang `?page&page_size&q&sort&filter`, GET :id, POST `bulk` verify|block) · `campaigns` (CRUD, `POST :id/submit`, `POST :id/approve` chạy logic ví §8.1, `POST :id/pause|resume|reject`) · `customers` · `contracts` (+ `POST :id/render` trả HTML/PDF theo mẫu, số tiền bằng chữ tiếng Việt) · `approvals` (hàng chờ) · `media` (GET, `POST /upload-url`, `POST :id/confirm`, `POST /import {source,url}`, duyệt/trả lại) · `screens` · `schedule` · `topups` (`POST :id/confirm`) · `wallets` · `users` (mời, đổi vai trò, khóa) · `permissions/:adminId` (GET/PUT) · `audit-log` (GET only) · `dashboard/overview` · `revenue` · `partners` · `rtb-floors` · `settings/sepay` (GET/PUT + `POST test`).

**Portal `/portal/v1`** (chỉ dữ liệu của chính khách): `campaigns`, `media`, `wallet`, `topups` (POST → QR + nội dung `AMS <payment_code>`), `wallet/refund-requests`, `me`.

**Webhook:** `POST /webhooks/payments/sepay` (HMAC-SHA256, header `X-SePay-Signature: sha256=<hex>` + `X-SePay-Timestamp`, lệch >5 phút bị từ chối; cũng chấp nhận `Authorization: Apikey`), trả `{"success":true}`. Dev: `POST /dev/sepay/simulate` chỉ khi `RUNTIME=docker` và `SEPAY_MODE!=production`.

**Gateway `/v1`** (ký Ed25519 trên body+timestamp+nonce): `register`, `pair`, `heartbeat`, `manifest`, `events` (tối đa 50 sự kiện/lô, idempotent theo `event_id`).

Phân quyền: 6 vai trò × 12 mô-đun (`overview, devices, tv_experience, campaigns, customers, approvals, media, screens, schedule, finance, partners, admin`) × 4 hành động (`view, write, approve, delete`). Bảng mặc định theo vai trò nằm ở `packages/config/rbac.ts` (một nguồn, dùng chung API và web). Tài khoản ngoài (customer/partner) luôn bị lọc theo `customer_id`/`campaign_grants` trong **câu SQL**, và bị cấm `approve`, `delete`, mô-đun `finance` (ngoài ví của mình).

## 5. Cổng, tên miền, dịch vụ (Docker local)

`api` 8787 · `edge-gateway` 8788 · `web-admin` 5173 (dev) / nginx 8080 · `postgres` 5432 · `redis` 6379 · Caddy media (HTTP, chỉ đọc `renditions/*`) 9000 · volume `mediadata` thay MinIO · `mailpit` 8025 (SMTP 1025) · Caddy 80/443 → `admin.ams.localhost`, `portal.ams.localhost`, `api.ams.localhost`, `gw.ams.localhost`. Biến môi trường: `.env.example` ở gốc (agent infra sở hữu, các agent khác bổ sung dòng qua `requests.md`).

## 6. Phân việc và quyền sở hữu thư mục

| Agent | Mã | Sở hữu (chỉ ghi ở đây) | Phụ thuộc |
|---|---|---|---|
| Nền móng | `f1-foundation` | `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `packages/db`, `packages/runtime`, `packages/config`, `packages/shared` | không |
| Hạ tầng | `f2-infra` | `infra/`, `Makefile`, `.env.example`, `.github/`, `scripts/`, Dockerfile gốc từng dịch vụ (`services/*/Dockerfile`, `apps/web-admin/Dockerfile`) | PLAN |
| Web admin | `f3-web` | `apps/web-admin` | hợp đồng API §4 |
| Tài liệu thương mại | `f4-docs` | `docs/ARCHITECTURE.md`, `docs/COST-MODEL.md`, `docs/COMMERCIAL-RECOMMENDATIONS.md`, `docs/THREAT-MODEL.md`, `docs/diagrams/` | không |
| API lõi | `a1-api-core` | `services/api/src/{app,auth,rbac,audit,admin,portal,media,contracts}*` | f1 |
| Tài chính | `a2-payments` | `services/payments`, `services/api/src/finance/**` (gắn vào app qua `mountFinance(app, rt)`) | f1 |
| Gateway | `a3-gateway` | `services/edge-gateway`, `services/ingest-consumer`, `tools/sim` | f1 |
| Reviewer bảo mật | `r1-security` | chỉ đọc; viết `tests/security/**`, `ops/reviews/r1.md` | a1,a2 |
| Reviewer QA | `r2-qa` | `tests/e2e/**`, `ops/reviews/r2.md` | tất cả |
| Reviewer đối chiếu | `r3-spec` | chỉ đọc; `ops/reviews/r3.md` (checklist nghiệm thu mục 14 đặc tả) | tất cả |

Reviewer **không sửa mã của agent khác**: ghi lỗi (tệp:dòng, tái hiện, mức độ) vào `ops/reviews/rX.md`; agent chính giao sửa.

## 7. Cổng chất lượng trước khi coi là xong

`pnpm -r typecheck` sạch · `pnpm -r test` xanh · migration chạy sạch trên cả pglite (Postgres) và `node:sqlite` · test đua tiền (2 chiến dịch tranh 1 số dư; webhook SePay trùng 5 lần chỉ cộng 1 lần) · test IDOR (khách A không đọc/ghi dữ liệu khách B) · `docker compose config` hợp lệ (`docker compose -f infra/docker/docker-compose.yml config`, chạy được dù không có daemon).
