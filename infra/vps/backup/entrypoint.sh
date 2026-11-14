#!/bin/sh
# Ghi bien moi truong cho cron (busybox crond khong truyen env), dat lich, chay crond o foreground.
set -eu
umask 077
export -p | grep -E "^export (PG|BACKUP|OPS_REPORT|RCLONE_CONFIG|AMS_ENV|TZ)" > /etc/backup.env || true
{
  echo "${BACKUP_CRON:-17 */6 * * *} /usr/local/bin/ams-backup postgres >> /proc/1/fd/1 2>&1"
  if [ "${BACKUP_MEDIA:-0}" = "1" ]; then echo "${BACKUP_MEDIA_CRON:-40 3 * * 0} /usr/local/bin/ams-backup media >> /proc/1/fd/1 2>&1"; fi
} > /etc/crontabs/root
echo "[backup] lich postgres: ${BACKUP_CRON:-17 */6 * * *}; media: ${BACKUP_MEDIA:-0}; giu ${BACKUP_KEEP:-14} ban"
if [ "${BACKUP_RUN_ON_START:-0}" = "1" ]; then /usr/local/bin/ams-backup postgres || true; fi
exec crond -f -L /dev/stdout
