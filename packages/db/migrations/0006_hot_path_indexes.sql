-- 0006: chi muc cho duong truy van nong (r4-codereview). Chi them chi muc, khong doi cot/rang buoc.
-- Chay nguyen van tren PostgreSQL 16 va SQLite/D1 (IF NOT EXISTS: chay lai an toan).

-- gateway nap thiet bi: devices LEFT JOIN screens ON screens.device_id (moi lan cache miss)
CREATE INDEX IF NOT EXISTS idx_screens_device ON screens(device_id);

-- danh sach lich su luot xem / proof-of-play mac dinh ORDER BY ts DESC, <khoa phu> LIMIT: khong co chi muc thi sap xep ca bang
CREATE INDEX IF NOT EXISTS idx_ev_imp_ts ON ev_ad_impression(ts, event_id);
CREATE INDEX IF NOT EXISTS idx_ev_pop_ts ON ev_proof_of_play(ts, creative_id);

-- bang gop theo gio: khoa chinh bat dau bang hour nen loc theo chien dich / doi tac phai quet het
CREATE INDEX IF NOT EXISTS idx_impression_hourly_campaign ON impression_hourly(campaign_id, hour);
CREATE INDEX IF NOT EXISTS idx_impression_hourly_partner ON impression_hourly(partner_id, hour);

-- hoa don: subquery tuong quan theo invoice_id / contract_id cho tung dong danh sach
CREATE INDEX IF NOT EXISTS idx_receivables_invoice ON receivables(invoice_id);
CREATE INDEX IF NOT EXISTS idx_receivables_contract ON receivables(contract_id);

-- thanh toan: hang doi thu cong (result LIKE 'manual:%' AND topup_id), danh sach webhook moi nhat, danh sach nap tien toan he thong
CREATE INDEX IF NOT EXISTS idx_webhooks_topup ON payment_webhooks(topup_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_received ON payment_webhooks(received_at);
CREATE INDEX IF NOT EXISTS idx_topups_status ON topups(status, requested_at);
