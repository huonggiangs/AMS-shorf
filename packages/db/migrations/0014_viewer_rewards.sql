-- 0014 (WP-18): phia nguoi xem. Thuong tu chien dich, tuong tac QR, chi tra (cho tai chinh duyet), co uy quyen thue.
-- Chay nguyen van tren PostgreSQL 16 va SQLite/D1. Chi THEM cot/bang/chi muc, khong doi du lieu cu.
-- Migration chi ap khi deploy (D1: wrangler d1 migrations apply; Node: migrate()) (xem docs/VIEWER-API.md).

-- Loai chien dich: 'cover' (phu: luot xem tra thap theo reward_points cua slot) hoac 'performance' (hieu qua: luot xem KHONG tinh,
-- chi nhap/quet QR theo interaction_reward_vnd). Mac dinh 'performance' = an toan (khong ghi thuong luot xem cho den khi nha tai tro cau hinh).
ALTER TABLE campaigns ADD COLUMN reward_model TEXT NOT NULL DEFAULT 'performance' CHECK (reward_model IN ('cover','performance'));
-- Don gia thuong moi lan tuong tac hop le (dong). Mac dinh 0 = khong thuong. Tran cung o DB 1000, tran van hanh la INTERACTION_MAX_REWARD_VND (50).
ALTER TABLE campaigns ADD COLUMN interaction_reward_vnd INTEGER NOT NULL DEFAULT 0 CHECK (interaction_reward_vnd >= 0 AND interaction_reward_vnd <= 1000);

-- Xac minh so dien thoai nguoi xem (OTP gui toi so nay). phone_hash da co (HMAC, UNIQUE).
ALTER TABLE end_users ADD COLUMN phone_enc TEXT;
ALTER TABLE end_users ADD COLUMN phone_verified_at TEXT;

-- Lenh chi tra tao tu app: khoa idempotent, tai khoan nhan (ma hoa AES-GCM, chi cho tai chinh giai ma), snapshot che do thue.
ALTER TABLE payouts ADD COLUMN idempotency_key TEXT;
ALTER TABLE payouts ADD COLUMN bank_code TEXT;
ALTER TABLE payouts ADD COLUMN bank_name TEXT;
ALTER TABLE payouts ADD COLUMN account_enc TEXT;
ALTER TABLE payouts ADD COLUMN account_last4 TEXT;
ALTER TABLE payouts ADD COLUMN tax_mode TEXT;
ALTER TABLE payouts ADD COLUMN requested_via TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payouts_idem ON payouts(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Moi dong thuong (xem / tuong tac) chi duoc ghi mot lan theo (ref_type, ref_id = event_id): chong cong thuong trung khi thiet bi gui lai.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_ledger_reward_ref ON wallet_ledger(ref_type, ref_id) WHERE kind = 'reward' AND ref_id IS NOT NULL;

-- Tuong tac (nhap / quet QR) do thiet bi bao, da ky. event_id (UUIDv7) la khoa chinh => khu trung.
CREATE TABLE IF NOT EXISTS viewer_interactions (
  event_id TEXT NOT NULL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  user_id TEXT REFERENCES end_users(id),
  campaign_id TEXT NOT NULL,
  creative_id TEXT NOT NULL,
  slot_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('tap','qr_scan')),
  ts TEXT NOT NULL,
  valid INTEGER NOT NULL DEFAULT 0 CHECK (valid IN (0,1)),
  reject_reason TEXT,
  reward_vnd INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_viewer_inter_user ON viewer_interactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_viewer_inter_user_camp ON viewer_interactions(user_id, campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_viewer_inter_campaign ON viewer_interactions(campaign_id, created_at);

-- Uy quyen thue cua nguoi nhan chi tra. Lich su chi THEM dong (dong moi nhat = hieu luc, mode none = thu hoi).
-- mode (trung tu vung cua app Mindo): auto_pay (bat thanh toan tu dong: nguoi nhan chap nhan khau tru/chi tra thue),
-- delegate (uy quyen ung dung nop thue thay), none (chua chap nhan / thu hoi). CHUA nop thue that: chi luu co va dong y, xem docs/VIEWER-API.md muc 7.
CREATE TABLE IF NOT EXISTS viewer_tax_authorizations (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES end_users(id),
  mode TEXT NOT NULL CHECK (mode IN ('none','auto_pay','delegate')),
  consent_version TEXT,
  tax_code_enc TEXT,
  device_id TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_viewer_tax_user ON viewer_tax_authorizations(user_id, created_at);
