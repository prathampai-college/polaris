FROM node:20-alpine AS builder
WORKDIR /workspace
COPY hq-dashboard ./hq-dashboard
WORKDIR /workspace/hq-dashboard
RUN npm ci --silent || npm install --silent && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /workspace/hq-dashboard/package.json ./package.json
COPY --from=builder /workspace/hq-dashboard/.next ./.next
COPY --from=builder /workspace/hq-dashboard/node_modules ./node_modules
COPY --from=builder /workspace/hq-dashboard/next.config.mjs ./next.config.mjs
COPY --from=builder /workspace/hq-dashboard/public ./public 2>/dev/null || true
EXPOSE 3001
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://localhost:3001 || exit 1
CMD ["npm","start"]
