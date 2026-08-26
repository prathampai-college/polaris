FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json next.config.mjs tailwind.config.ts postcss.config.mjs ./
RUN npm ci --silent || npm install --silent
COPY app ./app
COPY components ./components
RUN npm run build || (echo "build failed" && ls -la)

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/public ./public 2>/dev/null || true
EXPOSE 3001
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://localhost:3001 || exit 1
CMD ["npm","start"]
