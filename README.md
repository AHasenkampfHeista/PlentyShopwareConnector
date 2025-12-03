# Plentymarkets to Shopware Connector

A production-ready data synchronization system that connects Plentymarkets with Shopware, enabling automated product, category, and configuration data sync.

## Features

- ✅ **Automated Sync**: Scheduled background jobs for continuous data synchronization
- ✅ **Multi-tenant**: Support for multiple shops with isolated data
- ✅ **Config Caching**: Categories, attributes, sales prices, manufacturers, and units
- ✅ **Product Sync**: Full and delta product synchronization
- ✅ **Mock Mode**: Test without real Shopware instance
- ✅ **Queue System**: Reliable job processing with BullMQ and Redis
- ✅ **Type Safety**: Full TypeScript implementation

## Architecture

```
┌─────────────────┐
│   Scheduler     │  Cron-based job scheduler
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Redis Queue   │  BullMQ job queue
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Sync Worker   │  Process sync jobs
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────────┐
│ Plenty │ │  Shopware  │
│  API   │ │ (or Mock)  │
└────────┘ └────────────┘
         │         │
         └────┬────┘
              ▼
      ┌──────────────┐
      │  PostgreSQL  │
      └──────────────┘
```

## Project Structure

```
├── packages/
│   ├── shared/           # Shared utilities, types, clients
│   │   ├── src/
│   │   │   ├── clients/  # API clients (Plenty, Shopware, Mock)
│   │   │   ├── database/ # Prisma client
│   │   │   ├── queue/    # BullMQ queue service
│   │   │   ├── types/    # TypeScript types
│   │   │   └── utils/    # Encryption, logging
│   │   └── prisma/
│   │       └── schema.prisma
│   ├── scheduler/        # Cron-based job scheduler
│   └── sync-worker/      # Job processor
│       └── src/
│           └── processors/  # Sync logic (CONFIG, PRODUCT_DELTA)
├── scripts/              # Utility scripts
├── docker/              # Docker Compose for PostgreSQL & Redis
└── .env                 # Configuration
```

## Prerequisites

- Node.js 18+
- Docker & Docker Compose
- Plentymarkets account with API access

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Infrastructure

```bash
npm run docker:up
```

This starts:
- PostgreSQL (port 5432)
- Redis (port 6379)

### 3. Configure Environment

Create `.env` file:

```env
# Database
DATABASE_URL="postgresql://connector:connector123@localhost:5432/connector"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Encryption (generate with: openssl rand -base64 32)
ENCRYPTION_KEY=your-32-byte-base64-key

# Scheduler
CRON_CONFIG_SYNC="0 3 * * *"        # Daily at 3 AM
CRON_PRODUCT_SYNC="*/15 * * * *"    # Every 15 minutes

# Logging
LOG_LEVEL=info
```

### 4. Initialize Database

```bash
cd packages/shared
npx prisma db push
npx prisma generate
cd ../..
```

### 5. Seed Test Data

```bash
npm run seed
```

This creates:
- Test tenant
- Sync schedules
- Encrypted credentials

### 6. Update Credentials

Edit `scripts/update-credentials.ts` with your Plenty credentials:

```typescript
const plentyCredentials = {
  username: 'your-plenty-username',
  password: 'your-plenty-password'
};
```

Then run:

```bash
npx tsx scripts/update-credentials.ts
```

### 7. Start Services

```bash
# Terminal 1: Start worker
npm run dev:worker

# Terminal 2: Start scheduler
npm run dev:scheduler
```

## Available Scripts

### Development

```bash
npm run dev:worker          # Start sync worker with hot reload
npm run dev:scheduler       # Start job scheduler with hot reload
npm run docker:up           # Start PostgreSQL & Redis
npm run docker:down         # Stop infrastructure
```

### Database

```bash
cd packages/shared
npx prisma db push          # Apply schema changes
npx prisma generate         # Generate Prisma client
npx prisma studio           # Open database GUI
```

### Manual Sync Triggers

```bash
# Trigger CONFIG sync (categories, attributes, etc.)
npx tsx scripts/trigger-config-sync.ts <tenant-id>

# Trigger PRODUCT_DELTA sync
npx tsx scripts/trigger-product-delta-sync.ts <tenant-id>

# Trigger FULL_PRODUCT sync
npx tsx scripts/trigger-full-sync.ts <tenant-id>
```

Default test tenant ID: `00000000-0000-0000-0000-000000000001`

## Sync Types

### CONFIG Sync
Syncs configuration data from Plentymarkets:
- **Categories**: Product categories with hierarchies
- **Attributes**: Product attributes and values
- **Sales Prices**: Price configurations
- **Manufacturers**: Manufacturer data
- **Units**: Measurement units

Cached in PostgreSQL for fast access during product sync.

### PRODUCT_DELTA Sync
Syncs products that changed since last sync:
- Fetches variations from Plenty API
- Transforms to Shopware format
- Creates/updates in Shopware (or mock DB)
- Tracks sync timestamp for next delta

### FULL_PRODUCT Sync
Complete product catalog sync:
- Fetches all products regardless of change date
- Useful for initial sync or recovery

## Mock Shopware Mode

For testing without a real Shopware instance, products are saved to the `mock_shopware_products` table.

To use real Shopware, replace `MockShopwareClient` with `ShopwareClient` in the worker processor.

## Database Schema

### Key Models

- **Tenant**: Multi-tenant configuration
- **SyncSchedule**: Cron-based sync schedules
- **SyncJob**: Job tracking and status
- **SyncState**: Last sync timestamps per type
- **PlentyCategory**: Cached category data
- **PlentyAttribute**: Cached attribute data
- **PlentySalesPrice**: Cached price configurations
- **PlentyManufacturer**: Cached manufacturer data
- **PlentyUnit**: Cached unit data
- **MockShopwareProduct**: Mock Shopware product storage

## Configuration

### Encryption

Credentials are encrypted in the database using AES-256-GCM. Generate a key:

```bash
openssl rand -base64 32
```

### Sync Schedules

Configure in `.env`:

```env
CRON_CONFIG_SYNC="0 3 * * *"        # Daily at 3 AM
CRON_PRODUCT_SYNC="*/15 * * * *"    # Every 15 minutes
```

Or modify `SyncSchedule` records in the database.

## Monitoring

### View Logs

Worker and scheduler output structured JSON logs:

```bash
# Follow worker logs
npm run dev:worker

# Follow scheduler logs
npm run dev:scheduler
```

### Check Job Status

```bash
cd packages/shared
npx prisma studio
```

Navigate to `SyncJob` table to see job history and status.

### Check Sync Stats

Query the database:

```sql
-- Last sync times
SELECT * FROM "SyncState";

-- Recent jobs
SELECT * FROM "SyncJob" ORDER BY "createdAt" DESC LIMIT 10;

-- Product count
SELECT COUNT(*) FROM "MockShopwareProduct";
```

## Production Deployment

### 1. Build for Production

```bash
npm run build
```

### 2. Set Production Environment

```env
NODE_ENV=production
LOG_LEVEL=warn
```

### 3. Use Process Manager

```bash
# Using PM2
pm2 start packages/scheduler/dist/index.js --name scheduler
pm2 start packages/sync-worker/dist/index.js --name worker

# Using systemd
sudo cp scripts/systemd/* /etc/systemd/system/
sudo systemctl enable connector-worker
sudo systemctl enable connector-scheduler
sudo systemctl start connector-worker
sudo systemctl start connector-scheduler
```

### 4. Setup Real Shopware

Replace mock client with real Shopware client in the worker processor.

## Troubleshooting

### Worker not processing jobs

Check Redis connection:
```bash
docker exec -it redis redis-cli
> PING
PONG
```

### Database connection errors

Verify PostgreSQL is running:
```bash
docker ps | grep postgres
```

### Plenty API authentication fails

1. Check credentials in database (encrypted)
2. Verify Plenty API access in their admin panel
3. Check API rate limits

### No products syncing

1. Trigger manual sync: `npx tsx scripts/trigger-product-delta-sync.ts <tenant-id>`
2. Check worker logs for errors
3. Verify CONFIG sync ran successfully first

## Development

### Adding a New Sync Type

1. Add enum to `prisma/schema.prisma`:
   ```prisma
   enum SyncType {
     // ... existing types
     NEW_TYPE
   }
   ```

2. Create processor in `packages/sync-worker/src/processors/`

3. Register in worker router

4. Create trigger script in `scripts/`

### Running Tests

```bash
npm test
```

## API Documentation

### Plenty API

- Base URL: Configured per tenant
- Auth: Username/password
- Rate Limits: Varies by plan

### Shopware API

- Base URL: Configured per tenant
- Auth: OAuth2 or API credentials
- Rate Limits: Check Shopware documentation

## License

MIT

## Support

For issues or questions, please open an issue on the repository.
