-- 0017: Signage Player (thang may / LED, app vn.anio.signage). Co y KHONG dung ALTER TABLE (khong idempotent tren SQLite/D1):
-- cac bang phu moi khoa theo id, nhu 0007/0013/0015/0016. Mot ban SQL dung chung Postgres/SQLite/D1.
--
-- device_profiles: thong tin thiet bi tu khai (do phan giai, huong, nguon dang phat, dung luong cache) + dau cap quyen cua van hanh.
--   px_w/px_h dung de chon nhom manifest `elevator_<w>x<h>` khi thiet bi CHUA gan vao screens (screens.px_* uu tien khi da gan).
--   approved_at/approved_by: van hanh da "Cap quyen" (trust_level >= 1) thiet bi khong-TV; NULL = chua/da thu hoi.
CREATE TABLE IF NOT EXISTS device_profiles (
  device_id TEXT NOT NULL PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  px_w INTEGER,
  px_h INTEGER,
  orientation TEXT,
  source TEXT,
  cache_mb INTEGER,
  reported_at TEXT,
  approved_at TEXT,
  approved_by TEXT
);
-- device_logs: nhat ky thiet bi gui qua POST /v1/logs (<= 8 KB moi lan). Giu 7 ngay (don trong cron Worker / vong outbox Node).
CREATE TABLE IF NOT EXISTS device_logs (
  id TEXT NOT NULL PRIMARY KEY,
  device_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  received_at TEXT NOT NULL,
  level TEXT NOT NULL,
  tag TEXT,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_logs_dev ON device_logs(device_id, ts, id);
CREATE INDEX IF NOT EXISTS idx_device_logs_recv ON device_logs(received_at);
-- schedule_slot_text: chu header/footer ghi de theo tung lich phat (NULL = khong ghi de; chuoi rong = an). Cau hinh chung theo loai man: settings.signage_config.
CREATE TABLE IF NOT EXISTS schedule_slot_text (
  slot_id TEXT NOT NULL PRIMARY KEY REFERENCES schedule_slots(id) ON DELETE CASCADE,
  header TEXT,
  footer TEXT,
  updated_at TEXT NOT NULL
);
