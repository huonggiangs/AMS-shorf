-- 0016: anh dai dien (thumbnail) cua creative, tao O TRINH DUYET luc tai len (Cloudflare khong co ffmpeg) roi PUT /media/:id/thumbnail.
-- Co y KHONG dung ALTER TABLE (khong idempotent tren SQLite/D1): bang phu khoa theo creative_id, nhu 0007/0013/0015.
-- thumb_key: khoa trong kho tep (media/{customer}/{id}/thumb.jpg). Xoa creative => xoa dong nay (API cung xoa tep).
CREATE TABLE IF NOT EXISTS creative_thumbnails (
  creative_id TEXT NOT NULL PRIMARY KEY REFERENCES creatives(id) ON DELETE CASCADE,
  thumb_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
