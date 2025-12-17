import { PrismaClient, SyncType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createJobLogger } from '../utils/logger';
import { PlentyClient } from '../clients/PlentyClient';
import type { PlentyClientConfig } from '../clients/PlentyClient';
import { createShopwareClient } from '../clients/ShopwareClientFactory';
import type { IShopwareClient } from '../clients/interfaces';
import type { PlentyVariation, PlentyItemImage } from '../types/plenty';
import type { DecryptedSyncJobData, SyncResult, FieldMapping } from '../types/sync';
import type { ShopwareBulkProduct } from '../types/shopware';
import { ProductTransformer, TransformContext } from '../transformers/ProductTransformer';
import { ConfigSyncProcessor } from './ConfigSyncProcessor';
import { ProductMappingService } from '../services/ProductMappingService';
import type { ProductMappingRecord } from '../services/ProductMappingService';

const DEFAULT_BATCH_SIZE = 100;
const BULK_SYNC_BATCH_SIZE = 100;

// Updated relations to support full product structure
const DEFAULT_WITH_RELATIONS = [
  'variationSalesPrices',
  'variationBarcodes',
  'variationAttributeValues',
  'variationCategories',
  'variationProperties',  // For Plenty Properties
  'variationTexts',       // For multi-language
  'variationImages',      // For variation-specific image links
  'stock',
  'item',                 // For mainVariationId and parent-child relationship
];

export interface ProductSyncOptions {
  fullSync?: boolean;
  batchSize?: number;
  skipExisting?: boolean;
  skipImages?: boolean;  // Option to skip image sync for faster processing
}

/**
 * Represents a group of variations belonging to the same item
 */
interface VariationGroup {
  itemId: number;
  mainVariation: PlentyVariation;
  childVariations: PlentyVariation[];
}

/**
 * Product Sync Processor
 * Handles FULL_PRODUCT and PRODUCT_DELTA sync types
 * Supports parent-child product structure with two-phase sync
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
      // Ensure config exists
      await this.ensureConfigExists(jobData.tenantId, log);

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

      // Get Shopware system defaults (required for product creation)
      // First try from config, then fetch from API and cache
      const shopwareDefaults = await this.getOrFetchShopwareDefaults(
        jobData.tenantId,
        shopware,
        log
      );

      // Get sales channel ID for product visibility
      const { TenantConfigService } = await import('../services/TenantConfigService');
      const configService = new TenantConfigService();
      const salesChannelId = await configService.getShopwareSalesChannelId(jobData.tenantId);

      if (!salesChannelId) {
        log.warn(
          'No shopwareSalesChannelId configured! Products will NOT appear in storefront. ' +
          'Set shopwareSalesChannelId in tenant_configs to enable product visibility.'
        );
      }

      log.info('Using Shopware defaults', {
        taxId: shopwareDefaults.taxId,
        taxRate: shopwareDefaults.taxRate,
        currencyId: shopwareDefaults.currencyId,
        salesChannelId: salesChannelId || '(not configured)',
      });

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
        // Delta sync
        const lastSyncAt = await this.getLastSyncTime(jobData.tenantId);

        if (lastSyncAt) {
          log.info('Starting delta product sync', { since: lastSyncAt.toISOString() });
          variations = await plenty.getVariationsDelta(lastSyncAt, DEFAULT_WITH_RELATIONS);
        } else {
          log.warn('No previous sync state found. Performing full sync.');
          variations = await plenty.getAllVariations({
            with: DEFAULT_WITH_RELATIONS.join(','),
            itemsPerPage: options.batchSize || DEFAULT_BATCH_SIZE,
            'itemId': 23423
          });
        }
      }

      log.info('Fetched variations', { count: variations.length });

      if (variations.length === 0) {
        log.info('No variations to sync');
        result.duration = Date.now() - startTime;
        return result;
      }

      // Group variations by item for parent-child processing
      const variationGroups = this.groupVariationsByItem(variations);
      log.info('Grouped variations by item', {
        groups: variationGroups.length,
        totalVariations: variations.length,
      });

      // Fetch images for all items if not skipped
      let itemImages: Map<number, PlentyItemImage[]> | undefined;
      if (!options.skipImages) {
        const itemIds = variationGroups.map((g) => g.itemId);
        log.info('Fetching images for items', { itemCount: itemIds.length, itemIds });
        itemImages = await plenty.getBatchItemImages(itemIds);

        // Log detailed image counts per item
        const totalImages = Array.from(itemImages.values()).reduce((sum, imgs) => sum + imgs.length, 0);
        const itemsWithImages = Array.from(itemImages.entries()).filter(([, imgs]) => imgs.length > 0).length;

        log.info('Fetched item images', {
          itemCount: itemIds.length,
          itemsWithImages,
          totalImages,
        });

        // Log ALL images with their IDs, URLs, and variation links for debugging
        for (const [itemId, images] of itemImages.entries()) {
          log.info('Item images detail', {
            itemId,
            imageCount: images.length,
            images: images.map(img => ({
              id: img.id,
              url: img.url,
              position: img.position,
              variationLinkCount: img.variationLinks?.length || 0,
              linkedVariationIds: img.variationLinks?.map(vl => vl.variationId) || [],
            })),
          });
        }
      }

      // Create transform context with Shopware defaults
      const transformContext: TransformContext = {
        tenantId: jobData.tenantId,
        shopwareClient: shopware,
        itemImages,
        customMappings: mappings,
        // Shopware system defaults (required for products)
        defaultTaxId: shopwareDefaults.taxId,
        defaultTaxRate: shopwareDefaults.taxRate,
        defaultCurrencyId: shopwareDefaults.currencyId,
        // Sales channel for product visibility in storefront
        salesChannelId: salesChannelId || undefined,
      };

      // Load existing mappings for all variations
      const variationIds = variations.map((v) => v.id);
      const existingMappings = await this.mappingService.getBatchMappings(
        jobData.tenantId,
        variationIds
      );
      log.info('Loaded existing mappings', { count: Object.keys(existingMappings).length });

      // ============================================
      // PHASE 1: SYNC PARENT PRODUCTS (Main Variations)
      // ============================================
      log.info('Phase 1: Syncing parent products', { count: variationGroups.length });

      const parentMappingRecords: ProductMappingRecord[] = [];
      const parentResults = new Map<number, { shopwareProductId: string; success: boolean }>();

      // Process parent variations in batches
      const parentBatches = this.createBatches(variationGroups, BULK_SYNC_BATCH_SIZE);

      for (let batchIndex = 0; batchIndex < parentBatches.length; batchIndex++) {
        const batch = parentBatches[batchIndex];
        log.debug('Processing parent batch', { batch: batchIndex + 1, total: parentBatches.length });

        try {
          // Ensure categories and attributes exist for each variation
          await this.ensureDependencies(batch.map((g) => g.mainVariation), jobData.tenantId, shopware, log);

          // Transform parent variations
          const parentProducts: ShopwareBulkProduct[] = [];
          for (const group of batch) {
            try {
              const product = await this.transformer.transformAsParent(
                group.mainVariation,
                transformContext
              );

              // Log media count from transformer
              if (product.media && product.media.length > 0) {
                log.info('Transform returned media', {
                  variationId: group.mainVariation.id,
                  mediaCount: product.media.length,
                });
              } else {
                log.debug('Transform returned no media', {
                  variationId: group.mainVariation.id,
                });
              }

              // Add existing Shopware ID if mapped
              const mapping = existingMappings[group.mainVariation.id];
              if (mapping) {
                product.id = mapping.shopwareProductId;
                // Remove visibilities on update - they already exist and would cause duplicate key error
                // Media uses deterministic IDs so it can be upserted safely
                delete product.visibilities;
                log.info('Using existing mapping for parent', {
                  variationId: group.mainVariation.id,
                  shopwareProductId: mapping.shopwareProductId,
                  visibilitiesRemoved: true,
                });
              } else {
                log.info('No existing mapping for parent, creating new', {
                  variationId: group.mainVariation.id,
                  hasVisibilities: !!product.visibilities,
                });
              }

              product._plentyItemId = group.itemId;
              product._plentyVariationId = group.mainVariation.id;

              parentProducts.push(product as ShopwareBulkProduct);
            } catch (error) {
              log.warn('Failed to transform parent variation', {
                variationId: group.mainVariation.id,
                error: error instanceof Error ? error.message : String(error),
              });
              parentResults.set(group.mainVariation.id, { shopwareProductId: '', success: false });
            }
          }

          // Bulk sync parent products
          if (parentProducts.length > 0) {
            const bulkResult = await shopware.bulkSyncProducts(parentProducts);

            for (const itemResult of bulkResult.results) {
              result.itemsProcessed++;

              const product = parentProducts.find((p) => p.productNumber === itemResult.productNumber);
              const variationId = product?._plentyVariationId;

              if (itemResult.success) {
                if (itemResult.action === 'create') {
                  result.itemsCreated++;
                } else {
                  result.itemsUpdated++;
                }

                if (variationId) {
                  parentResults.set(variationId, {
                    shopwareProductId: itemResult.shopwareId,
                    success: true,
                  });

                  parentMappingRecords.push({
                    plentyItemId: product?._plentyItemId || 0,
                    plentyVariationId: variationId,
                    shopwareProductId: itemResult.shopwareId,
                    shopwareProductNumber: itemResult.productNumber,
                    isParent: true,
                    shopwareParentId: undefined,
                    lastSyncAction: itemResult.action,
                  });

                  // Clean up orphaned product_media (images deleted in Plenty)
                  if (product?.media !== undefined) {
                    const expectedMediaIds = product.media.map(m => m.id).filter((id): id is string => !!id);
                    const mediaCleanup = await shopware.syncProductMedia(itemResult.shopwareId, expectedMediaIds);
                    if (mediaCleanup.removed > 0) {
                      log.info('Cleaned up orphaned product media', {
                        productId: itemResult.shopwareId,
                        removed: mediaCleanup.removed,
                        kept: mediaCleanup.kept,
                      });
                    }
                  }
                }
              } else {
                result.itemsFailed++;
                result.errors.push({
                  entityId: itemResult.productNumber,
                  entityType: 'parent_variation',
                  error: itemResult.error || 'Unknown error',
                });

                if (variationId) {
                  parentResults.set(variationId, { shopwareProductId: '', success: false });
                }
              }
            }
          }
        } catch (error) {
          log.error('Failed to process parent batch', {
            batch: batchIndex + 1,
            error: error instanceof Error ? error.message : String(error),
          });

          // Mark all items in batch as failed
          for (const group of batch) {
            result.itemsProcessed++;
            result.itemsFailed++;
            parentResults.set(group.mainVariation.id, { shopwareProductId: '', success: false });
          }
        }
      }

      // Save parent mappings
      if (parentMappingRecords.length > 0) {
        await this.mappingService.upsertMappings(jobData.tenantId, parentMappingRecords);
        log.info('Saved parent mappings', { count: parentMappingRecords.length });
      }

      // ============================================
      // PHASE 2: SYNC CHILD PRODUCTS (Child Variations)
      // ============================================
      const allChildVariations: Array<{ variation: PlentyVariation; parentShopwareId: string }> = [];

      for (const group of variationGroups) {
        const parentResult = parentResults.get(group.mainVariation.id);

        // Skip children if parent failed or if there are no children
        if (!parentResult?.success || group.childVariations.length === 0) {
          continue;
        }

        for (const childVariation of group.childVariations) {
          allChildVariations.push({
            variation: childVariation,
            parentShopwareId: parentResult.shopwareProductId,
          });
        }
      }

      log.info('Phase 2: Syncing child products', { count: allChildVariations.length });

      if (allChildVariations.length > 0) {
        const childMappingRecords: ProductMappingRecord[] = [];
        const childBatches = this.createBatches(allChildVariations, BULK_SYNC_BATCH_SIZE);

        for (let batchIndex = 0; batchIndex < childBatches.length; batchIndex++) {
          const batch = childBatches[batchIndex];
          log.debug('Processing child batch', { batch: batchIndex + 1, total: childBatches.length });

          try {
            // Ensure dependencies for child variations
            await this.ensureDependencies(batch.map((c) => c.variation), jobData.tenantId, shopware, log);

            // Transform child variations
            const childProducts: ShopwareBulkProduct[] = [];
            for (const { variation, parentShopwareId } of batch) {
              try {
                const product = await this.transformer.transformAsChild(
                  variation,
                  parentShopwareId,
                  transformContext
                );

                // Add existing Shopware ID if mapped
                const mapping = existingMappings[variation.id];
                if (mapping) {
                  product.id = mapping.shopwareProductId;
                  // Media uses deterministic IDs so it can be upserted safely
                }

                product._plentyItemId = variation.itemId;
                product._plentyVariationId = variation.id;

                childProducts.push(product as ShopwareBulkProduct);
              } catch (error) {
                log.warn('Failed to transform child variation', {
                  variationId: variation.id,
                  error: error instanceof Error ? error.message : String(error),
                });
                result.itemsFailed++;
              }
            }

            // Bulk sync child products
            if (childProducts.length > 0) {
              const bulkResult = await shopware.bulkSyncProducts(childProducts);

              for (const itemResult of bulkResult.results) {
                result.itemsProcessed++;

                const product = childProducts.find((p) => p.productNumber === itemResult.productNumber);
                const variationId = product?._plentyVariationId;

                if (itemResult.success) {
                  if (itemResult.action === 'create') {
                    result.itemsCreated++;
                  } else {
                    result.itemsUpdated++;
                  }

                  if (variationId && product) {
                    childMappingRecords.push({
                      plentyItemId: product._plentyItemId || 0,
                      plentyVariationId: variationId,
                      shopwareProductId: itemResult.shopwareId,
                      shopwareProductNumber: itemResult.productNumber,
                      isParent: false,
                      shopwareParentId: product.parentId,
                      lastSyncAction: itemResult.action,
                    });

                    // Clean up orphaned product_media (images deleted in Plenty)
                    if (product.media !== undefined) {
                      const expectedMediaIds = product.media.map(m => m.id).filter((id): id is string => !!id);
                      const mediaCleanup = await shopware.syncProductMedia(itemResult.shopwareId, expectedMediaIds);
                      if (mediaCleanup.removed > 0) {
                        log.info('Cleaned up orphaned product media (child)', {
                          productId: itemResult.shopwareId,
                          removed: mediaCleanup.removed,
                          kept: mediaCleanup.kept,
                        });
                      }
                    }
                  }
                } else {
                  result.itemsFailed++;
                  result.errors.push({
                    entityId: itemResult.productNumber,
                    entityType: 'child_variation',
                    error: itemResult.error || 'Unknown error',
                  });
                }
              }
            }
          } catch (error) {
            log.error('Failed to process child batch', {
              batch: batchIndex + 1,
              error: error instanceof Error ? error.message : String(error),
            });

            // Mark all items in batch as failed
            for (const { variation } of batch) {
              result.itemsProcessed++;
              result.itemsFailed++;
              result.errors.push({
                entityId: variation.id.toString(),
                entityType: 'child_variation',
                error: error instanceof Error ? error.message : 'Batch processing failed',
              });
            }
          }
        }

        // Save child mappings
        if (childMappingRecords.length > 0) {
          await this.mappingService.upsertMappings(jobData.tenantId, childMappingRecords);
          log.info('Saved child mappings', { count: childMappingRecords.length });
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

  // ============================================
  // GROUPING LOGIC
  // ============================================

  /**
   * Group variations by itemId for parent-child processing
   * Main variations become parents, other variations become children
   */
  private groupVariationsByItem(variations: PlentyVariation[]): VariationGroup[] {
    const groups = new Map<number, VariationGroup>();

    for (const variation of variations) {
      const itemId = variation.itemId;

      if (!groups.has(itemId)) {
        groups.set(itemId, {
          itemId,
          mainVariation: null!,
          childVariations: [],
        });
      }

      const group = groups.get(itemId)!;

      if (variation.isMain) {
        group.mainVariation = variation;
      } else {
        group.childVariations.push(variation);
      }
    }

    // Handle edge cases and filter valid groups
    const validGroups: VariationGroup[] = [];

    for (const group of groups.values()) {
      if (group.mainVariation) {
        // Normal case: has main variation
        validGroups.push(group);
      } else if (group.childVariations.length > 0) {
        // Edge case: no main variation found - use first child as "main"
        // This can happen in delta sync when main variation wasn't updated
        group.mainVariation = group.childVariations.shift()!;
        validGroups.push(group);
      }
      // Skip groups with no variations (shouldn't happen)
    }

    return validGroups;
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

  // ============================================
  // DEPENDENCY MANAGEMENT
  // ============================================

  /**
   * Ensure categories, attributes, and properties exist before syncing products
   */
  private async ensureDependencies(
    variations: PlentyVariation[],
    tenantId: string,
    shopware: IShopwareClient,
    log: ReturnType<typeof createJobLogger>
  ): Promise<void> {
    const { CategorySyncService } = await import('../services/CategorySyncService');
    const { AttributeSyncService } = await import('../services/AttributeSyncService');
    const { PropertySyncService } = await import('../services/PropertySyncService');

    const categorySyncService = new CategorySyncService();
    const attributeSyncService = new AttributeSyncService();
    const propertySyncService = new PropertySyncService();

    for (const variation of variations) {
      // Ensure categories
      try {
        await categorySyncService.ensureCategoriesExist(tenantId, variation, shopware);
      } catch (error) {
        log.warn('Failed to ensure categories exist', {
          variationId: variation.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Ensure attributes (variant-defining)
      try {
        await attributeSyncService.ensureAttributesExist(tenantId, variation, shopware);
      } catch (error) {
        log.warn('Failed to ensure attributes exist', {
          variationId: variation.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Ensure properties (informational)
      try {
        await propertySyncService.ensurePropertiesExist(tenantId, variation, shopware);
      } catch (error) {
        log.warn('Failed to ensure properties exist', {
          variationId: variation.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // ============================================
  // CONFIG & STATE MANAGEMENT
  // ============================================

  /**
   * Get Shopware system defaults from config or fetch from API
   * Caches the values in TenantConfig for future use
   */
  private async getOrFetchShopwareDefaults(
    tenantId: string,
    shopware: IShopwareClient,
    log: ReturnType<typeof createJobLogger>
  ): Promise<{ taxId: string; taxRate: number; currencyId: string }> {
    const { TenantConfigService } = await import('../services/TenantConfigService');
    const configService = new TenantConfigService();

    // Try to get from config first
    const cachedDefaults = await configService.getShopwareDefaults(tenantId);

    if (cachedDefaults) {
      log.debug('Using cached Shopware defaults from config', cachedDefaults);
      return cachedDefaults;
    }

    // Not in config - fetch from Shopware API
    log.info('Shopware defaults not in config, fetching from API...');

    const [defaultTax, defaultCurrency] = await Promise.all([
      shopware.getDefaultTax(),
      shopware.getDefaultCurrency(),
    ]);

    if (!defaultTax) {
      throw new Error(
        'Failed to fetch default tax from Shopware. ' +
        'Please configure shopwareDefaultTaxId and shopwareDefaultTaxRate in tenant_configs manually.'
      );
    }
    if (!defaultCurrency) {
      throw new Error(
        'Failed to fetch default currency from Shopware. ' +
        'Please configure shopwareDefaultCurrencyId in tenant_configs manually.'
      );
    }

    const defaults = {
      taxId: defaultTax.id,
      taxRate: defaultTax.taxRate,
      currencyId: defaultCurrency.id,
    };

    // Save to config for future use
    await configService.setShopwareDefaults(tenantId, defaults);
    log.info('Fetched and cached Shopware defaults', defaults);

    return defaults;
  }

  /**
   * Ensure config exists
   */
  private async ensureConfigExists(
    tenantId: string,
    log: ReturnType<typeof createJobLogger>
  ): Promise<void> {
    const syncState = await this.prisma.syncState.findUnique({
      where: {
        tenantId_syncType: {
          tenantId,
          syncType: 'CONFIG',
        },
      },
    });

    if (!syncState || !syncState.lastSuccessfulSyncAt) {
      const errorMsg = 'Config not found. Please run CONFIG sync first before syncing products.';
      log.error(errorMsg);
      throw new Error(errorMsg);
    }

    log.debug('Config exists', {
      lastSyncedAt: syncState.lastSuccessfulSyncAt,
      ageHours: Math.round((Date.now() - syncState.lastSuccessfulSyncAt.getTime()) / (1000 * 60 * 60)),
    });
  }

  /**
   * Load field mappings
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
   * Get last sync time for delta sync
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
   * Update sync state
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
}
