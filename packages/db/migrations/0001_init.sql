-- AMS 0001: schema giao dich + bang su kien (SQL tap con chay duoc tren PostgreSQL 16 va SQLite/D1).
-- Quy uoc: id TEXT (ULID/UUIDv7 sinh o ung dung); thoi gian TEXT ISO-8601 UTC; tien BIGINT (dong);
-- boolean INTEGER 0/1; JSON/mang luu TEXT. Khong DEFAULT theo ham dac thu dialect.

-- ===== nguoi dung va quyen =====
CREATE TABLE tenants (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  tax_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE customers (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  legal_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  -- MST ma hoa truong (AES-GCM, FIELD_ENC_KEY) + chi muc mu HMAC de bao dam UNIQUE va tim kiem
  tax_code_enc TEXT,
  tax_code_hash TEXT UNIQUE,
  address TEXT,
  industry TEXT,
  rep_name TEXT,
  rep_title TEXT,
  phone TEXT,
  email TEXT,
  contact_name TEXT,
  account_owner_id TEXT,
  payment_terms TEXT,
  credit_limit_vnd BIGINT NOT NULL DEFAULT 0,
  payment_code TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (state IN ('pending_payment','active','paused','terminated')),
  since TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_customers_state ON customers(state, created_at);
CREATE INDEX idx_customers_owner ON customers(account_owner_id);

CREATE TABLE admins (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('super_admin','content_manager','finance','device_ops','customer','partner')),
  account_kind TEXT NOT NULL CHECK (account_kind IN ('internal','customer','partner')),
  customer_id TEXT REFERENCES customers(id),
  org_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','locked','disabled')),
  password_hash TEXT,
  totp_secret_enc TEXT,
  mfa_required INTEGER NOT NULL DEFAULT 1 CHECK (mfa_required IN (0,1)),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  invited_by TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  -- tai khoan ngoai bat buoc gan customer_id; tai khoan noi bo thi khong
  CHECK ((account_kind = 'internal' AND customer_id IS NULL) OR (account_kind <> 'internal' AND customer_id IS NOT NULL)),
  CHECK ((account_kind = 'internal' AND role NOT IN ('customer','partner')) OR (account_kind = 'customer' AND role = 'customer') OR (account_kind = 'partner' AND role = 'partner'))
);
CREATE UNIQUE INDEX uq_admins_email ON admins(email);
CREATE INDEX idx_admins_customer ON admins(customer_id);
CREATE INDEX idx_admins_role ON admins(role, status);

-- ghi de quyen theo tai khoan tren bang mac dinh theo vai tro (packages/config/rbac.ts)
CREATE TABLE admin_permissions (
  admin_id TEXT NOT NULL REFERENCES admins(id),
  module TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view','write','approve','delete')),
  allowed INTEGER NOT NULL CHECK (allowed IN (0,1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (admin_id, module, action)
);

CREATE TABLE sessions (
  id TEXT NOT NULL PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  mfa_verified INTEGER NOT NULL DEFAULT 0 CHECK (mfa_verified IN (0,1)),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_sessions_admin ON sessions(admin_id, revoked_at);

-- thu thach MFA (mfa_token) va ma khoi phuc
CREATE TABLE mfa (
  id TEXT NOT NULL PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  kind TEXT NOT NULL CHECK (kind IN ('challenge','recovery','enroll')),
  token_hash TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_counter BIGINT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_mfa_admin ON mfa(admin_id, kind);

CREATE TABLE invites (
  id TEXT NOT NULL PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_invites_admin ON invites(admin_id);

CREATE TABLE settings (
  key TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- audit_log: chi INSERT (xem 0002_append_only)
CREATE TABLE audit_log (
  id TEXT NOT NULL PRIMARY KEY,
  ts TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  customer_id TEXT,
  ip TEXT,
  diff TEXT
);
CREATE INDEX idx_audit_ts ON audit_log(ts, id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, ts);
CREATE INDEX idx_audit_object ON audit_log(object_type, object_id, ts);
CREATE INDEX idx_audit_customer ON audit_log(customer_id, ts);

CREATE TABLE upload_quotas (
  customer_id TEXT NOT NULL PRIMARY KEY REFERENCES customers(id),
  max_files_per_day INTEGER NOT NULL DEFAULT 20,
  max_mb_per_file INTEGER NOT NULL DEFAULT 30,
  max_total_gb INTEGER NOT NULL DEFAULT 5
);

CREATE TABLE notifications (
  id TEXT NOT NULL PRIMARY KEY,
  admin_id TEXT REFERENCES admins(id),
  customer_id TEXT REFERENCES customers(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  ref_type TEXT,
  ref_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notif_admin ON notifications(admin_id, read_at, created_at);
CREATE INDEX idx_notif_customer ON notifications(customer_id, created_at);

-- ===== thiet bi =====
CREATE TABLE end_users (
  id TEXT NOT NULL PRIMARY KEY,
  phone_hash TEXT,
  email_enc TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_end_users_phone ON end_users(phone_hash);

CREATE TABLE devices (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT REFERENCES end_users(id),
  name TEXT,
  kind TEXT NOT NULL,
  model TEXT,
  os TEXT,
  app_version TEXT,
  region_id TEXT,
  pubkey_ed25519 TEXT,
  trust_level INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'checking',
  paired_at TEXT,
  last_seen_at TEXT,
  views_30d INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0,1)),
  shard SMALLINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_devices_region ON devices(region_id, status);
CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_shard ON devices(shard);
CREATE INDEX idx_devices_page ON devices(created_at, id);
CREATE UNIQUE INDEX uq_devices_pubkey ON devices(pubkey_ed25519);

CREATE TABLE device_attestations (
  device_id TEXT NOT NULL REFERENCES devices(id),
  nonce TEXT NOT NULL,
  result TEXT,
  checked_at TEXT,
  PRIMARY KEY (device_id, nonce)
);

-- ma ghep doi 6 so, het han 5 phut
CREATE TABLE pairing_codes (
  code TEXT NOT NULL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pairing_device ON pairing_codes(device_id);

-- ===== dia diem va man hinh =====
CREATE TABLE venues (
  id TEXT NOT NULL PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  region_id TEXT,
  address TEXT,
  lat REAL,
  lng REAL,
  owner_contact TEXT,
  contract_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_venues_region ON venues(region_id, kind);

CREATE TABLE screens (
  id TEXT NOT NULL PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  type TEXT NOT NULL CHECK (type IN ('tv','elevator','led_p5')),
  diag_inch REAL,
  width_mm INTEGER,
  height_mm INTEGER,
  px_w INTEGER,
  px_h INTEGER,
  orientation TEXT,
  pixel_pitch_mm REAL,
  brightness_nit INTEGER,
  controller_kind TEXT,
  controller_ref TEXT,
  device_id TEXT REFERENCES devices(id),
  state TEXT NOT NULL DEFAULT 'active',
  installed_at TEXT
);
CREATE INDEX idx_screens_venue ON screens(venue_id);
CREATE INDEX idx_screens_type ON screens(type, state);

CREATE TABLE screen_groups (
  id TEXT NOT NULL PRIMARY KEY,
  venue_id TEXT REFERENCES venues(id),
  name TEXT NOT NULL
);

-- ===== khach hang va hop dong =====
CREATE TABLE customer_contacts (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  title TEXT,
  phone TEXT,
  email TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1))
);
CREATE INDEX idx_contacts_customer ON customer_contacts(customer_id);

CREATE TABLE contract_templates (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  body_md TEXT NOT NULL,
  variables TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE contracts (
  id TEXT NOT NULL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  title TEXT NOT NULL,
  value_vnd BIGINT NOT NULL CHECK (value_vnd >= 0),
  vat_rate INTEGER NOT NULL DEFAULT 10,
  start_date TEXT,
  end_date TEXT,
  advance_pct INTEGER NOT NULL DEFAULT 0,
  paid_pct INTEGER NOT NULL DEFAULT 0,
  payment_terms TEXT,
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft','pending_sign','active','paused','expired','terminated')),
  signed_at TEXT,
  signed_file_key TEXT,
  template_id TEXT REFERENCES contract_templates(id),
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_contracts_customer ON contracts(customer_id, state, created_at);
CREATE INDEX idx_contracts_page ON contracts(created_at, id);

CREATE TABLE contract_lines (
  id TEXT NOT NULL PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  screen_type TEXT,
  region_id TEXT,
  daypart TEXT,
  frequency INTEGER,
  duration_s INTEGER,
  unit_price_vnd BIGINT NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_contract_lines_contract ON contract_lines(contract_id);

CREATE TABLE invoices (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  period TEXT NOT NULL,
  amount_vnd BIGINT NOT NULL,
  vat_rate INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'draft',
  einvoice_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_invoices_customer ON invoices(customer_id, period);

CREATE TABLE receivables (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  contract_id TEXT REFERENCES contracts(id),
  invoice_id TEXT REFERENCES invoices(id),
  amount_vnd BIGINT NOT NULL,
  due_date TEXT,
  paid_vnd BIGINT NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','partial','paid','overdue'))
);
CREATE INDEX idx_receivables_customer ON receivables(customer_id, state);

-- ===== quang cao =====
CREATE TABLE advertisers (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  tax_code TEXT
);

CREATE TABLE campaigns (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  contract_id TEXT REFERENCES contracts(id),
  advertiser_id TEXT REFERENCES advertisers(id),
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft','pending_review','awaiting_funds','scheduled','active','paused','rejected','ended')),
  budget_cap_vnd BIGINT NOT NULL DEFAULT 0 CHECK (budget_cap_vnd >= 0),
  approved_budget_vnd BIGINT NOT NULL DEFAULT 0,
  reserved_vnd BIGINT NOT NULL DEFAULT 0 CHECK (reserved_vnd >= 0),
  spent_vnd BIGINT NOT NULL DEFAULT 0 CHECK (spent_vnd >= 0),
  funding_state TEXT NOT NULL DEFAULT 'none'
    CHECK (funding_state IN ('none','reserved','awaiting_funds','released')),
  activate_on_approve INTEGER NOT NULL DEFAULT 1 CHECK (activate_on_approve IN (0,1)),
  target_types TEXT,
  duration_s INTEGER,
  start_at TEXT,
  end_at TEXT,
  reject_reason TEXT,
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_campaigns_customer ON campaigns(customer_id, state, created_at);
CREATE INDEX idx_campaigns_state ON campaigns(state, start_at);
CREATE INDEX idx_campaigns_page ON campaigns(created_at, id);

CREATE TABLE campaign_grants (
  id TEXT NOT NULL PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  can_upload INTEGER NOT NULL DEFAULT 0 CHECK (can_upload IN (0,1)),
  expires_at TEXT,
  UNIQUE (admin_id, campaign_id)
);
CREATE INDEX idx_grants_campaign ON campaign_grants(campaign_id);

-- campaign_id NULL = tep trong thu vien media cua khach, chua gan chien dich
CREATE TABLE creatives (
  id TEXT NOT NULL PRIMARY KEY,
  campaign_id TEXT REFERENCES campaigns(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  name TEXT,
  target_type TEXT,
  px_w INTEGER,
  px_h INTEGER,
  orientation TEXT,
  kind TEXT,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','youtube','gdrive','dropbox','url')),
  source_url TEXT,
  storage_key TEXT,
  mime TEXT,
  size_bytes BIGINT,
  duration_s INTEGER,
  codec TEXT,
  uploaded_by TEXT,
  uploader_kind TEXT,
  scan_state TEXT NOT NULL DEFAULT 'pending',
  review_state TEXT NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','approved','rejected','returned')),
  review_note TEXT,
  state TEXT NOT NULL DEFAULT 'uploading',
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, target_type, px_w, px_h)
);
CREATE INDEX idx_creatives_customer ON creatives(customer_id, review_state, created_at);
CREATE INDEX idx_creatives_campaign ON creatives(campaign_id);

CREATE TABLE partners (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT,
  endpoint TEXT,
  auth_ref TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  floor_cpm_vnd BIGINT NOT NULL DEFAULT 0,
  logo_key TEXT
);

CREATE TABLE schedule_slots (
  id TEXT NOT NULL PRIMARY KEY,
  campaign_id TEXT REFERENCES campaigns(id),
  partner_id TEXT REFERENCES partners(id),
  screen_group_id TEXT REFERENCES screen_groups(id),
  target_type TEXT,
  daypart TEXT,
  start_min INTEGER,
  end_min INTEGER,
  priority INTEGER NOT NULL DEFAULT 3,
  reward_points INTEGER NOT NULL DEFAULT 0,
  regions TEXT
);
CREATE INDEX idx_slots_campaign ON schedule_slots(campaign_id);

CREATE TABLE rtb_floors (
  id TEXT NOT NULL PRIMARY KEY,
  category TEXT NOT NULL UNIQUE,
  floor_cpm_vnd BIGINT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- ===== tien =====
-- Bo dem so du (cache). Kha dung = balance_vnd - reserved_vnd; CHECK chan so am o tang DB.
CREATE TABLE ad_wallets (
  customer_id TEXT NOT NULL PRIMARY KEY REFERENCES customers(id),
  balance_vnd BIGINT NOT NULL DEFAULT 0,
  reserved_vnd BIGINT NOT NULL DEFAULT 0,
  spent_vnd BIGINT NOT NULL DEFAULT 0,
  low_balance_alert_pct INTEGER NOT NULL DEFAULT 10,
  updated_at TEXT NOT NULL,
  CHECK (balance_vnd >= 0),
  CHECK (reserved_vnd >= 0),
  CHECK (reserved_vnd <= balance_vnd)
);

-- so cai bat bien: chi INSERT (xem 0002_append_only)
CREATE TABLE wallet_entries (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  kind TEXT NOT NULL CHECK (kind IN ('topup','reserve','release','spend','refund','adjust')),
  amount_vnd BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  reserved_after BIGINT NOT NULL DEFAULT 0,
  ref_type TEXT,
  ref_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_wallet_entries_customer ON wallet_entries(customer_id, created_at, id);
CREATE INDEX idx_wallet_entries_ref ON wallet_entries(ref_type, ref_id);
-- mot lan nap gan voi mot topups.id chi duoc ghi so cai mot lan (idempotent)
CREATE UNIQUE INDEX uq_wallet_entries_ref ON wallet_entries(kind, ref_type, ref_id)
  WHERE ref_type IS NOT NULL AND ref_id IS NOT NULL AND kind = 'topup';

CREATE TABLE topups (
  id TEXT NOT NULL PRIMARY KEY,
  code TEXT UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  method TEXT,
  provider TEXT,
  provider_txn_id TEXT UNIQUE,
  matched_by TEXT,
  raw_content TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited','rejected','unmatched')),
  requested_by TEXT,
  confirmed_by TEXT,
  requested_at TEXT NOT NULL,
  credited_at TEXT
);
CREATE INDEX idx_topups_customer ON topups(customer_id, status, requested_at);

CREATE TABLE payment_webhooks (
  id TEXT NOT NULL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  payload TEXT,
  signature_ok INTEGER NOT NULL DEFAULT 0 CHECK (signature_ok IN (0,1)),
  result TEXT,
  matched_customer_id TEXT,
  topup_id TEXT,
  received_at TEXT,
  processed_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_webhooks_customer ON payment_webhooks(matched_customer_id, received_at);

CREATE TABLE activation_rules (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  min_amount_vnd BIGINT NOT NULL,
  auto_activate INTEGER NOT NULL DEFAULT 1 CHECK (auto_activate IN (0,1)),
  plan_id TEXT
);

CREATE TABLE activation_log (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  trigger_topup_id TEXT,
  actions TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activation_log_customer ON activation_log(customer_id, created_at);

CREATE TABLE refund_requests (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
  requested_by TEXT,
  decided_by TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX idx_refund_customer ON refund_requests(customer_id, status, created_at);

-- thuong nguoi xem
CREATE TABLE payouts (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES end_users(id),
  amount_vnd BIGINT NOT NULL,
  channel TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  external_ref TEXT,
  requested_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX idx_payouts_user ON payouts(user_id, status);

CREATE TABLE wallet_ledger (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES end_users(id),
  kind TEXT NOT NULL,
  amount_vnd BIGINT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  status TEXT NOT NULL DEFAULT 'posted',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_wallet_ledger_user ON wallet_ledger(user_id, created_at);

-- ===== su kien (ban Postgres/SQLite; ban ClickHouse o packages/db/clickhouse) =====
CREATE TABLE ev_heartbeat (
  ts TEXT NOT NULL,
  device_id TEXT NOT NULL,
  shard SMALLINT NOT NULL DEFAULT 0,
  region TEXT,
  app_ver TEXT,
  soc_temp INTEGER,
  rssi INTEGER,
  dl_mbps REAL,
  cache_used_mb INTEGER,
  cache_slots INTEGER,
  state INTEGER
);
CREATE INDEX idx_ev_heartbeat_device ON ev_heartbeat(device_id, ts);
CREATE INDEX idx_ev_heartbeat_ts ON ev_heartbeat(ts);

CREATE TABLE ev_ad_impression (
  ts TEXT NOT NULL,
  event_id TEXT NOT NULL,
  device_id TEXT,
  screen_id TEXT,
  campaign_id TEXT NOT NULL,
  creative_id TEXT,
  slot_id TEXT,
  partner_id TEXT,
  region_id TEXT,
  vcr_pct INTEGER NOT NULL DEFAULT 0,
  valid INTEGER NOT NULL DEFAULT 1 CHECK (valid IN (0,1)),
  reject_reason TEXT,
  revenue_micro_vnd BIGINT NOT NULL DEFAULT 0,
  reward_vnd INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id)
);
CREATE INDEX idx_ev_imp_campaign ON ev_ad_impression(campaign_id, ts);
CREATE INDEX idx_ev_imp_device ON ev_ad_impression(device_id, ts);

CREATE TABLE ev_proof_of_play (
  ts TEXT NOT NULL,
  screen_id TEXT NOT NULL,
  creative_id TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  source TEXT
);
CREATE INDEX idx_ev_pop_screen ON ev_proof_of_play(screen_id, ts);
CREATE INDEX idx_ev_pop_creative ON ev_proof_of_play(creative_id, ts);

-- bang gop theo gio (thay Materialized View cua ClickHouse); EventStore tang dan khi chen impression moi
CREATE TABLE impression_hourly (
  hour TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  partner_id TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  impressions BIGINT NOT NULL DEFAULT 0,
  valid BIGINT NOT NULL DEFAULT 0,
  revenue_micro_vnd BIGINT NOT NULL DEFAULT 0,
  reward_vnd BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, campaign_id, partner_id, region)
);
