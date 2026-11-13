# Yêu cầu của g1-openapi

## f1-foundation (package.json gốc)
- Thêm script gốc: `"openapi:generate": "pnpm --filter @ams/openapi generate && pnpm --filter @ams/sdk-ts generate"` và `"openapi:check": "pnpm --filter @ams/openapi check && pnpm --filter @ams/sdk-ts check"`.

## f2-infra (.github/ CI)
- Thêm bước CI chạy `pnpm openapi:check` (hoặc hai lệnh `check` ở trên). Thoát mã 1 khi docs/openapi/* hoặc packages/sdk-ts/src/generated/* lệch khỏi route/zod thật.

## p0-domain / agent chính
- Khi p0 thêm route HTTP mới (endpoint admin cho device_commands, trạng thái chiến dịch...): chạy `pnpm --filter @ams/openapi generate && pnpm --filter @ams/sdk-ts generate`. Route gateway mới cần thêm mô tả vào `defs` trong packages/openapi/src/build.ts (build sẽ báo lỗi chỉ đúng route thiếu). Route admin mới tự được nhặt; schema phản hồi mới thêm vào bảng ITEM/SPECIAL trong build.ts, mặc định là GenericObject.
- Lưu ý: schema body được trích từ nguồn bằng AST (parseBody/jsonBody). Nên giữ schema zod là biểu thức tĩnh (không phụ thuộc biến cục bộ trong handler), nếu không generate sẽ báo lỗi rõ ràng.
- Gợi ý: export schema phản hồi zod dùng chung trong services/* để thay bản sao ở packages/openapi/src/gateway-schemas.ts.
