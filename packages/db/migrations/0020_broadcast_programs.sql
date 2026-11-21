-- 0020: Chuong trinh phat song noi bo (khong qua hop dong/thanh toan). Van hanh chon media trong kho, loai man, khu vuc, khung gio roi xuat ban;
-- gateway dua chuong trinh da xuat ban vao manifest cua nhom thiet bi tuong ung (campaign_id trong manifest = 'bp_<id>', khong tinh tien).
-- Co y KHONG dung ALTER TABLE (xem 0017/0018): bang moi khoa theo id.
-- status: draft | published | ended. Chi 'published' va trong khoang ngay moi vao manifest.
-- target_type: tv | elevator | led_p5. regions: JSON mang ma khu vuc; rong = moi khu vuc.
-- start_date/end_date: YYYY-MM-DD (gio Viet Nam), NULL = khong gioi han. start_min/end_min: luoi 30 phut trong ngay.
CREATE TABLE IF NOT EXISTS broadcast_programs (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  target_type TEXT NOT NULL,
  regions TEXT NOT NULL DEFAULT '[]',
  start_date TEXT,
  end_date TEXT,
  start_min INTEGER NOT NULL DEFAULT 0,
  end_min INTEGER NOT NULL DEFAULT 1440,
  priority INTEGER NOT NULL DEFAULT 3,
  header TEXT,
  footer TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_broadcast_programs_state ON broadcast_programs(status, target_type);
-- Danh sach tep cua chuong trinh theo thu tu phat. creative_id: tep trong kho media (creatives), chi nhan tep chua gan chien dich.
CREATE TABLE IF NOT EXISTS broadcast_program_items (
  program_id TEXT NOT NULL REFERENCES broadcast_programs(id) ON DELETE CASCADE,
  creative_id TEXT NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (program_id, creative_id)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_items_creative ON broadcast_program_items(creative_id);
