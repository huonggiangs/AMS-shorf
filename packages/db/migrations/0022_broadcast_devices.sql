-- 0022: Chuong trinh phat song nhan theo TUNG THIET BI. Khong co dong = chuong trinh theo loai man + khu vuc nhu cu.
-- Co dong = chi cac thiet bi nay nhan (manifest cua thiet bi duoc xay rieng, khong dung chung nhom khu vuc).
CREATE TABLE IF NOT EXISTS broadcast_program_devices (
  program_id TEXT NOT NULL REFERENCES broadcast_programs(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  PRIMARY KEY (program_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_bp_devices_device ON broadcast_program_devices(device_id);
