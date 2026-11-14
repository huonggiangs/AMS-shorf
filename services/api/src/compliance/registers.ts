// So dang ky hoat dong xu ly du lieu (ho so xu ly ND13) + so ghi nhan dong y. Muc mac dinh = KHUNG tu chinh sach bao mat nhap; luat su/DPO hoan thien.
import type { Runtime } from '@ams/runtime';

const DEFAULTS: { activity: string; purpose: string; data_categories: string; data_subjects: string; legal_basis: string; recipients: string; cross_border: number; retention: string }[] = [
  { activity: 'Tài khoản cổng khách hàng/quản trị', purpose: 'Xác thực, phân quyền, hỗ trợ khách hàng', data_categories: 'Họ tên, email, điện thoại, IP, thiết bị đăng nhập', data_subjects: 'Nhân sự khách hàng, đối tác, nhân viên', legal_basis: 'Thực hiện hợp đồng', recipients: 'Nội bộ; nhà cung cấp email', cross_border: 0, retention: 'Đến khi chấm dứt hợp đồng + [N] năm' },
  { activity: 'Hồ sơ pháp lý và KYC nhà quảng cáo', purpose: 'Thẩm định nhà quảng cáo, kiểm soát ngành hạn chế', data_categories: 'Mã số doanh nghiệp, người đại diện pháp luật, giấy phép kinh doanh', data_subjects: 'Đại diện pháp luật của khách hàng', legal_basis: 'Nghĩa vụ pháp lý / lợi ích hợp pháp', recipients: 'Nội bộ', cross_border: 0, retention: '[Luật sư xác nhận]' },
  { activity: 'Đo lường quảng cáo trên thiết bị TV', purpose: 'Tính lượt hiển thị, đối soát, chống gian lận', data_categories: 'Mã thiết bị, thời điểm xem, chiến dịch', data_subjects: 'Người xem (qua thiết bị)', legal_basis: '[Luật sư xác nhận: đồng ý / lợi ích hợp pháp]', recipients: 'Nội bộ; nhãn hàng (số liệu tổng hợp)', cross_border: 0, retention: 'Theo cài đặt retention_policy' },
  { activity: 'Ví thưởng người xem', purpose: 'Trả thưởng và chi trả', data_categories: 'Tên hiển thị, email, mã bằm số điện thoại, sổ cái thưởng', data_subjects: 'Người xem có tài khoản', legal_basis: 'Đồng ý / thực hiện thỏa thuận', recipients: 'Đối tác chi trả', cross_border: 0, retention: 'Sổ cái giữ theo quy định kế toán' },
  { activity: 'Hóa đơn điện tử và thanh toán', purpose: 'Xuất hóa đơn, đối soát thu tiền', data_categories: 'Tên, MST, địa chỉ, email xuất hóa đơn, nội dung giao dịch', data_subjects: 'Khách hàng', legal_basis: 'Nghĩa vụ pháp lý (kế toán, thuế)', recipients: 'Nhà cung cấp hóa đơn điện tử, ngân hàng/cổng thanh toán', cross_border: 0, retention: 'Theo quy định kế toán, thuế' },
];

/** Nap muc mac dinh khi so dang ky con trong (idempotent). */
export async function ensureProcessingRecords(rt: Runtime): Promise<number> {
  if ((await rt.db.query('SELECT 1 AS x FROM processing_records LIMIT 1'))[0]) return 0;
  const now = rt.clock.now().toISOString();
  let n = 0;
  for (const d of DEFAULTS) {
    const r = await rt.db.run(
      `INSERT INTO processing_records (id, activity, purpose, data_categories, data_subjects, legal_basis, recipients, cross_border, retention, owner, active, updated_by, created_at, updated_at)
       SELECT ?,?,?,?,?,?,?,?,?,NULL,1,NULL,?,? WHERE NOT EXISTS (SELECT 1 FROM processing_records WHERE activity = ?)`,
      [rt.id(), d.activity, d.purpose, d.data_categories, d.data_subjects, d.legal_basis, d.recipients, d.cross_border, d.retention, now, now, d.activity],
    );
    n += r.changes;
  }
  return n;
}
