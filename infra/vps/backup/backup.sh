#!/bin/sh
# Sao luu ma hoa (AES-256-CBC + PBKDF2, doc duoc bang openssl hoac tools/ops restore.ts), giu BACKUP_KEEP ban, tuy chon rclone sang noi khac,
# bao cao cho API (POST /ops/backup-report) de trang Canh bao biet. Dung: ams-backup postgres | ams-backup media
set -eu
umask 077
# shellcheck disable=SC1091
. /etc/backup.env 2>/dev/null || true
KIND="${1:-postgres}"
DIR=/backups
KEEP="${BACKUP_KEEP:-14}"
ITER="${BACKUP_PBKDF2_ITER:-200000}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
START="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
ENV_NAME="${AMS_ENV:-production}"

report() { # ok bytes sha note
  [ -n "${OPS_REPORT_URL:-}" ] && [ -n "${OPS_REPORT_TOKEN:-}" ] || return 0
  END="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  if [ "$1" = "1" ]; then
    BODY="{\"kind\":\"$KIND\",\"env\":\"$ENV_NAME\",\"target\":\"${TARGET:-local}\",\"bytes\":${2:-0},\"sha256\":\"${3:-}\",\"encrypted\":true,\"ok\":true,\"started_at\":\"$START\",\"finished_at\":\"$END\"}"
  else
    BODY="{\"kind\":\"$KIND\",\"env\":\"$ENV_NAME\",\"ok\":false,\"note\":\"${4:-loi}\",\"started_at\":\"$START\",\"finished_at\":\"$END\"}"
  fi
  curl -fsS -m 15 -X POST -H "content-type: application/json" -H "authorization: Bearer $OPS_REPORT_TOKEN" -d "$BODY" "$OPS_REPORT_URL" >/dev/null || echo "[backup] khong bao cao duoc cho API"
}
fail() {
  echo "[backup] THAT BAI: $1" >&2
  report 0 0 "" "$1"
  find /backups -maxdepth 1 -name '*.tmp' -delete
  exit 1
}

[ -n "${BACKUP_ENC_KEY:-}" ] || fail "thieu BACKUP_ENC_KEY"
if [ "$KIND" = "postgres" ]; then
  PREFIX="postgres-$PGDATABASE"
  OUT="$DIR/$PREFIX-$STAMP.dump.enc"
  TMP="$DIR/$PREFIX-$STAMP.dump.tmp"
  pg_dump -Fc --no-owner --no-privileges -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -f "$TMP" || fail "pg_dump"
  # kiem tra dump doc duoc truoc khi ma hoa
  pg_restore --list "$TMP" >/dev/null || fail "pg_restore --list"
  openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter "$ITER" -salt -pass env:BACKUP_ENC_KEY -in "$TMP" -out "$OUT" || fail "openssl"
  rm -f "$TMP"
elif [ "$KIND" = "media" ]; then
  PREFIX="media"
  OUT="$DIR/$PREFIX-$STAMP.tar.enc"
  tar -C /data/objects -cf - . | openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter "$ITER" -salt -pass env:BACKUP_ENC_KEY -out "$OUT" || fail "tar/openssl media"
else
  fail "kind khong hop le: $KIND"
fi
SHA="$(sha256sum "$OUT" | cut -d' ' -f1)"
echo "$SHA  $(basename "$OUT")" > "$OUT.sha256"
BYTES="$(wc -c < "$OUT" | tr -d ' ')"
# giu KEEP ban moi nhat
ls -1 "$DIR" | grep -E "^$PREFIX-.*\.enc$" | sort | head -n "-$KEEP" | while read -r f; do
  rm -f "${DIR:?}/$f" "${DIR:?}/$f.sha256"
done
TARGET=local
if [ -n "${BACKUP_RCLONE:-}" ]; then
  rclone copyto "$OUT" "${BACKUP_RCLONE%/}/$(basename "$OUT")" && rclone copyto "$OUT.sha256" "${BACKUP_RCLONE%/}/$(basename "$OUT").sha256" || fail "rclone"
  TARGET="rclone:${BACKUP_RCLONE%%:*}"
fi
echo "[backup] xong $KIND: $(basename "$OUT") $BYTES byte sha256=$(echo "$SHA" | cut -c1-12)... ngoai-may=$TARGET"
report 1 "$BYTES" "$SHA"
