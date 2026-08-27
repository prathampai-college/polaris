FROM node:20-alpine
WORKDIR /workspace
RUN apk add --no-cache curl
COPY shared ./shared
RUN cd shared && npm ci --silent || npm install --silent && npx tsc
COPY sync-gateway ./sync-gateway
WORKDIR /workspace/sync-gateway
RUN npm ci --silent || npm install --silent && npx tsc
EXPOSE 8787
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /workspace/sync-gateway
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://localhost:8787 || exit 1
CMD ["node","dist/gateway.js"]
