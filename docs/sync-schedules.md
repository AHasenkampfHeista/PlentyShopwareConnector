# Sync Schedule Management

This guide explains how to manage automated sync schedules for your PlentyShopware connector.

## Overview

The connector supports automated syncing on configurable schedules using cron expressions. Each tenant can have multiple sync schedules for different sync types.

## Quick Start

### 1. Setup Default Schedules

Create all default sync schedules for a tenant:

```bash
npm run manage-schedules setup <tenant-id>
```

This creates the following default schedules:

| Sync Type | Frequency | Cron Expression | Description |
|-----------|-----------|-----------------|-------------|
| CONFIG | Daily at 2:00 AM | `0 2 * * *` | Syncs categories, attributes, prices, manufacturers, units |
| PRODUCT_DELTA | Every 30 minutes | `*/30 * * * *` | Syncs only updated products since last sync |
| STOCK | Every 15 minutes | `*/15 * * * *` | Syncs stock levels from all warehouses |
| FULL_PRODUCT | Weekly (Sunday 3:00 AM) | `0 3 * * 0` | Full product catalog sync |

### OR Create Individual Schedules

If you only want specific sync types, create them individually:

```bash
# Create only stock sync with default schedule (every 15 minutes)
npm run manage-schedules create-stock <tenant-id>

# Create stock sync with custom schedule (every 5 minutes)
npm run manage-schedules create-stock <tenant-id> "*/5 * * * *"

# Create config sync (daily at 2 AM)
npm run manage-schedules create-config <tenant-id>

# Create product delta sync (every 30 minutes)
npm run manage-schedules create-delta <tenant-id>

# Create full product sync (weekly on Sunday)
npm run manage-schedules create-full <tenant-id>
```

This gives you fine-grained control over which syncs to enable.

### 2. List Schedules

View all sync schedules for a tenant:

```bash
npm run manage-schedules list <tenant-id>
```

Example output:
```
📋 Sync schedules for tenant: My Store
   Tenant ID: 00000000-0000-0000-0000-000000000001

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ID                                    Type             Cron             Status    Priority  Next Run
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
abc123...                             CONFIG           0 2 * * *        ✅ Enabled 100       2025-12-06T02:00:00.000Z
def456...                             PRODUCT_DELTA    */30 * * * *     ✅ Enabled 50        2025-12-05T15:30:00.000Z
ghi789...                             STOCK            */15 * * * *     ✅ Enabled 80        2025-12-05T15:15:00.000Z
jkl012...                             FULL_PRODUCT     0 3 * * 0        ✅ Enabled 30        2025-12-08T03:00:00.000Z
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
```

## Commands

### Create Individual Sync Schedules

Instead of setting up all syncs at once, you can create specific sync types:

#### Create Stock Sync

```bash
# With default schedule (every 15 minutes)
npm run manage-schedules create-stock <tenant-id>

# With custom schedule (every 5 minutes)
npm run manage-schedules create-stock <tenant-id> "*/5 * * * *"
```

#### Create Config Sync

```bash
# With default schedule (daily at 2 AM)
npm run manage-schedules create-config <tenant-id>

# With custom schedule (twice daily at 2 AM and 2 PM)
npm run manage-schedules create-config <tenant-id> "0 2,14 * * *"
```

#### Create Product Delta Sync

```bash
# With default schedule (every 30 minutes)
npm run manage-schedules create-delta <tenant-id>

# With custom schedule (hourly)
npm run manage-schedules create-delta <tenant-id> "0 * * * *"
```

#### Create Full Product Sync

```bash
# With default schedule (weekly on Sunday at 3 AM)
npm run manage-schedules create-full <tenant-id>

# With custom schedule (daily at 4 AM)
npm run manage-schedules create-full <tenant-id> "0 4 * * *"
```

**Note:** If a schedule already exists for the same sync type, it will be updated with the new cron expression.

### Enable a Schedule

Enable a previously disabled schedule:

```bash
npm run manage-schedules enable <schedule-id>
```

### Disable a Schedule

Temporarily disable a schedule without deleting it:

```bash
npm run manage-schedules disable <schedule-id>
```

### Update Schedule Frequency

Change the cron expression for a schedule:

```bash
npm run manage-schedules update <schedule-id> "<cron-expression>"
```

**Examples:**

```bash
# Run stock sync every 5 minutes instead of 15
npm run manage-schedules update abc123 "*/5 * * * *"

# Run product delta sync hourly at minute 0
npm run manage-schedules update def456 "0 * * * *"

# Run full product sync daily at 4:00 AM
npm run manage-schedules update ghi789 "0 4 * * *"
```

### Delete a Schedule

Permanently delete a schedule:

```bash
npm run manage-schedules delete <schedule-id>
```

## Cron Expression Format

Cron expressions consist of 5 fields:

```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, Sunday=0 or 7)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

### Common Examples

| Pattern | Description |
|---------|-------------|
| `*/5 * * * *` | Every 5 minutes |
| `*/15 * * * *` | Every 15 minutes |
| `*/30 * * * *` | Every 30 minutes |
| `0 * * * *` | Every hour (at minute 0) |
| `0 */2 * * *` | Every 2 hours |
| `0 0 * * *` | Daily at midnight |
| `0 2 * * *` | Daily at 2:00 AM |
| `0 9,17 * * *` | Twice daily at 9:00 AM and 5:00 PM |
| `0 9-17 * * *` | Every hour from 9:00 AM to 5:00 PM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 3 * * 0` | Sundays at 3:00 AM |
| `0 0 1 * *` | Monthly on the 1st at midnight |

## Sync Types

### CONFIG
Syncs reference data from Plenty:
- Categories
- Attributes
- Sales Prices
- Manufacturers
- Units

**Recommendation:** Run daily or when you make changes to your Plenty configuration.

### FULL_PRODUCT
Fetches ALL products/variations from Plenty and syncs to Shopware.

**Recommendation:** Run weekly or after major catalog changes.

**Note:** This can be slow for large catalogs (thousands of products).

### PRODUCT_DELTA
Syncs only products that have been updated since the last sync.

**Recommendation:** Run frequently (every 15-30 minutes) to keep product data current.

**Note:** Uses the `updatedAt` timestamp from Plenty.

### STOCK
Syncs stock levels from all Plenty warehouses to Shopware.

**Recommendation:** Run frequently (every 5-15 minutes) to keep stock accurate.

**Note:** Always fetches full stock data (no delta support from Plenty API).

## Priority System

Schedules have a priority value that affects job processing order:

| Priority | When Used |
|----------|-----------|
| 100 | CONFIG - Must run before product syncs |
| 80 | STOCK - Important for real-time accuracy |
| 50 | PRODUCT_DELTA - Regular product updates |
| 30 | FULL_PRODUCT - Background bulk operations |

Higher priority jobs are processed first when multiple jobs are queued.

## Best Practices

### 1. Start with Defaults
Use the default schedules as a starting point and adjust based on your needs.

### 2. Monitor Performance
- Check sync job logs to see how long syncs take
- Adjust frequency if syncs are overlapping or taking too long

### 3. Sync Order Matters
- CONFIG should run before PRODUCT syncs (daily is fine)
- PRODUCT_DELTA should run more frequently than FULL_PRODUCT
- STOCK can run independently and frequently

### 4. Consider Your Catalog Size
- **Small catalog (< 1000 products):** You can run syncs more frequently
- **Medium catalog (1000-10000 products):** Use recommended frequencies
- **Large catalog (> 10000 products):** Reduce FULL_PRODUCT frequency, increase PRODUCT_DELTA frequency

### 5. Business Hours
Consider running intensive syncs (FULL_PRODUCT) during off-hours:
```bash
# Run full sync at 3:00 AM
npm run manage-schedules update <schedule-id> "0 3 * * *"
```

### 6. High-Traffic Periods
For stock-sensitive businesses, increase STOCK sync frequency during peak hours:
```bash
# Every 5 minutes during business hours (9 AM - 6 PM, weekdays)
0 9-18 * * 1-5 */5

# Or simply every 5 minutes all the time
*/5 * * * *
```

## Troubleshooting

### Schedules Not Running

1. Check if the scheduler service is running:
   ```bash
   npm run dev:scheduler
   ```

2. Check if the schedule is enabled:
   ```bash
   npm run manage-schedules list <tenant-id>
   ```

3. Check scheduler logs for errors

### Jobs Queuing But Not Processing

1. Check if the worker service is running:
   ```bash
   npm run dev:worker
   ```

2. Check Redis connection

3. Check worker logs for errors

### Overlapping Syncs

If syncs are taking longer than the schedule interval:

1. Increase the interval between syncs
2. Check for performance issues in logs
3. Consider scaling workers (increase `WORKER_CONCURRENCY`)

### Invalid Cron Expression

If you get an error when setting a cron schedule:

1. Validate your expression at [crontab.guru](https://crontab.guru/)
2. Ensure you're using the 5-field format (minute, hour, day, month, weekday)
3. Quote the expression in the command: `"*/5 * * * *"`

## Manual Sync Triggers

You can also trigger syncs manually without schedules:

```bash
# Trigger config sync
npm run trigger-config-sync <tenant-id>

# Trigger full product sync
npm run trigger-full-sync <tenant-id>

# Trigger product delta sync
npm run trigger-delta-sync <tenant-id>
```

These bypass the scheduler and add jobs directly to the queue.

## Database Access

Schedules are stored in the `sync_schedules` table. You can query them directly:

```sql
-- View all schedules
SELECT * FROM sync_schedules WHERE tenant_id = '<your-tenant-id>';

-- View upcoming scheduled syncs
SELECT sync_type, cron_schedule, next_run_at, enabled
FROM sync_schedules
WHERE tenant_id = '<your-tenant-id>'
ORDER BY next_run_at;

-- View recent sync jobs
SELECT sync_type, status, items_processed, completed_at
FROM sync_jobs
WHERE tenant_id = '<your-tenant-id>'
ORDER BY completed_at DESC
LIMIT 10;
```

## Advanced Usage

### Custom Schedules

You can create custom schedules by modifying the script or adding schedules directly to the database with specific requirements:

```sql
INSERT INTO sync_schedules (
  id, tenant_id, sync_type, cron_schedule, direction, priority, enabled, next_run_at
) VALUES (
  gen_random_uuid(),
  '<tenant-id>',
  'STOCK',
  '*/5 * * * *',
  'PLENTY_TO_SHOPWARE',
  90,
  true,
  NOW() + INTERVAL '5 minutes'
);
```

### Multiple Schedules

You can have multiple schedules for the same sync type with different directions:
- `PLENTY_TO_SHOPWARE`: Sync from Plenty to Shopware
- `SHOPWARE_TO_PLENTY`: Sync from Shopware to Plenty (future)
- `BI_DIRECTIONAL`: Sync both ways (future)

Currently, only `PLENTY_TO_SHOPWARE` is implemented.
