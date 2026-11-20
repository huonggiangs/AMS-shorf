-- 0015 (w-dev): xac nhan cua nguoi duyet cho kid_safe / ngu canh man khoa cua creative, GAN VOI phien ban noi dung.
-- Co y KHONG dung ALTER TABLE (khong idempotent): bang phu khoa theo creative_id, nhu 0007/0013.
-- Manifest chi giu ngu canh 'lock' khi dong nay co kid_safe = 1 VA content_version = creative_security.content_version hien tai
-- (khach doi tep/dinh dang/overlay => content_version tang => xac nhan het hieu luc cho toi khi nguoi duyet xac nhan lai).
-- Lenh thiet bi dung bang device_commands (0004); huy lenh = status 'failed' + result 'cancelled_by_admin' (khong doi CHECK).
CREATE TABLE IF NOT EXISTS creative_kid_review (
  creative_id TEXT NOT NULL PRIMARY KEY,
  content_version INTEGER NOT NULL,
  kid_safe INTEGER NOT NULL DEFAULT 0 CHECK (kid_safe IN (0,1)),
  contexts TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT NOT NULL,
  note TEXT
);
