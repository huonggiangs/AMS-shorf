-- 0004: P0 mien nghiep vu (docs/DOMAIN-REVISION-PROPOSAL.md muc 1-4). Chay nguyen van tren PostgreSQL 16 va SQLite/D1 (khong can ban rieng tung engine).

-- (2) Outbox: viec phai xay ra SAU mot thay doi trang thai, ghi cung giao dich voi thay doi do; worker xu ly idempotent.
--   status: pending (cho/dang thu lai) | done | dead (het so lan thu, can nguoi xu ly)
--   available_at: thoi diem som nhat duoc xu ly (cung la "hop dong thue" khi mot worker dang giu: claim day available_at ra phia truoc)
--   dedupe_key UNIQUE: INSERT ... ON CONFLICT DO NOTHING => ghi hai lan cung mot viec chi ra mot dong
CREATE TABLE outbox (
  id TEXT NOT NULL PRIMARY KEY,
  topic TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  processed_at TEXT,
  last_error TEXT,
  dedupe_key TEXT NOT NULL UNIQUE
);
CREATE INDEX idx_outbox_due ON outbox(status, available_at, id);

-- (3) Lenh gui thiet bi (thay danh sach trong KV `cmd:<device>`).
--   status: pending -> delivered (heartbeat tra ve) -> acked | failed (thiet bi bao) ; expired (qua han, quet dinh ky)
--   idempotency_key: duy nhat theo thiet bi (NULL = khong khu trung); args la JSON dang TEXT
CREATE TABLE device_commands (
  id TEXT NOT NULL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  type TEXT NOT NULL,
  args TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','acked','failed','expired')),
  idempotency_key TEXT,
  expires_at TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  deliveries INTEGER NOT NULL DEFAULT 0,
  acked_at TEXT,
  result TEXT,
  UNIQUE (device_id, idempotency_key)
);
CREATE INDEX idx_device_commands_dev ON device_commands(device_id, status, created_at);
CREATE INDEX idx_device_commands_exp ON device_commands(status, expires_at);

-- (4) Khu trung chi tieu THEO TUNG su kien: mot event_id chi duoc tinh tien dung mot lan, bat ke gom lo/giao lai/mat dien giua chung.
--   credited_micro: so micro-VND da cong vao phan du cua chien dich (ghi cung buoc nguyen tu voi viec chiem event_id)
CREATE TABLE spend_events (
  event_id TEXT NOT NULL PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  amount_micro_vnd BIGINT NOT NULL,
  claim TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_spend_events_created ON spend_events(created_at);
