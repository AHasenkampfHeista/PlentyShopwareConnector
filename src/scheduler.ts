import 'dotenv/config';
import { PrismaClient, SyncStatus, TenantStatus } from '@prisma/client';
import { parseExpression } from 'cron-parser';
import { logger } from './utils/logger';
import { QueueService } from './queue/QueueService';
import type { SyncJobData } from './types/sync';

// Configuration
const SCHEDULER_INTERVAL_MS = parseInt(process.env.SCHEDULER_INTERVAL_MS || '60000', 10);
const MAX_JOBS_PER_CYCLE = parseInt(process.env.MAX_JOBS_PER_CYCLE || '100', 10);
const CLEANUP_OLDER_THAN_DAYS = parseInt(process.env.CLEANUP_OLDER_THAN_DAYS || '7', 10);

const prisma = new PrismaClient();
const queueService = new QueueService({
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
});

/**
 * Check for due schedules and create jobs
 */
async function checkAndCreateJobs(): Promise<void> {
  const now = new Date();
  const cycleId = Date.now().toString(36);

  logger.debug('Scheduler cycle started', { cycleId });

  try {
    // Find all schedules that are due to run
    const dueSchedules = await prisma.syncSchedule.findMany({
      where: {
        enabled: true,
        OR: [
          { nextRunAt: null }, // Never run before
          { nextRunAt: { lte: now } }, // Due to run
        ],
        tenant: {
          status: TenantStatus.ACTIVE,
        },
      },
      include: {
        tenant: true,
      },
      take: MAX_JOBS_PER_CYCLE,
      orderBy: [
        { priority: 'desc' },
        { nextRunAt: 'asc' },
      ],
    });

    if (dueSchedules.length === 0) {
      logger.debug('No schedules due', { cycleId });
      return;
    }

    logger.info('Found due schedules', { count: dueSchedules.length, cycleId });

    // Process each due schedule
    for (const schedule of dueSchedules) {
      try {
        // Check if there's already a pending or processing job for this tenant + sync type
        const existingJob = await prisma.syncJob.findFirst({
          where: {
            tenantId: schedule.tenantId,
            syncType: schedule.syncType,
            status: {
              in: [SyncStatus.PENDING, SyncStatus.PROCESSING],
            },
          },
        });

        // Calculate next run time
        const nextRun = calculateNextRun(schedule.cronSchedule);

        if (existingJob) {
          // Job already exists, skip creation but update schedule
          logger.info('Job already exists, skipping creation', {
            existingJobId: existingJob.id,
            tenantId: schedule.tenantId,
            syncType: schedule.syncType,
            existingJobStatus: existingJob.status,
            nextRunAt: nextRun.toISOString(),
            cycleId,
          });

          // Update schedule's nextRunAt so it keeps tracking
          await prisma.syncSchedule.update({
            where: { id: schedule.id },
            data: {
              nextRunAt: nextRun,
            },
          });

          continue;
        }

        // No existing job, create a new one
        const syncJob = await prisma.syncJob.create({
          data: {
            tenantId: schedule.tenantId,
            scheduleId: schedule.id,
            syncType: schedule.syncType,
            direction: schedule.direction,
            status: SyncStatus.PENDING,
          },
        });

        // Prepare job data for queue
        const jobData: SyncJobData = {
          id: syncJob.id,
          tenantId: schedule.tenantId,
          scheduleId: schedule.id,
          syncType: schedule.syncType,
          direction: schedule.direction,
          plentyUrl: schedule.tenant.plentyUrl,
          plentyCredentials: schedule.tenant.plentyCredentials,
          shopwareUrl: schedule.tenant.shopwareUrl,
          shopwareCredentials: schedule.tenant.shopwareCredentials,
        };

        // Add job to queue
        await queueService.addJob(jobData, {
          priority: schedule.priority,
        });

        // Update schedule with last run and next run times
        await prisma.syncSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            nextRunAt: nextRun,
          },
        });

        logger.info('Job created', {
          jobId: syncJob.id,
          tenantId: schedule.tenantId,
          syncType: schedule.syncType,
          nextRunAt: nextRun.toISOString(),
          cycleId,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Failed to create job for schedule', {
          scheduleId: schedule.id,
          tenantId: schedule.tenantId,
          error: errorMessage,
          cycleId,
        });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Scheduler cycle failed', { error: errorMessage, cycleId });
  }
}

/**
 * Calculate the next run time based on cron expression
 */
function calculateNextRun(cronSchedule: string): Date {
  try {
    const interval = parseExpression(cronSchedule);
    return interval.next().toDate();
  } catch (error) {
    // If cron parsing fails, default to 1 hour from now
    logger.warn('Failed to parse cron expression, defaulting to 1 hour', { cronSchedule });
    return new Date(Date.now() + 60 * 60 * 1000);
  }
}

/**
 * Clean up old completed jobs
 */
async function cleanupOldJobs(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_OLDER_THAN_DAYS);

  try {
    // Delete old completed jobs
    const completedResult = await prisma.syncJob.deleteMany({
      where: {
        status: SyncStatus.COMPLETED,
        completedAt: { lt: cutoffDate },
      },
    });

    // Delete old failed jobs (keep for longer investigation)
    const failedCutoff = new Date();
    failedCutoff.setDate(failedCutoff.getDate() - CLEANUP_OLDER_THAN_DAYS * 2);

    const failedResult = await prisma.syncJob.deleteMany({
      where: {
        status: SyncStatus.FAILED,
        completedAt: { lt: failedCutoff },
      },
    });

    // Delete old sync logs
    const logsResult = await prisma.syncLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    if (completedResult.count > 0 || failedResult.count > 0 || logsResult.count > 0) {
      logger.info('Cleaned up old data', {
        completedJobs: completedResult.count,
        failedJobs: failedResult.count,
        syncLogs: logsResult.count,
      });
    }
  } catch (error) {
    logger.error('Failed to cleanup old jobs', { error });
  }
}

/**
 * Perform health check
 */
async function healthCheck(): Promise<boolean> {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check Redis connection
    const queueStats = await queueService.getQueueStats();

    logger.debug('Health check passed', { queueStats });
    return true;
  } catch (error) {
    logger.error('Health check failed', { error });
    return false;
  }
}

/**
 * Main scheduler loop
 */
async function main(): Promise<void> {
  logger.info('Scheduler starting', {
    intervalMs: SCHEDULER_INTERVAL_MS,
    maxJobsPerCycle: MAX_JOBS_PER_CYCLE,
    cleanupDays: CLEANUP_OLDER_THAN_DAYS,
  });

  // Connect to queue
  await queueService.connect();

  // Run immediately on startup
  await checkAndCreateJobs();

  // Schedule regular cycles
  const schedulerInterval = setInterval(async () => {
    try {
      await checkAndCreateJobs();
    } catch (error) {
      logger.error('Scheduler cycle error', { error });
    }
  }, SCHEDULER_INTERVAL_MS);

  // Schedule cleanup (once per hour)
  const cleanupInterval = setInterval(async () => {
    await cleanupOldJobs();
  }, 60 * 60 * 1000);

  // Schedule health check (every 5 minutes)
  const healthInterval = setInterval(async () => {
    await healthCheck();
  }, 5 * 60 * 1000);

  logger.info('Scheduler started and running');

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    logger.info('Shutdown signal received', { signal });

    // Clear intervals
    clearInterval(schedulerInterval);
    clearInterval(cleanupInterval);
    clearInterval(healthInterval);

    // Close connections
    await queueService.close();
    await prisma.$disconnect();

    logger.info('Scheduler stopped gracefully');
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

// Start the scheduler
main().catch((error) => {
  logger.error('Scheduler failed to start', { error });
  process.exit(1);
});
