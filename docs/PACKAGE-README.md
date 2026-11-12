# Gói bàn giao AMS cho Agent

Mở `prototype/AMS Admin.dc.html` (cần `app.js` và `app.css` cùng thư mục) để xem giao diện chạy được, dữ liệu là dữ liệu minh họa.

## Nội dung
| Đường dẫn | Mô tả |
|---|---|
| docs/DAC-TA-GIAO-VIEC-AGENT.md | **Đặc tả chính**: sản phẩm, kiến trúc 50 triệu thiết bị, cơ sở dữ liệu, Docker local, Cloudflare, SePay, việc giao |
| docs/BRIEF-AGENT-THUONG-MAI.md | Bản tóm tắt thương mại ban đầu (đã thay bằng đặc tả chính) |
| docs/DESIGN-TOKENS.md | Màu, chữ, hình khối, điểm ngắt, kiểu biểu đồ |
| styles/app.css | Toàn bộ CSS giao diện |
| icons/*.svg | 28 icon rời (24×24, nét 1,7, dùng `currentColor`) |
| icons/sprite.svg | Cùng bộ icon dạng `<symbol id="i-tên">` |
| icons/icons.json | Tên icon và đường vẽ |
| prototype/ | Bản chạy được: app.js (logic, dữ liệu mẫu, biểu đồ), app.css, AMS Admin.dc.html |

## Icon
home, tv, phone, ads, coin, link, shield, bell, search, plus, dl, menu, moon, x, chev, info, users, eye, check, card, cal, img, clock, warn, doc, gear, user, log.
Icon vẽ riêng cho prototype (kiểu nét mảnh, giống bộ Iconly/Lucide). Có thể thay bằng bộ icon chính thức khi có, giữ nguyên tên.

## Chưa có trong gói
- Ảnh `ADS.png` (mẫu quảng cáo hiển thị trên TV) nằm ở `D:\JOB\Block video\tv\ADS.png` trên máy chủ dự án.
- Tài liệu SePay nội bộ ở `D:\hotel\HW\anio-power\Anionote_09108CH`.
- Logo các nhà cung cấp (Chicilon, Unique OOH, WeWin, Goldsun, Brandcom, Trimai).
- Font San Francisco (dùng font hệ thống, không đóng gói). 
- Chưa có mã backend, app TV, Docker Compose: đó là phần Agent cần xây theo đặc tả.

## Cách đọc code prototype
app.js là một tệp: dữ liệu mẫu ở đầu (devices, ads, CUS, CT, WAL, TOP, SEP...), `PAGES` là từng trang, `shell()` là khung, `table()` bảng dùng chung (tìm, lọc, sắp xếp, phân trang, chọn dòng, CSV), `fireAct()` là mọi thao tác. Khi làm thật, tách thành component React theo cấu trúc trong đặc tả mục 10.
