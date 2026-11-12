#!/bin/sh
# Áp DDL sự kiện của packages/db/clickhouse (mount tại /ams-ddl) vào ClickHouse đơn nút (local).
# ReplicatedMergeTree cần Keeper nên được thay bằng MergeTree khi chạy local.
set -e
for f in /ams-ddl/*.sql; do
  [ -e "$f" ] || { echo "Không có DDL trong /ams-ddl"; exit 0; }
  echo "ClickHouse: áp $f"
  sed 's/ReplicatedMergeTree/MergeTree/g' "$f" | clickhouse-client --user "${CLICKHOUSE_USER:-default}" --password "${CLICKHOUSE_PASSWORD:-}" --database "${CLICKHOUSE_DB:-ams}" --multiquery
done
