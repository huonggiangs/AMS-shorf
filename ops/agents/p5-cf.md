STATUS: done
UPDATED: 2026-11-14 12:20 UTC

# p5-cf: Cloudflare an toàn cho tiền + media trên Cloudflare

## Checklist
- [x] Bộ đếm nguyên tử trên D1 (`kv_counters`, migration 0011), `Kv.incrBy/incrMany` tùy chọn + helper, Redis/Memory/faults cập nhật
- [x] Quyết định D1 vs DO: `docs/DECISIONS-CF-COUNTERS.md` (không cần đổi wrangler.toml: không có DO mới)
- [x] Gateway: trần giờ/thiết bị gom lô + idempotent theo event_id (N1, N4); không đụng dòng tính giá
- [x] PoP: `ev_pop_seen` + DbEventStore khử trùng theo event_id (N8); ClickHouse bỏ trường event_id
- [x] Consumer: `claim` gom lô; totp:used chiếm nguyên tử (auth/routes.ts, payments/sepay-change.ts)
- [x] Media CF: validator allow-list, hàng chờ `needs_manual_review`, admin approve/reject có audit, cổng quét nguyên vẹn
- [x] Docs: DECISIONS-CF-COUNTERS.md, CLOUDFLARE-MEDIA-LIMITS.md, DEPLOY-CLOUDFLARE.md ghi chú
- [x] Test: runtime (cf-counters, pop-dedupe), gateway (cap-idempotent), api (cf-media)
- [x] `node scripts/deploy-cloudflare.mjs --env staging --fake-ids --dry-run --no-crons` pass
- [ ] Chạy thật trên Cloudflare staging (chưa có tài khoản): xác nhận D1 batch RETURNING và độ trễ/rows-written

## Lưu ý phối hợp
- `services/api/src/auth/routes.ts` (checkTotp) và `services/api/src/routes/media.ts` (mount `mediaScanReviewRoutes`, scan_warning) lẫn thay đổi chưa commit của p2: p5 chỉ sửa vài dòng, p2 commit cùng các tệp đó.
