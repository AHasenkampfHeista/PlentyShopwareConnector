import { PrismaClient, PlentyCategory } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';
import { CategoryMappingService, CategoryMappingLookup, CategoryMappingRecord } from './CategoryMappingService';
import type { IShopwareClient } from '../clients/interfaces';
import type { ShopwareCategory } from '../types/shopware';
import type { PlentyVariation } from '../types/plenty';

/**
 * Category Sync Service
 * Orchestrates on-demand category creation in Shopware during product sync
 *
 * Key features:
 * - Respects manual mappings (never overwrite)
 * - Handles parent hierarchy (bottom-up creation)
 * - Uses PlentyCategory table as source of truth
 * - Extracts localized names from JSON
 */
export class CategorySyncService {
  private prisma: PrismaClient;
  private mappingService: CategoryMappingService;
  private categoryCache: Map<number, PlentyCategory> = new Map();
  private log = createLogger({ service: 'CategorySyncService' });

  constructor() {
    this.prisma = getPrismaClient();
    this.mappingService = new CategoryMappingService();
  }

  /**
   * Ensure categories exist in Shopware for a product variation
   * Returns map of plenty category ID -> shopware category ID
   *
   * Algorithm:
   * 1. Extract category IDs from variation.variationCategories
   * 2. Load existing mappings (manual + auto)
   * 3. For unmapped categories:
   *    a. Load from PlentyCategory cache
   *    b. Check if parent exists, create parent first (recursive)
   *    c. Transform to Shopware format
   *    d. Create in Shopware
   *    e. Store mapping as AUTO
   * 4. Return mapping lookup
   */
  async ensureCategoriesExist(
    tenantId: string,
    variation: PlentyVariation,
    shopware: IShopwareClient
  ): Promise<CategoryMappingLookup> {
    // Extract category IDs from variation
    const categoryIds = variation.variationCategories?.map((vc) => vc.categoryId) || [];

    if (categoryIds.length === 0) {
      return {};
    }

    this.log.debug('Ensuring categories exist', {
      variationId: variation.id,
      categoryCount: categoryIds.length,
    });

    // Load existing mappings
    const existingMappings = await this.mappingService.getBatchMappings(tenantId, categoryIds);

    // Find unmapped categories
    const unmappedCategoryIds = categoryIds.filter((id) => !existingMappings[id]);

    if (unmappedCategoryIds.length === 0) {
      this.log.debug('All categories already mapped', { variationId: variation.id });
      return existingMappings;
    }

    this.log.info('Creating missing categories', {
      variationId: variation.id,
      unmappedCount: unmappedCategoryIds.length,
    });

    // Create missing categories
    const newMappings: CategoryMappingRecord[] = [];

    for (const categoryId of unmappedCategoryIds) {
      try {
        const shopwareCategoryId = await this.createCategoryInShopware(
          tenantId,
          categoryId,
          shopware,
          existingMappings
        );

        // Store the new mapping
        newMappings.push({
          plentyCategoryId: categoryId,
          shopwareCategoryId,
          mappingType: 'AUTO',
          lastSyncAction: 'create',
        });

        // Update local lookup for subsequent categories
        existingMappings[categoryId] = {
          shopwareCategoryId,
          mappingType: 'AUTO',
        };
      } catch (error) {
        this.log.error('Failed to create category', {
          categoryId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other categories
      }
    }

    // Save all new mappings to database
    if (newMappings.length > 0) {
      await this.mappingService.upsertMappings(tenantId, newMappings);
    }

    return existingMappings;
  }

  /**
   * Create a single category in Shopware
   * Handles parent creation recursively
   * Returns the Shopware category ID
   */
  private async createCategoryInShopware(
    tenantId: string,
    plentyCategoryId: number,
    shopware: IShopwareClient,
    existingMappings: CategoryMappingLookup,
    visitedIds: Set<number> = new Set()
  ): Promise<string> {
    // Detect circular references
    if (visitedIds.has(plentyCategoryId)) {
      throw new Error(`Circular category reference detected for category ${plentyCategoryId}`);
    }
    visitedIds.add(plentyCategoryId);

    // Load category from cache
    const plentyCategory = await this.getCachedPlentyCategory(tenantId, plentyCategoryId);

    if (!plentyCategory) {
      throw new Error(`Category ${plentyCategoryId} not found in PlentyCategory cache`);
    }

    // Check if parent exists, create if needed
    let parentShopwareId: string | undefined;

    if (plentyCategory.parentId) {
      // Check if parent is already mapped
      const parentMapping = existingMappings[plentyCategory.parentId];

      if (parentMapping) {
        parentShopwareId = parentMapping.shopwareCategoryId;
      } else {
        // Recursively create parent first
        this.log.debug('Creating parent category first', {
          categoryId: plentyCategoryId,
          parentId: plentyCategory.parentId,
        });

        parentShopwareId = await this.createCategoryInShopware(
          tenantId,
          plentyCategory.parentId,
          shopware,
          existingMappings,
          visitedIds
        );

        // Update mapping for subsequent siblings
        existingMappings[plentyCategory.parentId] = {
          shopwareCategoryId: parentShopwareId,
          mappingType: 'AUTO',
        };
      }
    }

    // Transform to Shopware format
    const shopwareCategory = await this.transformCategory(
      tenantId,
      plentyCategory,
      parentShopwareId
    );

    // Create in Shopware
    this.log.info('Creating category in Shopware', {
      plentyCategoryId,
      name: shopwareCategory.name,
      parentId: parentShopwareId,
    });

    const result = await shopware.createCategory(shopwareCategory);

    if (!result.success) {
      throw new Error(`Failed to create category in Shopware: ${result.error || 'Unknown error'}`);
    }

    return result.id;
  }

  /**
   * Transform PlentyCategory to ShopwareCategory
   */
  private async transformCategory(
    tenantId: string,
    plentyCategory: PlentyCategory,
    parentShopwareId?: string
  ): Promise<ShopwareCategory> {
    // Extract name from localized names (prefer de -> en -> first available)
    let categoryName = 'Unnamed Category';

    if (plentyCategory.names && typeof plentyCategory.names === 'object') {
      const names = plentyCategory.names as Record<string, string>;
      categoryName = names.de || names.en || Object.values(names)[0] || 'Unnamed Category';
    }

    return {
      id: '', // Will be generated by Shopware
      parentId: parentShopwareId,
      name: categoryName,
      active: true,
      visible: true,
      level: plentyCategory.level,
      _plentyCategoryId: plentyCategory.id,
    };
  }

  /**
   * Get category from local cache (PlentyCategory table)
   */
  private async getCachedPlentyCategory(
    tenantId: string,
    categoryId: number
  ): Promise<PlentyCategory | null> {
    // Check in-memory cache first
    if (this.categoryCache.has(categoryId)) {
      return this.categoryCache.get(categoryId)!;
    }

    // Load from database
    const category = await this.prisma.plentyCategory.findUnique({
      where: {
        tenantId_id: {
          tenantId,
          id: categoryId,
        },
      },
    });

    if (category) {
      this.categoryCache.set(categoryId, category);
    }

    return category;
  }

  /**
   * Clear the in-memory category cache
   */
  clearCache(): void {
    this.categoryCache.clear();
  }
}
