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
  updated_at TEXT NOT NULL
);

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

-- Xac nhan quyen su dung noi dung khi tai creative (ai, luc nao, IP, phien ban cau cam ket).
CREATE TABLE IF NOT EXISTS creative_rights (
  creative_id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  ip TEXT,
  statement_version TEXT NOT NULL
);

-- Go noi dung (takedown): tam dung chien dich + ly do + nguoi khieu nai; state: open -> reinstated | removed.
CREATE TABLE IF NOT EXISTS content_takedowns (
  id TEXT NOT NULL PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  creative_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('copyright','legal','complaint','policy','other')),
  reason TEXT NOT NULL,
  complainant TEXT,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','reinstated','removed')),
  prev_state TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_content_takedowns_campaign ON content_takedowns(campaign_id, state);
CREATE INDEX IF NOT EXISTS idx_content_takedowns_state ON content_takedowns(state, created_at);

-- (4) Doi tuong khan gia cua thiet bi: general (mac dinh khi khong co dong) | family | child.
--   Thiet bi family/child chi nhan chien dich kid_safe thuoc nganh trong danh sach cho phep (gateway loc khi xay manifest).
CREATE TABLE IF NOT EXISTS device_audience (
  device_id TEXT NOT NULL PRIMARY KEY,
  audience TEXT NOT NULL DEFAULT 'general' CHECK (audience IN ('general','family','child')),
  note TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- (5) Hoa don dien tu (ND123) 1-1 voi invoices: so hoa don, ma tra cuu, ngay lap, ma CQT, tep PDF/XML.
--   kind: original | adjustment (dieu chinh, tro toi hoa don goc qua adjusts_invoice_id).
CREATE TABLE IF NOT EXISTS invoice_einvoices (
  invoice_id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'original' CHECK (kind IN ('original','adjustment')),
  einvoice_no TEXT NOT NULL,
  series TEXT,
  lookup_code TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  tax_authority_code TEXT,
  amount_vnd BIGINT NOT NULL,
  vat_vnd BIGINT NOT NULL,
  total_vnd BIGINT NOT NULL,
  pdf_key TEXT,
  xml_key TEXT,
  adjusts_invoice_id TEXT,
  adjust_reason TEXT,
  refund_request_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, einvoice_no, series)
);
CREATE INDEX IF NOT EXISTS idx_invoice_einvoices_adjusts ON invoice_einvoices(adjusts_invoice_id);

-- (6) Nhac no: moi viec (danh dau qua han, thu nhac, tu tam dung, canh bao so du, vuot han muc) ghi mot dong; dedupe_key UNIQUE => chay lai khong gui trung.
CREATE TABLE IF NOT EXISTS dunning_events (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  receivable_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('reminder','overdue','auto_pause','low_balance','credit_limit')),
  stage TEXT,
  detail TEXT,
  mail_sent INTEGER NOT NULL DEFAULT 0 CHECK (mail_sent IN (0,1)),
  created_at TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_dunning_events_customer ON dunning_events(customer_id, created_at);

-- (7) Ban ky hop dong da tai len (lich su; contracts.signed_file_key tro toi ban moi nhat).
CREATE TABLE IF NOT EXISTS contract_signed_files (
  id TEXT NOT NULL PRIMARY KEY,
  contract_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  state TEXT NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading','stored')),
  signed_on TEXT,
  uploaded_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_signed_files_contract ON contract_signed_files(contract_id, created_at);

-- (8) Yeu cau dang ky (lead) tu trang cong khai: nhan vien duyet -> tao khach hang + moi nguoi dung.
CREATE TABLE IF NOT EXISTS signup_requests (
  id TEXT NOT NULL PRIMARY KEY,
  company_name TEXT NOT NULL,
  tax_code TEXT,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  industry TEXT,
  message TEXT,
  accepted_terms_version TEXT,
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','approved','rejected','spam')),
  ip TEXT,
  created_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  customer_id TEXT,
  admin_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_signup_requests_state ON signup_requests(state, created_at);
CREATE INDEX IF NOT EXISTS idx_signup_requests_email ON signup_requests(email);
