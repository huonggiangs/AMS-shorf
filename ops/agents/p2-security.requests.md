# Yêu cầu của p2-security cho agent khác

## p5 (services/edge-gateway) — cưỡng chế chính sách trẻ em lúc xây manifest
`services/edge-gateway/src/manifest.ts` hiện chỉ bỏ ngữ cảnh `lock` khi `kid_safe !== true`; chưa đọc cài đặt `settings.tv_experience.lock_ads_enabled` (mặc định tắt, API đã chặn đặt/duyệt). Vá đề xuất (p2 không sửa file của p5):

1. Thêm vào `ManifestBuilder`:
```ts
private async lockAdsEnabled(): Promise<boolean> {
  const r = (await this.rt.db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'tv_experience'"))[0];
  if (!r) return false;
  try { return (JSON.parse(r.value) as { lock_ads_enabled?: unknown }).lock_ads_enabled === true; } catch { return false; }
}
```
2. Trong `buildWith`, trước vòng lặp creative: `const lockAllowed = await this.lockAdsEnabled();`
3. `parseOverlayJson(raw, lockAllowed)` trả `{ ov, drop }`: nếu `contexts` có `lock` mà KHÔNG (`lockAllowed && kid_safe === true`) thì bỏ `lock`; nếu `lock` là ngữ cảnh duy nhất thì `drop = true` và `continue` (không phát creative chỉ-lock ở màn thường; hiện nó rơi về `fullscreen`).
4. Cập nhật `tests/contract/test/protocol.test.ts` (case "overlay do nguoi duyet dat"): creative c1 có `lock` cần `INSERT INTO settings ('tv_experience', '{"lock_ads_enabled":true,...}')`; thêm case mặc định (không có cài đặt) => không có `lock`, creative chỉ-lock vắng mặt khỏi manifest.
API đã bump manifest khi đổi cài đặt này (`PUT /tv-experience/settings`).

Tùy chọn (hưởng lợi từ 0008): gateway có thể loại creative với `creative_security.approved_version IS NOT NULL AND approved_version <> content_version` (nội dung đổi sau khi duyệt).

## p5 / agent runtime
- R1-10: presign S3/R2 chưa ràng độ dài (`content-length-range`/chữ ký `Content-Length`); media-worker nên băm streaming tệp > 128 MB.
- R1-12: bộ đếm KV Cloudflare không nguyên tử (login/MFA/TOTP replay/gateway rate limit).
- R1-20: gateway `util.ts` bỏ qua `TRUST_PROXY`.
- Đã ghim `nodemailer` 7.0.13 qua `pnpm.overrides` (root); bản vá cho các advisory mới nằm ở 8.x-10.x (đổi major).

## p4 (legal/compliance)
- p2 đã thêm bảng `campaign_gate` (0008): `restricted_industry`, `rights_confirmed_at/by` khi gửi duyệt chiến dịch; p4 có `campaign_compliance` (category, kid_safe, duyệt hai lần) và `creative_rights` (xác nhận khi tải creative): hai thứ độc lập, không trùng. Nếu p4 muốn thống nhất, nên đọc `campaign_gate.restricted_industry` làm đầu vào cho "duyệt lần hai".
