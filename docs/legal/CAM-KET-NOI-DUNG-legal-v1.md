# Cam kết nội dung quảng cáo - phiên bản `legal-v1`

> **Văn bản chờ luật sư rà soát.** Chủ dự án đã hoãn bước luật sư; nội dung dưới đây chưa được luật sư xác nhận. Chỉ dùng sau khi chủ dự án chấp nhận rủi ro này.

Ràng buộc gốc (17/11/2026): quảng cáo hiển thị trên màn hình TV phải kèm cam kết nội dung không vi phạm pháp luật Việt Nam và pháp luật các quốc gia nơi hiển thị.

## Văn bản người duyệt/tải lên phải tick

> Tôi xác nhận nội dung này không vi phạm pháp luật Việt Nam và pháp luật các quốc gia nơi hiển thị, không chứa nội dung không phù hợp với trẻ em, và tôi chịu trách nhiệm về xác nhận này.

## Ô riêng "Phù hợp trẻ em"

Lựa chọn của người ký, **mặc định bỏ trống = không an toàn cho trẻ**. Hệ thống không bao giờ tự đặt. Trên TV gia đình (ứng dụng Mindo, có kiểm soát phụ huynh) chỉ phát creative có `kid_safe = true`.

## Quy tắc

- Chỉ người dùng nội bộ có quyền `media:approve` mới ký được; máy chủ kiểm tra bằng `can(...)`.
- Hệ thống KHÔNG tự ký: duyệt tự động cho tải lên của tài khoản nội bộ không ghi cam kết nếu người tải không tick ô cam kết lúc tải lên.
- Mỗi lần ký ghi: creative, người ký (mã + tên), thời điểm, phiên bản văn bản (`legal-v1`), phiên bản nội dung (`content_version`), lựa chọn kid_safe, băm IP/UA, nguồn (`approve`, `upload`, `late`, `bulk`, `campaign`). Lịch sử chỉ thêm, không xóa.
- Đổi nội dung (tăng `content_version`) hoặc trả lại/thu hồi duyệt làm cam kết cũ mất hiệu lực; muốn phát phải ký lại.
- Manifest cho thiết bị chỉ phát creative có cam kết hiệu lực, kèm `kid_safe`, `legal_attested: true`, `attested_by` (tên người ký, tối đa 64 ký tự), `attestation_version`, `attested_at`.
- Khi đổi nội dung văn bản: tăng số phiên bản (`legal-v2`), thêm tệp `CAM-KET-NOI-DUNG-legal-v2.md`, cập nhật hằng số trong `packages/shared/src/attestation.ts` và `apps/web-admin/src/lib/attest.ts`. Máy chủ từ chối (409 `legal_version_mismatch`) ai ký phiên bản cũ.
