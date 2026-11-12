# Yêu cầu của m1-media-worker cho agent khác

## a1-api-core (services/api/src/routes/media.ts)
1. Sau khi `POST /:id/confirm` UPDATE thành công (`state='pending_review'`) gọi `await rt.queue.send('media.uploaded', { creative_id: id })` (hằng `MEDIA_TOPIC` ở `@ams/media-worker`; không bắt buộc import). Nếu không gửi, worker vẫn tự quét DB mỗi `MEDIA_SWEEP_S` giây (mặc định 60).
2. Quy tắc duyệt/manifest: chỉ cho duyệt (`approve`) và phát (manifest) creative có `scan_state='clean'`; `unscanned` hiển thị cảnh báo "chưa quét mã độc" cho người duyệt; `infected` đã bị worker chuyển `rejected/invalid`. (Hiện `approve` không kiểm `scan_state`.)
3. Import link (`/import`): worker CHƯA tải về (youtube/gdrive/dropbox/url cần yt-dlp, giới hạn SSRF, quyền sở hữu). Các dòng này giữ `scan_state='pending'` (worker bỏ qua, không đánh dấu clean). Cần quyết định sản phẩm trước khi làm.

## p0-domain / f1-foundation (migration mới, không phải của m1)
Rendition hiện chỉ nằm ở object store (`renditions/<customer>/<creative>/manifest.json`). Đề xuất cột `creatives.renditions TEXT` (JSON: profile, key, sha256, width, height, codec, size) hoặc bảng `creative_renditions(creative_id, profile, storage_key, sha256, width, height, codec, size_bytes)`; sau đó m1 ghi vào đó và manifest (a3-gateway) ưu tiên rendition, sha256 của rendition thay vì bản gốc. Hiện manifest vẫn phát tệp gốc.

## i1 / o2 (compose) — đề xuất service
```yaml
  media-worker:
    build: { context: ../.., dockerfile: services/media-worker/Dockerfile }
    environment:
      RUNTIME: docker
      CLAMD_HOST: clamav
      CLAMD_PORT: "3310"
      CLAMAV_REQUIRED: "0"        # production: "1"
      MEDIA_TRANSCODE: "1"        # dev nhẹ máy: "0"
      MEDIA_FFMPEG_THREADS: "2"
      MEDIA_MAX_BYTES: "536870912"
      MEDIA_SWEEP_S: "60"
      PORT: "8790"
      # cộng các biến DB/Redis/S3 giống ingest-consumer (DATABASE_URL, REDIS_URL, S3_*)
    depends_on: [postgres, redis, minio, clamav]
    deploy: { resources: { limits: { cpus: "2", memory: 1g } } }   # giới hạn CPU transcode (THREAT-MODEL D)
    healthcheck: { test: ["CMD", "wget", "-qO-", "http://localhost:8790/health"] }
  clamav:
    image: clamav/clamav:1.4        # cổng 3310; khởi động lâu (tải CSDL), nên cho start_period 120s
    healthcheck: { test: ["CMD", "clamdscan", "--ping", "1"], start_period: 120s }
```
Lưu ý: worker đọc cả tệp vào bộ nhớ (ObjectStore.get), nên đặt memory >= 2x `MEDIA_MAX_BYTES` nếu cho phép tệp lớn; clamd mặc định `StreamMaxLength` 25M, tăng lên >= 512M trong clamd.conf nếu cần quét tệp TV lớn (quá giới hạn clamd trả ERROR => `unscanned`, không phải clean). Chạy `pnpm install` lại ở gốc để cập nhật `pnpm-lock.yaml` cho package mới.

## Settlement
Đặc tả §14 #9 chỉ liệt kê `settlement` ("Đối soát, VCR, thưởng, hóa đơn, chi trả, công nợ", DAC-TA dòng ~382) và ARCHITECTURE nói "đối soát impression với sổ cái"; không có quy tắc tính (kỳ, công thức VCR/thưởng, chia doanh thu đối tác). Không tạo khung job; cần p0-domain/a2 định nghĩa quy tắc trước.
