-- 0003: noi cac goi voi nhau (i1-integration).
-- creatives: sha256 (manifest chi phat tep da xac minh), format (dinh dang quang cao tren TV), overlay (JSON lop phu).
ALTER TABLE creatives ADD COLUMN sha256 TEXT;
ALTER TABLE creatives ADD COLUMN format TEXT NOT NULL DEFAULT 'fullscreen' CHECK (format IN ('fullscreen','menu_banner','l_banner','pause_ad','qr_corner','reward'));
-- overlay: JSON {sponsor_tag, brand_label, headline, hotline:{label,number,sub}, qr:{url,label,title}, scte_id, badges[]}; kiem tra o API (zod), khong rang buoc o DB
ALTER TABLE creatives ADD COLUMN overlay TEXT;

-- admins: thay settings `admin_profile:<id>` bang cot that
ALTER TABLE admins ADD COLUMN phone TEXT;
ALTER TABLE admins ADD COLUMN expires_at TEXT;

-- chi tieu impression: phan du micro-VND cong don theo chien dich + bang khu trung theo idempotencyKey
ALTER TABLE campaigns ADD COLUMN spend_remainder_micro BIGINT NOT NULL DEFAULT 0;
CREATE TABLE spend_dedupe (
  idempotency_key TEXT NOT NULL PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  amount_micro_vnd BIGINT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  charged_vnd BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_spend_dedupe_campaign ON spend_dedupe(campaign_id, created_at);
