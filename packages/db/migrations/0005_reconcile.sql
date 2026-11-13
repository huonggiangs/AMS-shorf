-- 0005: doi soat doanh thu/chi tieu voi impression log, bao ve cong tien kep, nhat ky chay job doi soat.
-- Chay nguyen van tren PostgreSQL 16 va SQLite/D1.

-- Mot lan chay cua job doi soat (revenue | sepay | repair): de biet job co chay hay khong, cua so nao, ket qua ra sao.
CREATE TABLE reconcile_runs (
  id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  window_from TEXT,
  window_to TEXT,
  checked INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  resolved INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error')),
  error TEXT,
  params TEXT
);
CREATE INDEX idx_reconcile_runs_kind ON reconcile_runs(kind, started_at);

-- Chenh lech theo (loai, chien dich, ngay gio Viet Nam). UNIQUE => chay lai chi cap nhat, khong nhan doi dong.
--   claim_vs_impression: micro-VND da chiem (spend_events) so voi doanh thu impression hop le (impression_hourly). diff = actual - expected (+ thu thua, - thu thieu)
--   ledger_vs_claim:     VND da ghi so cai (spend_dedupe.charged_vnd * 1e6) so voi micro da chiem. Chi bao thu THUA (so cai > chiem + dung sai).
--   status: open (dang lech) | resolved (tu dong dong khi lan chay sau thay het lech, hoac nguoi xu ly) | ignored (nguoi bo qua: khong tu mo lai)
CREATE TABLE revenue_discrepancies (
  id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('claim_vs_impression','ledger_vs_claim')),
  campaign_id TEXT NOT NULL,
  day TEXT NOT NULL,
  expected_micro BIGINT NOT NULL DEFAULT 0,
  actual_micro BIGINT NOT NULL DEFAULT 0,
  diff_micro BIGINT NOT NULL DEFAULT 0,
  tolerance_micro BIGINT NOT NULL DEFAULT 0,
  impressions_valid BIGINT NOT NULL DEFAULT 0,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  note TEXT,
  UNIQUE (kind, campaign_id, day)
);
CREATE INDEX idx_rev_disc_status ON revenue_discrepancies(status, day);
CREATE INDEX idx_rev_disc_campaign ON revenue_discrepancies(campaign_id, day);

-- Bao ve cong tien kep: moi khoan tien vao vi chiem MOT khoa duy nhat truoc khi cong.
--   claim_key = 'txn:<provider>:<ma giao dich ngan hang>' (moi duong: webhook, doi soat bu, hang doi thu cong)
--             | 'topup:<id>' (nap thu cong khong co ma giao dich)
-- Hai duong cung mot giao dich ngan hang => cung claim_key => chi mot topup duoc cong (UNIQUE + chen idempotent).
CREATE TABLE topup_credit_claims (
  claim_key TEXT NOT NULL PRIMARY KEY,
  topup_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  amount_vnd BIGINT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_topup_claims_topup ON topup_credit_claims(topup_id);
