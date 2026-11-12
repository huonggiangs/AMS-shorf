// Hop dong thong diep gateway -> queue -> ingest-consumer.
export interface ImpressionRow {
  ts: string;
  event_id: string;
  device_id: string;
  screen_id: string | null;
  campaign_id: string;
  creative_id: string;
  slot_id: string | null;
  partner_id: string | null;
  region_id: string | null;
  vcr_pct: number;
  valid: 0 | 1;
  reject_reason: string | null;
  revenue_micro_vnd: number;
  reward_vnd: number;
}
export interface PopRow {
  event_id: string;
  ts: string;
  screen_id: string;
  creative_id: string;
  duration_ms: number;
  source: string;
}
/** Thong diep gateway -> queue `ingest.events` -> ingest-consumer */
export interface IngestMessage {
  v: 1;
  device_id: string;
  impressions: ImpressionRow[];
  pops: PopRow[];
}
export const INGEST_TOPIC = 'ingest.events';

