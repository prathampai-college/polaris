FROM node:20-alpine AS builder
WORKDIR /workspace
COPY shared ./shared
RUN cd shared && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund) && npx tsc
COPY field ./field
WORKDIR /workspace/field
ARG NEXT_PUBLIC_HQ_URL=http://localhost:8000
ARG NEXT_PUBLIC_GATEWAY_URL=ws://localhost:8787
ENV NEXT_PUBLIC_HQ_URL=$NEXT_PUBLIC_HQ_URL
ENV NEXT_PUBLIC_GATEWAY_URL=$NEXT_PUBLIC_GATEWAY_URL
# Disable Next telemetry phone-home during build (stalls/hangs on restricted networks)
ENV NEXT_TELEMETRY_DISABLED=1
# --no-audit --no-fund skips slow registry metadata; keep output visible (no --silent)
# so the build never looks hung. npm ci requires field/package-lock.json (committed).
RUN (npm ci --no-audit --no-fund || npm install --no-audit --no-fund) && npm run build

FROM node:20-alpine
WORKDIR /workspace
ENV NODE_ENV=production
RUN apk add --no-cache wget curl
COPY --from=builder /workspace/shared ./shared
COPY --from=builder /workspace/field ./field
WORKDIR /workspace/field
EXPOSE 3000
RUN addgroup -g 10001 -S appgroup && adduser -u 10001 -S appuser -G appgroup && chown -R appuser:appgroup /workspace
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD wget -qO- http://localhost:3000/api/health || wget -qO- http://localhost:3000 || exit 1
CMD ["npm", "start"]

