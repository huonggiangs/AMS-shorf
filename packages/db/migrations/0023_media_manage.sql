-- 0023 (m-list): sua metadata media - mo ta + the (JSON). Xoa dung lai co che xoa that + don R2 co san.
-- Chay duoc tren PostgreSQL 16 va SQLite/D1. Khong doi y nghia cac cot cu.
ALTER TABLE creatives ADD COLUMN description TEXT;
ALTER TABLE creatives ADD COLUMN tags TEXT;
