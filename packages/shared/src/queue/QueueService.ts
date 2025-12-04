import { Queue, Worker, Job, QueueEvents, JobsOptions } from 'bullmq';
import Redis from 'ioredis';
import { createLogger } from '../utils/logger';
import { SyncJobData } from '../types/sync';

const DEFAULT_QUEUE_NAME = 'sync-jobs';

export interface QueueConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  queueName?: string;
}

export interface JobHandler {
  (job: Job<SyncJobData>): Promise<void>;
}

export interface AddJobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
}

export class QueueService {
  private queue: Queue<SyncJobData> | null = null;
  private worker: Worker<SyncJobData> | null = null;
  private queueEvents: QueueEvents | null = null;
  private redis: Redis | null = null;
  private readonly queueName: string;
  private readonly config: QueueConfig;
  private log = createLogger({ service: 'QueueService' });

  constructor(config: QueueConfig) {
    this.config = config;
    this.queueName = config.queueName || DEFAULT_QUEUE_NAME;
  }

  /**
   * Connect to Redis and initialize the queue
   */
  async connect(): Promise<void> {
    try {
      // Create Redis connection
      this.redis = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
      });

      // Create queue
      this.queue = new Queue<SyncJobData>(this.queueName, {
        connection: {
          host: this.config.redis.host,
          port: this.config.redis.port,
          password: this.config.redis.password,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            count: 1000, // Keep last 1000 completed jobs
            age: 24 * 60 * 60, // Keep for 24 hours
          },
          removeOnFail: {
            count: 5000, // Keep last 5000 failed jobs
            age: 7 * 24 * 60 * 60, // Keep for 7 days
          },
        },
      });

      this.log.info('Connected to Redis queue', {
        host: this.config.redis.host,
        port: this.config.redis.port,
        queueName: this.queueName,
      });
    } catch (error) {
      this.log.error('Failed to connect to Redis', { error });
      throw error;
    }
  }

  /**
   * Add a job to the queue
   */
  async addJob(jobData: SyncJobData, options: AddJobOptions = {}): Promise<Job<SyncJobData>> {
    if (!this.queue) {
      throw new Error('Queue not connected. Call connect() first.');
    }

    const jobOptions: JobsOptions = {
      jobId: jobData.id, // Use the sync job ID as the BullMQ job ID
      priority: options.priority,
      delay: options.delay,
    };

    if (options.attempts) {
      jobOptions.attempts = options.attempts;
    }

    if (options.backoff) {
      jobOptions.backoff = options.backoff;
    }

    const job = await this.queue.add(jobData.syncType, jobData, jobOptions);

    this.log.debug('Job added to queue', {
      jobId: job.id,
      syncType: jobData.syncType,
      tenantId: jobData.tenantId,
    });

    return job;
  }

  /**
   * Add multiple jobs to the queue in bulk
   */
  async addJobs(
    jobs: Array<{ data: SyncJobData; options?: AddJobOptions }>
  ): Promise<Job<SyncJobData>[]> {
    if (!this.queue) {
      throw new Error('Queue not connected. Call connect() first.');
    }

    const bulkJobs = jobs.map(({ data, options = {} }) => ({
      name: data.syncType,
      data,
      opts: {
        jobId: data.id,
        priority: options.priority,
        delay: options.delay,
        attempts: options.attempts,
        backoff: options.backoff,
      } as JobsOptions,
    }));

    const addedJobs = await this.queue.addBulk(bulkJobs);

    this.log.info('Bulk jobs added to queue', { count: addedJobs.length });

    return addedJobs;
  }

  /**
   * Start a worker to process jobs
   */
  async startWorker(
    handler: JobHandler,
    concurrency: number = 5
  ): Promise<void> {
    if (this.worker) {
      this.log.warn('Worker already running');
      return;
    }

    this.worker = new Worker<SyncJobData>(
      this.queueName,
      async (job: Job<SyncJobData>) => {
        const jobLog = createLogger({
          jobId: job.id,
          tenantId: job.data.tenantId,
          syncType: job.data.syncType,
        });

        jobLog.info('Processing job');
        const startTime = Date.now();

        try {
          await handler(job);
          const duration = Date.now() - startTime;
          jobLog.info('Job completed', { duration });
        } catch (error) {
          const duration = Date.now() - startTime;
          jobLog.error('Job failed', { duration, error });
          throw error;
        }
      },
      {
        connection: {
          host: this.config.redis.host,
          port: this.config.redis.port,
          password: this.config.redis.password,
        },
        concurrency,
        limiter: {
          max: 10, // Max 10 jobs per 1000ms
          duration: 1000,
        },
      }
    );

    // Event handlers
    this.worker.on('completed', (job) => {
      this.log.debug('Job completed', { jobId: job.id });
    });

    this.worker.on('failed', (job, error) => {
      this.log.error('Job failed', {
        jobId: job?.id,
        error: error.message,
        attemptsMade: job?.attemptsMade,
      });
    });

    this.worker.on('error', (error) => {
      this.log.error('Worker error', { error: error.message });
    });

    this.worker.on('stalled', (jobId) => {
      this.log.warn('Job stalled', { jobId });
    });

    this.log.info('Worker started', { concurrency });
  }

  /**
   * Start queue events listener for monitoring
   */
  async startQueueEvents(): Promise<void> {
    this.queueEvents = new QueueEvents(this.queueName, {
      connection: {
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
      },
    });

    this.queueEvents.on('completed', ({ jobId }) => {
      this.log.debug('Queue event: Job completed', { jobId });
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      this.log.warn('Queue event: Job failed', { jobId, reason: failedReason });
    });

    this.queueEvents.on('progress', ({ jobId, data }) => {
      this.log.debug('Queue event: Job progress', { jobId, progress: data });
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    if (!this.queue) {
      throw new Error('Queue not connected');
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get failed jobs
   */
  async getFailedJobs(start = 0, end = 100): Promise<Job<SyncJobData>[]> {
    if (!this.queue) {
      throw new Error('Queue not connected');
    }

    return this.queue.getFailed(start, end);
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<void> {
    if (!this.queue) {
      throw new Error('Queue not connected');
    }

    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.retry();
      this.log.info('Job retried', { jobId });
    }
  }

  /**
   * Clean old jobs
   */
  async cleanOldJobs(gracePeriodMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    if (!this.queue) {
      throw new Error('Queue not connected');
    }

    await this.queue.clean(gracePeriodMs, 1000, 'completed');
    await this.queue.clean(gracePeriodMs * 7, 1000, 'failed');

    this.log.info('Old jobs cleaned');
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    if (!this.queue) {
      throw new Error('Queue not connected');
    }

    await this.queue.pause();
    this.log.info('Queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    if (!this.queue) {
      throw new Error('Queue not connected');
    }

    await this.queue.resume();
    this.log.info('Queue resumed');
  }

  /**
   * Close connections gracefully
   */
  async close(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    if (this.worker) {
      closePromises.push(this.worker.close());
    }

    if (this.queueEvents) {
      closePromises.push(this.queueEvents.close());
    }

    if (this.queue) {
      closePromises.push(this.queue.close());
    }

    if (this.redis) {
      closePromises.push(Promise.resolve(this.redis.disconnect()));
    }

    await Promise.all(closePromises);

    this.worker = null;
    this.queueEvents = null;
    this.queue = null;
    this.redis = null;

    this.log.info('Queue service closed');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.queue !== null;
  }

  /**
   * Check if worker is running
   */
  isWorkerRunning(): boolean {
    return this.worker !== null;
  }

  /**
   * Get the underlying queue instance
   */
  getQueue(): Queue<SyncJobData> | null {
    return this.queue;
  }
}
