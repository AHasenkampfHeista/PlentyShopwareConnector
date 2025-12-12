import { PrismaClient, MappingType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';

export interface ManufacturerMappingRecord {
  plentyManufacturerId: number;
  shopwareManufacturerId: string;
  mappingType: 'MANUAL' | 'AUTO';
  lastSyncAction: 'create' | 'update';
}

export interface ManufacturerMappingLookup {
  [plentyManufacturerId: number]: {
    shopwareManufacturerId: string;
    mappingType: 'MANUAL' | 'AUTO';
  };
}

/**
 * Manufacturer Mapping Service
 * Manages the mapping between PlentyMarkets manufacturers and Shopware manufacturers
 */
export class ManufacturerMappingService {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'ManufacturerMappingService' });

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Get batch mappings for multiple manufacturer IDs
   * Returns a map of manufacturerId -> Shopware info
   */
  async getBatchMappings(
    tenantId: string,
    manufacturerIds: number[]
  ): Promise<ManufacturerMappingLookup> {
    if (manufacturerIds.length === 0) {
      return {};
    }

    const mappings = await this.prisma.manufacturerMapping.findMany({
      where: {
        tenantId,
        plentyManufacturerId: {
          in: manufacturerIds,
        },
      },
      select: {
        plentyManufacturerId: true,
        shopwareManufacturerId: true,
        mappingType: true,
      },
    });

    const lookup: ManufacturerMappingLookup = {};
    for (const mapping of mappings) {
      lookup[mapping.plentyManufacturerId] = {
        shopwareManufacturerId: mapping.shopwareManufacturerId,
        mappingType: mapping.mappingType,
      };
    }

    this.log.debug('Loaded batch manufacturer mappings', {
      tenantId,
      requested: manufacturerIds.length,
      found: Object.keys(lookup).length,
    });

    return lookup;
  }

  /**
   * Upsert multiple mappings at once (transaction)
   */
  async upsertMappings(
    tenantId: string,
    records: ManufacturerMappingRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    this.log.debug('Upserting manufacturer mappings', { tenantId, count: records.length });

    // Use transaction to ensure all mappings are saved together
    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.manufacturerMapping.upsert({
          where: {
            tenantId_plentyManufacturerId: {
              tenantId,
              plentyManufacturerId: record.plentyManufacturerId,
            },
          },
          create: {
            tenantId,
            plentyManufacturerId: record.plentyManufacturerId,
            shopwareManufacturerId: record.shopwareManufacturerId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
          update: {
            shopwareManufacturerId: record.shopwareManufacturerId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
        })
      )
    );

    this.log.info('Manufacturer mappings upserted successfully', {
      tenantId,
      count: records.length,
    });
  }

  /**
   * Get a single mapping by plenty manufacturer ID
   */
  async getMapping(
    tenantId: string,
    plentyManufacturerId: number
  ): Promise<{ shopwareManufacturerId: string; mappingType: string } | null> {
    const mapping = await this.prisma.manufacturerMapping.findUnique({
      where: {
        tenantId_plentyManufacturerId: {
          tenantId,
          plentyManufacturerId,
        },
      },
      select: {
        shopwareManufacturerId: true,
        mappingType: true,
      },
    });

    return mapping;
  }

  /**
   * Delete mappings by plenty manufacturer IDs
   */
  async deleteMappingsByManufacturerIds(
    tenantId: string,
    manufacturerIds: number[]
  ): Promise<number> {
    if (manufacturerIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.manufacturerMapping.deleteMany({
      where: {
        tenantId,
        plentyManufacturerId: {
          in: manufacturerIds,
        },
      },
    });

    this.log.info('Deleted manufacturer mappings', {
      tenantId,
      count: result.count,
    });

    return result.count;
  }

  /**
   * Get count of mappings for a tenant
   */
  async getMappingCount(tenantId: string): Promise<number> {
    return this.prisma.manufacturerMapping.count({
      where: { tenantId },
    });
  }

  /**
   * Get all manual mappings for a tenant
   */
  async getManualMappings(tenantId: string): Promise<ManufacturerMappingRecord[]> {
    const mappings = await this.prisma.manufacturerMapping.findMany({
      where: {
        tenantId,
        mappingType: MappingType.MANUAL,
      },
      select: {
        plentyManufacturerId: true,
        shopwareManufacturerId: true,
        mappingType: true,
        lastSyncAction: true,
      },
    });

    return mappings.map((m) => ({
      plentyManufacturerId: m.plentyManufacturerId,
      shopwareManufacturerId: m.shopwareManufacturerId,
      mappingType: m.mappingType,
      lastSyncAction: m.lastSyncAction as 'create' | 'update',
    }));
  }
}
