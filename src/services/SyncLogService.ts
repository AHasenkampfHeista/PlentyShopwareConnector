import { PrismaClient, SyncType, Prisma } from '@prisma/client';
import { createLogger } from '../utils/logger';

const prisma = new PrismaClient();

export interface SyncLogEntry {
  tenantId: string;
  jobId: string;
  entityType: SyncType;
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'skip' | 'error' | 'start' | 'complete' | 'info';
  success: boolean;
  details: Record<string, unknown>;
}

/**
 * Service for logging detailed sync operations to the sync_logs table.
 * Provides visibility into what happened during each sync job.
 */
export class SyncLogService {
  private log = createLogger({ service: 'SyncLogService' });
  private prisma: PrismaClient;
  private buffer: SyncLogEntry[] = [];
  private bufferSize = 50; // Flush after this many entries

  constructor() {
    this.prisma = prisma;
  }

  /**
   * Log a single sync operation
   */
  async logOperation(entry: SyncLogEntry): Promise<void> {
    this.buffer.push(entry);

    if (this.buffer.length >= this.bufferSize) {
      await this.flush();
    }
  }

  /**
   * Log job start
   */
  async logJobStart(tenantId: string, jobId: string, syncType: SyncType): Promise<void> {
    await this.logOperation({
      tenantId,
      jobId,
      entityType: syncType,
      entityId: jobId,
      action: 'start',
      success: true,
      details: {
        message: `Starting ${syncType} sync`,
        startedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Log job completion
   */
  async logJobComplete(
    tenantId: string,
    jobId: string,
    syncType: SyncType,
    summary: Record<string, unknown>
  ): Promise<void> {
    await this.logOperation({
      tenantId,
      jobId,
      entityType: syncType,
      entityId: jobId,
      action: 'complete',
      success: true,
      details: {
        message: `Completed ${syncType} sync`,
        completedAt: new Date().toISOString(),
        ...summary,
      },
    });
    await this.flush(); // Always flush on job complete
  }

  /**
   * Log entity sync result (batch of entities)
   */
  async logEntityBatch(
    tenantId: string,
    jobId: string,
    syncType: SyncType,
    entityName: string,
    result: { created: number; updated: number; errors: number },
    details?: Record<string, unknown>
  ): Promise<void> {
    const action = result.errors > 0 ? 'error' : (result.created > 0 ? 'create' : 'update');
    await this.logOperation({
      tenantId,
      jobId,
      entityType: syncType,
      entityId: `batch:${entityName}`,
      action,
      success: result.errors === 0,
      details: {
        entityName,
        created: result.created,
        updated: result.updated,
        errors: result.errors,
        total: result.created + result.updated,
        ...details,
      },
    });
  }

  /**
   * Log an individual entity sync
   */
  async logEntity(
    tenantId: string,
    jobId: string,
    syncType: SyncType,
    entityId: string,
    action: 'create' | 'update' | 'delete' | 'skip' | 'error',
    success: boolean,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.logOperation({
      tenantId,
      jobId,
      entityType: syncType,
      entityId,
      action,
      success,
      details: details || {},
    });
  }

  /**
   * Log an error
   */
  async logError(
    tenantId: string,
    jobId: string,
    syncType: SyncType,
    entityId: string,
    error: Error | string,
    context?: Record<string, unknown>
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;

    await this.logOperation({
      tenantId,
      jobId,
      entityType: syncType,
      entityId,
      action: 'error',
      success: false,
      details: {
        error: errorMessage,
        stack: errorStack,
        ...context,
      },
    });
  }

  /**
   * Log informational message
   */
  async logInfo(
    tenantId: string,
    jobId: string,
    syncType: SyncType,
    message: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.logOperation({
      tenantId,
      jobId,
      entityType: syncType,
      entityId: 'info',
      action: 'info',
      success: true,
      details: {
        message,
        ...details,
      },
    });
  }

  /**
   * Flush buffered logs to database
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    try {
      await this.prisma.syncLog.createMany({
        data: entries.map((entry) => ({
          tenantId: entry.tenantId,
          jobId: entry.jobId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          action: entry.action,
          success: entry.success,
          details: entry.details as Prisma.InputJsonValue,
        })),
      });
    } catch (error) {
      this.log.error('Failed to flush sync logs to database', { error, count: entries.length });
      // Re-add to buffer for retry (but limit to prevent memory issues)
      if (this.buffer.length < 1000) {
        this.buffer.push(...entries);
      }
    }
  }

  /**
   * Get logs for a specific job
   */
  async getJobLogs(jobId: string, options?: { limit?: number; offset?: number }) {
    return this.prisma.syncLog.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
      take: options?.limit || 100,
      skip: options?.offset || 0,
    });
  }

  /**
   * Get error logs for a tenant
   */
  async getTenantErrors(tenantId: string, options?: { limit?: number; since?: Date }) {
    return this.prisma.syncLog.findMany({
      where: {
        tenantId,
        success: false,
        ...(options?.since ? { createdAt: { gte: options.since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
    });
  }
}

// Singleton instance
let syncLogService: SyncLogService | null = null;

export function getSyncLogService(): SyncLogService {
  if (!syncLogService) {
    syncLogService = new SyncLogService();
  }
  return syncLogService;
}
