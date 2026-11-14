-- 0007: gia that (p1-pricing). Chi THEM bang moi (IF NOT EXISTS: chay lai an toan, ke ca tren D1 khong co giao dich tuong tac).
-- Chay nguyen van tren PostgreSQL 16 va SQLite/D1. Tien: micro-VND BIGINT (1 VND = 1.000.000), khong so thuc.
-- Co y KHONG dung ALTER TABLE (khong idempotent): gia chot cua chien dich va gia thoa thuan cua dong hop dong nam o bang phu khoa theo id.

-- Bang gia niem yet, CO PHIEN BAN THEO NGAY HIEU LUC. '*' = moi gia tri.
-- Dong ('*','*','*','*') la gia mac dinh. customer_id cu the = gia rieng cua khach. Doi gia = them dong moi (effective_from moi) va dong lai dong cu (effective_to),
-- KHONG sua dong cu: lich su gia luon doc duoc. model: per_impression (price = micro-VND moi luot) | cpm (price = micro-VND moi 1.000 luot, quy ra luot bang ceil).
-- floor_micro_vnd: gia san MOI LUOT (gia ban/gia hop dong khong bao gio duoi san).
CREATE TABLE IF NOT EXISTS rate_cards (
  id TEXT NOT NULL PRIMARY KEY,
  customer_id TEXT NOT NULL DEFAULT '*',
  screen_type TEXT NOT NULL DEFAULT '*' CHECK (screen_type IN ('*','tv','elevator','led_p5')),
  region_id TEXT NOT NULL DEFAULT '*',
  daypart TEXT NOT NULL DEFAULT '*' CHECK (daypart IN ('*','peak','off_peak')),
  model TEXT NOT NULL DEFAULT 'per_impression' CHECK (model IN ('per_impression','cpm')),
  price_micro_vnd BIGINT NOT NULL CHECK (price_micro_vnd > 0),
  floor_micro_vnd BIGINT NOT NULL DEFAULT 0 CHECK (floor_micro_vnd >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (customer_id, screen_type, region_id, daypart, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_rate_cards_lookup ON rate_cards(screen_type, daypart, effective_from);

-- Gia chot (snapshot) cua chien dich, ghi luc DUYET. Duong tru tien chi doc bang nay; doi bang gia sau do KHONG doi gia chien dich da duyet.
-- Mot dong cho moi (loai man, khu vuc, khung gio); region_id '*' = moi khu vuc chua co dong rieng. Duyet lai (sau khi bi tra lai) thay toan bo dong.
-- Khong FK: chien dich bi xoa boi nhieu duong (API, outbox hoan tien); dong mo coi khong anh huong tien.
CREATE TABLE IF NOT EXISTS campaign_prices (
  campaign_id TEXT NOT NULL,
  screen_type TEXT NOT NULL,
  region_id TEXT NOT NULL DEFAULT '*',
  daypart TEXT NOT NULL CHECK (daypart IN ('peak','off_peak')),
  unit_price_micro_vnd BIGINT NOT NULL CHECK (unit_price_micro_vnd > 0),
  floor_micro_vnd BIGINT NOT NULL DEFAULT 0 CHECK (floor_micro_vnd >= 0),
  list_price_micro_vnd BIGINT,
  model TEXT NOT NULL DEFAULT 'per_impression',
  cpm_micro_vnd BIGINT,
  source TEXT NOT NULL CHECK (source IN ('contract','rate_card','default_card','placeholder','legacy')),
  source_ref TEXT,
  floored INTEGER NOT NULL DEFAULT 0 CHECK (floored IN (0,1)),
  resolved_by TEXT,
  resolved_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, screen_type, region_id, daypart)
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

-- Chien dich da duyet truoc 0007 (DB cu/dev) chua co gia chot: gan gia tam cu (20 d/luot) de khong dung tru tien. Production bat dau rong nen khong co dong nao. Idempotent.
INSERT INTO campaign_prices (campaign_id, screen_type, region_id, daypart, unit_price_micro_vnd, floor_micro_vnd, list_price_micro_vnd, model, cpm_micro_vnd, source, source_ref, floored, resolved_by, resolved_at)
SELECT c.id, t.screen_type, '*', d.daypart, 20000000, 0, NULL, 'per_impression', NULL, 'legacy', NULL, 0, NULL, c.updated_at
  FROM campaigns c
 CROSS JOIN (SELECT 'tv' AS screen_type UNION ALL SELECT 'elevator' UNION ALL SELECT 'led_p5') t
 CROSS JOIN (SELECT 'peak' AS daypart UNION ALL SELECT 'off_peak') d
 WHERE c.state IN ('awaiting_funds','scheduled','active','paused')
   AND NOT EXISTS (SELECT 1 FROM campaign_prices p WHERE p.campaign_id = c.id);
