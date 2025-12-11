import { PrismaClient, MappingType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';

// ============================================
// ATTRIBUTE (PROPERTY GROUP) MAPPINGS
// ============================================

export interface AttributeMappingRecord {
  plentyAttributeId: number;
  shopwarePropertyGroupId: string;
  mappingType: 'MANUAL' | 'AUTO';
  lastSyncAction: 'create' | 'update';
}

export interface AttributeMappingLookup {
  [plentyAttributeId: number]: {
    shopwarePropertyGroupId: string;
    mappingType: 'MANUAL' | 'AUTO';
  };
}

// ============================================
// ATTRIBUTE VALUE (PROPERTY OPTION) MAPPINGS
// ============================================

export interface AttributeValueMappingRecord {
  plentyAttributeId: number;
  plentyAttributeValueId: number;
  shopwarePropertyGroupId: string;
  shopwarePropertyOptionId: string;
  mappingType: 'MANUAL' | 'AUTO';
  lastSyncAction: 'create' | 'update';
}

export interface AttributeValueMappingLookup {
  [plentyAttributeValueId: number]: {
    shopwarePropertyGroupId: string;
    shopwarePropertyOptionId: string;
    mappingType: 'MANUAL' | 'AUTO';
  };
}

/**
 * Attribute Mapping Service
 * Manages mappings for both:
 * - Attributes (PlentyMarkets Attributes → Shopware Property Groups)
 * - Attribute Values (PlentyMarkets Attribute Values → Shopware Property Options)
 */
export class AttributeMappingService {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'AttributeMappingService' });

  constructor() {
    this.prisma = getPrismaClient();
  }

  // ============================================
  // ATTRIBUTE (PROPERTY GROUP) METHODS
  // ============================================

  /**
   * Get batch attribute mappings for multiple attribute IDs
   */
  async getBatchAttributeMappings(
    tenantId: string,
    attributeIds: number[]
  ): Promise<AttributeMappingLookup> {
    if (attributeIds.length === 0) {
      return {};
    }

    const mappings = await this.prisma.attributeMapping.findMany({
      where: {
        tenantId,
        plentyAttributeId: {
          in: attributeIds,
        },
      },
      select: {
        plentyAttributeId: true,
        shopwarePropertyGroupId: true,
        mappingType: true,
      },
    });

    const lookup: AttributeMappingLookup = {};
    for (const mapping of mappings) {
      lookup[mapping.plentyAttributeId] = {
        shopwarePropertyGroupId: mapping.shopwarePropertyGroupId,
        mappingType: mapping.mappingType,
      };
    }

    this.log.debug('Loaded batch attribute mappings', {
      tenantId,
      requested: attributeIds.length,
      found: Object.keys(lookup).length,
    });

    return lookup;
  }

  /**
   * Upsert multiple attribute mappings at once (transaction)
   */
  async upsertAttributeMappings(
    tenantId: string,
    records: AttributeMappingRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    this.log.debug('Upserting attribute mappings', { tenantId, count: records.length });

    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.attributeMapping.upsert({
          where: {
            tenantId_plentyAttributeId: {
              tenantId,
              plentyAttributeId: record.plentyAttributeId,
            },
          },
          create: {
            tenantId,
            plentyAttributeId: record.plentyAttributeId,
            shopwarePropertyGroupId: record.shopwarePropertyGroupId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
          update: {
            shopwarePropertyGroupId: record.shopwarePropertyGroupId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
        })
      )
    );

    this.log.info('Attribute mappings upserted successfully', {
      tenantId,
      count: records.length,
    });
  }

  /**
   * Get a single attribute mapping
   */
  async getAttributeMapping(
    tenantId: string,
    plentyAttributeId: number
  ): Promise<{ shopwarePropertyGroupId: string; mappingType: string } | null> {
    const mapping = await this.prisma.attributeMapping.findUnique({
      where: {
        tenantId_plentyAttributeId: {
          tenantId,
          plentyAttributeId,
        },
      },
      select: {
        shopwarePropertyGroupId: true,
        mappingType: true,
      },
    });

    return mapping;
  }

  /**
   * Delete attribute mappings by attribute IDs
   */
  async deleteAttributeMappingsByIds(
    tenantId: string,
    attributeIds: number[]
  ): Promise<number> {
    if (attributeIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.attributeMapping.deleteMany({
      where: {
        tenantId,
        plentyAttributeId: {
          in: attributeIds,
        },
      },
    });

    this.log.info('Deleted attribute mappings', {
      tenantId,
      count: result.count,
    });

    return result.count;
  }

  /**
   * Get count of attribute mappings for a tenant
   */
  async getAttributeMappingCount(tenantId: string): Promise<number> {
    return this.prisma.attributeMapping.count({
      where: { tenantId },
    });
  }

  /**
   * Get all manual attribute mappings for a tenant
   */
  async getManualAttributeMappings(tenantId: string): Promise<AttributeMappingRecord[]> {
    const mappings = await this.prisma.attributeMapping.findMany({
      where: {
        tenantId,
        mappingType: MappingType.MANUAL,
      },
      select: {
        plentyAttributeId: true,
        shopwarePropertyGroupId: true,
        mappingType: true,
        lastSyncAction: true,
      },
    });

    return mappings.map((m) => ({
      plentyAttributeId: m.plentyAttributeId,
      shopwarePropertyGroupId: m.shopwarePropertyGroupId,
      mappingType: m.mappingType,
      lastSyncAction: m.lastSyncAction as 'create' | 'update',
    }));
  }

  // ============================================
  // ATTRIBUTE VALUE (PROPERTY OPTION) METHODS
  // ============================================

  /**
   * Get batch attribute value mappings for multiple value IDs
   */
  async getBatchAttributeValueMappings(
    tenantId: string,
    attributeValueIds: number[]
  ): Promise<AttributeValueMappingLookup> {
    // Filter out any undefined/null values as a safety check
    const validIds = attributeValueIds.filter((id) => id !== undefined && id !== null);

    if (validIds.length === 0) {
      return {};
    }

    const mappings = await this.prisma.attributeValueMapping.findMany({
      where: {
        tenantId,
        plentyAttributeValueId: {
          in: validIds,
        },
      },
      select: {
        plentyAttributeValueId: true,
        shopwarePropertyGroupId: true,
        shopwarePropertyOptionId: true,
        mappingType: true,
      },
    });

    const lookup: AttributeValueMappingLookup = {};
    for (const mapping of mappings) {
      lookup[mapping.plentyAttributeValueId] = {
        shopwarePropertyGroupId: mapping.shopwarePropertyGroupId,
        shopwarePropertyOptionId: mapping.shopwarePropertyOptionId,
        mappingType: mapping.mappingType,
      };
    }

    this.log.debug('Loaded batch attribute value mappings', {
      tenantId,
      requested: attributeValueIds.length,
      found: Object.keys(lookup).length,
    });

    return lookup;
  }

  /**
   * Upsert multiple attribute value mappings at once (transaction)
   */
  async upsertAttributeValueMappings(
    tenantId: string,
    records: AttributeValueMappingRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    this.log.debug('Upserting attribute value mappings', { tenantId, count: records.length });

    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.attributeValueMapping.upsert({
          where: {
            tenantId_plentyAttributeValueId: {
              tenantId,
              plentyAttributeValueId: record.plentyAttributeValueId,
            },
          },
          create: {
            tenantId,
            plentyAttributeId: record.plentyAttributeId,
            plentyAttributeValueId: record.plentyAttributeValueId,
            shopwarePropertyGroupId: record.shopwarePropertyGroupId,
            shopwarePropertyOptionId: record.shopwarePropertyOptionId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
          update: {
            shopwarePropertyGroupId: record.shopwarePropertyGroupId,
            shopwarePropertyOptionId: record.shopwarePropertyOptionId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
        })
      )
    );

    this.log.info('Attribute value mappings upserted successfully', {
      tenantId,
      count: records.length,
    });
  }

  /**
   * Get a single attribute value mapping
   */
  async getAttributeValueMapping(
    tenantId: string,
    plentyAttributeValueId: number
  ): Promise<{
    shopwarePropertyGroupId: string;
    shopwarePropertyOptionId: string;
    mappingType: string;
  } | null> {
    const mapping = await this.prisma.attributeValueMapping.findUnique({
      where: {
        tenantId_plentyAttributeValueId: {
          tenantId,
          plentyAttributeValueId,
        },
      },
      select: {
        shopwarePropertyGroupId: true,
        shopwarePropertyOptionId: true,
        mappingType: true,
      },
    });

    return mapping;
  }

  /**
   * Delete attribute value mappings by value IDs
   */
  async deleteAttributeValueMappingsByIds(
    tenantId: string,
    attributeValueIds: number[]
  ): Promise<number> {
    if (attributeValueIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.attributeValueMapping.deleteMany({
      where: {
        tenantId,
        plentyAttributeValueId: {
          in: attributeValueIds,
        },
      },
    });

    this.log.info('Deleted attribute value mappings', {
      tenantId,
      count: result.count,
    });

    return result.count;
  }

  /**
   * Get count of attribute value mappings for a tenant
   */
  async getAttributeValueMappingCount(tenantId: string): Promise<number> {
    return this.prisma.attributeValueMapping.count({
      where: { tenantId },
    });
  }

  /**
   * Get all manual attribute value mappings for a tenant
   */
  async getManualAttributeValueMappings(
    tenantId: string
  ): Promise<AttributeValueMappingRecord[]> {
    const mappings = await this.prisma.attributeValueMapping.findMany({
      where: {
        tenantId,
        mappingType: MappingType.MANUAL,
      },
      select: {
        plentyAttributeId: true,
        plentyAttributeValueId: true,
        shopwarePropertyGroupId: true,
        shopwarePropertyOptionId: true,
        mappingType: true,
        lastSyncAction: true,
      },
    });

    return mappings.map((m) => ({
      plentyAttributeId: m.plentyAttributeId,
      plentyAttributeValueId: m.plentyAttributeValueId,
      shopwarePropertyGroupId: m.shopwarePropertyGroupId,
      shopwarePropertyOptionId: m.shopwarePropertyOptionId,
      mappingType: m.mappingType,
      lastSyncAction: m.lastSyncAction as 'create' | 'update',
    }));
  }
}
