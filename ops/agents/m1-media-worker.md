STATUS: done
UPDATED: 2026-11-12 UTC

- Da lam: `services/media-worker` (package `@ams/media-worker`, Dockerfile, 10 test).
  - `src/worker.ts`: `createMediaWorker(rt, opts)`; topic `media.uploaded` `{creative_id}` + `sweep()` (quet DB `scan_state='pending'` phong mat tin). Khoa mem KV `media:lock:<id>`, ghi cuoi bang UPDATE co dieu kien `WHERE scan_state='pending'` (idempotent).
  - Kiem: kich thuoc theo loai man, magic bytes (png/jpeg/mp4/webm), khop MIME, sha256, ClamAV (clamd INSTREAM TCP: `src/clamav.ts`, `ClamdScanner`/`NoScanner`/`FakeScanner`), ffprobe (kich thuoc that = khai bao, thoi luong theo loai man), chuyen ma H.264 mp4 / webp (`src/media.ts`).
  - scan_state ghi: `clean` | `infected` | `unscanned` (clamd khong san sang hoac tep bi tu choi truoc khi quet; KHONG bao gio 'clean' neu chua quet). `CLAMAV_REQUIRED=1` => giu 'pending' va thu lai.
  - Tu choi => `review_state='rejected'`, `state='invalid'`, `review_note` tieng Viet. Thanh cong khong dong vao review_state/state.
  - Rendition luu object store: `renditions/<customer>/<creative>/<profile>.<ext>` + `manifest.json` (khong co cot DB, xem requests).
- Env: CLAMD_HOST, CLAMD_PORT=3310, CLAMD_TIMEOUT_MS, CLAMAV_REQUIRED, MEDIA_TRANSCODE (=0 tat), MEDIA_FFMPEG_THREADS, MEDIA_FFMPEG_TIMEOUT_MS, MEDIA_MAX_BYTES, MEDIA_SWEEP_S=60, PORT=8790 (+ GET /health).
- Kiem: `pnpm --filter @ams/media-worker typecheck` sach; `pnpm --filter @ams/media-worker test` 10/10 (gom ffmpeg+ffprobe that: probe, mpeg4->H.264 1080x1920 bo audio, PNG->webp, tep gia mao bi tu choi; clamd TCP voi server gia).
- Chua: build/chay Docker image (khong co daemon); chay clamd that; tai ve nguon link (youtube/gdrive/dropbox/url); settlement (spec khong du chi tiet).
