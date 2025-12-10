#!/usr/bin/env tsx
/**
 * Manage sync schedules for a tenant
 *
 * Usage:
 *   npm run manage-schedules setup <tenant-id>                      # Setup all default schedules
 *   npm run manage-schedules list <tenant-id>                       # List all schedules
 *   npm run manage-schedules create-stock <tenant-id> [cron]        # Create stock sync only
 *   npm run manage-schedules create-config <tenant-id> [cron]       # Create config sync only
 *   npm run manage-schedules create-delta <tenant-id> [cron]        # Create delta sync only
 *   npm run manage-schedules create-full <tenant-id> [cron]         # Create full sync only
 *   npm run manage-schedules enable <schedule-id>                   # Enable a schedule
 *   npm run manage-schedules disable <schedule-id>                  # Disable a schedule
 *   npm run manage-schedules update <schedule-id> <cron>            # Update cron schedule
 *   npm run manage-schedules delete <schedule-id>                   # Delete a schedule
 */

import 'dotenv/config';
import { PrismaClient, SyncType, SyncDirection } from '@prisma/client';
import parser from 'cron-parser';

const prisma = new PrismaClient();

// Default sync schedules with sensible defaults
const DEFAULT_SCHEDULES = [
  {
    syncType: SyncType.CONFIG,
    cronSchedule: '0 2 * * *', // Daily at 2:00 AM
    direction: SyncDirection.PLENTY_TO_SHOPWARE,
    priority: 100, // Highest priority - needed for product sync
    description: 'Config sync (categories, attributes, prices)',
  },
  {
    syncType: SyncType.PRODUCT_DELTA,
    cronSchedule: '*/30 * * * *', // Every 30 minutes
    direction: SyncDirection.PLENTY_TO_SHOPWARE,
    priority: 50,
    description: 'Product delta sync (updates only)',
  },
  {
    syncType: SyncType.STOCK,
    cronSchedule: '*/15 * * * *', // Every 15 minutes
    direction: SyncDirection.PLENTY_TO_SHOPWARE,
    priority: 80, // High priority - stock should be current
    description: 'Stock sync (all warehouses)',
  },
  {
    syncType: SyncType.FULL_PRODUCT,
    cronSchedule: '0 3 * * 0', // Weekly on Sunday at 3:00 AM
    direction: SyncDirection.PLENTY_TO_SHOPWARE,
    priority: 30,
    description: 'Full product sync (weekly)',
  },
];

/**
 * Setup default sync schedules for a tenant
 */
async function setupDefaultSchedules(tenantId: string): Promise<void> {
  // Verify tenant exists
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  console.log(`\n📋 Setting up sync schedules for tenant: ${tenant.name}`);
  console.log(`   Tenant ID: ${tenantId}\n`);

  for (const schedule of DEFAULT_SCHEDULES) {
    try {
      // Calculate next run time
      const interval = parser.parseExpression(schedule.cronSchedule);
      const nextRunAt = interval.next().toDate();

      const created = await prisma.syncSchedule.upsert({
        where: {
          tenantId_syncType_direction: {
            tenantId,
            syncType: schedule.syncType,
            direction: schedule.direction,
          },
        },
        create: {
          tenantId,
          syncType: schedule.syncType,
          cronSchedule: schedule.cronSchedule,
          direction: schedule.direction,
          priority: schedule.priority,
          enabled: true,
          nextRunAt,
        },
        update: {
          cronSchedule: schedule.cronSchedule,
          priority: schedule.priority,
          nextRunAt,
        },
      });

      console.log(`✅ ${schedule.syncType.padEnd(15)} | ${schedule.cronSchedule.padEnd(15)} | ${schedule.description}`);
      console.log(`   Schedule ID: ${created.id}`);
      console.log(`   Next run: ${nextRunAt.toISOString()}\n`);
    } catch (error) {
      console.error(`❌ Failed to create schedule for ${schedule.syncType}:`, error);
    }
  }

  console.log('✨ Default schedules setup complete!\n');
}

/**
 * List all sync schedules for a tenant
 */
async function listSchedules(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  const schedules = await prisma.syncSchedule.findMany({
    where: { tenantId },
    orderBy: [{ enabled: 'desc' }, { priority: 'desc' }],
  });

  if (schedules.length === 0) {
    console.log(`\n📋 No schedules found for tenant: ${tenant.name}`);
    console.log(`   Run: npm run manage-schedules setup ${tenantId}\n`);
    return;
  }

  console.log(`\n📋 Sync schedules for tenant: ${tenant.name}`);
  console.log(`   Tenant ID: ${tenantId}\n`);
  console.log('─'.repeat(120));
  console.log(
    'ID'.padEnd(38) +
      'Type'.padEnd(17) +
      'Cron'.padEnd(17) +
      'Status'.padEnd(10) +
      'Priority'.padEnd(10) +
      'Next Run'
  );
  console.log('─'.repeat(120));

  for (const schedule of schedules) {
    const status = schedule.enabled ? '✅ Enabled' : '❌ Disabled';
    const nextRun = schedule.nextRunAt
      ? schedule.nextRunAt.toISOString()
      : 'Not scheduled';

    console.log(
      schedule.id.padEnd(38) +
        schedule.syncType.padEnd(17) +
        schedule.cronSchedule.padEnd(17) +
        status.padEnd(10) +
        schedule.priority.toString().padEnd(10) +
        nextRun
    );
  }

  console.log('─'.repeat(120));
  console.log('');
}

/**
 * Enable a sync schedule
 */
async function enableSchedule(scheduleId: string): Promise<void> {
  const schedule = await prisma.syncSchedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule) {
    console.error(`❌ Schedule not found: ${scheduleId}`);
    process.exit(1);
  }

  if (schedule.enabled) {
    console.log(`ℹ️  Schedule is already enabled: ${schedule.syncType}`);
    return;
  }

  // Calculate next run time
  const interval = parser.parseExpression(schedule.cronSchedule);
  const nextRunAt = interval.next().toDate();

  await prisma.syncSchedule.update({
    where: { id: scheduleId },
    data: {
      enabled: true,
      nextRunAt,
    },
  });

  console.log(`✅ Schedule enabled: ${schedule.syncType}`);
  console.log(`   Next run: ${nextRunAt.toISOString()}`);
}

/**
 * Disable a sync schedule
 */
async function disableSchedule(scheduleId: string): Promise<void> {
  const schedule = await prisma.syncSchedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule) {
    console.error(`❌ Schedule not found: ${scheduleId}`);
    process.exit(1);
  }

  if (!schedule.enabled) {
    console.log(`ℹ️  Schedule is already disabled: ${schedule.syncType}`);
    return;
  }

  await prisma.syncSchedule.update({
    where: { id: scheduleId },
    data: {
      enabled: false,
    },
  });

  console.log(`✅ Schedule disabled: ${schedule.syncType}`);
}

/**
 * Update a sync schedule's cron expression
 */
async function updateSchedule(scheduleId: string, cronSchedule: string): Promise<void> {
  const schedule = await prisma.syncSchedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule) {
    console.error(`❌ Schedule not found: ${scheduleId}`);
    process.exit(1);
  }

  // Validate cron expression
  try {
    const interval = parser.parseExpression(cronSchedule);
    const nextRunAt = interval.next().toDate();

    await prisma.syncSchedule.update({
      where: { id: scheduleId },
      data: {
        cronSchedule,
        nextRunAt,
      },
    });

    console.log(`✅ Schedule updated: ${schedule.syncType}`);
    console.log(`   New cron: ${cronSchedule}`);
    console.log(`   Next run: ${nextRunAt.toISOString()}`);
  } catch (error) {
    console.error(`❌ Invalid cron expression: ${cronSchedule}`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Create a specific sync schedule
 */
async function createSyncSchedule(
  tenantId: string,
  syncType: SyncType,
  cronSchedule: string,
  priority: number,
  description: string
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  try {
    const interval = parser.parseExpression(cronSchedule);
    const nextRunAt = interval.next().toDate();

    const schedule = await prisma.syncSchedule.upsert({
      where: {
        tenantId_syncType_direction: {
          tenantId,
          syncType,
          direction: SyncDirection.PLENTY_TO_SHOPWARE,
        },
      },
      create: {
        tenantId,
        syncType,
        cronSchedule,
        direction: SyncDirection.PLENTY_TO_SHOPWARE,
        priority,
        enabled: true,
        nextRunAt,
      },
      update: {
        cronSchedule,
        priority,
        nextRunAt,
        enabled: true,
      },
    });

    console.log(`\n✅ ${syncType} sync schedule created`);
    console.log(`   Tenant: ${tenant.name}`);
    console.log(`   Schedule ID: ${schedule.id}`);
    console.log(`   Cron: ${cronSchedule} (${description})`);
    console.log(`   Priority: ${priority}`);
    console.log(`   Next run: ${nextRunAt.toISOString()}\n`);
  } catch (error) {
    console.error(`❌ Invalid cron expression: ${cronSchedule}`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function createStockSync(tenantId: string, cronSchedule?: string): Promise<void> {
  await createSyncSchedule(
    tenantId,
    SyncType.STOCK,
    cronSchedule || '*/15 * * * *',
    80,
    cronSchedule ? 'Custom schedule' : 'Every 15 minutes'
  );
}

async function createConfigSync(tenantId: string, cronSchedule?: string): Promise<void> {
  await createSyncSchedule(
    tenantId,
    SyncType.CONFIG,
    cronSchedule || '0 2 * * *',
    100,
    cronSchedule ? 'Custom schedule' : 'Daily at 2:00 AM'
  );
}

async function createProductDeltaSync(tenantId: string, cronSchedule?: string): Promise<void> {
  await createSyncSchedule(
    tenantId,
    SyncType.PRODUCT_DELTA,
    cronSchedule || '*/30 * * * *',
    50,
    cronSchedule ? 'Custom schedule' : 'Every 30 minutes'
  );
}

async function createFullProductSync(tenantId: string, cronSchedule?: string): Promise<void> {
  await createSyncSchedule(
    tenantId,
    SyncType.FULL_PRODUCT,
    cronSchedule || '0 3 * * 0',
    30,
    cronSchedule ? 'Custom schedule' : 'Weekly (Sunday 3:00 AM)'
  );
}

/**
 * Delete a sync schedule
 */
async function deleteSchedule(scheduleId: string): Promise<void> {
  const schedule = await prisma.syncSchedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule) {
    console.error(`❌ Schedule not found: ${scheduleId}`);
    process.exit(1);
  }

  await prisma.syncSchedule.delete({
    where: { id: scheduleId },
  });

  console.log(`✅ Schedule deleted: ${schedule.syncType}`);
}

/**
 * Show usage information
 */
function showUsage(): void {
  console.log(`
📅 Sync Schedule Manager

Usage:
  npm run manage-schedules <command> [arguments]

Commands:
  setup <tenant-id>                       Setup all default sync schedules
  list <tenant-id>                        List all schedules for a tenant

  Create Specific Syncs:
  create-stock <tenant-id> [cron]         Create stock sync schedule
  create-config <tenant-id> [cron]        Create config sync schedule
  create-delta <tenant-id> [cron]         Create product delta sync schedule
  create-full <tenant-id> [cron]          Create full product sync schedule

  Manage Schedules:
  enable <schedule-id>                    Enable a schedule
  disable <schedule-id>                   Disable a schedule
  update <schedule-id> <cron>             Update cron schedule
  delete <schedule-id>                    Delete a schedule

Examples:
  # Setup all default schedules
  npm run manage-schedules setup 00000000-0000-0000-0000-000000000001

  # Create only stock sync with default schedule (every 15 minutes)
  npm run manage-schedules create-stock 00000000-0000-0000-0000-000000000001

  # Create stock sync with custom schedule (every 5 minutes)
  npm run manage-schedules create-stock 00000000-0000-0000-0000-000000000001 "*/5 * * * *"

  # List all schedules
  npm run manage-schedules list 00000000-0000-0000-0000-000000000001

  # Modify existing schedule
  npm run manage-schedules update abc123 "*/10 * * * *"
  npm run manage-schedules disable abc123

Default Schedules:
  CONFIG:         Daily at 2:00 AM         (0 2 * * *)
  PRODUCT_DELTA:  Every 30 minutes         (*/30 * * * *)
  STOCK:          Every 15 minutes         (*/15 * * * *)
  FULL_PRODUCT:   Weekly (Sunday 3:00 AM)  (0 3 * * 0)

Cron Format:
  * * * * *
  │ │ │ │ │
  │ │ │ │ └─── Day of week (0-7, Sun=0 or 7)
  │ │ │ └───── Month (1-12)
  │ │ └─────── Day of month (1-31)
  │ └───────── Hour (0-23)
  └─────────── Minute (0-59)
`);
}

/**
 * Main function
 */
async function main() {
  const command = process.argv[2];
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];

  try {
    switch (command) {
      case 'setup':
        if (!arg1) {
          console.error('❌ Missing tenant ID');
          showUsage();
          process.exit(1);
        }
        await setupDefaultSchedules(arg1);
        break;

      case 'list':
        if (!arg1) {
          console.error('❌ Missing tenant ID');
          showUsage();
          process.exit(1);
        }
        await listSchedules(arg1);
        break;

      case 'create-stock':
        if (!arg1) {
          console.error('❌ Missing tenant ID');
          showUsage();
          process.exit(1);
        }
        await createStockSync(arg1, arg2);
        break;

      case 'create-config':
        if (!arg1) {
          console.error('❌ Missing tenant ID');
          showUsage();
          process.exit(1);
        }
        await createConfigSync(arg1, arg2);
        break;

      case 'create-delta':
        if (!arg1) {
          console.error('❌ Missing tenant ID');
          showUsage();
          process.exit(1);
        }
        await createProductDeltaSync(arg1, arg2);
        break;

      case 'create-full':
        if (!arg1) {
          console.error('❌ Missing tenant ID');
          showUsage();
          process.exit(1);
        }
        await createFullProductSync(arg1, arg2);
        break;

      case 'enable':
        if (!arg1) {
          console.error('❌ Missing schedule ID');
          showUsage();
          process.exit(1);
        }
        await enableSchedule(arg1);
        break;

      case 'disable':
        if (!arg1) {
          console.error('❌ Missing schedule ID');
          showUsage();
          process.exit(1);
        }
        await disableSchedule(arg1);
        break;

      case 'update':
        if (!arg1 || !arg2) {
          console.error('❌ Missing schedule ID or cron expression');
          showUsage();
          process.exit(1);
        }
        await updateSchedule(arg1, arg2);
        break;

      case 'delete':
        if (!arg1) {
          console.error('❌ Missing schedule ID');
          showUsage();
          process.exit(1);
        }
        await deleteSchedule(arg1);
        break;

      default:
        showUsage();
        process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
