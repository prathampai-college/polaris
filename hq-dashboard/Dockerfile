FROM node:20-alpine AS builder
WORKDIR /workspace
COPY hq-dashboard ./hq-dashboard
WORKDIR /workspace/hq-dashboard
RUN mkdir -p ./public && (npm ci --silent || npm install --silent) && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget curl
COPY --from=builder /workspace/hq-dashboard/package.json ./package.json
COPY --from=builder /workspace/hq-dashboard/.next ./.next
COPY --from=builder /workspace/hq-dashboard/next.config.mjs ./next.config.mjs
COPY --from=builder /workspace/hq-dashboard/node_modules ./node_modules
COPY --from=builder /workspace/hq-dashboard/public ./public
EXPOSE 3001
RUN addgroup -g 10001 -S appgroup && adduser -u 10001 -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD wget -qO- http://localhost:3001/api/health || wget -qO- http://localhost:3001 || exit 1
CMD ["npm", "start"]

