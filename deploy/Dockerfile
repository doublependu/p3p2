# Build from the repository root:
#   docker build -f deploy/Dockerfile -t p3p2/p3p2 .
# Run (plain http, for a LAN; docker-compose.yml next to this file adds Caddy and HTTPS):
#   docker run -d --name p3p2 -p 8080:8080 -v p3p2-data:/data \
#     -e P3P2_PUBLIC_URL=http://<this machine's address>:8080 p3p2/p3p2
#   docker logs p3p2        # prints the one-time setup link

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY protocol/package.json protocol/
COPY server/package.json server/
COPY client/package.json client/
COPY e2e/package.json e2e/
COPY bench/package.json bench/
RUN npm ci --omit=dev --workspace @p3p2/server --include-workspace-root=false

FROM node:24-alpine
ENV NODE_ENV=production \
    P3P2_DATA_DIR=/data \
    P3P2_PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json LICENSE ./
COPY protocol protocol
COPY server/package.json server/
COPY server/src server/src
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
# Node runs the TypeScript sources directly (type stripping), exactly as in development.
CMD ["node", "server/src/main.ts"]
