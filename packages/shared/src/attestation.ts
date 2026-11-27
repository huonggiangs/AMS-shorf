// Cam ket phap ly noi dung quang cao (rang buoc goc 17/11): quang cao hien tren man hinh phai kem cam ket noi dung khong vi pham phap luat.
// Nguoi co quyen duyet (media:approve) tick o cam ket khi duyet / tai len; may chu ghi nguoi ky + thoi diem + phien ban van ban.
// TV (Mindo WP-30) bat buoc: legal_attested === true, attested_by (1..64 ky tu), attestation_version (chuoi khong rong); kid_safe === true.
// Van ban goc: docs/legal/CAM-KET-NOI-DUNG-legal-v1.md (test dam bao 3 ban: tai lieu, shared, web-admin khop tung chu).

/** Phien ban van ban cam ket hien hanh. Doi noi dung van ban => tang so (legal-v2) va them tep docs/legal tuong ung. */
export const LEGAL_ATTESTATION_VERSION = 'legal-v1';
/** Van ban CHO LUAT SU RA SOAT (chu du an da hoan buoc luat su). */
export const LEGAL_ATTESTATION_STATUS_NOTE = 'Văn bản chờ luật sư rà soát';
export const LEGAL_ATTESTATION_TEXT_VI =
  'Tôi xác nhận nội dung này không vi phạm pháp luật Việt Nam và pháp luật các quốc gia nơi hiển thị, không chứa nội dung không phù hợp với trẻ em, và tôi chịu trách nhiệm về xác nhận này.';
/** Nhan o rieng "Phu hop tre em": lua chon cua nguoi duyet, mac dinh bo trong = KHONG an toan cho tre. */
export const KID_SAFE_LABEL_VI = 'Phù hợp trẻ em';
export const KID_SAFE_HELP_VI = 'Chỉ tick khi bạn đã xem và xác nhận nội dung phù hợp cho trẻ em. Không tick thì TV gia đình (có kiểm soát của phụ huynh) sẽ không phát nội dung này.';
export const ATTESTED_BY_MAX = 64;

/** Phan `attest` cua body duyet / tai len / ky bo sung (zod schema o services/api/src/lib/attestation.ts). accepted bat buoc la true. */
export interface AttestInput { accepted: true; version: string; kid_safe?: boolean }

/** Trang thai cam ket cua creative trong danh sach/chi tiet (API admin). */
export type AttestationStatus = 'valid' | 'missing' | 'stale';
