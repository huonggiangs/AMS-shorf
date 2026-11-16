-- Soan hop dong tu mau + xuat PDF (u2). Chay duoc tren Postgres, SQLite va D1; chi dung kieu TEXT/INTEGER va IF NOT EXISTS.
-- Mau hop dong co phien ban (khac bang contract_templates cu dung cho render HTML). Mau nap san la 'draft': can luat su duyet moi chot ban ky.
CREATE TABLE IF NOT EXISTS contract_doc_templates (
  id TEXT NOT NULL PRIMARY KEY,
  code TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  articles TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  lawyer_ref TEXT,
  approved_by TEXT,
  approved_at TEXT,
  change_note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (code, version)
);

-- Ban soan hop dong theo tung hop dong. variables/article_overrides: phan nguoi dung sua; snapshot + rendered_text + content_hash: ban dung tai thoi diem chot.
CREATE TABLE IF NOT EXISTS contract_docs (
  id TEXT NOT NULL PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  template_id TEXT NOT NULL REFERENCES contract_doc_templates(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final','superseded')),
  variables TEXT NOT NULL DEFAULT '{}',
  article_overrides TEXT NOT NULL DEFAULT '{}',
  snapshot TEXT,
  rendered_text TEXT,
  content_hash TEXT,
  finalized_by TEXT,
  finalized_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (contract_id, version)
);
CREATE INDEX IF NOT EXISTS idx_contract_docs_contract ON contract_docs(contract_id, status);
-- moi hop dong chi co mot ban nhap dang soan
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_docs_one_draft ON contract_docs(contract_id) WHERE status = 'draft';
