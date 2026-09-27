# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder
WORKDIR /workspace
# Manifests first: `npm ci` layers stay cached unless deps change.
# (Previously `COPY shared ./shared` / `COPY field ./field` ran before
# install, so any src edit reinstalled the three.js/Next trees.)
COPY shared/package.json shared/package-lock.json ./shared/
RUN --mount=type=cache,target=/root/.npm cd shared && npm ci --no-audit --no-fund
COPY shared/src ./shared/src
COPY shared/tsconfig.json ./shared/
RUN cd shared && npx tsc
COPY field/package.json field/package-lock.json ./field/
WORKDIR /workspace/field
# npm ci requires field/package-lock.json (committed) — strict, no fallback,
# so builds are hermetic and never silently resolve new trees.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY field/app ./app
COPY field/components ./components
COPY field/lib ./lib
COPY field/public ./public
COPY field/next.config.mjs field/next-env.d.ts field/postcss.config.mjs field/tailwind.config.ts field/tsconfig.json ./
# No build-time endpoints: tablets read HQ/gateway URLs from /api/config at runtime.
# Disable Next telemetry phone-home during build (stalls/hangs on restricted networks)
ENV NEXT_TELEMETRY_DISABLED=1
# --no-audit --no-fund skips slow registry metadata; keep output visible (no --silent)
# so the build never looks hung.
RUN npm run build
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
COPY --chown=appuser:appgroup --from=builder /workspace/field ./field
WORKDIR /workspace/field
EXPOSE 3000
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD wget -qO- http://localhost:3000/api/health || wget -qO- http://localhost:3000 || exit 1
CMD ["npm", "start"]
