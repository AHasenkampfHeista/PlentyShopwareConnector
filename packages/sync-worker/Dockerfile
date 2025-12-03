FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/sync-worker/package*.json ./packages/sync-worker/
COPY packages/shared/package*.json ./packages/shared/

# Install dependencies
RUN npm ci --workspace=packages/sync-worker --workspace=packages/shared

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/sync-worker ./packages/sync-worker
COPY tsconfig.json ./

# Generate Prisma client
RUN cd packages/shared && npx prisma generate

# Build packages
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/sync-worker

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/sync-worker/package*.json ./packages/sync-worker/
COPY packages/shared/package*.json ./packages/shared/

# Install production dependencies only
RUN npm ci --workspace=packages/sync-worker --workspace=packages/shared --omit=dev

# Copy built files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/sync-worker/dist ./packages/sync-worker/dist
COPY --from=builder /app/packages/shared/prisma ./packages/shared/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Health check script
COPY packages/sync-worker/healthcheck.js ./

# Set environment
ENV NODE_ENV=production

# Run worker
CMD ["node", "packages/sync-worker/dist/index.js"]
