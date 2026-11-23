-- 0028: bao cao luot xem (proof-of-play) + chan doan dong bo.
--  * ev_proof_of_play them device_id, campaign_id: gateway ghi san de bao cao khong phai doan thiet bi/chien dich tu screen_id/creative
--    (dong cu de NULL, bao cao tu suy ra qua screens/creatives).
--  * device_event_stats: dem su kien theo thiet bi/gio (UTC, dang YYYY-MM-DDTHH)/ly do ('accepted', 'valid', 'flagged', 'rej:<ly do>', 'alias:<ten>'), de web hien "Chan doan dong bo".
--    Ghi boi gateway (khong lam hong request neu loi). Giu 14 ngay (don trong cron).
ALTER TABLE ev_proof_of_play ADD COLUMN device_id TEXT;
ALTER TABLE ev_proof_of_play ADD COLUMN campaign_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ev_pop_campaign ON ev_proof_of_play(campaign_id, ts);
CREATE INDEX IF NOT EXISTS idx_ev_pop_device ON ev_proof_of_play(device_id, ts);

CREATE TABLE IF NOT EXISTS device_event_stats (
  device_id TEXT NOT NULL,
  hour TEXT NOT NULL,
  reason TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  last_at TEXT NOT NULL,
  PRIMARY KEY (device_id, hour, reason)
);
CREATE INDEX IF NOT EXISTS idx_device_event_stats_hour ON device_event_stats(hour);
