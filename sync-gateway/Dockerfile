# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder
WORKDIR /workspace
# Manifests first: `npm ci` layers stay cached unless deps change.
# (Previously `COPY shared ./shared` ran before install, so any src edit
# reinstalled everything.)
COPY shared/package.json shared/package-lock.json ./shared/
RUN --mount=type=cache,target=/root/.npm cd shared && npm ci --no-audit --no-fund
COPY shared/src ./shared/src
COPY shared/tsconfig.json ./shared/
RUN cd shared && npx tsc
COPY sync-gateway/package.json sync-gateway/package-lock.json ./sync-gateway/
WORKDIR /workspace/sync-gateway
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY sync-gateway/src ./src
COPY sync-gateway/test ./test
COPY sync-gateway/tsconfig.json ./
RUN npx tsc && npm prune --omit=dev --no-audit --no-fund && npm --prefix ../shared prune --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /workspace
ENV NODE_ENV=production
RUN apk add --no-cache curl
RUN addgroup -g 10001 -S appgroup && adduser -u 10001 -S appuser -G appgroup
# --chown on copy instead of `chown -R` (rewriting every file is slow).
# node_modules are pruned to prod-only in the builder (tsx/typescript/@types
# are build-time only; runtime is `node dist/gateway.js`).
COPY --chown=appuser:appgroup --from=builder /workspace/shared/dist ./shared/dist
COPY --chown=appuser:appgroup --from=builder /workspace/shared/package.json ./shared/package.json
COPY --chown=appuser:appgroup --from=builder /workspace/shared/node_modules ./shared/node_modules
COPY --chown=appuser:appgroup --from=builder /workspace/sync-gateway/dist ./sync-gateway/dist
COPY --chown=appuser:appgroup --from=builder /workspace/sync-gateway/package.json ./sync-gateway/package.json
COPY --chown=appuser:appgroup --from=builder /workspace/sync-gateway/node_modules ./sync-gateway/node_modules
WORKDIR /workspace/sync-gateway
EXPOSE 8787
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 CMD curl -f http://localhost:8787/health || node -e "const s=require('net').createConnection({port:8787,host:'127.0.0.1'},()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000)"
CMD ["node", "dist/gateway.js"]
