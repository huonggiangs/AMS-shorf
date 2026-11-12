Thư mục này được mount vào `/docker-entrypoint-initdb.d` của ClickHouse (profile `events`).
Mọi tệp `*.sql` ở đây chạy một lần khi volume `chdata` còn trống, theo thứ tự tên.

DDL sự kiện (heartbeat, ad_impression, proof_of_play, bảng gộp) thuộc sở hữu f1/a3 (đặc tả mục 5.2).
Lưu ý khi viết: ClickHouse đơn nút dùng `MergeTree`/`ReplacingMergeTree` (không dùng `Replicated*`),
và id trong PLAN là chuỗi ULID nên cột id dùng `String`, không dùng `UInt64`.
Bản đồ tên biến: bảng nằm trong database `ams` (`CLICKHOUSE_DB`).
