-- 0023 (v-link): creative dang "dan link" (stream): TV phat truc tiep tu URL, may chu KHONG tai/chuyen ma/luu video.
-- Co y KHONG dung ALTER TABLE (khong idempotent tren D1): bang phu khoa theo creative_id, nhu 0007/0013/0015.
-- Khong co dong = creative tai len (delivery 'upload'). creatives.source = 'url', storage_key/sha256 = NULL cho dong stream.
-- Rang buoc noi dung: `binding` = SHA-256(url | etag | content-length | last-modified | [hash 64 KB dau voi HLS/DASH hoac khi may chu khong tra validator]).
-- Bo kiem tra lai (toi da 1 lan/gio/creative) so binding hien tai voi binding da luu; doi hoac URL loi => probe_status khac 'ok' + needs_review = 1,
-- creative quay ve cho duyet thu cong va BI LOAI khoi manifest. Chi nguoi duyet (xem noi dung that) moi dua ve 'ok'.
CREATE TABLE IF NOT EXISTS creative_stream (
  creative_id TEXT NOT NULL PRIMARY KEY,
  delivery TEXT NOT NULL DEFAULT 'stream' CHECK (delivery IN ('stream')),
  stream_url TEXT NOT NULL,
  stream_kind TEXT NOT NULL CHECK (stream_kind IN ('mp4','webm','hls','dash')),
  declared_duration_s INTEGER NOT NULL,
  content_type TEXT,
  content_length BIGINT,
  etag TEXT,
  last_modified TEXT,
  body_hash TEXT,
  binding TEXT NOT NULL,
  probe_status TEXT NOT NULL DEFAULT 'ok' CHECK (probe_status IN ('ok','changed','unreachable','http_error')),
  probe_detail TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0,1)),
  checked_at TEXT NOT NULL,
  full_view_by TEXT,
  full_view_at TEXT,
  approved_binding TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creative_stream_check ON creative_stream(checked_at);
CREATE INDEX IF NOT EXISTS idx_creative_stream_status ON creative_stream(probe_status, needs_review);
