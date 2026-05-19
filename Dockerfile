FROM node:20-alpine AS builder
WORKDIR /app
# better-sqlite3 ships musl prebuilds for node 20; build tools kept as fallback.
RUN apk add --no-cache python3 make g++
COPY package.json tsconfig.json nest-cli.json ./
RUN npm install --no-fund --no-audit
COPY src ./src
COPY policies ./policies
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/policies ./policies
# Local SQLite file is written here when DB_DRIVER=sqlite.
RUN mkdir -p /app/var
EXPOSE 8082
CMD ["node", "dist/main.js"]
