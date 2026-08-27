FROM node:20-alpine AS builder
WORKDIR /workspace
COPY shared ./shared
RUN cd shared && npm ci --silent || npm install --silent && npx tsc
COPY field ./field
WORKDIR /workspace/field
RUN npm ci --silent || npm install --silent && npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY --from=builder /workspace/field/package.json ./package.json
COPY --from=builder /workspace/field/.next ./.next
COPY --from=builder /workspace/field/public ./public
COPY --from=builder /workspace/field/node_modules ./node_modules
COPY --from=builder /workspace/field/next.config.mjs ./next.config.mjs
EXPOSE 3000
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://localhost:3000/api/health || wget -qO- http://localhost:3000 || exit 1
CMD ["npm","start"]
