-- 0026: Cay phan nhom thiet bi (long nhau), dia diem dat thiet bi, va thong tin dat/giam sat tren device_profiles.
-- Thiet bi thuoc DUNG MOT nhom va toi da MOT dia diem (cot tren device_profiles, 1-1 theo khoa chinh devices.id).
-- Xoa mem (deleted_at). Moi truy van quan tri deu di qua /admin/v1 (noi bo), nen khong co tenant_id (bang devices cung khong co).
CREATE TABLE IF NOT EXISTS device_groups (
  id TEXT NOT NULL PRIMARY KEY,
  parent_id TEXT REFERENCES device_groups(id),
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_groups_parent ON device_groups(parent_id);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  province TEXT,
  district TEXT,
  lat REAL,
  lng REAL,
  venue_type TEXT NOT NULL DEFAULT 'other',
  contact_name TEXT,
  contact_phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_locations_province ON locations(province);

-- group_id/location_id: gan nhom/dia diem. mac/serial: do van hanh nhap tay (thiet bi khong tu khai).
-- volume: am luong thiet bi BAO CAO qua heartbeat (0-100); volume_at: thoi diem bao cao.
ALTER TABLE device_profiles ADD COLUMN group_id TEXT;
ALTER TABLE device_profiles ADD COLUMN location_id TEXT;
ALTER TABLE device_profiles ADD COLUMN mac TEXT;
ALTER TABLE device_profiles ADD COLUMN serial TEXT;
ALTER TABLE device_profiles ADD COLUMN volume INTEGER;
ALTER TABLE device_profiles ADD COLUMN volume_at TEXT;
CREATE INDEX IF NOT EXISTS idx_device_profiles_group ON device_profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_device_profiles_location ON device_profiles(location_id);
