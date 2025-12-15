import { PrismaClient, MappingType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';

// ============================================
// PROPERTY (PROPERTY GROUP) MAPPINGS
// ============================================

export interface PropertyMappingRecord {
  plentyPropertyId: number;
  plentyPropertyGroupId: number | null;
  shopwarePropertyGroupId: string;
  mappingType: 'MANUAL' | 'AUTO';
  lastSyncAction: 'create' | 'update';
}

export interface PropertyMappingLookup {
  [plentyPropertyId: number]: {
    shopwarePropertyGroupId: string;
    mappingType: 'MANUAL' | 'AUTO';
  };
}

// ============================================
// PROPERTY SELECTION (PROPERTY OPTION) MAPPINGS
// ============================================

export interface PropertySelectionMappingRecord {
  plentyPropertyId: number;
  plentySelectionId: number;
  shopwarePropertyGroupId: string;
  shopwarePropertyOptionId: string;
  mappingType: 'MANUAL' | 'AUTO';
  lastSyncAction: 'create' | 'update';
}

export interface PropertySelectionMappingLookup {
  [plentySelectionId: number]: {
    shopwarePropertyGroupId: string;
    shopwarePropertyOptionId: string;
    mappingType: 'MANUAL' | 'AUTO';
  };
}

/**
 * Property Mapping Service
 * Manages mappings for both:
 * - Properties (PlentyMarkets Properties → Shopware Property Groups)
 * - Property Selections (PlentyMarkets Property Selections → Shopware Property Options)
 *
 * Note: This is separate from AttributeMappingService because Plenty differentiates between:
 * - Attributes: Variant-defining characteristics (Color, Size)
 * - Properties: Additional product information (Material, Care Instructions)
 */
export class PropertyMappingService {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'PropertyMappingService' });

  constructor() {
    this.prisma = getPrismaClient();
  }

  // ============================================
  // PROPERTY (PROPERTY GROUP) METHODS
  // ============================================

  /**
   * Get batch property mappings for multiple property IDs
   */
  async getBatchPropertyMappings(
    tenantId: string,
    propertyIds: number[]
  ): Promise<PropertyMappingLookup> {
    if (propertyIds.length === 0) {
      return {};
    }

    const mappings = await this.prisma.propertyMapping.findMany({
      where: {
        tenantId,
        plentyPropertyId: {
          in: propertyIds,
        },
      },
      select: {
        plentyPropertyId: true,
        shopwarePropertyGroupId: true,
        mappingType: true,
      },
    });

    const lookup: PropertyMappingLookup = {};
    for (const mapping of mappings) {
      lookup[mapping.plentyPropertyId] = {
        shopwarePropertyGroupId: mapping.shopwarePropertyGroupId,
        mappingType: mapping.mappingType,
      };
    }

    this.log.debug('Loaded batch property mappings', {
      tenantId,
      requested: propertyIds.length,
      found: Object.keys(lookup).length,
    });

    return lookup;
  }

  /**
   * Upsert multiple property mappings at once (transaction)
   */
  async upsertPropertyMappings(
    tenantId: string,
    records: PropertyMappingRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    this.log.debug('Upserting property mappings', { tenantId, count: records.length });

    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.propertyMapping.upsert({
          where: {
            tenantId_plentyPropertyId: {
              tenantId,
              plentyPropertyId: record.plentyPropertyId,
            },
          },
          create: {
            tenantId,
            plentyPropertyId: record.plentyPropertyId,
            plentyPropertyGroupId: record.plentyPropertyGroupId,
            shopwarePropertyGroupId: record.shopwarePropertyGroupId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
          update: {
            plentyPropertyGroupId: record.plentyPropertyGroupId,
            shopwarePropertyGroupId: record.shopwarePropertyGroupId,
            mappingType: record.mappingType,
            lastSyncedAt: new Date(),
            lastSyncAction: record.lastSyncAction,
          },
        })
      )
    );

    this.log.info('Property mappings upserted successfully', {
      tenantId,
      count: records.length,
    });
  }

  /**
   * Get a single property mapping
   */
  async getPropertyMapping(
    tenantId: string,
    plentyPropertyId: number
  ): Promise<{ shopwarePropertyGroupId: string; mappingType: string } | null> {
    const mapping = await this.prisma.propertyMapping.findUnique({
      where: {
        tenantId_plentyPropertyId: {
          tenantId,
          plentyPropertyId,
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
   * Delete property mappings by property IDs
   */
  async deletePropertyMappingsByIds(
    tenantId: string,
    propertyIds: number[]
  ): Promise<number> {
    if (propertyIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.propertyMapping.deleteMany({
      where: {
        tenantId,
        plentyPropertyId: {
          in: propertyIds,
        },
      },
    });

    this.log.info('Deleted property mappings', {
      tenantId,
      count: result.count,
    });

    return result.count;
  }

  /**
   * Get count of property mappings for a tenant
   */
  async getPropertyMappingCount(tenantId: string): Promise<number> {
    return this.prisma.propertyMapping.count({
      where: { tenantId },
    });
  }

  /**
   * Get all manual property mappings for a tenant
   */
  async getManualPropertyMappings(tenantId: string): Promise<PropertyMappingRecord[]> {
    const mappings = await this.prisma.propertyMapping.findMany({
      where: {
        tenantId,
        mappingType: MappingType.MANUAL,
      },
      select: {
        plentyPropertyId: true,
        plentyPropertyGroupId: true,
        shopwarePropertyGroupId: true,
        mappingType: true,
        lastSyncAction: true,
      },
    });

    return mappings.map((m) => ({
      plentyPropertyId: m.plentyPropertyId,
      plentyPropertyGroupId: m.plentyPropertyGroupId,
      shopwarePropertyGroupId: m.shopwarePropertyGroupId,
      mappingType: m.mappingType,
      lastSyncAction: m.lastSyncAction as 'create' | 'update',
    }));
  }

  // ============================================
  // PROPERTY SELECTION (PROPERTY OPTION) METHODS
  // ============================================

  /**
   * Get batch property selection mappings for multiple selection IDs
   */
  async getBatchPropertySelectionMappings(
    tenantId: string,
    selectionIds: number[]
  ): Promise<PropertySelectionMappingLookup> {
    // Filter out any undefined/null values as a safety check
    const validIds = selectionIds.filter((id) => id !== undefined && id !== null);

    if (validIds.length === 0) {
      return {};
    }

    const mappings = await this.prisma.propertySelectionMapping.findMany({
      where: {
        tenantId,
        plentySelectionId: {
          in: validIds,
        },
      },
      select: {
        plentySelectionId: true,
        shopwarePropertyGroupId: true,
        shopwarePropertyOptionId: true,
        mappingType: true,
      },
    });

    const lookup: PropertySelectionMappingLookup = {};
    for (const mapping of mappings) {
      lookup[mapping.plentySelectionId] = {
        shopwarePropertyGroupId: mapping.shopwarePropertyGroupId,
        shopwarePropertyOptionId: mapping.shopwarePropertyOptionId,
        mappingType: mapping.mappingType,
      };
    }

    this.log.debug('Loaded batch property selection mappings', {
      tenantId,
      requested: selectionIds.length,
      found: Object.keys(lookup).length,
    });

    return lookup;
  }

  /**
   * Upsert multiple property selection mappings at once (transaction)
   */
  async upsertPropertySelectionMappings(
    tenantId: string,
    records: PropertySelectionMappingRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    this.log.debug('Upserting property selection mappings', { tenantId, count: records.length });

    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.propertySelectionMapping.upsert({
          where: {
            tenantId_plentySelectionId: {
              tenantId,
              plentySelectionId: record.plentySelectionId,
            },
          },
          create: {
            tenantId,
            plentyPropertyId: record.plentyPropertyId,
            plentySelectionId: record.plentySelectionId,
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

    this.log.info('Property selection mappings upserted successfully', {
      tenantId,
      count: records.length,
    });
  }

  /**
   * Get a single property selection mapping
   */
  async getPropertySelectionMapping(
    tenantId: string,
    plentySelectionId: number
  ): Promise<{
    shopwarePropertyGroupId: string;
    shopwarePropertyOptionId: string;
    mappingType: string;
  } | null> {
    const mapping = await this.prisma.propertySelectionMapping.findUnique({
      where: {
        tenantId_plentySelectionId: {
          tenantId,
          plentySelectionId,
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
   * Delete property selection mappings by selection IDs
   */
  async deletePropertySelectionMappingsByIds(
    tenantId: string,
    selectionIds: number[]
  ): Promise<number> {
    if (selectionIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.propertySelectionMapping.deleteMany({
      where: {
        tenantId,
        plentySelectionId: {
          in: selectionIds,
        },
      },
    });

    this.log.info('Deleted property selection mappings', {
      tenantId,
      count: result.count,
    });

    return result.count;
  }

  /**
   * Get count of property selection mappings for a tenant
   */
  async getPropertySelectionMappingCount(tenantId: string): Promise<number> {
    return this.prisma.propertySelectionMapping.count({
      where: { tenantId },
    });
  }

  /**
   * Get all manual property selection mappings for a tenant
   */
  async getManualPropertySelectionMappings(
    tenantId: string
  ): Promise<PropertySelectionMappingRecord[]> {
    const mappings = await this.prisma.propertySelectionMapping.findMany({
      where: {
        tenantId,
        mappingType: MappingType.MANUAL,
      },
      select: {
        plentyPropertyId: true,
        plentySelectionId: true,
        shopwarePropertyGroupId: true,
        shopwarePropertyOptionId: true,
        mappingType: true,
        lastSyncAction: true,
      },
    });

    return mappings.map((m) => ({
      plentyPropertyId: m.plentyPropertyId,
      plentySelectionId: m.plentySelectionId,
      shopwarePropertyGroupId: m.shopwarePropertyGroupId,
      shopwarePropertyOptionId: m.shopwarePropertyOptionId,
      mappingType: m.mappingType,
      lastSyncAction: m.lastSyncAction as 'create' | 'update',
    }));
  }

  /**
   * Get all selection mappings for a specific property
   */
  async getPropertySelectionMappingsByPropertyId(
    tenantId: string,
    plentyPropertyId: number
  ): Promise<PropertySelectionMappingRecord[]> {
    const mappings = await this.prisma.propertySelectionMapping.findMany({
      where: {
        tenantId,
        plentyPropertyId,
      },
      select: {
        plentyPropertyId: true,
        plentySelectionId: true,
        shopwarePropertyGroupId: true,
        shopwarePropertyOptionId: true,
        mappingType: true,
        lastSyncAction: true,
      },
    });

    return mappings.map((m) => ({
      plentyPropertyId: m.plentyPropertyId,
      plentySelectionId: m.plentySelectionId,
      shopwarePropertyGroupId: m.shopwarePropertyGroupId,
      shopwarePropertyOptionId: m.shopwarePropertyOptionId,
      mappingType: m.mappingType,
      lastSyncAction: m.lastSyncAction as 'create' | 'update',
    }));
  }
}
