# Design tokens AMS

Nguồn: app.css (biến CSS trên `.tvn`). Giao diện theo ADS.fig, font hệ thống Apple San Francisco.

## Màu (sáng)
| Token | Giá trị | Dùng cho |
|---|---|---|
| --pri | #005BBF | nút chính, tab đang chọn, liên kết |
| --pri-d | #00479A | hover nút chính |
| --pri-t | #E8F1FB | nền nhạt của màu chính, mục menu đang chọn |
| --ink | #0F172A | chữ chính |
| --mut | #64748B | chữ phụ, nhãn |
| --line | #E2E8F0 | viền, đường kẻ |
| --bg | #F1F5F9 | nền trang |
| --card | #FFFFFF | nền thẻ |
| --ok / --ok-t | #059669 / #ECFDF5 | thành công |
| --warn / --warn-t | #D97706 / #FFFBEB | cảnh báo, giờ vàng |
| --bad / --bad-t | #E11D48 / #FFF1F2 | lỗi, offline |
| Sky | #0284C7 | cột doanh thu, nguồn Chicilon |
| Slate | #94A3B8, #CBD5E1 | chuỗi phụ trong biểu đồ |

## Màu (tối, class `.dark`)
bg #0B1220 · card #111A2C · ink #E6ECF5 · mut #94A3B8 · line #1E2B42 · pri #4C9AFF · pri-t #12263F · ok #34D399 · warn #FBBF24 · bad #FB7185.

## Chữ
- Chữ thường: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, 'Segoe UI', sans-serif`
- Số liệu, nhãn, cột bảng: `'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace` (biến `--mono`)
- Cỡ: thân 14px · tiêu đề trang clamp(20px, 1.4vw + 14px, 28px) · KPI clamp(22px, 1.2vw + 14px, 30px) · nhãn mono 11.5px chữ hoa, giãn chữ .06em
- SF không tải được từ web. Apple dùng font thật, nền tảng khác dùng font hệ thống gần nhất.

## Hình khối
Thẻ bo 12px, viền 1px `--line`, gần như không đổ bóng · nút bo 8px cao 40px (nhỏ 32px) · thẻ trạng thái bo 6px, chữ mono 12px · avatar bo 8px · hộp thoại bo 20px.

## Bố cục và điểm ngắt
Menu trái 232px (thu 76px) · nội dung tối đa 1500px (1760px từ 1600px) · ≤1200px menu thu icon, khối 2 cột thành 1 cột · ≤900px menu thành ngăn trượt · ≤560px KPI một cột.

## Biểu đồ (vẽ bằng SVG/CSS trong app.js, không dùng thư viện)
Đường xu hướng có tooltip (`line()`) · cột nhóm (`bars()`) · donut (`donut()`) · bản đồ nhiệt slot fill (`heat()`) · thanh pacing (`.bar`) · timeline kéo thả (`.tl`, `.blk`). Bảng màu chuỗi: #005BBF, #0284C7, #059669, #D97706, #94A3B8.
