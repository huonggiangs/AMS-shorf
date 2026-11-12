# syntax=docker/dockerfile:1.7
# @ams/payments - image nhiều tầng: build (pnpm) -> deploy (chỉ phụ thuộc prod) -> runtime (node:22-alpine, user node).
# Build từ GỐC repo:  docker build -f services/payments/Dockerfile .
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
    pnpm install --offline --frozen-lockfile --filter "@ams/payments..."
RUN pnpm --filter "@ams/payments..." build
# pnpm 10: deploy kiểu cũ (không cần inject-workspace-packages)
ENV npm_config_force_legacy_deploy=true
RUN pnpm --filter "@ams/payments" deploy --prod /out/app \
 && node -e "const p=require('/out/app/package.json'); if(!p.scripts||!p.scripts.start){console.error('Thiếu script start trong @ams/payments');process.exit(1)}"

# ---- runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=8790
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=build --chown=node:node /out/app/ ./
USER node
EXPOSE 8790
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--run", "start"]
