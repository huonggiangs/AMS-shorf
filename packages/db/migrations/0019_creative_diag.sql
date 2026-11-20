-- 0019: chan doan an toan cho creative (chi admin/audit xem) + canh bao quy cach (hien cho nguoi dung).
-- diag (JSON): { kind:'import', code, http, content_type, title, snippet(<=200 ky tu da lam sach), final_url (da bo gia tri tham so), steps:[{url,status,content_type}], warnings:[] }
-- Khong chua cookie/token/URL ky. Co y dung bang phu (khong ALTER TABLE): xem 0018. Xoa creative => xoa dong nay.
CREATE TABLE IF NOT EXISTS creative_diag (
  creative_id TEXT NOT NULL PRIMARY KEY REFERENCES creatives(id) ON DELETE CASCADE,
  diag TEXT NOT NULL,
  created_at TEXT NOT NULL
);
