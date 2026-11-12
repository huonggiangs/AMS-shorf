# syntax=docker/dockerfile:1.7
# @ams/api - image nhiều tầng: build (pnpm install + gói esbuild) -> runtime (node:22-alpine, user node, không root).
# Build từ GỐC repo:  docker build -f services/api/Dockerfile .
#
# Cách đóng gói: package workspace (@ams/*) xuất mã TypeScript nguồn, và Node KHÔNG chạy .ts trong node_modules,
# nên điểm vào src/index.ts được gói (bundle) bằng esbuild thành MỘT tệp index.mjs gồm cả phụ thuộc.
# Image cuối chỉ có Node + tệp đó (không node_modules, không mã nguồn). Điểm vào theo quy ước: src/index.ts,
# lắng nghe cổng $PORT, có GET /health (xem ops/agents/f2-infra.requests.md).
ARG NODE_IMAGE=node:22-alpine
ARG ESBUILD_VERSION=0.25.0

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable \
 && mkdir -p /repo /pnpm /out \
 && chown -R node:node /repo /pnpm /out
WORKDIR /repo

# ---- build: cài phụ thuộc (cache store pnpm), kiểm kiểu, gói thành một tệp
FROM base AS build
ARG ESBUILD_VERSION
USER node
COPY --chown=node:node pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm fetch
COPY --chown=node:node . .
# "--filter ams" = dự án gốc (typescript, tsx, vitest nằm ở devDependencies của gốc)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --offline --frozen-lockfile --filter "@ams/api..." --filter ams
# cổng kiểm kiểu của chính package (script build hiện là tsc --noEmit)
RUN pnpm --filter "@ams/api" run --if-present typecheck
WORKDIR /repo/services/api
RUN pnpm dlx esbuild@${ESBUILD_VERSION} src/index.ts --bundle --platform=node --target=node22 --format=esm \
      --outfile=/out/app/index.mjs --sourcemap --legal-comments=none --log-level=warning \
      --external:pg-native \
      --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
 && test -s /out/app/index.mjs

# ---- migrate: container chạy một lần (migration + seed). Giữ nguyên workspace đầy đủ + devDependencies.
# Cần hai script trong services/api/package.json: "migrate" và "seed" (xem f2-infra.requests.md).
FROM build AS migrate
ENV NODE_ENV=production HOME=/home/node
USER node
WORKDIR /repo
CMD ["sh", "-c", "pnpm --filter @ams/api migrate && if [ \"${SEED:-1}\" = \"1\" ]; then pnpm --filter @ams/api seed; else echo 'SEED=0: bỏ qua seed'; fi"]

# ---- runtime (tầng cuối = mặc định khi `docker build` không có --target)
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=8787 AMS_API_START=1
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=build --chown=node:node /out/app/ ./
USER node
EXPOSE 8787
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "index.mjs"]
