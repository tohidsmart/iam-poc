# syntax=docker/dockerfile:1

# Pinned by digest so a rebuild cannot silently pick up a different base.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

# --- build: compile TypeScript with dev dependencies ---
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- deps: production dependencies only ---
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- runtime: no compiler, no dev dependencies, no package manager use ---
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Files stay root-owned and the process runs as `node` (uid 1000), so a
# compromised process cannot rewrite its own code.
USER node
EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Exec form with node as PID 1: SIGTERM reaches the app directly (no npm or
# shell in between), and main.ts handles it for a graceful shutdown.
CMD ["node", "dist/main.js"]
