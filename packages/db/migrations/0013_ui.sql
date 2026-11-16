-- 0013 (u1-ui): dieu khoan bo sung cua dong gia hop dong: mo hinh gia (fixed|cpm), gia CPM goc, ngay hieu luc.
-- Co y KHONG dung ALTER TABLE (khong idempotent): bang phu khoa theo contract_line_id, nhu 0007. Don gia moi luot van nam o contract_line_prices.
-- model='cpm': cpm_micro_vnd = gia moi 1.000 luot (micro-VND nguyen); don gia moi luot = ceil(cpm/1000) (cung quy tac voi bang gia).
-- effective_from/to: ngay YYYY-MM-DD gio Viet Nam, bao gom ca hai dau; NULL = khong gioi han (theo thoi han hop dong).
CREATE TABLE IF NOT EXISTS contract_line_terms (
  contract_line_id TEXT NOT NULL PRIMARY KEY,
  contract_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'fixed' CHECK (model IN ('fixed','cpm')),
  cpm_micro_vnd BIGINT CHECK (cpm_micro_vnd IS NULL OR cpm_micro_vnd > 0),
  effective_from TEXT,
  effective_to TEXT
);
CREATE INDEX IF NOT EXISTS idx_contract_line_terms_contract ON contract_line_terms(contract_id);
