# syntax=docker/dockerfile:1.7
# @ams/web-admin - build tĩnh bằng Node 22, phục vụ bằng nginx (không root, cổng 8080).
# Build từ GỐC repo:  docker build -f apps/web-admin/Dockerfile .
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable \
 && corepack prepare pnpm@10.28.0 --activate \
 && mkdir -p /repo /pnpm \
 && chown -R node:node /repo /pnpm
WORKDIR /repo

FROM base AS build
USER node
# Web gọi API qua đường dẫn cùng origin /api (nginx/Caddy/Cloudflare chuyển tiếp). Có thể ghi đè khi build.
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
COPY --chown=node:node pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm fetch
COPY --chown=node:node . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --offline --frozen-lockfile --filter "@ams/web-admin..." --filter ams
RUN pnpm --filter "@ams/web-admin..." build \
 && test -f apps/web-admin/dist/index.html

FROM ${NGINX_IMAGE} AS runtime
# Mẫu cấu hình: entrypoint của image thay biến ${API_UPSTREAM} rồi ghi vào /etc/nginx/conf.d
COPY --chown=101:101 apps/web-admin/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=101:101 /repo/apps/web-admin/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://api:8787 \
    NGINX_ENVSUBST_FILTER=API_UPSTREAM
EXPOSE 8080
USER 101
