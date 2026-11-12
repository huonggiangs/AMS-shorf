-- Bang gop cho dashboard (muc 5.2 chi liet ke ten + cot; DDL duoi day la phan cai dat bo sung cua f1-foundation).
-- Dashboard luon doc cac bang nay, khong quet bang tho.

CREATE TABLE impression_hourly (
  hour DateTime, campaign_id UInt64, partner_id UInt16, region UInt16,
  impressions UInt64, valid UInt64, revenue_micro_vnd Int64, reward_vnd Int64
) ENGINE = SummingMergeTree PARTITION BY toYYYYMM(hour) ORDER BY (campaign_id, hour, partner_id, region);

CREATE MATERIALIZED VIEW impression_hourly_mv TO impression_hourly AS
SELECT toStartOfHour(ts) AS hour, campaign_id, partner_id, toUInt16(0) AS region,
       count() AS impressions, sum(valid) AS valid, sum(revenue_micro_vnd) AS revenue_micro_vnd, sum(reward_vnd) AS reward_vnd
FROM ad_impression GROUP BY hour, campaign_id, partner_id;

CREATE TABLE heatmap_slot_fill (day Date, hour UInt8, region UInt16, fill_pct Float32)
ENGINE = ReplacingMergeTree ORDER BY (day, hour, region);

CREATE TABLE device_state_daily (day Date, region UInt16, online_peak UInt32, offline_count UInt32)
ENGINE = ReplacingMergeTree ORDER BY (day, region);
