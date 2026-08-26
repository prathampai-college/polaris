FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY package.json tsconfig.json ./
RUN npm ci --silent || npm install --silent
COPY src ./src
RUN npx tsc
EXPOSE 8787
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://localhost:8787 || exit 1
CMD ["node","dist/gateway.js"]
