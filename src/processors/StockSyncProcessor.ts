import { PrismaClient, SyncType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createJobLogger } from '../utils/logger';
import { PlentyClient } from '../clients/PlentyClient';
import type { PlentyClientConfig } from '../clients/PlentyClient';
import { createShopwareClient } from '../clients/ShopwareClientFactory';
import type { IShopwareClient } from '../clients/interfaces';
import { ProductMappingService } from '../services/ProductMappingService';
import type { PlentyStockManagementEntry } from '../types/plenty';
import type { DecryptedSyncJobData, SyncResult, SyncError } from '../types/sync';
import type { ShopwareStockUpdate } from '../types/shopware';

/**
 * Stock Sync Processor
 * Handles STOCK sync type
 *
 * Note: The Plenty stock management endpoint does not support updatedAt filtering,
 * so we fetch all stock data and update Shopware accordingly.
 */
export class StockSyncProcessor {
  private prisma: PrismaClient;
  private mappingService: ProductMappingService;

  constructor() {
    this.prisma = getPrismaClient();
    this.mappingService = new ProductMappingService();
  }

  /**
   * Process a stock sync job
   */
  async process(jobData: DecryptedSyncJobData): Promise<SyncResult> {
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
      log.info('Starting stock sync');

      // Initialize clients
      const plentyConfig: PlentyClientConfig = {
        baseUrl: jobData.plentyUrl,
        credentials: jobData.plentyCredentials,
      };
      const plenty = new PlentyClient(plentyConfig);
      await plenty.authenticate();

      const shopware: IShopwareClient = createShopwareClient({
        tenantId: jobData.tenantId,
      });
      await shopware.authenticate();

      // Fetch all stock data from Plenty
      log.info('Fetching stock from Plenty stock management endpoint');
      const stockEntries = await plenty.getStockManagement();
      log.info(`Fetched ${stockEntries.length} stock entries`);

      if (stockEntries.length === 0) {
        log.warn('No stock entries found');
        result.duration = Date.now() - startTime;
        return result;
      }

      // Group stock by variation ID and calculate total net stock per variation
      const stockByVariation = this.aggregateStockByVariation(stockEntries);
      log.info(`Aggregated stock for ${Object.keys(stockByVariation).length} variations`);

      // Get all product mappings for this tenant
      const variationIds = Object.keys(stockByVariation).map(Number);
      const mappings = await this.mappingService.getBatchMappings(jobData.tenantId, variationIds);
      const mappingCount = Object.keys(mappings).length;
      log.info(`Found ${mappingCount} product mappings`);

      if (mappingCount === 0) {
        log.warn('No product mappings found. Products may not be synced yet.');
        result.duration = Date.now() - startTime;
        return result;
      }

      // Prepare stock updates for Shopware
      const stockUpdates: ShopwareStockUpdate[] = [];
      for (const variationId of Object.keys(mappings).map(Number)) {
        const mapping = mappings[variationId];
        const totalStock = stockByVariation[variationId];
        if (totalStock !== undefined && mapping) {
          stockUpdates.push({
            id: mapping.shopwareProductId, // Use UUID for reliable lookup
            stock: totalStock,
          });
        }
      }

      log.info(`Prepared ${stockUpdates.length} stock updates for Shopware`);

      if (stockUpdates.length === 0) {
        log.warn('No stock updates to process');
        result.duration = Date.now() - startTime;
        return result;
      }

      // Update stock in Shopware (in batches)
      const batchSize = 100;
      const batches = this.createBatches(stockUpdates, batchSize);

      log.info(`Processing ${batches.length} batches of stock updates`);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        log.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} items)`);

        try {
          const batchResults = await shopware.batchUpdateStock(batch);

          for (const batchResult of batchResults) {
            result.itemsProcessed++;
            if (batchResult.success) {
              result.itemsUpdated++;
            } else {
              result.itemsFailed++;
              if (batchResult.error) {
                result.errors.push({
                  entityId: batchResult.id || 'unknown',
                  entityType: 'stock',
                  error: batchResult.error,
                });
              }
            }
          }
        } catch (error) {
          log.error(`Failed to process batch ${i + 1}`, { error });
          result.itemsFailed += batch.length;
          result.errors.push({
            entityId: `batch-${i + 1}`,
            entityType: 'stock-batch',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Update sync state
      await this.updateSyncState(jobData.tenantId, jobData.syncType);

      result.duration = Date.now() - startTime;
      log.info('Stock sync completed', {
        itemsProcessed: result.itemsProcessed,
        itemsUpdated: result.itemsUpdated,
        itemsFailed: result.itemsFailed,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({
        entityId: 'stock-sync',
        entityType: 'sync',
        error: errorMessage,
      });
      log.error('Stock sync failed', { error, result });
      throw error;
    }
  }

  /**
   * Aggregate stock by variation ID
   * Calculates total net stock for each variation across all warehouses
   */
  private aggregateStockByVariation(
    stockEntries: PlentyStockManagementEntry[]
  ): Record<number, number> {
    const stockByVariation: Record<number, number> = {};

    for (const entry of stockEntries) {
      const variationId = entry.variationId;
      const netStock = entry.stockNet || 0;

      if (!stockByVariation[variationId]) {
        stockByVariation[variationId] = 0;
      }
      stockByVariation[variationId] += netStock;
    }

    return stockByVariation;
  }

  /**
   * Create batches from an array
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Update sync state
   */
  private async updateSyncState(tenantId: string, syncType: SyncType): Promise<void> {
    const now = new Date();
    await this.prisma.syncState.upsert({
      where: {
        tenantId_syncType: {
          tenantId,
          syncType,
        },
      },
      create: {
        tenantId,
        syncType,
        lastSyncAt: now,
        lastSuccessfulSyncAt: now,
      },
      update: {
        lastSyncAt: now,
        lastSuccessfulSyncAt: now,
      },
    });
  }
}
