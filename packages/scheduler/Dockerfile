FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/scheduler/package*.json ./packages/scheduler/
COPY packages/shared/package*.json ./packages/shared/

# Install dependencies
RUN npm ci --workspace=packages/scheduler --workspace=packages/shared

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/scheduler ./packages/scheduler
COPY tsconfig.json ./

# Generate Prisma client
RUN cd packages/shared && npx prisma generate

# Build packages
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/scheduler

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/scheduler/package*.json ./packages/scheduler/
COPY packages/shared/package*.json ./packages/shared/

# Install production dependencies only
RUN npm ci --workspace=packages/scheduler --workspace=packages/shared --omit=dev

# Copy built files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/scheduler/dist ./packages/scheduler/dist
COPY --from=builder /app/packages/shared/prisma ./packages/shared/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Health check script
COPY packages/scheduler/healthcheck.js ./

# Set environment
ENV NODE_ENV=production

# Run scheduler
CMD ["node", "packages/scheduler/dist/index.js"]
