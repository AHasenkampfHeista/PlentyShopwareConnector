#!/usr/bin/env tsx
/**
 * Reset Sync Data Script
 *
 * Clears all synced data while preserving:
 * - Tenant configurations (credentials, URLs)
 * - Sync schedules
 * - Field mappings (sync_mappings)
 *
 * This is useful for testing or starting fresh without reconfiguring tenants.
 *
 * Usage: npm run reset-sync-data --workspace=packages/shared
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../src/utils/logger';

const prisma = new PrismaClient();
const log = createLogger({ service: 'ResetSyncData' });

async function main() {
  log.info('Starting sync data reset...');

  try {
    // Confirm before proceeding
    console.log('\n⚠️  WARNING: This will delete ALL synced data!\n');
    console.log('The following data will be DELETED:');
    console.log('  - All synced products (mock_shopware_products)');
    console.log('  - All product mappings (product_mappings)');
    console.log('  - All sync jobs and logs');
    console.log('  - All sync state (next sync will be FULL, not delta)');
    console.log('  - All cached Plenty data (categories, attributes, etc.)');
    console.log('\nThe following will be PRESERVED:');
    console.log('  - Tenant configurations (credentials, URLs)');
    console.log('  - Sync schedules (will be reset to run immediately)');
    console.log('  - Field mappings (sync_mappings)');
    console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to continue...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    log.info('Proceeding with reset...');

    // Delete in order to respect foreign key constraints

    // 1. Delete sync logs (references sync_jobs)
    log.info('Deleting sync logs...');
    const syncLogsCount = await prisma.syncLog.deleteMany({});
    log.info(`Deleted ${syncLogsCount.count} sync logs`);

    // 2. Delete sync jobs
    log.info('Deleting sync jobs...');
    const syncJobsCount = await prisma.syncJob.deleteMany({});
    log.info(`Deleted ${syncJobsCount.count} sync jobs`);

    // 3. Delete sync state
    log.info('Deleting sync state...');
    const syncStateCount = await prisma.syncState.deleteMany({});
    log.info(`Deleted ${syncStateCount.count} sync states`);

    // 4. Delete product mappings (new table)
    log.info('Deleting product mappings...');
    const mappingsCount = await prisma.productMapping.deleteMany({});
    log.info(`Deleted ${mappingsCount.count} product mappings`);

    // 5. Delete mock Shopware products
    log.info('Deleting mock Shopware products...');
    const productsCount = await prisma.mockShopwareProduct.deleteMany({});
    log.info(`Deleted ${productsCount.count} mock products`);

    // 6. Delete cached Plenty config data
    log.info('Deleting Plenty categories...');
    const categoriesCount = await prisma.plentyCategory.deleteMany({});
    log.info(`Deleted ${categoriesCount.count} categories`);

    log.info('Deleting Plenty attributes...');
    const attributesCount = await prisma.plentyAttribute.deleteMany({});
    log.info(`Deleted ${attributesCount.count} attributes`);

    log.info('Deleting Plenty sales prices...');
    const pricesCount = await prisma.plentySalesPrice.deleteMany({});
    log.info(`Deleted ${pricesCount.count} sales prices`);

    log.info('Deleting Plenty manufacturers...');
    const manufacturersCount = await prisma.plentyManufacturer.deleteMany({});
    log.info(`Deleted ${manufacturersCount.count} manufacturers`);

    log.info('Deleting Plenty units...');
    const unitsCount = await prisma.plentyUnit.deleteMany({});
    log.info(`Deleted ${unitsCount.count} units`);

    // Reset sync schedules so they run immediately
    log.info('Resetting sync schedules...');
    const scheduleUpdateResult = await prisma.syncSchedule.updateMany({
      data: {
        lastRunAt: null,
        nextRunAt: null,
      },
    });
    log.info(`Reset ${scheduleUpdateResult.count} sync schedules`);

    // NOTE: We do NOT re-create sync_state entries here
    // The worker will automatically create them on first run and do a full sync
    // This ensures delta syncs truly fetch all data instead of only recently updated items
    log.info('✨ Sync state cleared - next sync will be a full sync for each tenant');

    log.info('✅ Sync data reset complete!');

    // Summary
    console.log('\n📊 Summary:');
    console.log(`  Sync logs:          ${syncLogsCount.count}`);
    console.log(`  Sync jobs:          ${syncJobsCount.count}`);
    console.log(`  Sync states:        ${syncStateCount.count}`);
    console.log(`  Product mappings:   ${mappingsCount.count}`);
    console.log(`  Mock products:      ${productsCount.count}`);
    console.log(`  Categories:         ${categoriesCount.count}`);
    console.log(`  Attributes:         ${attributesCount.count}`);
    console.log(`  Sales prices:       ${pricesCount.count}`);
    console.log(`  Manufacturers:      ${manufacturersCount.count}`);
    console.log(`  Units:              ${unitsCount.count}`);
    console.log(`  Schedules reset:    ${scheduleUpdateResult.count}`);
    console.log('\n✅ All sync data cleared. Schedules reset to run immediately.');
    console.log('✨ Next sync will be a FULL sync (not delta) for all tenants.');

  } catch (error) {
    log.error('Failed to reset sync data', { error });
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
