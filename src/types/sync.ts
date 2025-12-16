/**
 * Sync-related types used across the application
 */

import { SyncType, SyncDirection, SyncStatus, TenantStatus } from '@prisma/client';

// Re-export Prisma enums for convenience
export { SyncType, SyncDirection, SyncStatus, TenantStatus };

// ============================================
// JOB DATA
// ============================================

export interface SyncJobData {
  id: string;
  tenantId: string;
  scheduleId?: string;
  syncType: SyncType;
  direction: SyncDirection;
  plentyUrl: string;
  plentyCredentials: string; // Encrypted
  shopwareUrl: string;
  shopwareCredentials: string; // Encrypted

  // Optional metadata
  metadata?: Record<string, unknown>;
}

export interface DecryptedSyncJobData extends Omit<SyncJobData, 'plentyCredentials' | 'shopwareCredentials'> {
  plentyCredentials: {
    username: string;
    password: string;
  };
  shopwareCredentials: {
    clientId: string;
    clientSecret: string;
  };
}

// ============================================
// SYNC RESULTS
// ============================================

export interface SyncResult {
  success: boolean;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsFailed: number;
  errors: SyncError[];
  duration: number; // milliseconds
  metadata?: Record<string, unknown>;
}

export interface SyncError {
  entityId: string;
  entityType: string;
  error: string;
  details?: Record<string, unknown>;
}

// ============================================
// CONFIG SYNC SPECIFIC
// ============================================

/**
 * Result for a single entity type sync (categories, attributes, etc.)
 */
export interface EntitySyncResult {
  created: number; // New items created in Shopware
  updated: number; // Existing items updated in Shopware
  errors: number; // Items that failed to sync
  orphaned: number; // Items no longer in Plenty but still mapped to Shopware
}

export interface ConfigSyncResult {
  // Aggregate totals for dashboard display and database storage
  success: boolean;
  itemsProcessed: number; // Total items processed across all entity types
  itemsCreated: number; // Total items created (new in Shopware)
  itemsUpdated: number; // Total items updated (existing in Shopware)
  itemsFailed: number; // Total items that failed
  itemsOrphaned: number; // Total items no longer in Plenty but still in Shopware
  duration: number; // Total duration in milliseconds

  // Per-entity-type breakdown for detailed view
  categories: EntitySyncResult;
  attributes: EntitySyncResult;
  salesPrices: EntitySyncResult;
  manufacturers: EntitySyncResult;
  units: EntitySyncResult;
  properties: EntitySyncResult;
}

// ============================================
// PRODUCT SYNC SPECIFIC
// ============================================

export interface ProductSyncOptions {
  fullSync?: boolean; // If true, ignore updatedAt filter
  batchSize?: number; // Number of products to process at once
  skipExisting?: boolean; // If true, skip products that already exist
}

export interface ProductSyncProgress {
  totalPages: number;
  currentPage: number;
  totalItems: number;
  processedItems: number;
  createdItems: number;
  updatedItems: number;
  failedItems: number;
}

// ============================================
// FIELD MAPPING
// ============================================

export interface FieldMapping {
  plentyField: string;
  shopwareField: string;
  transformationRule?: TransformationRule;
  isRequired: boolean;
  defaultValue?: string;
}

export interface TransformationRule {
  type: 'direct' | 'multiply' | 'divide' | 'concat' | 'split' | 'map' | 'custom';
  params?: Record<string, unknown>;
}

export interface MultiplyTransformationParams {
  factor: number;
}

export interface ConcatTransformationParams {
  fields: string[];
  separator: string;
}

export interface MapTransformationParams {
  mapping: Record<string, unknown>;
  defaultValue?: unknown;
}

// ============================================
// TENANT CONFIG
// ============================================

export interface TenantConfigSyncSettings {
  autoRefreshThresholdHours: number;
  checkBeforeProductSync: boolean;
  forceRefreshOnError: boolean;
}

export const DEFAULT_CONFIG_SYNC_SETTINGS: TenantConfigSyncSettings = {
  autoRefreshThresholdHours: 6,
  checkBeforeProductSync: true,
  forceRefreshOnError: true,
};

// ============================================
// SCHEDULER
// ============================================

export interface SchedulerConfig {
  intervalMs: number;
  maxJobsPerCycle: number;
  cleanupOlderThanDays: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  intervalMs: 60000, // 1 minute
  maxJobsPerCycle: 100,
  cleanupOlderThanDays: 7,
};

// ============================================
// WORKER
// ============================================

export interface WorkerConfig {
  concurrency: number;
  maxRetries: number;
  retryDelayMs: number;
}

export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  concurrency: 5,
  maxRetries: 3,
  retryDelayMs: 5000,
};
