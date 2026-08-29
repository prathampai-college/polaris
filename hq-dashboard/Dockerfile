FROM node:20-alpine AS builder
WORKDIR /workspace
COPY shared ./shared
RUN cd shared && (npm ci --silent || npm install --silent) && npx tsc
COPY hq-dashboard ./hq-dashboard
WORKDIR /workspace/hq-dashboard
RUN mkdir -p ./public && (npm ci --silent || npm install --silent) && npm run build

FROM node:20-alpine
WORKDIR /workspace
ENV NODE_ENV=production
RUN apk add --no-cache wget curl
COPY --from=builder /workspace/shared ./shared
COPY --from=builder /workspace/hq-dashboard ./hq-dashboard
WORKDIR /workspace/hq-dashboard
EXPOSE 3001
RUN addgroup -g 10001 -S appgroup && adduser -u 10001 -S appuser -G appgroup && chown -R appuser:appgroup /workspace
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD wget -qO- http://localhost:3001/api/health || wget -qO- http://localhost:3001 || exit 1
CMD ["npm", "start"]

