# Sidecar sao luu: cron (busybox crond) + pg_dump 16 + openssl + curl + rclone. Chay root BEN TRONG container (chi mount volume backups va media doc-chi).
FROM postgres:16-alpine
RUN apk add --no-cache openssl curl rclone tzdata
COPY backup.sh /usr/local/bin/ams-backup
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/ams-backup /usr/local/bin/entrypoint.sh && mkdir -p /backups
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
