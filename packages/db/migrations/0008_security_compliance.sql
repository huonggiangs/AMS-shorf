-- 0008 (p2-security): rang buoc phien ban noi dung (R1-14), kid_safe/man khoa co cau truc (R4-N5), cong tuan thu noi dung chien dich.
-- Chay nguyen van tren PostgreSQL 16 va SQLite/D1 (mot file dung chung, giong 0003-0007). Chi THEM bang/chi muc IF NOT EXISTS (khong ALTER): chay lai an toan,
-- ke ca tren D1 khong co giao dich tuong tac. Khong co dong = mac dinh (content_version 1, kid_safe 0, lock_context 0, chua rang buoc phien ban).

-- (1) creative_security: 1-1 voi creatives.
--   content_version: tang moi khi tep/dinh dang/overlay doi (R1-14). approved_version/approved_hash: phien ban + dau van tay noi dung luc duyet;
--   NULL = duyet truoc khi co rang buoc (du lieu cu/demo). kid_safe/lock_context: cot co cau truc, API dong bo moi lan overlay doi.
CREATE TABLE IF NOT EXISTS creative_security (
  creative_id TEXT NOT NULL PRIMARY KEY,
  content_version INTEGER NOT NULL DEFAULT 1,
  approved_version INTEGER,
  approved_hash TEXT,
  kid_safe INTEGER NOT NULL DEFAULT 0 CHECK (kid_safe IN (0,1)),
  lock_context INTEGER NOT NULL DEFAULT 0 CHECK (lock_context IN (0,1)),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creative_security_kid ON creative_security(kid_safe, lock_context);

-- Du lieu co san: dong bo kid_safe/lock tu overlay JSON mot lan (sau do API giu dong bo, khong dung LIKE nua).
INSERT INTO creative_security (creative_id, content_version, kid_safe, lock_context, updated_at)
SELECT id,
       1,
       CASE WHEN overlay LIKE '%"kid_safe":true%' THEN 1 ELSE 0 END,
       CASE WHEN overlay LIKE '%"lock"%' THEN 1 ELSE 0 END,
       created_at
  FROM creatives
 WHERE overlay LIKE '%"kid_safe":true%' OR overlay LIKE '%"lock"%'
ON CONFLICT (creative_id) DO NOTHING;

-- (2) campaign_gate: cong tuan thu noi dung khi gui duyet chien dich (1-1 voi campaigns).
--   restricted_industry: nganh han che (khach khai bao hoac nganh khach thuoc danh sach cam). rights_confirmed_*: xac nhan quyen su dung noi dung (ai, luc nao, phien ban cau cam ket).
CREATE TABLE IF NOT EXISTS campaign_gate (
  campaign_id TEXT NOT NULL PRIMARY KEY,
  restricted_industry INTEGER NOT NULL DEFAULT 0 CHECK (restricted_industry IN (0,1)),
  restricted_reason TEXT,
  rights_confirmed_at TEXT,
  rights_confirmed_by TEXT,
  rights_statement TEXT,
  updated_at TEXT NOT NULL
);
