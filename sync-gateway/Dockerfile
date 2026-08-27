FROM node:20-alpine AS builder
WORKDIR /workspace
COPY shared ./shared
RUN cd shared && (npm ci --silent || npm install --silent) && npx tsc
COPY sync-gateway ./sync-gateway
WORKDIR /workspace/sync-gateway
RUN (npm ci --silent || npm install --silent) && npx tsc

FROM node:20-alpine
WORKDIR /workspace
ENV NODE_ENV=production
RUN apk add --no-cache curl
COPY --from=builder /workspace/shared/dist ./shared/dist
COPY --from=builder /workspace/shared/package.json ./shared/package.json
COPY --from=builder /workspace/shared/node_modules ./shared/node_modules
COPY --from=builder /workspace/sync-gateway/dist ./sync-gateway/dist
COPY --from=builder /workspace/sync-gateway/package.json ./sync-gateway/package.json
COPY --from=builder /workspace/sync-gateway/node_modules ./sync-gateway/node_modules
WORKDIR /workspace/sync-gateway
EXPOSE 8787
RUN addgroup -g 10001 -S appgroup && adduser -u 10001 -S appuser -G appgroup && chown -R appuser:appgroup /workspace
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 CMD curl -f http://localhost:8787/health || node -e "const s=require('net').createConnection({port:8787,host:'127.0.0.1'},()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000)"
CMD ["node", "dist/gateway.js"]

