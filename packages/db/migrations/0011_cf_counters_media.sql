-- 0011 (p5-cf): bo dem nguyen tu cho Cloudflare, khoa khu trung proof-of-play, nhat ky kiem tra creative tren Cloudflare.
-- Chay nguyen van tren PostgreSQL 16 va SQLite/D1 (IF NOT EXISTS: chay lai an toan). Tren Postgres/Redis cac bang dem la vo hai (khong dung).

-- 1) Bo dem nguyen tu cua duong Cloudflare (D1): rate limit, khoa chiem, tran gio/thiet bi, khu trung lo. Xem docs/DECISIONS-CF-COUNTERS.md.
--    exp = giay epoch het han (cua so co dinh); dong het han bi cron don (D1Counters.purge) hoac dem lai khi tang.
CREATE TABLE IF NOT EXISTS kv_counters (
  k TEXT PRIMARY KEY,
  n BIGINT NOT NULL,
  exp BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kv_counters_exp ON kv_counters(exp);

-- 2) Khoa khu trung proof-of-play THEO event_id (N8): ev_proof_of_play khong co event_id nen khong the UNIQUE tren chinh no
--    (ALTER ADD COLUMN khong co IF NOT EXISTS tren SQLite). Ghi PoP chi khi chiem duoc event_id o day (cung mot lo/giao dich).
--    `claim` la the cua lan chen thanh cong (cung mau voi spend_events) de cau lenh ghi PoP chi chay cho chinh nguoi chiem.
CREATE TABLE IF NOT EXISTS ev_pop_seen (
  event_id TEXT PRIMARY KEY,
  claim TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ev_pop_seen_ts ON ev_pop_seen(ts);

-- 3) Ket qua kiem tra creative khong co ClamAV (duong Cloudflare). KHONG phai quet virus: engine ghi ro nguon phan quyet.
--    engine: 'cf-validator-v1' (allow-list: magic bytes/MIME/kich thuoc/sha256) | 'manual' (admin duyet tay) | 'clamav' (media-worker VPS).
CREATE TABLE IF NOT EXISTS creative_validation (
  creative_id TEXT PRIMARY KEY REFERENCES creatives(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  verdict TEXT NOT NULL,
  detail TEXT,
  sha256 TEXT,
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creatives_scan_state ON creatives(scan_state);
