import { PrismaClient, SyncType } from '@prisma/client';
import {
  getPrismaClient,
  createJobLogger,
  PlentyClient,
  PlentyClientConfig,
  MockShopwareClient,
  IShopwareClient,
} from '@connector/shared';
import { PlentyVariation } from '@connector/shared';
import { DecryptedSyncJobData, SyncResult, SyncError, FieldMapping } from '@connector/shared';
import { ProductTransformer } from '../transformers/ProductTransformer';
import { ConfigSyncProcessor } from './ConfigSyncProcessor';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_WITH_RELATIONS = [
  'variationSalesPrices',
  'variationBarcodes',
  'variationStock',
  'variationAttributeValues',
  'variationCategories',
  'variationTexts',
];

export interface ProductSyncOptions {
  fullSync?: boolean;
  batchSize?: number;
  skipExisting?: boolean;
}

/**
 * Product Sync Processor
 * Handles FULL_PRODUCT and PRODUCT_DELTA sync types
 */
export class ProductSyncProcessor {
  private prisma: PrismaClient;
  private transformer: ProductTransformer;
  private configProcessor: ConfigSyncProcessor;

  constructor() {
    this.prisma = getPrismaClient();
    this.transformer = new ProductTransformer();
    this.configProcessor = new ConfigSyncProcessor();
  }

  /**
   * Process a product sync job
   */
  async process(
    jobData: DecryptedSyncJobData,
    options: ProductSyncOptions = {}
  ): Promise<SyncResult> {
    const log = createJobLogger(jobData.id, jobData.tenantId, jobData.syncType);
    const startTime = Date.now();

    const result: SyncResult = {
      success: true,
      itemsProcessed: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsFailed: 0,
      errors: [],
      duration: 0,
    };

    try {
      // Check if config is stale and needs refresh
      await this.checkAndRefreshConfig(jobData, log);

      // Initialize clients
      const plentyConfig: PlentyClientConfig = {
        baseUrl: jobData.plentyUrl,
        credentials: jobData.plentyCredentials,
      };
      const plenty = new PlentyClient(plentyConfig);
      await plenty.authenticate();

      const shopware: IShopwareClient = new MockShopwareClient({
        tenantId: jobData.tenantId,
      });
      await shopware.authenticate();

      // Load custom field mappings
      const mappings = await this.loadFieldMappings(jobData.tenantId, jobData.syncType);

      // Determine if this is a delta or full sync
      const isFullSync =
        options.fullSync || jobData.syncType === SyncType.FULL_PRODUCT;

      let variations: PlentyVariation[];

      if (isFullSync) {
        log.info('Starting full product sync');
        variations = await plenty.getAllVariations(
          {
            with: DEFAULT_WITH_RELATIONS.join(','),
            itemsPerPage: options.batchSize || DEFAULT_BATCH_SIZE,
          },
          (page, total) => {
            log.debug('Fetching page', { page, total });
          }
        );
      } else {
        // Delta sync - get last sync time
        const lastSyncAt = await this.getLastSyncTime(jobData.tenantId);
        log.info('Starting delta product sync', { since: lastSyncAt?.toISOString() });

        if (lastSyncAt) {
          variations = await plenty.getVariationsDelta(lastSyncAt, DEFAULT_WITH_RELATIONS);
        } else {
          // No previous sync, do full sync
          log.warn('No previous sync found, performing full sync');
          variations = await plenty.getAllVariations({
            with: DEFAULT_WITH_RELATIONS.join(','),
            itemsPerPage: options.batchSize || DEFAULT_BATCH_SIZE,
          });
        }
      }

      log.info('Fetched variations', { count: variations.length });

      // Process each variation
      for (const variation of variations) {
        try {
          const syncResult = await this.syncVariation(
            variation,
            jobData.tenantId,
            shopware,
            mappings,
            options.skipExisting
          );

          result.itemsProcessed++;

          if (syncResult.action === 'create') {
            result.itemsCreated++;
          } else if (syncResult.action === 'update') {
            result.itemsUpdated++;
          } else if (syncResult.action === 'error') {
            result.itemsFailed++;
            result.errors.push({
              entityId: variation.id.toString(),
              entityType: 'variation',
              error: syncResult.error || 'Unknown error',
            });
          }

          // Log sync operation
          await this.logSyncOperation(
            jobData.tenantId,
            jobData.id,
            variation.id.toString(),
            syncResult.action,
            syncResult.success,
            syncResult
          );
        } catch (error) {
          result.itemsFailed++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push({
            entityId: variation.id.toString(),
            entityType: 'variation',
            error: errorMessage,
          });
          log.error('Failed to sync variation', { variationId: variation.id, error: errorMessage });
        }
      }

      // Update sync state
      await this.updateSyncState(jobData.tenantId, jobData.syncType);

      result.success = result.itemsFailed === 0;
      result.duration = Date.now() - startTime;

      log.info('Product sync completed', {
        processed: result.itemsProcessed,
        created: result.itemsCreated,
        updated: result.itemsUpdated,
        failed: result.itemsFailed,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push({
        entityId: '',
        entityType: 'sync',
        error: errorMessage,
      });
      log.error('Product sync failed', { error: errorMessage, result });
      throw error;
    }
  }

  /**
   * Check if config is stale and refresh if needed
   */
  private async checkAndRefreshConfig(
    jobData: DecryptedSyncJobData,
    log: ReturnType<typeof createJobLogger>
  ): Promise<void> {
    const configAge = await this.configProcessor.getConfigAge(jobData.tenantId);
    const thresholdHours = 6; // Default threshold

    if (configAge === null || configAge > thresholdHours) {
      log.info('Config is stale, refreshing', { ageHours: configAge });

      // Create a config sync job data
      const configJobData: DecryptedSyncJobData = {
        ...jobData,
        id: `config-refresh-${Date.now()}`,
        syncType: SyncType.CONFIG,
      };

      await this.configProcessor.process(configJobData);
      log.info('Config refreshed');
    }
  }

  /**
   * Sync a single variation to Shopware
   */
  private async syncVariation(
    variation: PlentyVariation,
    tenantId: string,
    shopware: IShopwareClient,
    mappings: FieldMapping[],
    skipExisting?: boolean
  ): Promise<{ action: string; success: boolean; error?: string }> {
    // Transform to Shopware format
    const product = await this.transformer.transform(variation, tenantId, mappings);

    // Check if product exists
    const exists = await shopware.productExists(product.productNumber);

    if (exists) {
      if (skipExisting) {
        return { action: 'skip', success: true };
      }
      // Update existing product
      const result = await shopware.updateProduct(product.productNumber, product);
      return {
        action: result.action,
        success: result.success,
        error: result.error,
      };
    } else {
      // Create new product
      const result = await shopware.createProduct(product);
      return {
        action: result.action,
        success: result.success,
        error: result.error,
      };
    }
  }

  /**
   * Load field mappings for a tenant
   */
  private async loadFieldMappings(
    tenantId: string,
    syncType: SyncType
  ): Promise<FieldMapping[]> {
    const mappings = await this.prisma.syncMapping.findMany({
      where: {
        tenantId,
        entityType: syncType,
      },
    });

    return mappings.map((m) => ({
      plentyField: m.plentyField,
      shopwareField: m.shopwareField,
      transformationRule: m.transformationRule as FieldMapping['transformationRule'],
      isRequired: m.isRequired,
      defaultValue: m.defaultValue || undefined,
    }));
  }

  /**
   * Get last successful sync time for delta sync
   */
  private async getLastSyncTime(tenantId: string): Promise<Date | null> {
    const state = await this.prisma.syncState.findUnique({
      where: {
        tenantId_syncType: {
          tenantId,
          syncType: 'PRODUCT_DELTA',
        },
      },
    });

    return state?.lastSuccessfulSyncAt || null;
  }

  /**
   * Update sync state after successful sync
   */
  private async updateSyncState(tenantId: string, syncType: SyncType): Promise<void> {
    const now = new Date();
    const syncTypeKey = syncType === SyncType.FULL_PRODUCT ? 'PRODUCT_DELTA' : syncType;

    await this.prisma.syncState.upsert({
      where: {
        tenantId_syncType: {
          tenantId,
          syncType: syncTypeKey,
        },
      },
      create: {
        tenantId,
        syncType: syncTypeKey,
        lastSyncAt: now,
        lastSuccessfulSyncAt: now,
      },
      update: {
        lastSyncAt: now,
        lastSuccessfulSyncAt: now,
      },
    });
  }

  /**
   * Log sync operation to database
   */
  private async logSyncOperation(
    tenantId: string,
    jobId: string,
    entityId: string,
    action: string,
    success: boolean,
    details: object
  ): Promise<void> {
    await this.prisma.syncLog.create({
      data: {
        tenantId,
        jobId,
        entityType: SyncType.PRODUCT_DELTA,
        entityId,
        action,
        success,
        details,
      },
    });
  }
}
