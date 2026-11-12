#!/usr/bin/env bash
# AMS - sao lưu / khôi phục / kiểm chứng PostgreSQL (Docker local). Xem docs/ops/DISASTER-RECOVERY.md.
#
# Dùng:
#   scripts/backup-postgres.sh backup  [--out DIR] [--keep N]
#   scripts/backup-postgres.sh verify  FILE [--compare-source]
#   scripts/backup-postgres.sh restore FILE [--target-db TÊN] [--yes]
#   scripts/backup-postgres.sh list    [--out DIR]
#
# Chế độ:
#   (mặc định) docker : chạy pg_dump/pg_restore TRONG container `postgres` của compose (infra/docker/docker-compose.yml).
#   --direct          : dùng pg_dump/pg_restore/psql cài trên máy, kết nối bằng DATABASE_URL hoặc PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
#
# Mặc định lưu vào ./backups/ (đã nằm trong .gitignore): postgres-<db>-<UTC>.dump (định dạng custom -Fc) + .sha256.
# Đọc POSTGRES_USER / POSTGRES_DB từ .env (không `source`), biến môi trường cùng tên được ưu tiên.
# Không in mật khẩu. Không xóa gì ngoài các tệp sao lưu cũ do chính script này tạo (theo --keep).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.yml"
ENV_FILE="$ROOT/.env"

MODE=docker
OUT="$ROOT/backups"
KEEP=14
TARGET_DB=""
ASSUME_YES=0
COMPARE=0

die() { echo "LỖI: $*" >&2; exit 1; }
log() { echo "[backup-postgres] $*"; }

usage() { sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ---------------------------------------------------------------- tham số
[ $# -ge 1 ] || usage 1
CMD="$1"; shift
FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --direct) MODE=direct ;;
    --out) OUT="${2:?thiếu giá trị --out}"; shift ;;
    --keep) KEEP="${2:?thiếu giá trị --keep}"; shift ;;
    --target-db) TARGET_DB="${2:?thiếu giá trị --target-db}"; shift ;;
    --yes) ASSUME_YES=1 ;;
    --compare-source) COMPARE=1 ;;
    -h|--help) usage 0 ;;
    -*) die "tham số lạ: $1" ;;
    *) [ -z "$FILE" ] && FILE="$1" || die "thừa tham số: $1" ;;
  esac
  shift
done
[ "${AMS_BACKUP_MODE:-}" = direct ] && MODE=direct
case "$KEEP" in ''|*[!0-9]*) die "--keep phải là số nguyên >= 1" ;; esac
[ "$KEEP" -ge 1 ] || die "--keep phải >= 1"

# ---------------------------------------------------------------- cấu hình
env_get() { # đọc KEY từ .env mà không source (giá trị có thể chứa ký tự đặc biệt)
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//" || true
}

PGUSER_="${POSTGRES_USER:-$(env_get POSTGRES_USER)}"; PGUSER_="${PGUSER_:-ams}"
PGDB_="${POSTGRES_DB:-$(env_get POSTGRES_DB)}"; PGDB_="${PGDB_:-ams}"

if [ "$MODE" = direct ]; then
  if [ -n "${DATABASE_URL:-}" ]; then
    # postgres://user:pass@host:port/db
    re='^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^?]+)'
    [[ "$DATABASE_URL" =~ $re ]] || die "DATABASE_URL không đúng dạng postgres://user:pass@host:port/db"
    export PGUSER="${BASH_REMATCH[2]}" PGHOST="${BASH_REMATCH[5]}" PGPORT="${BASH_REMATCH[7]:-5432}"
    [ -n "${BASH_REMATCH[4]}" ] && export PGPASSWORD="${BASH_REMATCH[4]}"
    PGDB_="${BASH_REMATCH[8]}"
  else
    export PGUSER="${PGUSER:-$PGUSER_}"
    [ -n "${PGDATABASE:-}" ] && PGDB_="$PGDATABASE"
  fi
  for t in pg_dump pg_restore psql; do command -v "$t" >/dev/null 2>&1 || die "chế độ --direct cần '$t' trên máy"; done
else
  command -v docker >/dev/null 2>&1 || die "không thấy 'docker'. Cài Docker, hoặc dùng --direct với pg_dump trên máy."
  [ -f "$ENV_FILE" ] || log "Cảnh báo: chưa có .env (chạy 'make setup'); dùng mặc định user=$PGUSER_ db=$PGDB_."
fi
SRC_DB="$PGDB_"

# ---------------------------------------------------------------- lớp truy cập (docker | direct)
dc() {
  if [ -f "$ENV_FILE" ]; then docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else docker compose -f "$COMPOSE_FILE" "$@"; fi
}
# pgx PROG ARGS...: chạy công cụ Postgres (thêm -U ở chế độ docker; chế độ direct dùng biến PG*).
pgx() {
  local prog="$1"; shift
  if [ "$MODE" = direct ]; then "$prog" "$@"
  else dc exec -T postgres "$prog" -U "$PGUSER_" "$@"; fi
}
sql() { # sql DB "câu lệnh"  -> in giá trị thuần (-Atq)
  pgx psql -v ON_ERROR_STOP=1 -Atq -d "$1" -c "$2"
}
REMOTE_TMP=""
stage_in() { # stage_in LOCAL -> đặt đường dẫn REMOTE_TMP mà pg_restore đọc được
  if [ "$MODE" = direct ]; then REMOTE_TMP="$1"
  else REMOTE_TMP="/tmp/ams-restore-$$.dump"; dc cp "$1" "postgres:$REMOTE_TMP" >/dev/null; fi
}
stage_cleanup() { [ "$MODE" = docker ] && [ -n "$REMOTE_TMP" ] && { dc exec -T postgres rm -f "$REMOTE_TMP" >/dev/null 2>&1 || true; }; REMOTE_TMP=""; }

sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
valid_ident() { [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || die "tên cơ sở dữ liệu không hợp lệ: $1"; }

KEY_TABLES="tenants customers admins devices campaigns ad_wallets wallet_entries topups payment_webhooks audit_log outbox"

# ---------------------------------------------------------------- backup
cmd_backup() {
  valid_ident "$SRC_DB"
  mkdir -p "$OUT"
  local ts final part
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  final="$OUT/postgres-$SRC_DB-$ts.dump"
  part="$final.partial"
  log "Sao lưu cơ sở dữ liệu '$SRC_DB' (chế độ $MODE) -> $final"
  trap 'rm -f "$part"; stage_cleanup' EXIT
  if [ "$MODE" = direct ]; then
    pg_dump -d "$SRC_DB" -Fc --no-owner --no-acl -f "$part"
  else
    local rtmp="/tmp/ams-backup-$$.dump"
    pgx pg_dump -d "$SRC_DB" -Fc --no-owner --no-acl -f "$rtmp"
    dc cp "postgres:$rtmp" "$part" >/dev/null
    dc exec -T postgres rm -f "$rtmp" >/dev/null 2>&1 || true
  fi
  [ -s "$part" ] || die "tệp sao lưu rỗng"
  mv "$part" "$final"
  trap - EXIT
  echo "$(sha_of "$final")  $(basename "$final")" > "$final.sha256"
  log "Xong: $(du -h "$final" | cut -f1), sha256 trong $(basename "$final").sha256"
  # giữ N bản mới nhất của chính DB này
  local old
  old="$(ls -1 "$OUT"/postgres-"$SRC_DB"-*.dump 2>/dev/null | sort | awk -v k="$KEEP" '{a[NR]=$0} END{for(i=1;i<=NR-k;i++)print a[i]}' || true)"
  if [ -n "$old" ]; then
    echo "$old" | while IFS= read -r f; do rm -f "$f" "$f.sha256"; log "Xóa bản cũ (quá --keep $KEEP): $(basename "$f")"; done
  fi
  log "Nhắc: bản sao lưu KHÔNG chứa FIELD_ENC_KEY. Lưu khóa này riêng, ở nơi an toàn (mất khóa = không giải mã được MST/số tài khoản)."
}

# ---------------------------------------------------------------- verify
cmd_verify() {
  [ -n "$FILE" ] || die "thiếu đường dẫn tệp .dump"
  [ -f "$FILE" ] || die "không thấy tệp: $FILE"
  valid_ident "$SRC_DB"
  local scratch="${SRC_DB}_verify_$$"; valid_ident "$scratch"
  if [ -f "$FILE.sha256" ]; then
    [ "$(sha_of "$FILE")" = "$(cut -d' ' -f1 "$FILE.sha256")" ] || die "SHA-256 KHÔNG khớp: tệp sao lưu hỏng hoặc bị sửa"
    log "SHA-256 khớp."
  else
    log "Cảnh báo: không có $(basename "$FILE").sha256, bỏ qua kiểm checksum."
  fi
  stage_in "$FILE"
  trap 'sql postgres "DROP DATABASE IF EXISTS \"'"$scratch"'\"" >/dev/null 2>&1 || true; stage_cleanup' EXIT
  pgx pg_restore --list "$REMOTE_TMP" >/dev/null || die "pg_restore --list thất bại: tệp không đọc được"
  log "Danh mục tệp đọc được. Khôi phục thử vào cơ sở dữ liệu tạm '$scratch' (không đụng '$SRC_DB')..."
  sql postgres "CREATE DATABASE \"$scratch\"" >/dev/null
  pgx pg_restore --exit-on-error --no-owner --no-acl -d "$scratch" "$REMOTE_TMP" || die "khôi phục thử thất bại"

  local tables mig bad=0
  tables="$(sql "$scratch" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
  mig="$(sql "$scratch" "SELECT count(*) FROM _migrations" 2>/dev/null || echo 0)"
  [ "${tables:-0}" -gt 0 ] || { echo "  thất bại: không có bảng nào" >&2; bad=1; }
  [ "${mig:-0}" -gt 0 ] || { echo "  thất bại: bảng _migrations rỗng" >&2; bad=1; }
  log "Bảng: $tables; migration đã ghi: $mig. Số dòng các bảng chính (bản khôi phục$([ $COMPARE = 1 ] && echo " | nguồn")):"
  local t a b
  for t in $KEY_TABLES; do
    a="$(sql "$scratch" "SELECT count(*) FROM $t" 2>/dev/null || echo THIẾU)"
    if [ $COMPARE = 1 ]; then
      b="$(sql "$SRC_DB" "SELECT count(*) FROM $t" 2>/dev/null || echo THIẾU)"
      printf '  %-18s %10s | %s\n' "$t" "$a" "$b"
      [ "$a" = "$b" ] || { echo "    ^ khác nhau (nếu hệ thống vẫn chạy sau thời điểm sao lưu thì có thể bình thường)" >&2; bad=2; }
    else
      printf '  %-18s %10s\n' "$t" "$a"
      [ "$a" != "THIẾU" ] || bad=1
    fi
  done
  # Bất biến sổ cái (cùng công thức với reconcileLedger của services/payments): cache ví phải khớp tổng sổ cái.
  local drift
  drift="$(sql "$scratch" "SELECT count(*) FROM ad_wallets w LEFT JOIN (SELECT customer_id, SUM(CASE WHEN kind IN ('topup','adjust') THEN amount_vnd WHEN kind IN ('spend','refund') THEN -amount_vnd ELSE 0 END) AS b FROM wallet_entries GROUP BY customer_id) e ON e.customer_id = w.customer_id WHERE COALESCE(e.b,0) <> w.balance_vnd" 2>/dev/null || echo "?")"
  log "Ví lệch sổ cái (balance): $drift  (0 là đạt; khác 0 thì chạy đối soát tài chính trước khi đưa vào dùng)"
  [ "$drift" = "0" ] || [ "$drift" = "?" ] || bad=1
  # Bảng bất biến phải còn trigger chặn UPDATE/DELETE sau khôi phục
  local trg
  trg="$(sql "$scratch" "SELECT count(*) FROM pg_trigger WHERE tgname IN ('audit_log_immutable','wallet_entries_immutable','wallet_ledger_immutable')" 2>/dev/null || echo 0)"
  log "Trigger bất biến còn nguyên: $trg/3"
  [ "$trg" = "3" ] || bad=1

  sql postgres "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null
  trap - EXIT; stage_cleanup
  if [ $bad -eq 1 ]; then die "KIỂM CHỨNG THẤT BẠI (xem các dòng trên)"; fi
  if [ $bad -eq 2 ]; then log "Kiểm chứng đạt về cấu trúc; số dòng khác nguồn hiện tại (xem trên)."; exit 0; fi
  log "KIỂM CHỨNG ĐẠT: bản sao lưu khôi phục được."
}

# ---------------------------------------------------------------- restore
cmd_restore() {
  [ -n "$FILE" ] || die "thiếu đường dẫn tệp .dump"
  [ -f "$FILE" ] || die "không thấy tệp: $FILE"
  local target="${TARGET_DB:-$SRC_DB}"; valid_ident "$target"
  if [ -f "$FILE.sha256" ] && [ "$(sha_of "$FILE")" != "$(cut -d' ' -f1 "$FILE.sha256")" ]; then die "SHA-256 KHÔNG khớp, từ chối khôi phục"; fi
  log "Khôi phục '$FILE' vào cơ sở dữ liệu '$target' (chế độ $MODE)."
  if [ "$target" = "$SRC_DB" ]; then
    echo "CẢNH BÁO: sẽ GHI ĐÈ toàn bộ dữ liệu hiện có trong '$target'." >&2
    echo "Hãy dừng api, edge-gateway, ingest-consumer trước (make down hoặc 'docker compose ... stop api edge-gateway ingest-consumer') và chạy 'backup' để có bản an toàn." >&2
    if [ $ASSUME_YES -ne 1 ]; then
      printf "Gõ chính xác tên cơ sở dữ liệu '%s' để tiếp tục: " "$target"; read -r a
      [ "$a" = "$target" ] || die "đã hủy"
    fi
  fi
  stage_in "$FILE"
  trap 'stage_cleanup' EXIT
  local exists
  exists="$(sql postgres "SELECT 1 FROM pg_database WHERE datname = '$target'")"
  if [ -z "$exists" ]; then
    log "Tạo cơ sở dữ liệu '$target'."
    sql postgres "CREATE DATABASE \"$target\"" >/dev/null
    pgx pg_restore --exit-on-error --no-owner --no-acl -d "$target" "$REMOTE_TMP"
  else
    # --clean --if-exists: xóa đối tượng cũ rồi tạo lại (DROP TABLE không bị trigger bất biến chặn)
    pgx pg_restore --exit-on-error --clean --if-exists --no-owner --no-acl -d "$target" "$REMOTE_TMP"
  fi
  log "Xong. Việc cần làm tiếp: (1) chạy lại 'pnpm --filter @ams/api migrate' nếu mã mới hơn bản sao lưu; (2) đối soát ví/SePay; (3) khởi động lại dịch vụ. Xem docs/ops/DISASTER-RECOVERY.md mục 3."
}

cmd_list() {
  ls -1t "$OUT"/postgres-*.dump 2>/dev/null | while IFS= read -r f; do printf '%s  %s\n' "$(du -h "$f" | cut -f1)" "$f"; done
  [ -d "$OUT" ] || log "Chưa có thư mục $OUT"
}

case "$CMD" in
  backup) cmd_backup ;;
  verify) cmd_verify ;;
  restore) cmd_restore ;;
  list) cmd_list ;;
  -h|--help|help) usage 0 ;;
  *) die "lệnh lạ: $CMD (backup|verify|restore|list)" ;;
esac
