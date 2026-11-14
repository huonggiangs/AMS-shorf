-- 0009 (p3-ops): canh bao van hanh, nhat ky gui thong bao, nhip job nen, bo dem loi.
-- Chay nguyen van tren PostgreSQL 16 va SQLite/D1; moi cau lenh deu IF NOT EXISTS (chay lai an toan).

-- Su co do job kiem tra (runOpsChecks) mo/dong. Moi quy tac (rule_key) chi co MOT su co chua dong (chi muc duy nhat co dieu kien ben duoi).
--   severity: S1 | S2 | S3 (docs/ops/ONCALL.md)      component: api | gateway | db | queue | payments
--   status: open -> acked (nguoi truc da nhan) -> resolved (job thay het dieu kien, tu dong)
--   public_note: cau mo ta an toan cho trang trang thai cong khai (khong so lieu noi bo); detail chi cho quan tri
CREATE TABLE IF NOT EXISTS ops_incidents (
  id TEXT NOT NULL PRIMARY KEY,
  rule_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('S1','S2','S3')),
  component TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  public_note TEXT,
  metric_value BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acked','resolved')),
  occurrences INTEGER NOT NULL DEFAULT 1,
  opened_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  acked_at TEXT,
  acked_by TEXT,
  ack_note TEXT,
  resolved_at TEXT,
  last_notified_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_incidents_active ON ops_incidents(rule_key) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_ops_incidents_status ON ops_incidents(status, opened_at);
CREATE INDEX IF NOT EXISTS idx_ops_incidents_opened ON ops_incidents(opened_at);

-- Moi lan gui thong bao (thanh cong hay that bai) de biet kenh nao dang hong. Khong luu URL/token.
--   event: opened | reminder | resolved | test
CREATE TABLE IF NOT EXISTS ops_notifications (
  id TEXT NOT NULL PRIMARY KEY,
  incident_id TEXT,
  channel TEXT NOT NULL,
  event TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0 CHECK (ok IN (0,1)),
  error TEXT,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_notifications_incident ON ops_notifications(incident_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_ops_notifications_sent ON ops_notifications(sent_at);

-- Nhip job nen: bo lap lich boc moi job bang withJobRun(rt, '<ten>', fn) (services/api/src/ops/checks.ts).
CREATE TABLE IF NOT EXISTS ops_job_runs (
  job TEXT NOT NULL PRIMARY KEY,
  first_started_at TEXT NOT NULL,
  last_started_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  runs BIGINT NOT NULL DEFAULT 0,
  failures BIGINT NOT NULL DEFAULT 0
);

-- Bo dem theo o thoi gian (bucket = ISO phut dau o 10 phut). Dem phan hoi 5xx: api_5xx, sepay_webhook_5xx, gateway_5xx (chi ghi khi co loi).
CREATE TABLE IF NOT EXISTS ops_counters (
  name TEXT NOT NULL,
  bucket TEXT NOT NULL,
  n BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (name, bucket)
);

-- Bao cao sao luu: script sao luu (scripts/ops/backup.ts) goi POST /ops/backup-report sau moi lan chay; job kiem tra canh bao khi ban moi nhat qua cu.
--   kind: d1 | postgres | media      target: noi luu (nhan do nguoi van hanh dat, KHONG chua khoa/URL co bi mat)
CREATE TABLE IF NOT EXISTS ops_backups (
  id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  env TEXT,
  target TEXT,
  bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  encrypted INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0,1)),
  ok INTEGER NOT NULL DEFAULT 1 CHECK (ok IN (0,1)),
  note TEXT,
  started_at TEXT,
  finished_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_backups_finished ON ops_backups(finished_at);
