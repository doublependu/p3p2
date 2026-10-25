# The p3p2 server, published on Docker Hub as p3p2/p3p2, for amd64 and arm64.
#
# Run (plain http, for a LAN; docker-compose.yml next to this file adds Caddy and HTTPS):
#   docker run -d --name p3p2 -p 8080:8080 -v p3p2-data:/data \
#     -e P3P2_PUBLIC_URL=http://<this machine's address>:8080 p3p2/p3p2:0.2
#   docker logs p3p2        # prints the one-time setup link
#
# Build from the repository root:
#   docker build -f deploy/Dockerfile -t p3p2/p3p2:checkout .
#
# Both stages start from one build of Node 24 on Alpine, pinned by its digest. To move to a newer one, take the
# version and the "Digest:" line of `docker buildx imagetools inspect node:24-alpine`, and change both lines.

# The server's dependencies are plain JavaScript (SQLite is node:sqlite), the same on every machine. They are
# installed once, on the machine that builds, and copied into the image for each machine: npm never runs under
# emulation.
FROM --platform=$BUILDPLATFORM node:26.12.1-alpine3.24@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY protocol/package.json protocol/
COPY server/package.json server/
COPY client/package.json client/
COPY e2e/package.json e2e/
COPY bench/package.json bench/
RUN npm ci --omit=dev --workspace @p3p2/server --include-workspace-root=false

FROM node:26.12.1-alpine3.24@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
# Set by the workflows: the release, and the commit it was built from.
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="p3p2" \
      org.opencontainers.image.description="Multiplayer for static web games, through a small server of your own" \
      org.opencontainers.image.url="https://github.com/doublependu/p3p2" \
      org.opencontainers.image.source="https://github.com/doublependu/p3p2" \
      org.opencontainers.image.documentation="https://github.com/doublependu/p3p2/blob/main/docs/self-host.md" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
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
