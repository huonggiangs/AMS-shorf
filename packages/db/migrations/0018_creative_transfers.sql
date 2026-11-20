-- 0018: trang thai chuyen tep lon cua creative: (1) tai len TUNG PHAN qua Worker (R2 multipart), (2) nhap tu Google Drive/Dropbox/URL (tai ve Worker -> R2).
-- Co y KHONG dung ALTER TABLE (khong idempotent tren SQLite/D1): bang phu khoa theo creative_id, nhu 0007/0013/0015/0016/0017.
-- kind   : 'multipart' | 'import'
-- status : multipart: open | completed | aborted | expired | failed ; import: queued | running | done | failed
-- upload_id/part_size/total_parts/parts: trang thai R2 multipart (parts = JSON [{n, etag, size}]); import cung dung de TIEP TUC sau khi mat ket noi.
-- bytes_done/bytes_total: tien do (import hien "Dang tai tu Drive... X%"); error_code/error_message: loi cuoi (tieng Viet, hien tren trang Media).
-- Xoa creative => xoa dong nay (API huy multipart dang mo truoc khi xoa).
CREATE TABLE IF NOT EXISTS creative_transfers (
  creative_id TEXT NOT NULL PRIMARY KEY REFERENCES creatives(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  upload_id TEXT,
  part_size INTEGER,
  total_parts INTEGER,
  parts TEXT NOT NULL DEFAULT '[]',
  bytes_done BIGINT NOT NULL DEFAULT 0,
  bytes_total BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creative_transfers_status ON creative_transfers(kind, status, updated_at);
