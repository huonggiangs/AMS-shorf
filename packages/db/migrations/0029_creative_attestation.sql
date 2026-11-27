-- 0029: cam ket phap ly noi dung (legal attestation) cua creative. Lich su CHI THEM, khong xoa (thu hoi = dat revoked_at).
-- Mot dong = mot lan nguoi co quyen media:approve tick o cam ket (luc duyet / tai len / ky bo sung / ky hang loat), gan voi content_version luc ky.
-- Cam ket HIEU LUC cua creative = dong moi nhat co revoked_at IS NULL VA content_version = creative_security.content_version hien tai.
-- Doi noi dung (content_version tang) hoac thu hoi duyet => khong con hieu luc, manifest khong phat creative do cho thiet bi.
-- kid_safe: lua chon cua NGUOI KY (mac dinh 0 = khong an toan cho tre). Khong the suy ra tu overlay.
-- CREATE ... IF NOT EXISTS: chay lai an toan (khong dung ALTER TABLE).
CREATE TABLE IF NOT EXISTS creative_attestations (
  id TEXT NOT NULL PRIMARY KEY,
  creative_id TEXT NOT NULL,
  content_version INTEGER NOT NULL,
  version TEXT NOT NULL,
  kid_safe INTEGER NOT NULL DEFAULT 0 CHECK (kid_safe IN (0,1)),
  signed_by TEXT NOT NULL,
  signed_by_name TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  ip_hash TEXT,
  ua_hash TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_creative_attestations_creative ON creative_attestations(creative_id, signed_at);
