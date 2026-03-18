# ── Stage 1: Builder ───────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY server/package*.json server/
RUN cd server && npm ci

# Copy source and compile TypeScript
COPY server/tsconfig.json server/
COPY server/src server/src
RUN cd server && npm run build

# ── Stage 2: Production ───────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -S vjj && adduser -S vjj -G vjj

# Copy compiled output from builder
COPY --from=builder /app/server/dist server/dist

# Install production dependencies only
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev

# Copy OPA policy bundles
COPY server/policies server/policies

# Prepare data directory with correct ownership
RUN mkdir -p data && chown vjj:vjj data

USER vjj

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server/dist/index.js"]
