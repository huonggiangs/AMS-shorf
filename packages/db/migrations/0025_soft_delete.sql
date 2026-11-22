-- d-cust: xoa mem thiet bi, luu tru khach hang. Chay duoc tren Postgres, SQLite va D1 (chi ALTER ... ADD COLUMN, kieu TEXT).
-- Thiet bi: deleted_at != NULL = da xoa (khoa cong khai bi go de gateway tu choi 410 device_deleted va cho phep dang ky lai thanh thiet bi MOI);
-- dong thiet bi va su kien/doanh thu cu GIU NGUYEN (khong xoa day chuyen).
ALTER TABLE devices ADD COLUMN deleted_at TEXT;
ALTER TABLE devices ADD COLUMN deleted_by TEXT;
-- Khach hang: ghi chu noi bo, thoi diem luu tru (archived_at != NULL = da xoa mem, state chuyen 'terminated'), updated_at de kiem soat sua dong thoi.
ALTER TABLE customers ADD COLUMN notes TEXT;
ALTER TABLE customers ADD COLUMN archived_at TEXT;
ALTER TABLE customers ADD COLUMN archived_by TEXT;
ALTER TABLE customers ADD COLUMN updated_at TEXT;
