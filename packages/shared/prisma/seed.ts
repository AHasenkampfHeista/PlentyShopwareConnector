#!/usr/bin/env tsx
/**
 * Database seed script
 * Creates a test tenant with default sync schedules
 *
 * Usage: npm run db:seed
 */

import { PrismaClient, TenantStatus, SyncType, SyncDirection } from '@prisma/client';
import { encrypt, encryptJSON } from '../src/utils/encryption';

const prisma = new PrismaClient();

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('Seeding database...');

  // Check if test tenant already exists
  const existingTenant = await prisma.tenant.findUnique({
    where: { id: TEST_TENANT_ID },
  });

  if (existingTenant) {
    console.log('Test tenant already exists. Skipping seed.');
    return;
  }

  // Create test tenant
  // IMPORTANT: Replace these with real credentials before testing
  const tenant = await prisma.tenant.create({
    data: {
      id: TEST_TENANT_ID,
      name: 'Test Shop',
      plentyUrl: 'https://your-shop.plentymarkets-cloud.com',
      plentyCredentials: encryptJSON({
        username: 'your-plenty-username',
        password: 'your-plenty-password',
      }),
      shopwareUrl: 'https://your-shop.shopware.com',
      shopwareCredentials: encryptJSON({
        clientId: 'your-shopware-client-id',
        clientSecret: 'your-shopware-client-secret',
      }),
      status: TenantStatus.ACTIVE,
      configSyncSettings: {
        autoRefreshThresholdHours: 6,
        checkBeforeProductSync: true,
        forceRefreshOnError: true,
      },
    },
  });

  console.log(`Created tenant: ${tenant.name} (${tenant.id})`);

  // Create sync schedules for the tenant
  const schedules = await Promise.all([
    // CONFIG sync - Daily at 3am
    prisma.syncSchedule.create({
      data: {
        tenantId: tenant.id,
        syncType: SyncType.CONFIG,
        direction: SyncDirection.PLENTY_TO_SHOPWARE,
        cronSchedule: '0 3 * * *',
        enabled: true,
        priority: 10,
        nextRunAt: new Date(), // Run immediately on first startup
      },
    }),

    // PRODUCT_DELTA sync - Every 15 minutes
    prisma.syncSchedule.create({
      data: {
        tenantId: tenant.id,
        syncType: SyncType.PRODUCT_DELTA,
        direction: SyncDirection.PLENTY_TO_SHOPWARE,
        cronSchedule: '*/15 * * * *',
        enabled: true,
        priority: 5,
        nextRunAt: new Date(Date.now() + 5 * 60 * 1000), // Start in 5 minutes
      },
    }),
  ]);

  console.log(`Created ${schedules.length} sync schedules:`);
  for (const schedule of schedules) {
    console.log(`  - ${schedule.syncType}: ${schedule.cronSchedule}`);
  }

  // Create some default field mappings
  const mappings = await Promise.all([
    prisma.syncMapping.create({
      data: {
        tenantId: tenant.id,
        entityType: SyncType.PRODUCT_DELTA,
        plentyField: 'number',
        shopwareField: 'productNumber',
        isRequired: true,
      },
    }),
    prisma.syncMapping.create({
      data: {
        tenantId: tenant.id,
        entityType: SyncType.PRODUCT_DELTA,
        plentyField: 'variationTexts.0.name',
        shopwareField: 'name',
        isRequired: true,
      },
    }),
    prisma.syncMapping.create({
      data: {
        tenantId: tenant.id,
        entityType: SyncType.PRODUCT_DELTA,
        plentyField: 'variationTexts.0.description',
        shopwareField: 'description',
        isRequired: false,
      },
    }),
  ]);

  console.log(`Created ${mappings.length} field mappings`);

  console.log('\nSeed complete!');
  console.log('\n=== IMPORTANT ===');
  console.log('Before testing, update the tenant credentials:');
  console.log(`
UPDATE tenants SET
  plenty_url = 'https://YOUR-SHOP.plentymarkets-cloud.com',
  plenty_credentials = '${encryptJSON({ username: 'YOUR_USERNAME', password: 'YOUR_PASSWORD' })}',
  shopware_url = 'https://YOUR-SHOP.shopware.com',
  shopware_credentials = '${encryptJSON({ clientId: 'YOUR_CLIENT_ID', clientSecret: 'YOUR_CLIENT_SECRET' })}'
WHERE id = '${TEST_TENANT_ID}';
`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
