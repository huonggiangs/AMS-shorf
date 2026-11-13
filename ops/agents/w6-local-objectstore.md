# w6-local-objectstore (bo MinIO, kho tep fs)

Ly do: anh MinIO khong con keo duoc (Docker Hub go, quay.io can dang nhap) => `docker compose up` hong.

Da lam
- packages/runtime/src/fs.ts: `FsObjectStore` (put/get/head/delete/list, khoa an toan chong traversal/symlink, ghi nguyen tu tmp+rename, content-type sidecar `.meta/<key>.json` + du phong theo duoi tep, URL ky HMAC putSigned/getSigned + verifySigned). `ObjectStore` them `delete?`/`list?` (fs + Memory) va tham so `putSigned(..., {maxBytes})`. S3/R2 giu nguyen. Chon bang `OBJECT_STORE=fs` + `OBJECT_STORE_DIR` trong createDockerRuntime (mac dinh `s3`).
- services/api/src/routes/storage.ts: `PUT /storage/upload/*`, `GET /storage/object/*` (URL ky HMAC cap sau upload-url da xac thuc; gioi han loai/kich thuoc theo chu ky + OBJECT_STORE_MAX_UPLOAD_MB; chi khoa `media/`). bodyLimit 2MB bo qua duong dan nay. web-admin KHONG phai doi: upload-url van tra {url,method,headers}, url tuong doi `/api/storage/upload/...`.
- nginx web-admin: location /api/storage/upload/ body 600m, khong dem.
- Caddy: `media.ams.localhost` (HTTPS) + `http://:9000` (TV) phat tinh chi-doc `/media-public/<prefix>/*` cho MEDIA_PUBLIC_PREFIXES (mac dinh renditions; `media` bi tu choi o entrypoint proxy). `/media-public/healthz`. URL TV = PUBLIC_MEDIA_BASE_URL (gateway doc truoc MEDIA_PUBLIC_URL cu).
- compose: bo minio, minio-init, miniodata, G_MINIO_*; them volume `mediadata` (api, media-worker rw; edge-gateway, proxy ro). Dockerfile runtime api/gateway/media-worker tao /data/objects thuoc user node.
- Dockerfile (6 tep): `corepack prepare pnpm@10.28.0 --activate`; pnpm-workspace.yaml them esbuild vao onlyBuiltDependencies.
- .env.example, setup.mjs, Makefile, ams.ps1, CHAY-AMS-LOCAL.bat, docs/ops (RUNBOOK, DR: sao luu volume bang tar, PENTEST), PLAN, ARCHITECTURE, deployment.mmd.
- Test: packages/runtime/test/objectstore.contract.test.ts (cung bo test cho Memory + Fs, 32 ca), services/api/test/storage-fs.test.ts (upload-url -> PUT -> confirm -> preview, tu choi sai ct/qua size/chu ky/het han/khoa ngoai media/).

Kiem tra: pnpm typecheck OK; vitest runtime/api/media-worker/edge-gateway OK; e2e:smoke 35/35; e2e:ui 11/11 (con dung fake S3 => van phu S3 adapter); `docker compose config -q` OK (khong co daemon).
Chua kiem: Caddyfile chay that (khong co caddy/daemon; binary tai ve bi chan chay), build image that, Range request cho preview video qua API.
Luu y: khoa fs `x` va `x/y` xung dot nhu thu muc; .env cu co MINIO_* van vo hai. DAC-TA-GIAO-VIEC-AGENT.md (dac ta) khong sua.
