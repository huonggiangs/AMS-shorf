STATUS: done
UPDATED: 2026-11-13 (UTC)

# x1-security-fix: trang thai R1

| Ma | Trang thai | Ghi chu |
|---|---|---|
| R1-01 | FIXED | users.ts: moi tai khoan noi bo moi duoc `mfa_required=1`. Test: api/test/security-x1.test.ts. Phan "chan phien khi chua co TOTP" nam trong auth/** (w1), da co san: mfa_required=1 => chi cap thu thach. |
| R1-03 (gateway) | FIXED | manifest.ts: chi `scan_state='clean'` (tru settings.allow_unscanned_creatives='1'/'true'); uu tien URL rendition (renditions/<cust>/<id>/manifest.json -> key + sha256); loi sha256 khong con lam hong ca manifest. Them `MANIFEST_REQUIRE_RENDITION=1`: bo creative chua co rendition (dung khi bucket chi mo prefix renditions/). Con lai (api media approve, bucket private, enqueue MEDIA_TOPIC, CLAMAV_REQUIRED): ngoai pham vi, xem requests. |
| R1-04 | FIXED | events.ts: `kv.incr` tung su kien. Test 20 lo x 50 song song => valid == 120. Luu y: Cloudflare KV incr khong nguyen tu (R1-12, packages/runtime) nen tren Workers can DO. |
| R1-07 | FIXED | users.ts guardEscalation kiem ca quyen mac dinh cua vai tro noi bo dich (moi + doi vai tro). |
| R1-08 | FIXED | customers.ts: roi khoi pending_payment va moi thao tac vao/ra terminated can customers:approve. (Chua co test rieng.) |
| R1-09 | FIXED | gateway.ts readBody doc theo luong, 413 khi vuot; content-length sai dinh dang => 413. Test chunked 5 MB. |
| R1-13 | FIXED (gateway) | /v1/dev/* chi mount khi AMS_ENV local|test (khong con dung NODE_ENV); khoi tao tu choi FIELD_ENC_KEY/SEPAY_WEBHOOK_SECRET/GATEWAY_SECRET = change-me* ngoai local. Phan docker-compose/API/setup.mjs: xem requests. |
| R1-27 | FIXED (phan 500) | `%` sai trong :group => 404, khong 500. |
| R1-28 | FIXED (phan PoP) | PoP voi creative khong thuoc manifest bi tu choi. |
| R1-02,05,06,11,15,16,18,25 | NOT FIXED | payments (s1/w4). |
| R1-10,14,22,23(api) | NOT FIXED | media/campaign (w1) hoac chua lam: R1-23, R1-26 can quyet dinh. |
| R1-12 | NOT FIXED | packages/runtime cloudflare kv. |
| R1-17,R1-26 | NOT FIXED | can quyet dinh chinh sach. |
| R1-19,24 | NOT FIXED | auth/** (w1). |
| R1-20 | NOT FIXED | gateway/payments bo qua TRUST_PROXY; can IP socket (node.ts) de khong dung chung bucket 'unknown'. |
| R1-21 | NOT FIXED | packages/shared password/aes: doi N va key-id can migration. |

Kiem chung: tsc edge-gateway + api sach; vitest edge-gateway 45 pass (commands.test postgres timeout hook pglite 10s do tai may, khong lien quan); sdk-ts typecheck loi co san (khong phai cua toi).
