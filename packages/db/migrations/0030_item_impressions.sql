-- 0029: luot hien thi tung MUC cua danh sach phat trong vung (zone.playlist), app gui `item_impression` qua POST /v1/events.
--  * CHI de bao cao (theo tep, doi tac, chuong trinh, vung, thiet bi, ngay). KHONG phai bang chung tinh tien: tien chi di qua impression (TV) /
--    proof_of_play; khong co luong nao doc bang nay de tru chi tieu. Xem docs/PLAYLIST.md.
--  * log_id (UUID app tu sinh) la khoa chinh: gui lai cung log_id => bo qua im lang (INSERT ... ON CONFLICT DO NOTHING), dem mot lan.
--  * customer_id / campaign_id duoc may chu tu suy ra luc nhan (media_id -> creatives.customer_id / campaign_id), khong tin app. NULL neu muc van ban / link ngoai.
--  * program_id luu DANG KHONG tien to (khong 'bp_'), khong co khoa ngoai: chuong trinh bi xoa van giu lich su.
--  * source: 'device' (thiet bi da cap quyen luc gui) | 'pending_trust'. Bao cao tinh theo quyen HIEN TAI cua thiet bi (nhu proof_of_play).
CREATE TABLE IF NOT EXISTS ev_item_impression (
  log_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  media_id TEXT,
  customer_id TEXT,
  campaign_id TEXT,
  played_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'device'
);
CREATE INDEX IF NOT EXISTS idx_ev_item_media ON ev_item_impression(media_id, played_at);
CREATE INDEX IF NOT EXISTS idx_ev_item_program ON ev_item_impression(program_id, played_at);
CREATE INDEX IF NOT EXISTS idx_ev_item_device ON ev_item_impression(device_id, played_at);
CREATE INDEX IF NOT EXISTS idx_ev_item_customer ON ev_item_impression(customer_id, played_at);
