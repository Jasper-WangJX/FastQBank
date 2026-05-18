# Frontend image (multi-stage). Stage 1 builds the Vite SPA with the
# production API base baked in; stage 2 is Caddy serving those static
# files + the reverse proxy to the backend. Building in Docker means the
# VPS only needs Docker — no Node, no manual `scp` of `dist`.
#
# Build context is the repo root (so it can see apps/web AND the
# Caddyfile). Configured in docker-compose.prod.yml.

# Node 22: pnpm 11 requires Node >= 22.13 (it imports node:sqlite).
FROM node:22-bookworm-slim AS build
WORKDIR /web
# Pin pnpm to the version that generated pnpm-lock.yaml so
# --frozen-lockfile is deterministic.
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
# Install deps first for layer caching. pnpm-workspace.yaml carries the
# `allowBuilds` approval (pnpm 10+ blocks dependency build scripts like
# esbuild's by default and exits non-zero in CI without it) — it MUST be
# copied here or `pnpm install --frozen-lockfile` fails with
# ERR_PNPM_IGNORED_BUILDS.
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/web/ ./
# config.ts reads import.meta.env.VITE_API_BASE_URL at build time.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm build

FROM caddy:2
# Caddyfile is baked in (not volume-mounted) so the image is reproducible.
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /web/dist /srv/web
