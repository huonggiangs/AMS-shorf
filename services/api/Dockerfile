# syntax=docker/dockerfile:1.7
# @ams/api - image nhiều tầng: build (pnpm) -> deploy (chỉ phụ thuộc prod) -> runtime (node:22-alpine, user node).
# Build từ GỐC repo:  docker build -f services/api/Dockerfile .
# Yêu cầu với package: script `build` và `start` (xem ops/agents/f2-infra.requests.md).
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable \
 && mkdir -p /repo /pnpm /out \
 && chown -R node:node /repo /pnpm /out
WORKDIR /repo

# ---- build: cài phụ thuộc (có cache store pnpm), biên dịch, gói gọn bằng pnpm deploy
FROM base AS build
USER node
COPY --chown=node:node pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm fetch
COPY --chown=node:node . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --offline --frozen-lockfile --filter "@ams/api..."
RUN pnpm --filter "@ams/api..." build
# pnpm 10: deploy kiểu cũ (không cần inject-workspace-packages)
ENV npm_config_force_legacy_deploy=true
RUN pnpm --filter "@ams/api" deploy --prod /out/app \
 && node -e "const p=require('/out/app/package.json'); if(!p.scripts||!p.scripts.start){console.error('Thiếu script start trong @ams/api');process.exit(1)}"

# ---- migrate: container một lần (migration + seed). Giữ nguyên workspace đầy đủ + devDependencies.
FROM build AS migrate
ENV NODE_ENV=production HOME=/home/node
USER node
WORKDIR /repo
# migrate luôn chạy; seed bỏ qua khi SEED=0
CMD ["sh", "-c", "pnpm --filter @ams/api migrate && if [ \"${SEED:-1}\" = \"1\" ]; then pnpm --filter @ams/api seed; else echo 'SEED=0: bỏ qua seed'; fi"]

# ---- runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=8787
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=build --chown=node:node /out/app/ ./
USER node
EXPOSE 8787
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--run", "start"]
