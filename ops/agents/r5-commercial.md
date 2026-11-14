STATUS: done
UPDATED: 2026-11-14T11:40:00Z

# r5-commercial: đánh giá sẵn sàng thương mại (chỉ đọc mã, không đổi mã ứng dụng)

## Đã làm
- Đọc: DAC-TA, BRIEF-AGENT-THUONG-MAI, COMMERCIAL-RECOMMENDATIONS, R1/R2/R3, DOMAIN-REVISION-PROPOSAL, 2 handoff, SLO, THREAT-MODEL, DR/RUNBOOK/RELEASE/PENTEST, SEPAY, RECONCILIATION, DEPLOY-CLOUDFLARE, COST-MODEL, nhật ký x1/x3/w2/w3/w4/a4/d1.
- Kiểm trực tiếp mã: giá impression (events.ts:25), contract_lines (contracts.ts:191), hóa đơn/VAT (invoices.ts), cổng quét creative (creatives-scan.ts, manifest.ts:391, media.ts:319,383), kv.incr (cloudflare/kv.ts:19-23), cron trong wrangler.toml (8 cron, 3+1 mỗi môi trường), danh sách ngành cấm kid_safe (tv-experience.ts:19), hoàn tiền (payments/routes.ts), MFA mời (users.ts:182).
- Viết docs/COMMERCIAL-READINESS.md (kết luận: NO-GO đại trà, GO có điều kiện cho pilot kín sau P0).
- Thêm bản nháp docs/legal/{TERMS-OF-SERVICE,PRIVACY-POLICY,SLA}.draft.md (cần luật sư).

## Không làm / không xác minh
- Không chạy test, Docker, Cloudflare, SePay; không push; không đổi mã.
- R3 (11-12) và nhật ký x1 đã cũ so với mã hiện tại; một số mục R1 đã sửa ở commit sau nhưng chưa có R1 chạy lại.
- Pháp lý/thuế/giới hạn gói Cloudflare chưa tra nguồn trong phiên này.

## Phát hiện nổi bật cho agent chính
1. Đơn giá impression là hằng số tạm 20 ₫; contract_lines không nối vào trừ tiền (chặn P0).
2. media-worker/ClamAV không chạy trên Cloudflare nên creative mới không thể clean/duyệt trên đường Cloudflare.
3. 8 cron khai báo vs giới hạn Free 5; staging --no-crons nên không có tác vụ nền.
4. Chưa có ToS/Privacy/SLA/bảng giá; hóa đơn điện tử chỉ là ô nhập tay.
