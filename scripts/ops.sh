#!/usr/bin/env bash
# AMS - sao luu / khoi phuc / dien tap / chuyen D1->Postgres (Linux/macOS/VPS). Goi tools/ops (pnpm + tsx).
#   scripts/ops.sh backup-pg  [--out DIR] [--keep 14] [--copy-to DIR]     (can DATABASE_URL, BACKUP_ENC_KEY, pg_dump tren may)
#   scripts/ops.sh backup-d1  production [--out DIR] [--keep 14]           (wrangler d1 export --remote -> ma hoa)
#   scripts/ops.sh restore FILE.enc --kind postgres --target-url postgres://... [--create-db]
#   scripts/ops.sh drill-dev                                               (Postgres nhung, du lieu SQLite seed; KHONG can bi mat that)
#   scripts/ops.sh drill-pg --source-url postgres://...                    (khoi phuc vao DB tam, so khop)
#   scripts/ops.sh d1-to-pg production --target-url postgres://... [--create-db] [--dry-run]
#   scripts/ops.sh d1-to-pg --input export.sql --target-url postgres://...
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
cmd="${1:-}"; [ -n "$cmd" ] || { sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; }
shift
tool() { local t="$1"; shift; exec pnpm --filter @ams/ops-tools exec tsx "src/$t.ts" "$@"; }
cfg="$ROOT/infra/cloudflare/api/wrangler.generated.toml"
case "$cmd" in
  backup-pg) tool backup postgres "$@" ;;
  backup-d1) env="${1:?thieu moi truong: staging|production}"; shift; tool backup d1 --d1-db "ams-core-$env" --env "$env" --config "$cfg" --label "$env" "$@" ;;
  restore) tool restore "$@" ;;
  drill-dev) tool drill dev "$@" ;;
  drill-pg) tool drill postgres "$@" ;;
  d1-to-pg)
    if [ "${1:-}" = "--input" ] || [ "${1:-}" = "--sqlite" ]; then tool d1-to-pg "$@"; fi
    env="${1:?thieu moi truong hoac --input FILE}"; shift
    tool d1-to-pg --d1-db "ams-core-$env" --env "$env" --config "$cfg" "$@" ;;
  *) echo "lenh khong ro: $cmd" >&2; exit 1 ;;
esac
