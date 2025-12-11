#!/usr/bin/env tsx
/**
 * Trigger a PRODUCT_DELTA sync for a specific tenant
 * Usage: npm run trigger-product-delta-sync <tenant-id>
 */

import 'dotenv/config';
import { PrismaClient, SyncType, SyncDirection, SyncStatus } from '@prisma/client';
import { QueueService } from '../src/queue/QueueService';
import type { SyncJobData } from '../src/types/sync';

async function main() {
  const tenantId = process.argv[2];

  if (!tenantId) {
    console.error('Usage: npm run trigger-product-delta-sync <tenant-id>');
    console.error('Example: npm run trigger-product-delta-sync 00000000-0000-0000-0000-000000000001');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const queueService = new QueueService({
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
    },
  });

  try {
    // Verify tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      console.error(`Tenant not found: ${tenantId}`);
      process.exit(1);
    }

    console.log(`Found tenant: ${tenant.name}`);
    console.log('Triggering PRODUCT_DELTA sync (changed products only)...');

    // Connect to queue
    await queueService.connect();

    // Create sync job
    const syncJob = await prisma.syncJob.create({
      data: {
        tenantId,
        syncType: SyncType.PRODUCT_DELTA,
        direction: SyncDirection.PLENTY_TO_SHOPWARE,
        status: SyncStatus.PENDING,
      },
    });

    console.log(`Created sync job: ${syncJob.id}`);

    // Add to queue
    const jobData: SyncJobData = {
      id: syncJob.id,
      tenantId,
      syncType: SyncType.PRODUCT_DELTA,
      direction: SyncDirection.PLENTY_TO_SHOPWARE,
      plentyUrl: tenant.plentyUrl,
      plentyCredentials: tenant.plentyCredentials,
      shopwareUrl: tenant.shopwareUrl,
      shopwareCredentials: tenant.shopwareCredentials,
    };

    await queueService.addJob(jobData);

    console.log('Job added to queue. Product delta sync will start shortly.');
    console.log(`Monitor progress: SELECT * FROM sync_jobs WHERE id = '${syncJob.id}';`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await queueService.close();
    await prisma.$disconnect();
  }
}

main();
