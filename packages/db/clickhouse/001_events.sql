-- DDL ClickHouse nguyen van theo docs/DAC-TA-GIAO-VIEC-AGENT.md muc 5.2.
-- Luu y: ban Postgres/SQLite (ev_*) dung id TEXT; khi ghi sang ClickHouse, ingest-consumer anh xa id -> UInt64.

CREATE TABLE heartbeat (
  ts DateTime, device_id UInt64, shard UInt16, region UInt16, app_ver LowCardinality(String),
  soc_temp Int16, rssi Int16, dl_mbps Float32, cache_used_mb UInt32, cache_slots UInt16, state UInt8
) ENGINE = ReplicatedMergeTree PARTITION BY toYYYYMMDD(ts) ORDER BY (shard, device_id, ts)
TTL ts + INTERVAL 14 DAY;

CREATE TABLE ad_impression (
  ts DateTime, event_id UUID, device_id UInt64, screen_id UInt64, campaign_id UInt64, creative_id UInt64,
  slot_id UInt64, partner_id UInt16, vcr_pct UInt8, valid UInt8, reject_reason LowCardinality(String),
  revenue_micro_vnd Int64, reward_vnd Int32
) ENGINE = ReplacingMergeTree(ts) PARTITION BY toYYYYMM(ts)
ORDER BY (campaign_id, toStartOfHour(ts), device_id, event_id);          -- khu trung theo event_id

CREATE TABLE proof_of_play (ts DateTime, screen_id UInt64, creative_id UInt64, duration_ms UInt32, source LowCardinality(String));
