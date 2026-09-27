# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder
WORKDIR /workspace
# Manifests first: `npm ci` layers stay cached unless deps change.
# (Previously `COPY shared ./shared` / `COPY hq-dashboard ./hq-dashboard` ran
# before install, so any src edit reinstalled the three.js/Next trees.)
COPY shared/package.json shared/package-lock.json ./shared/
RUN --mount=type=cache,target=/root/.npm cd shared && npm ci --no-audit --no-fund
COPY shared/src ./shared/src
COPY shared/tsconfig.json ./shared/
RUN cd shared && npx tsc
COPY hq-dashboard/package.json hq-dashboard/package-lock.json ./hq-dashboard/
WORKDIR /workspace/hq-dashboard
ARG NEXT_PUBLIC_HQ_URL=http://localhost:8000
ENV NEXT_PUBLIC_HQ_URL=$NEXT_PUBLIC_HQ_URL
# Disable Next telemetry phone-home during build (stalls/hangs on restricted networks)
ENV NEXT_TELEMETRY_DISABLED=1
# npm ci requires hq-dashboard/package-lock.json (committed) — strict, no
# fallback, so builds are hermetic and never silently resolve new trees.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY hq-dashboard/app ./app
COPY hq-dashboard/components ./components
COPY hq-dashboard/lib ./lib
COPY hq-dashboard/next.config.mjs hq-dashboard/next-env.d.ts hq-dashboard/postcss.config.mjs hq-dashboard/tailwind.config.ts hq-dashboard/tsconfig.json ./
RUN mkdir -p ./public && npm run build
# Prune build-time-only deps (typescript/tailwind/postcss/@types): `npm start`
# runs `next start`, which needs prod deps only. (No standalone output — plain
# `next start` against the pruned tree.)
RUN npm prune --omit=dev --no-audit --no-fund && npm --prefix ../shared prune --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /workspace
ENV NODE_ENV=production
RUN apk add --no-cache wget curl
RUN addgroup -g 10001 -S appgroup && adduser -u 10001 -S appuser -G appgroup
# --chown on copy instead of `chown -R` (rewriting every file is slow).
COPY --chown=appuser:appgroup --from=builder /workspace/shared ./shared
COPY --chown=appuser:appgroup --from=builder /workspace/hq-dashboard ./hq-dashboard
WORKDIR /workspace/hq-dashboard
EXPOSE 3001
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD wget -qO- http://localhost:3001/api/health || wget -qO- http://localhost:3001 || exit 1
CMD ["npm", "start"]
