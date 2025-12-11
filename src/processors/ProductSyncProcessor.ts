import { PrismaClient, SyncType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createJobLogger } from '../utils/logger';
import { PlentyClient } from '../clients/PlentyClient';
import type { PlentyClientConfig } from '../clients/PlentyClient';
import { MockShopwareClient } from '../clients/MockShopwareClient';
import type { IShopwareClient } from '../clients/interfaces';
import type { PlentyVariation } from '../types/plenty';
import type { DecryptedSyncJobData, SyncResult, FieldMapping } from '../types/sync';
import type { ShopwareBulkProduct } from '../types/shopware';
import { ProductTransformer } from '../transformers/ProductTransformer';
import { ConfigSyncProcessor } from './ConfigSyncProcessor';
import { ProductMappingService } from '../services/ProductMappingService';
import type { ProductMappingRecord } from '../services/ProductMappingService';

const DEFAULT_BATCH_SIZE = 100;
const BULK_SYNC_BATCH_SIZE = 100; // Batch size for bulk sync operations
const DEFAULT_WITH_RELATIONS = [
  'variationSalesPrices',
  'variationBarcodes',
  'variationAttributeValues',
  'variationCategories',
  'stock'
  // Start with minimal params - these are confirmed valid
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
  private mappingService: ProductMappingService;

  constructor() {
    this.prisma = getPrismaClient();
    this.transformer = new ProductTransformer();
    this.configProcessor = new ConfigSyncProcessor();
    this.mappingService = new ProductMappingService();
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
            'itemId': 23423
          },
          (page, total) => {
            log.debug('Fetching page', { page, total });
          }
        );
      } else {
        // Delta sync - get last sync time
        const lastSyncAt = await this.getLastSyncTime(jobData.tenantId);
        console.log(`\n>>> lastSyncAt ${lastSyncAt}  <<<\n`);

        if (lastSyncAt) {
          log.info('Starting delta product sync', { since: lastSyncAt.toISOString() });
          console.log(`\n>>> FETCHING since ${lastSyncAt.toISOString()}  <<<\n`);
          variations = await plenty.getVariationsDelta(lastSyncAt, DEFAULT_WITH_RELATIONS);
        } else {
          // No previous sync state found - do full sync
          log.warn(
            'No previous sync state found. This is expected after a reset. ' +
            'Performing FULL sync (not delta) to fetch all variations.'
          );
          variations = await plenty.getAllVariations({
            with: DEFAULT_WITH_RELATIONS.join(','),
            itemsPerPage: options.batchSize || DEFAULT_BATCH_SIZE,
          });
          log.info('Full sync completed, sync state will be created after successful sync');
        }
      }

      log.info('Fetched variations', { count: variations.length });
      console.log(`\n>>> FETCHED ${variations.length} VARIATIONS <<<\n`);

      // Load existing mappings for all variations
      const variationIds = variations.map((v) => v.id);
      const existingMappings = await this.mappingService.getBatchMappings(
        jobData.tenantId,
        variationIds
      );
      log.info('Loaded existing mappings', { count: Object.keys(existingMappings).length });

      // Split variations into batches
      const batches: PlentyVariation[][] = [];
      for (let i = 0; i < variations.length; i += BULK_SYNC_BATCH_SIZE) {
        batches.push(variations.slice(i, i + BULK_SYNC_BATCH_SIZE));
      }

      log.info('Processing in batches', { batches: batches.length, batchSize: BULK_SYNC_BATCH_SIZE });

      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        log.debug('Processing batch', { batch: batchIndex + 1, total: batches.length, items: batch.length });

        try {
          // Ensure categories exist before transforming products
          const { CategorySyncService } = await import('../services/CategorySyncService');
          const categorySyncService = new CategorySyncService();

          for (const variation of batch) {
            try {
              await categorySyncService.ensureCategoriesExist(
                jobData.tenantId,
                variation,
                shopware
              );
            } catch (error) {
              log.warn('Failed to ensure categories exist', {
                variationId: variation.id,
                error: error instanceof Error ? error.message : String(error),
              });
              // Continue - products will be created without category assignment
            }
          }

          // Ensure attributes and attribute values exist before transforming products
          const { AttributeSyncService } = await import('../services/AttributeSyncService');
          const attributeSyncService = new AttributeSyncService();

          for (const variation of batch) {
            try {
              await attributeSyncService.ensureAttributesExist(
                jobData.tenantId,
                variation,
                shopware
              );
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              const errorStack = error instanceof Error ? error.stack : undefined;

              console.error('❌ ATTRIBUTE SYNC FAILED:', {
                variationId: variation.id,
                variationNumber: variation.number,
                attributeValueCount: variation.variationAttributeValues?.length || 0,
                error: errorMessage,
                stack: errorStack,
              });

              log.warn('Failed to ensure attributes exist', {
                variationId: variation.id,
                error: errorMessage,
              });
              // Continue - products will be created without property assignment
            }
          }

          // Transform all variations in batch
          const bulkProducts: ShopwareBulkProduct[] = [];
          for (const variation of batch) {
            const product = await this.transformer.transform(variation, jobData.tenantId, mappings);

            // Add Shopware ID from mapping if exists
            const mapping = existingMappings[variation.id];
            if (mapping) {
              product.id = mapping.shopwareProductId;
            }

            // Add Plenty IDs for tracking
            product._plentyItemId = variation.itemId;
            product._plentyVariationId = variation.id;

            bulkProducts.push(product as ShopwareBulkProduct);
          }

          // Bulk sync the batch
          const bulkResult = await shopware.bulkSyncProducts(bulkProducts);

          // Process results and update mappings
          const mappingRecords: ProductMappingRecord[] = [];
          for (const itemResult of bulkResult.results) {
            result.itemsProcessed++;

            if (itemResult.success) {
              if (itemResult.action === 'create') {
                result.itemsCreated++;
              } else {
                result.itemsUpdated++;
              }

              // Find the corresponding product to get Plenty IDs
              const product = bulkProducts.find((p) => p.productNumber === itemResult.productNumber);
              if (product && product._plentyVariationId) {
                mappingRecords.push({
                  plentyItemId: product._plentyItemId || 0,
                  plentyVariationId: product._plentyVariationId,
                  shopwareProductId: itemResult.shopwareId,
                  shopwareProductNumber: itemResult.productNumber,
                  lastSyncAction: itemResult.action,
                });
              }

              // Log success
              await this.logSyncOperation(
                jobData.tenantId,
                jobData.id,
                product?._plentyVariationId?.toString() || itemResult.productNumber,
                itemResult.action,
                true,
                itemResult
              );
            } else {
              result.itemsFailed++;
              result.errors.push({
                entityId: itemResult.productNumber,
                entityType: 'variation',
                error: itemResult.error || 'Unknown error',
              });

              // Log failure
              await this.logSyncOperation(
                jobData.tenantId,
                jobData.id,
                itemResult.productNumber,
                'error',
                false,
                itemResult
              );
            }
          }

          // Update mappings for successful syncs
          if (mappingRecords.length > 0) {
            await this.mappingService.upsertMappings(jobData.tenantId, mappingRecords);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : undefined;

          console.error('❌ BATCH PROCESSING FAILED:', {
            batchIndex: batchIndex + 1,
            totalBatches: batches.length,
            batchSize: batch.length,
            error: errorMessage,
            stack: errorStack,
          });

          log.error('Failed to process batch', {
            batch: batchIndex + 1,
            error: errorMessage,
          });

          // Mark all items in batch as failed
          for (const variation of batch) {
            result.itemsProcessed++;
            result.itemsFailed++;
            result.errors.push({
              entityId: variation.id.toString(),
              entityType: 'variation',
              error: errorMessage,
            });
          }
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
      // Update existing product by SKU
      const result = await shopware.updateProductBySku(product.productNumber, product);
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
      transformationRule: m.transformationRule as unknown as FieldMapping['transformationRule'],
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
