import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';

export interface ProductMappingRecord {
  plentyItemId: number;
  plentyVariationId: number;
  shopwareProductId: string;
  shopwareProductNumber: string;
  lastSyncAction: 'create' | 'update';
}

export interface ProductMappingLookup {
  [variationId: number]: {
    shopwareProductId: string;
    shopwareProductNumber: string;
  };
}

/**
 * Product Mapping Service
 * Manages the mapping between PlentyMarkets variations and Shopware products
 */
export class ProductMappingService {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'ProductMappingService' });

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Get batch mappings for multiple variation IDs
   * Returns a map of variationId -> Shopware info
   */
  async getBatchMappings(
    tenantId: string,
    variationIds: number[]
  ): Promise<ProductMappingLookup> {
    if (variationIds.length === 0) {
      return {};
    }

    const mappings = await this.prisma.productMapping.findMany({
      where: {
        tenantId,
        plentyVariationId: {
          in: variationIds,
        },
      },
      select: {
        plentyVariationId: true,
        shopwareProductId: true,
        shopwareProductNumber: true,
      },
    });

    const lookup: ProductMappingLookup = {};
    for (const mapping of mappings) {
      lookup[mapping.plentyVariationId] = {
        shopwareProductId: mapping.shopwareProductId,
        shopwareProductNumber: mapping.shopwareProductNumber,
      };
    }

    this.log.debug('Loaded batch mappings', {
      tenantId,
      requested: variationIds.length,
      found: Object.keys(lookup).length,
    });

    return lookup;
  }

  /**
   * Upsert multiple mappings at once (transaction)
   */
  async upsertMappings(
    tenantId: string,
    records: ProductMappingRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    this.log.debug('Upserting mappings', { tenantId, count: records.length });

    // Use transaction to ensure all mappings are saved together
    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.productMapping.upsert({
          where: {
            tenantId_plentyVariationId: {
              tenantId,
              plentyVariationId: record.plentyVariationId,
            },
          },
          create: {
            tenantId,
            plentyItemId: record.plentyItemId,
            plentyVariationId: record.plentyVariationId,
            shopwareProductId: record.shopwareProductId,
            shopwareProductNumber: record.shopwareProductNumber,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
          update: {
            shopwareProductId: record.shopwareProductId,
            shopwareProductNumber: record.shopwareProductNumber,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
        })
      )
    );

    this.log.info('Mappings upserted successfully', {
      tenantId,
      count: records.length,
    });
  }

  /**
   * Get a single mapping by variation ID
   */
  async getMapping(
    tenantId: string,
    variationId: number
  ): Promise<{ shopwareProductId: string; shopwareProductNumber: string } | null> {
    const mapping = await this.prisma.productMapping.findUnique({
      where: {
        tenantId_plentyVariationId: {
          tenantId,
          plentyVariationId: variationId,
        },
      },
      select: {
        shopwareProductId: true,
        shopwareProductNumber: true,
      },
    });

    return mapping;
  }

  /**
   * Delete mappings by variation IDs
   */
  async deleteMappingsByVariationIds(
    tenantId: string,
    variationIds: number[]
  ): Promise<number> {
    if (variationIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.productMapping.deleteMany({
      where: {
        tenantId,
        plentyVariationId: {
          in: variationIds,
        },
      },
    });

    this.log.info('Deleted mappings', {
      tenantId,
      count: result.count,
    });

    return result.count;
  }

  /**
   * Get count of mappings for a tenant
   */
  async getMappingCount(tenantId: string): Promise<number> {
    return this.prisma.productMapping.count({
      where: { tenantId },
    });
  }
}
