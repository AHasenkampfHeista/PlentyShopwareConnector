import { PrismaClient, MappingType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';

export interface UnitMappingRecord {
  plentyUnitId: number;
  shopwareUnitId: string;
  mappingType: 'MANUAL' | 'AUTO';
  lastSyncAction: 'create' | 'update';
}

export interface UnitMappingLookup {
  [plentyUnitId: number]: {
    shopwareUnitId: string;
    mappingType: 'MANUAL' | 'AUTO';
  };
}

/**
 * Unit Mapping Service
 * Manages the mapping between PlentyMarkets units and Shopware units
 */
export class UnitMappingService {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'UnitMappingService' });

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Get batch mappings for multiple unit IDs
   * Returns a map of unitId -> Shopware info
   */
  async getBatchMappings(
    tenantId: string,
    unitIds: number[]
  ): Promise<UnitMappingLookup> {
    if (unitIds.length === 0) {
      return {};
    }

    const mappings = await this.prisma.unitMapping.findMany({
      where: {
        tenantId,
        plentyUnitId: {
          in: unitIds,
        },
      },
      select: {
        plentyUnitId: true,
        shopwareUnitId: true,
        mappingType: true,
      },
    });

    const lookup: UnitMappingLookup = {};
    for (const mapping of mappings) {
      lookup[mapping.plentyUnitId] = {
        shopwareUnitId: mapping.shopwareUnitId,
        mappingType: mapping.mappingType,
      };
    }

    this.log.debug('Loaded batch unit mappings', {
      tenantId,
      requested: unitIds.length,
      found: Object.keys(lookup).length,
    });

    return lookup;
  }

  /**
   * Upsert multiple mappings at once (transaction)
   */
  async upsertMappings(
    tenantId: string,
    records: UnitMappingRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    this.log.debug('Upserting unit mappings', { tenantId, count: records.length });

    // Use transaction to ensure all mappings are saved together
    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.unitMapping.upsert({
          where: {
            tenantId_plentyUnitId: {
              tenantId,
              plentyUnitId: record.plentyUnitId,
            },
          },
          create: {
            tenantId,
            plentyUnitId: record.plentyUnitId,
            shopwareUnitId: record.shopwareUnitId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
          update: {
            shopwareUnitId: record.shopwareUnitId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
        })
      )
    );

    this.log.info('Unit mappings upserted successfully', {
      tenantId,
      count: records.length,
    });
  }

  /**
   * Get a single mapping by plenty unit ID
   */
  async getMapping(
    tenantId: string,
    plentyUnitId: number
  ): Promise<{ shopwareUnitId: string; mappingType: string } | null> {
    const mapping = await this.prisma.unitMapping.findUnique({
      where: {
        tenantId_plentyUnitId: {
          tenantId,
          plentyUnitId,
        },
      },
      select: {
        shopwareUnitId: true,
        mappingType: true,
      },
    });

    return mapping;
  }

  /**
   * Delete mappings by plenty unit IDs
   */
  async deleteMappingsByUnitIds(
    tenantId: string,
    unitIds: number[]
  ): Promise<number> {
    if (unitIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.unitMapping.deleteMany({
      where: {
        tenantId,
        plentyUnitId: {
          in: unitIds,
        },
      },
    });

    this.log.info('Deleted unit mappings', {
      tenantId,
      count: result.count,
    });

    return result.count;
  }

  /**
   * Get count of mappings for a tenant
   */
  async getMappingCount(tenantId: string): Promise<number> {
    return this.prisma.unitMapping.count({
      where: { tenantId },
    });
  }

  /**
   * Get all manual mappings for a tenant
   */
  async getManualMappings(tenantId: string): Promise<UnitMappingRecord[]> {
    const mappings = await this.prisma.unitMapping.findMany({
      where: {
        tenantId,
        mappingType: MappingType.MANUAL,
      },
      select: {
        plentyUnitId: true,
        shopwareUnitId: true,
        mappingType: true,
        lastSyncAction: true,
      },
    });

    return mappings.map((m) => ({
      plentyUnitId: m.plentyUnitId,
      shopwareUnitId: m.shopwareUnitId,
      mappingType: m.mappingType,
      lastSyncAction: m.lastSyncAction as 'create' | 'update',
    }));
  }
}
