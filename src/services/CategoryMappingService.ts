import { PrismaClient, MappingType, MappingStatus } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';

export interface CategoryMappingRecord {
  plentyCategoryId: number;
  shopwareCategoryId: string;
  mappingType: 'MANUAL' | 'AUTO';
  lastSyncAction: 'create' | 'update';
}

export interface CategoryMappingLookup {
  [plentyCategoryId: number]: {
    shopwareCategoryId: string;
    mappingType: 'MANUAL' | 'AUTO';
  };
}

/**
 * Category Mapping Service
 * Manages the mapping between PlentyMarkets categories and Shopware categories
 */
export class CategoryMappingService {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'CategoryMappingService' });

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Get batch mappings for multiple category IDs
   * Returns a map of categoryId -> Shopware info
   */
  async getBatchMappings(
    tenantId: string,
    categoryIds: number[]
  ): Promise<CategoryMappingLookup> {
    if (categoryIds.length === 0) {
      return {};
    }

    const mappings = await this.prisma.categoryMapping.findMany({
      where: {
        tenantId,
        plentyCategoryId: {
          in: categoryIds,
        },
      },
      select: {
        plentyCategoryId: true,
        shopwareCategoryId: true,
        mappingType: true,
      },
    });

    const lookup: CategoryMappingLookup = {};
    for (const mapping of mappings) {
      lookup[mapping.plentyCategoryId] = {
        shopwareCategoryId: mapping.shopwareCategoryId,
        mappingType: mapping.mappingType,
      };
    }

    this.log.debug('Loaded batch category mappings', {
      tenantId,
      requested: categoryIds.length,
      found: Object.keys(lookup).length,
    });

    return lookup;
  }

  /**
   * Upsert multiple mappings at once (transaction)
   */
  async upsertMappings(
    tenantId: string,
    records: CategoryMappingRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    this.log.debug('Upserting category mappings', { tenantId, count: records.length });

    const now = new Date();

    // Use transaction to ensure all mappings are saved together
    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.categoryMapping.upsert({
          where: {
            tenantId_plentyCategoryId: {
              tenantId,
              plentyCategoryId: record.plentyCategoryId,
            },
          },
          create: {
            tenantId,
            plentyCategoryId: record.plentyCategoryId,
            shopwareCategoryId: record.shopwareCategoryId,
            mappingType: record.mappingType,
            lastSyncedAt: now,
            lastSyncAction: record.lastSyncAction,
            status: MappingStatus.ACTIVE,
            lastSeenAt: now,
          },
          update: {
            shopwareCategoryId: record.shopwareCategoryId,
            mappingType: record.mappingType,
            lastSyncedAt: now,
            lastSyncAction: record.lastSyncAction,
            status: MappingStatus.ACTIVE,
            lastSeenAt: now,
          },
        })
      )
    );

    this.log.info('Category mappings upserted successfully', {
      tenantId,
      count: records.length,
    });
  }

  /**
   * Get a single mapping by plenty category ID
   */
  async getMapping(
    tenantId: string,
    plentyCategoryId: number
  ): Promise<{ shopwareCategoryId: string; mappingType: string } | null> {
    const mapping = await this.prisma.categoryMapping.findUnique({
      where: {
        tenantId_plentyCategoryId: {
          tenantId,
          plentyCategoryId,
        },
      },
      select: {
        shopwareCategoryId: true,
        mappingType: true,
      },
    });

    return mapping;
  }

  /**
   * Delete mappings by plenty category IDs
   */
  async deleteMappingsByCategoryIds(
    tenantId: string,
    categoryIds: number[]
  ): Promise<number> {
    if (categoryIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.categoryMapping.deleteMany({
      where: {
        tenantId,
        plentyCategoryId: {
          in: categoryIds,
        },
      },
    });

    this.log.info('Deleted category mappings', {
      tenantId,
      count: result.count,
    });

    return result.count;
  }

  /**
   * Get count of mappings for a tenant
   */
  async getMappingCount(tenantId: string): Promise<number> {
    return this.prisma.categoryMapping.count({
      where: { tenantId },
    });
  }

  /**
   * Get all manual mappings for a tenant
   */
  async getManualMappings(tenantId: string): Promise<CategoryMappingRecord[]> {
    const mappings = await this.prisma.categoryMapping.findMany({
      where: {
        tenantId,
        mappingType: MappingType.MANUAL,
      },
      select: {
        plentyCategoryId: true,
        shopwareCategoryId: true,
        mappingType: true,
        lastSyncAction: true,
      },
    });

    return mappings.map((m) => ({
      plentyCategoryId: m.plentyCategoryId,
      shopwareCategoryId: m.shopwareCategoryId,
      mappingType: m.mappingType,
      lastSyncAction: m.lastSyncAction as 'create' | 'update',
    }));
  }

  /**
   * Get all ACTIVE mappings for a tenant (for orphan detection)
   */
  async getAllActiveMappings(tenantId: string): Promise<number[]> {
    const mappings = await this.prisma.categoryMapping.findMany({
      where: {
        tenantId,
        status: MappingStatus.ACTIVE,
      },
      select: {
        plentyCategoryId: true,
      },
    });

    return mappings.map((m) => m.plentyCategoryId);
  }

  /**
   * Mark mappings as orphaned (no longer exist in Plenty)
   * Returns count of mappings marked as orphaned
   */
  async markAsOrphaned(tenantId: string, plentyIds: number[]): Promise<number> {
    if (plentyIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.categoryMapping.updateMany({
      where: {
        tenantId,
        plentyCategoryId: {
          in: plentyIds,
        },
        status: MappingStatus.ACTIVE,
      },
      data: {
        status: MappingStatus.ORPHANED,
      },
    });

    if (result.count > 0) {
      this.log.info('Marked category mappings as orphaned', {
        tenantId,
        count: result.count,
        plentyIds,
      });
    }

    return result.count;
  }

  /**
   * Get all orphaned mappings for a tenant
   */
  async getOrphanedMappings(tenantId: string): Promise<{
    plentyCategoryId: number;
    shopwareCategoryId: string;
  }[]> {
    const mappings = await this.prisma.categoryMapping.findMany({
      where: {
        tenantId,
        status: MappingStatus.ORPHANED,
      },
      select: {
        plentyCategoryId: true,
        shopwareCategoryId: true,
      },
    });

    return mappings;
  }

  /**
   * Reactivate orphaned mappings (if item reappears in Plenty)
   */
  async reactivateMappings(tenantId: string, plentyIds: number[]): Promise<number> {
    if (plentyIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.categoryMapping.updateMany({
      where: {
        tenantId,
        plentyCategoryId: {
          in: plentyIds,
        },
        status: MappingStatus.ORPHANED,
      },
      data: {
        status: MappingStatus.ACTIVE,
        lastSeenAt: new Date(),
      },
    });

    if (result.count > 0) {
      this.log.info('Reactivated orphaned category mappings', {
        tenantId,
        count: result.count,
      });
    }

    return result.count;
  }
}
