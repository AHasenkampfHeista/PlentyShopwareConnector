import 'dotenv/config';
import { PrismaClient, SyncStatus, SyncType } from '@prisma/client';
import { Job } from 'bullmq';
import {
  logger,
  QueueService,
  decryptJSON,
  SyncJobData,
  DecryptedSyncJobData,
  createJobLogger,
} from '@connector/shared';
import { ConfigSyncProcessor } from './processors/ConfigSyncProcessor';
import { ProductSyncProcessor } from './processors/ProductSyncProcessor';
import { StockSyncProcessor } from './processors/StockSyncProcessor';

// Configuration
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

const prisma = new PrismaClient();
const queueService = new QueueService({
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
});

// Initialize processors
const configProcessor = new ConfigSyncProcessor();
const productProcessor = new ProductSyncProcessor();
const stockProcessor = new StockSyncProcessor();

/**
 * Decrypt credentials from job data
 */
function decryptJobCredentials(jobData: SyncJobData): DecryptedSyncJobData {
  return {
    ...jobData,
    plentyCredentials: decryptJSON<{ username: string; password: string }>(
      jobData.plentyCredentials
    ),
    shopwareCredentials: decryptJSON<{ clientId: string; clientSecret: string }>(
      jobData.shopwareCredentials
    ),
  };
}

/**
 * Process a sync job
 */
async function processJob(job: Job<SyncJobData>): Promise<void> {
  const jobData = job.data;
  const log = createJobLogger(jobData.id, jobData.tenantId, jobData.syncType);

  log.info('Processing job started', {
    syncType: jobData.syncType,
    direction: jobData.direction,
  });

  // Update job status to processing
  await prisma.syncJob.update({
    where: { id: jobData.id },
    data: {
      status: SyncStatus.PROCESSING,
      startedAt: new Date(),
    },
  });

  try {
    // Decrypt credentials
    const decryptedJobData = decryptJobCredentials(jobData);

    // Route to appropriate processor based on sync type
    let result;

    switch (jobData.syncType) {
      case SyncType.CONFIG:
        log.info('Routing to ConfigSyncProcessor');
        result = await configProcessor.process(decryptedJobData);
        break;

      case SyncType.FULL_PRODUCT:
        log.info('Routing to ProductSyncProcessor (full)');
        result = await productProcessor.process(decryptedJobData, { fullSync: true });
        break;

      case SyncType.PRODUCT_DELTA:
        log.info('Routing to ProductSyncProcessor (delta)');
        result = await productProcessor.process(decryptedJobData, { fullSync: false });
        break;

      case SyncType.STOCK:
        log.info('Routing to StockSyncProcessor');
        result = await stockProcessor.process(decryptedJobData);
        break;

      case SyncType.ORDER:
        log.warn('Order sync not yet implemented');
        result = { success: true, message: 'Order sync not implemented' };
        break;

      case SyncType.CUSTOMER:
        log.warn('Customer sync not yet implemented');
        result = { success: true, message: 'Customer sync not implemented' };
        break;

      default:
        throw new Error(`Unknown sync type: ${jobData.syncType}`);
    }

    // Update job status to completed
    await prisma.syncJob.update({
      where: { id: jobData.id },
      data: {
        status: SyncStatus.COMPLETED,
        completedAt: new Date(),
        metadata: result as object,
        ...(result && 'itemsProcessed' in result
          ? {
              itemsProcessed: result.itemsProcessed,
              itemsCreated: result.itemsCreated,
              itemsUpdated: result.itemsUpdated,
              itemsFailed: result.itemsFailed,
            }
          : {}),
      },
    });

    log.info('Job completed successfully', { result });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Job failed', { error: errorMessage });

    // Update job status to failed
    await prisma.syncJob.update({
      where: { id: jobData.id },
      data: {
        status: SyncStatus.FAILED,
        completedAt: new Date(),
        errorMessage,
      },
    });

    // Re-throw to let BullMQ handle retries
    throw error;
  }
}

/**
 * Check for stalled/orphaned jobs on startup
 */
async function recoverStalledJobs(): Promise<void> {
  try {
    // Find jobs that are stuck in PROCESSING status (likely from crashed workers)
    const stalledJobs = await prisma.syncJob.findMany({
      where: {
        status: SyncStatus.PROCESSING,
        startedAt: {
          // Consider stalled if processing for more than 30 minutes
          lt: new Date(Date.now() - 30 * 60 * 1000),
        },
      },
    });

    if (stalledJobs.length > 0) {
      logger.warn('Found stalled jobs', { count: stalledJobs.length });

      for (const job of stalledJobs) {
        // Reset to pending so they can be reprocessed
        await prisma.syncJob.update({
          where: { id: job.id },
          data: {
            status: SyncStatus.PENDING,
            startedAt: null,
            errorMessage: 'Job was stalled and reset',
          },
        });

        logger.info('Reset stalled job', { jobId: job.id });
      }
    }
  } catch (error) {
    logger.error('Failed to recover stalled jobs', { error });
  }
}

/**
 * Perform health check
 */
async function healthCheck(): Promise<boolean> {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check queue connection
    const stats = await queueService.getQueueStats();

    logger.debug('Worker health check passed', { queueStats: stats });
    return true;
  } catch (error) {
    logger.error('Worker health check failed', { error });
    return false;
  }
}

/**
 * Main worker entry point
 */
async function main(): Promise<void> {
  logger.info('Worker starting', { concurrency: WORKER_CONCURRENCY });

  // Connect to queue
  await queueService.connect();

  // Recover any stalled jobs from previous crashes
  await recoverStalledJobs();

  // Start the worker
  await queueService.startWorker(processJob, WORKER_CONCURRENCY);

  // Start queue events for monitoring
  await queueService.startQueueEvents();

  logger.info('Worker started and listening for jobs');

  // Schedule health check (every 5 minutes)
  const healthInterval = setInterval(async () => {
    await healthCheck();
  }, 5 * 60 * 1000);

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    logger.info('Shutdown signal received', { signal });

    clearInterval(healthInterval);

    // Close connections
    await queueService.close();
    await prisma.$disconnect();

    logger.info('Worker stopped gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    // Don't exit on unhandled rejection, just log
  });
}

// Start the worker
main().catch((error) => {
  logger.error('Worker failed to start', { error });
  process.exit(1);
});
