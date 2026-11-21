-- 0021: Mau bo cuc da vung (kieu QuangBao Cloud) cho chuong trinh phat song noi bo. Co y KHONG dung ALTER TABLE (xem 0017/0018):
-- bang phu moi khoa theo id.
-- layout_templates: mau dung lai. orientation: landscape | portrait. zones: JSON mang vung
--   [{id, type: video|image|marquee|clock|weather|qr, x,y,w,h (% 0..100), z, transition: none|fade|slide-left|slide-right|zoom, ...thuoc tinh chu chay/dong ho}].
CREATE TABLE IF NOT EXISTS layout_templates (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  orientation TEXT NOT NULL DEFAULT 'landscape',
  zones TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Bo cuc cua mot chuong trinh (khong co dong = man hinh don nhu cu). template_id chi de tham chieu (zones da chep vao day).
CREATE TABLE IF NOT EXISTS broadcast_program_layouts (
  program_id TEXT NOT NULL PRIMARY KEY REFERENCES broadcast_programs(id) ON DELETE CASCADE,
  template_id TEXT,
  orientation TEXT NOT NULL DEFAULT 'landscape',
  zones TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
-- Tep nao phat o vung nao (zone_id khop id vung trong bo cuc). Tep khong co dong = vung chinh dau tien kieu video/image.
CREATE TABLE IF NOT EXISTS broadcast_item_zones (
  program_id TEXT NOT NULL REFERENCES broadcast_programs(id) ON DELETE CASCADE,
  creative_id TEXT NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL,
  PRIMARY KEY (program_id, creative_id)
);

-- Mau he thong (id bat dau bang 'sys_'): xem duoc, dung lam goc, KHONG sua/xoa duoc qua API.
INSERT INTO layout_templates (id, name, orientation, zones, created_by, created_at, updated_at) SELECT 'sys_split_portrait', 'Chia đôi Dọc (TVC 50% + Poster 50%)', 'portrait', '[{"id": "tvc", "name": "Video Quảng cáo", "type": "video", "x": 0, "y": 0, "w": 100, "h": 50, "z": 0, "transition": "fade"}, {"id": "poster", "name": "Poster Tĩnh", "type": "image", "x": 0, "y": 50, "w": 100, "h": 50, "z": 0, "transition": "fade"}]', NULL, '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z' WHERE NOT EXISTS (SELECT 1 FROM layout_templates WHERE id = 'sys_split_portrait');
INSERT INTO layout_templates (id, name, orientation, zones, created_by, created_at, updated_at) SELECT 'sys_retail3', 'Bán lẻ 3 vùng', 'portrait', '[{"id": "bar", "name": "Thanh Chữ chạy", "type": "marquee", "x": 0, "y": 0, "w": 100, "h": 8, "z": 2, "transition": "none", "text": "Khuyến mãi hôm nay - Giảm đến 50%", "bg_color": "#DC2626", "text_color": "#FFFFFF", "font_size": 18, "scroll_speed": 60}, {"id": "tvc", "name": "Video TVC", "type": "video", "x": 0, "y": 8, "w": 100, "h": 67, "z": 0, "transition": "fade"}, {"id": "qr", "name": "Mã QR Ưu đãi", "type": "qr", "x": 25, "y": 75, "w": 50, "h": 25, "z": 0, "transition": "none", "url": "https://anio.vn"}]', NULL, '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z' WHERE NOT EXISTS (SELECT 1 FROM layout_templates WHERE id = 'sys_retail3');
INSERT INTO layout_templates (id, name, orientation, zones, created_by, created_at, updated_at) SELECT 'sys_lobby_landscape', 'Sảnh Tòa nhà Ngang', 'landscape', '[{"id": "lobby", "name": "Ảnh Sảnh Chính", "type": "image", "x": 0, "y": 0, "w": 70, "h": 100, "z": 0, "transition": "fade"}, {"id": "clock", "name": "Đồng hồ Số", "type": "clock", "x": 70, "y": 0, "w": 30, "h": 50, "z": 0, "transition": "none", "bg_color": "#111827", "text_color": "#FFFFFF", "font_size": 32}, {"id": "weather", "name": "Thời tiết Khu vực", "type": "weather", "x": 70, "y": 50, "w": 30, "h": 50, "z": 0, "transition": "none", "bg_color": "#1D4ED8", "text_color": "#FFFFFF"}]', NULL, '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z' WHERE NOT EXISTS (SELECT 1 FROM layout_templates WHERE id = 'sys_lobby_landscape');
INSERT INTO layout_templates (id, name, orientation, zones, created_by, created_at, updated_at) SELECT 'sys_airport', 'Sân bay Quốc tế', 'landscape', '[{"id": "banner", "name": "Banner Du lịch 4K", "type": "video", "x": 0, "y": 0, "w": 70, "h": 88, "z": 0, "transition": "fade"}, {"id": "clock", "name": "Giờ Chuyến bay", "type": "clock", "x": 70, "y": 0, "w": 30, "h": 44, "z": 0, "transition": "none", "bg_color": "#0F172A", "text_color": "#FDE68A", "font_size": 32}, {"id": "weather", "name": "Thời tiết Cửa ngõ", "type": "weather", "x": 70, "y": 44, "w": 30, "h": 44, "z": 0, "transition": "none", "bg_color": "#0369A1", "text_color": "#FFFFFF"}, {"id": "notice", "name": "Thông báo Hành khách", "type": "marquee", "x": 0, "y": 88, "w": 100, "h": 12, "z": 2, "transition": "none", "text": "Quý khách vui lòng có mặt tại cửa ra máy bay trước giờ khởi hành 30 phút", "bg_color": "#B45309", "text_color": "#FFFFFF", "font_size": 18, "scroll_speed": 60}]', NULL, '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z' WHERE NOT EXISTS (SELECT 1 FROM layout_templates WHERE id = 'sys_airport');
INSERT INTO layout_templates (id, name, orientation, zones, created_by, created_at, updated_at) SELECT 'sys_fnb_menu', 'Menu Quầy Gọi món F&B', 'portrait', '[{"id": "combo", "name": "Video Combo", "type": "video", "x": 0, "y": 0, "w": 100, "h": 72, "z": 0, "transition": "fade"}, {"id": "offer", "name": "Ưu đãi Giờ vàng", "type": "image", "x": 0, "y": 72, "w": 100, "h": 16, "z": 0, "transition": "fade"}, {"id": "qr", "name": "QR Thanh toán", "type": "qr", "x": 30, "y": 88, "w": 40, "h": 12, "z": 0, "transition": "none", "url": "https://anio.vn"}]', NULL, '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z' WHERE NOT EXISTS (SELECT 1 FROM layout_templates WHERE id = 'sys_fnb_menu');
INSERT INTO layout_templates (id, name, orientation, zones, created_by, created_at, updated_at) SELECT 'sys_medical_kiosk', 'Kiosk Y tế & Bệnh viện', 'portrait', '[{"id": "map", "name": "Sơ đồ & Chỉ dẫn Khoa", "type": "image", "x": 0, "y": 0, "w": 100, "h": 74, "z": 0, "transition": "fade"}, {"id": "guide", "name": "Hướng dẫn Bệnh nhân", "type": "marquee", "x": 0, "y": 74, "w": 100, "h": 12, "z": 2, "transition": "none", "text": "Vui lòng lấy số thứ tự và chờ gọi tên tại khu vực chờ", "bg_color": "#047857", "text_color": "#FFFFFF", "font_size": 18, "scroll_speed": 60}, {"id": "qr", "name": "QR Khám nhanh", "type": "qr", "x": 30, "y": 86, "w": 40, "h": 14, "z": 0, "transition": "none", "url": "https://anio.vn"}]', NULL, '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z' WHERE NOT EXISTS (SELECT 1 FROM layout_templates WHERE id = 'sys_medical_kiosk');
