-- 0007: gia that (p1-pricing). Chi THEM bang moi (IF NOT EXISTS: chay lai an toan, ke ca tren D1 khong co giao dich tuong tac).
-- Chay nguyen van tren PostgreSQL 16 va SQLite/D1. Tien: micro-VND BIGINT (1 VND = 1.000.000).
-- Co y KHONG dung ALTER TABLE (khong idempotent): gia chot cua chien dich va gia thoa thuan cua dong hop dong nam o bang 1-1.

-- Bang gia niem yet. '*' = moi gia tri. Dong (tenant_id, '*', '*', '*') la gia mac dinh cua tenant; tenant_id '*' ap cho moi tenant.
CREATE TABLE IF NOT EXISTS rate_cards (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '*',
  screen_type TEXT NOT NULL DEFAULT '*' CHECK (screen_type IN ('*','tv','elevator','led_p5')),
  format TEXT NOT NULL DEFAULT '*',
  daypart TEXT NOT NULL DEFAULT '*',
  unit TEXT NOT NULL DEFAULT 'impression' CHECK (unit IN ('impression','play')),
  price_micro_vnd BIGINT NOT NULL CHECK (price_micro_vnd > 0),
  floor_micro_vnd BIGINT NOT NULL DEFAULT 0 CHECK (floor_micro_vnd >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0,1)),
  note TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, screen_type, format, daypart)
);

-- Gia chot (snapshot) cua chien dich, ghi luc duyet. Duong tru tien chi doc bang nay; doi bang gia sau do KHONG doi gia chien dich da duyet.
-- Khong FK: chien dich bi xoa boi nhieu duong (API, outbox hoan tien); dong mo coi khong anh huong tien.
CREATE TABLE IF NOT EXISTS campaign_prices (
  campaign_id TEXT NOT NULL PRIMARY KEY,
  unit TEXT NOT NULL DEFAULT 'impression',
  unit_price_micro_vnd BIGINT NOT NULL CHECK (unit_price_micro_vnd > 0),
  floor_micro_vnd BIGINT NOT NULL DEFAULT 0 CHECK (floor_micro_vnd >= 0),
  list_price_micro_vnd BIGINT,
  source TEXT NOT NULL CHECK (source IN ('contract','rate_card','tenant_default','env_fallback','placeholder')),
  source_ref TEXT,
  floored INTEGER NOT NULL DEFAULT 0 CHECK (floored IN (0,1)),
  detail TEXT,
  resolved_by TEXT,
  resolved_at TEXT NOT NULL
);

-- Gia thoa thuan moi luot cua mot dong hop dong (contract_lines.unit_price_vnd la gia tri dong, khong phai don gia luot).
CREATE TABLE IF NOT EXISTS contract_line_prices (
  contract_line_id TEXT NOT NULL PRIMARY KEY,
  contract_id TEXT NOT NULL,
  impression_price_micro_vnd BIGINT NOT NULL CHECK (impression_price_micro_vnd > 0),
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_line_prices_contract ON contract_line_prices(contract_id);
