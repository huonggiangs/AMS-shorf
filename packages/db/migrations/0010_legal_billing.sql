-- 0010: phap ly + tuan thu + hoa don dien tu + nhac no (p4-legal-billing). Chi THEM bang moi (IF NOT EXISTS: chay lai an toan, ke ca tren D1).
-- Chay nguyen van tren PostgreSQL 16 va SQLite/D1. Co y KHONG dung ALTER TABLE: du lieu bo sung nam o bang phu khoa theo id.

-- (1) Van ban phap ly co phien ban: terms (dieu khoan), privacy, sla, ad_policy (chinh sach noi dung quang cao).
--   status: draft -> published -> retired. Moi kind chi mot ban published tai mot thoi diem (ung dung bao dam khi phat hanh).
--   sha256: bam cua body_md luc luu; ban ghi chap nhan luu lai sha256 de chung minh khach da dong y dung noi dung nao.
CREATE TABLE IF NOT EXISTS legal_documents (
  id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('terms','privacy','sla','ad_policy')),
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  requires_acceptance INTEGER NOT NULL DEFAULT 1 CHECK (requires_acceptance IN (0,1)),
  change_note TEXT,
  published_at TEXT,
  published_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (kind, version)
);
CREATE INDEX IF NOT EXISTS idx_legal_documents_kind ON legal_documents(kind, status);

-- Ban ghi chap nhan: ai (tai khoan + khach hang), phien ban nao (id + version + sha256), luc nao, tu IP nao. Chi INSERT.
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id TEXT NOT NULL PRIMARY KEY,
  admin_id TEXT NOT NULL,
  customer_id TEXT,
  document_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  UNIQUE (admin_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_customer ON legal_acceptances(customer_id, kind);

-- (2) KYC nha quang cao: ho so phap nhan (1-1 voi customers) + giay to tai len (kho tep, tien to docs/kyc/).
--   state: none -> submitted -> approved | rejected (sua ho so/giay to sau khi duyet dua ve submitted).
--   restricted_industry/restricted_categories: nguoi duyet KYC danh dau khach thuoc nganh han che (JSON mang nganh) => chien dich can duyet lan hai (campaign_gate cua p2 la dau vao cung huong).
CREATE TABLE IF NOT EXISTS customer_kyc (
  customer_id TEXT NOT NULL PRIMARY KEY,
  business_reg_no TEXT,
  business_reg_date TEXT,
  business_reg_place TEXT,
  legal_rep_name TEXT,
  legal_rep_title TEXT,
  state TEXT NOT NULL DEFAULT 'none' CHECK (state IN ('none','submitted','approved','rejected')),
  submitted_by TEXT,
  submitted_at TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  restricted_industry INTEGER NOT NULL DEFAULT 0 CHECK (restricted_industry IN (0,1)),
  restricted_categories TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_kyc_state ON customer_kyc(state, submitted_at);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('business_registration','industry_licence','ad_content_permit','authorization_letter','other')),
  category TEXT,
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  state TEXT NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading','pending','approved','rejected')),
  expires_on TEXT,
  note TEXT,
  uploaded_by TEXT,
  created_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_customer ON kyc_documents(customer_id, state);

-- (3) Tuan thu cua chien dich (1-1 voi campaigns; khong co dong = nganh 'general', khong kid_safe).
--   category: nganh quang cao (packages/shared/src/compliance.ts). kid_safe: nguoi duyet xac nhan duoc phat tren man hinh gia dinh/tre em.
--   second_approved_*: duyet lan hai cho nganh han che (nguoi khac voi nguoi duyet ngan sach).
CREATE TABLE IF NOT EXISTS campaign_compliance (
  campaign_id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  declared_by TEXT,
  declared_at TEXT,
  kid_safe INTEGER NOT NULL DEFAULT 0 CHECK (kid_safe IN (0,1)),
  kid_safe_by TEXT,
  kid_safe_at TEXT,
  second_approved_by TEXT,
  second_approved_at TEXT,
  second_note TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_compliance_cat ON campaign_compliance(category);

-- (5) Hoa don dien tu (ND123): moi dong la MOT chung tu gui nha cung cap (goc, dieu chinh, huy). Mot hoa don noi bo co the co nhieu chung tu
--   (goc + dieu chinh khi hoan tien). idempotency_key UNIQUE: gui lai cung yeu cau khong tao chung tu thu hai o ben nha cung cap.
--   kind: original | adjustment (tro toi chung tu goc qua adjusts_document_id) | cancellation
--   status: pending (cho gui/thu lai) -> issued | failed (het so lan thu) ; issued -> cancelled
--   provider: manual | misa | viettel ; sandbox 1 = moi truong thu nghiem cua nha cung cap (khong co gia tri phap ly)
CREATE TABLE IF NOT EXISTS einvoice_documents (
  id TEXT NOT NULL PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  sandbox INTEGER NOT NULL DEFAULT 0 CHECK (sandbox IN (0,1)),
  kind TEXT NOT NULL DEFAULT 'original' CHECK (kind IN ('original','adjustment','cancellation')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','issued','failed','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  einvoice_no TEXT,
  series TEXT,
  lookup_code TEXT,
  provider_ref TEXT,
  issue_date TEXT,
  tax_authority_code TEXT,
  amount_vnd BIGINT NOT NULL DEFAULT 0,
  vat_vnd BIGINT NOT NULL DEFAULT 0,
  total_vnd BIGINT NOT NULL DEFAULT 0,
  pdf_key TEXT,
  xml_key TEXT,
  adjusts_document_id TEXT,
  reason TEXT,
  refund_request_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_einvoice_documents_invoice ON einvoice_documents(invoice_id, created_at);
CREATE INDEX IF NOT EXISTS idx_einvoice_documents_status ON einvoice_documents(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_einvoice_documents_refund ON einvoice_documents(refund_request_id);

-- (6) Nhac no: moi viec (danh dau qua han, thu nhac, tu tam dung, canh bao so du, vuot han muc) ghi mot dong; dedupe_key UNIQUE => chay lai khong gui trung.
CREATE TABLE IF NOT EXISTS dunning_events (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  receivable_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('reminder','overdue','auto_pause','low_balance','credit_limit','einvoice_adjust')),
  stage TEXT,
  detail TEXT,
  mail_sent INTEGER NOT NULL DEFAULT 0 CHECK (mail_sent IN (0,1)),
  created_at TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_dunning_events_customer ON dunning_events(customer_id, created_at);

-- (7) Quyen cua chu the du lieu (Nghi dinh 13/2023): yeu cau xuat du lieu / an danh. Ket qua khong chua du lieu ca nhan (chi dem + loai).
--   subject_type: customer_contact (nguoi dung cong khach hang) | end_user (nguoi xem tren TV)
--   state: requested -> completed | rejected ; due_at = han tra loi (mac dinh 72 gio theo ND13, luat su xac nhan)
CREATE TABLE IF NOT EXISTS dsr_requests (
  id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('export','anonymize')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('customer_contact','end_user')),
  subject_id TEXT NOT NULL,
  customer_id TEXT,
  requester TEXT,
  channel TEXT,
  note TEXT,
  state TEXT NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','completed','rejected')),
  result_summary TEXT,
  due_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  completed_by TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dsr_requests_state ON dsr_requests(state, created_at);
CREATE INDEX IF NOT EXISTS idx_dsr_requests_subject ON dsr_requests(subject_type, subject_id);

-- (8) So dang ky hoat dong xu ly du lieu (ND13: ho so xu ly) va so ghi nhan dong y. Chi la so dang ky; noi dung phap ly do luat su hoan thien.
CREATE TABLE IF NOT EXISTS processing_records (
  id TEXT NOT NULL PRIMARY KEY,
  activity TEXT NOT NULL,
  purpose TEXT NOT NULL,
  data_categories TEXT NOT NULL,
  data_subjects TEXT,
  legal_basis TEXT,
  recipients TEXT,
  cross_border INTEGER NOT NULL DEFAULT 0 CHECK (cross_border IN (0,1)),
  retention TEXT,
  owner TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT NOT NULL PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('customer_contact','end_user')),
  subject_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1 CHECK (granted IN (0,1)),
  version TEXT,
  source TEXT,
  recorded_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consent_records_subject ON consent_records(subject_type, subject_id, created_at);
