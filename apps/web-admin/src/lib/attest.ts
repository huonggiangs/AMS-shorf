// Cam kết pháp lý nội dung quảng cáo. Khớp @ams/shared (attestation.ts) và docs/legal/CAM-KET-NOI-DUNG-legal-v1.md (test packages/shared bảo đảm khớp từng chữ).
export const LEGAL_ATTESTATION_VERSION = 'legal-v1';
export const LEGAL_ATTESTATION_STATUS_NOTE = 'Văn bản chờ luật sư rà soát';
export const LEGAL_ATTESTATION_TEXT_VI =
  'Tôi xác nhận nội dung này không vi phạm pháp luật Việt Nam và pháp luật các quốc gia nơi hiển thị, không chứa nội dung không phù hợp với trẻ em, và tôi chịu trách nhiệm về xác nhận này.';
export const KID_SAFE_LABEL_VI = 'Phù hợp trẻ em';
export const KID_SAFE_HELP_VI = 'Chỉ tick khi bạn đã xem và xác nhận nội dung phù hợp cho trẻ em. Không tick thì TV gia đình (có kiểm soát của phụ huynh) sẽ không phát nội dung này.';

export type AttestationStatus = 'valid' | 'missing' | 'stale';
export const ATTEST_STATUS_LABEL: Record<AttestationStatus, string> = { valid: 'Đã ký cam kết', missing: 'Thiếu cam kết pháp lý', stale: 'Cam kết cũ, cần ký lại' };
export const ATTEST_SOURCE_LABEL: Record<string, string> = { approve: 'Khi duyệt', upload: 'Khi tải lên', late: 'Ký bổ sung', bulk: 'Ký hàng loạt', campaign: 'Khi duyệt chiến dịch' };
export const attestBody = (accepted: boolean, kidSafe: boolean) => ({ accepted, version: LEGAL_ATTESTATION_VERSION, kid_safe: kidSafe });
