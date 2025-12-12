import { PrismaClient, MappingType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';

export interface SalesPriceMappingRecord {
  plentySalesPriceId: number;
  shopwarePriceId: string;
  mappingType: 'MANUAL' | 'AUTO';
  lastSyncAction: 'create' | 'update';
}

export interface SalesPriceMappingLookup {
  [plentySalesPriceId: number]: {
    shopwarePriceId: string;
    mappingType: 'MANUAL' | 'AUTO';
  };
}

/**
 * Sales Price Mapping Service
 * Manages the mapping between PlentyMarkets sales prices and Shopware prices
 */
export class SalesPriceMappingService {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'SalesPriceMappingService' });

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Get batch mappings for multiple sales price IDs
   * Returns a map of salesPriceId -> Shopware info
   */
  async getBatchMappings(
    tenantId: string,
    salesPriceIds: number[]
  ): Promise<SalesPriceMappingLookup> {
    if (salesPriceIds.length === 0) {
      return {};
    }

    const mappings = await this.prisma.salesPriceMapping.findMany({
      where: {
        tenantId,
        plentySalesPriceId: {
          in: salesPriceIds,
        },
      },
      select: {
        plentySalesPriceId: true,
        shopwarePriceId: true,
        mappingType: true,
      },
    });

    const lookup: SalesPriceMappingLookup = {};
    for (const mapping of mappings) {
      lookup[mapping.plentySalesPriceId] = {
        shopwarePriceId: mapping.shopwarePriceId,
        mappingType: mapping.mappingType,
      };
    }

    this.log.debug('Loaded batch sales price mappings', {
      tenantId,
      requested: salesPriceIds.length,
      found: Object.keys(lookup).length,
    });

    return lookup;
  }

  /**
   * Upsert multiple mappings at once (transaction)
   */
  async upsertMappings(
    tenantId: string,
    records: SalesPriceMappingRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    this.log.debug('Upserting sales price mappings', { tenantId, count: records.length });

    // Use transaction to ensure all mappings are saved together
    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.salesPriceMapping.upsert({
          where: {
            tenantId_plentySalesPriceId: {
              tenantId,
              plentySalesPriceId: record.plentySalesPriceId,
            },
          },
          create: {
            tenantId,
            plentySalesPriceId: record.plentySalesPriceId,
            shopwarePriceId: record.shopwarePriceId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
          update: {
            shopwarePriceId: record.shopwarePriceId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
        })
      )
    );

    this.log.info('Sales price mappings upserted successfully', {
      tenantId,
      count: records.length,
    });
  }

  /**
   * Get a single mapping by plenty sales price ID
   */
  async getMapping(
    tenantId: string,
    plentySalesPriceId: number
  ): Promise<{ shopwarePriceId: string; mappingType: string } | null> {
    const mapping = await this.prisma.salesPriceMapping.findUnique({
      where: {
        tenantId_plentySalesPriceId: {
          tenantId,
          plentySalesPriceId,
        },
      },
      select: {
        shopwarePriceId: true,
        mappingType: true,
      },
    });

    return mapping;
  }

  /**
   * Delete mappings by plenty sales price IDs
   */
  async deleteMappingsBySalesPriceIds(
    tenantId: string,
    salesPriceIds: number[]
  ): Promise<number> {
    if (salesPriceIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.salesPriceMapping.deleteMany({
      where: {
        tenantId,
        plentySalesPriceId: {
          in: salesPriceIds,
        },
      },
    });

    this.log.info('Deleted sales price mappings', {
      tenantId,
      count: result.count,
    });

    return result.count;
  }

  /**
   * Get count of mappings for a tenant
   */
  async getMappingCount(tenantId: string): Promise<number> {
    return this.prisma.salesPriceMapping.count({
      where: { tenantId },
    });
  }

  /**
   * Get all manual mappings for a tenant
   */
  async getManualMappings(tenantId: string): Promise<SalesPriceMappingRecord[]> {
    const mappings = await this.prisma.salesPriceMapping.findMany({
      where: {
        tenantId,
        mappingType: MappingType.MANUAL,
      },
      select: {
        plentySalesPriceId: true,
        shopwarePriceId: true,
        mappingType: true,
        lastSyncAction: true,
      },
    });

    return mappings.map((m) => ({
      plentySalesPriceId: m.plentySalesPriceId,
      shopwarePriceId: m.shopwarePriceId,
      mappingType: m.mappingType,
      lastSyncAction: m.lastSyncAction as 'create' | 'update',
    }));
  }
}
