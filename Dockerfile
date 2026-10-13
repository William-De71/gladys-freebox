# -----------------------------------------------------------------------------
# Freebox integration image.
#
# Gladys sandbox constraints ("the sandbox is the defense"):
#   - rootfs mounted READ-ONLY -> never write outside /data
#   - a single writable volume: /data
#   - runs as a non-root user
#   - multi-arch image (linux/amd64 + linux/arm64), see build.yml
#
# ffmpeg is bundled to capture a still image from the Freebox camera streams
# (HLS) when Gladys asks for a fresh camera image. Captures go through a pipe,
# so no temporary file is ever written.
# -----------------------------------------------------------------------------

FROM node:24-alpine

# Version of the release, passed by build.yml (`dev` for a local build).
ARG VERSION=dev

# OCI labels: where the code lives, under which licence, which version.
LABEL org.opencontainers.image.title="Gladys Freebox" \
      org.opencontainers.image.description="Gladys Assistant integration for the Freebox: home automation, players and cameras, on the local network" \
      org.opencontainers.image.source="https://github.com/William-De71/gladys-freebox" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}"

# dumb-init: correct signal handling (SIGTERM) for a graceful shutdown.
# ffmpeg: still-image capture from the Freebox camera streams.
RUN apk add --no-cache dumb-init ffmpeg

WORKDIR /app

# Install the PROD dependencies first (better build cache). `npm ci` only:
# a lockfile out of sync with package.json must fail the build, not be
# silently re-resolved into an untested dependency tree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Then the integration code.
COPY index.js ./
COPY src ./src
COPY gladys-assistant-integration.json ./

# The only writable location allowed at runtime. Docker creates a new volume
# with the owner of the image's /data, so it must belong to `node`, and before
# VOLUME: changes made to /data after it are discarded.
ENV NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# Run as an unprivileged user (already present in the node image).
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
