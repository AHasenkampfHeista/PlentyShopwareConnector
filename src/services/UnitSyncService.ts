import { PrismaClient, PlentyUnit } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';
import { UnitMappingService, UnitMappingLookup, UnitMappingRecord } from './UnitMappingService';
import type { IShopwareClient } from '../clients/interfaces';
import type { ShopwareUnit } from '../types/shopware';
import type { PlentyVariation } from '../types/plenty';

/**
 * Unit Sync Service
 * Orchestrates on-demand unit creation in Shopware during product sync
 *
 * Key features:
 * - Respects manual mappings (never overwrite)
 * - Uses PlentyUnit table as source of truth
 * - Creates units in Shopware when products reference them
 */
export class UnitSyncService {
  private prisma: PrismaClient;
  private mappingService: UnitMappingService;
  private unitCache: Map<number, PlentyUnit> = new Map();
  private log = createLogger({ service: 'UnitSyncService' });

  constructor() {
    this.prisma = getPrismaClient();
    this.mappingService = new UnitMappingService();
  }

  /**
   * Ensure a unit exists in Shopware for a product/variation
   * Returns the Shopware unit ID if available
   *
   * Algorithm:
   * 1. Extract unit ID from variation.unit.unitId
   * 2. Load existing mapping (manual + auto)
   * 3. For unmapped unit:
   *    a. Load from PlentyUnit cache
   *    b. Transform to Shopware format
   *    c. Create in Shopware
   *    d. Store mapping as AUTO
   * 4. Return Shopware unit ID
   */
  async ensureUnitExists(
    tenantId: string,
    variation: PlentyVariation,
    shopware: IShopwareClient
  ): Promise<string | null> {
    // Extract unit ID from variation's unit
    const unitId = variation.unit?.unitId;

    if (!unitId || unitId === 0) {
      return null;
    }

    this.log.debug('Ensuring unit exists', {
      variationId: variation.id,
      unitId,
    });

    // Load existing mapping
    const existingMappings = await this.mappingService.getBatchMappings(tenantId, [unitId]);

    if (existingMappings[unitId]) {
      this.log.debug('Unit already mapped', {
        variationId: variation.id,
        unitId,
        shopwareId: existingMappings[unitId].shopwareUnitId,
      });
      return existingMappings[unitId].shopwareUnitId;
    }

    // Create missing unit
    this.log.info('Creating missing unit', {
      variationId: variation.id,
      unitId,
    });

    try {
      const shopwareUnitId = await this.createUnitInShopware(
        tenantId,
        unitId,
        shopware
      );

      // Store the new mapping
      await this.mappingService.upsertMappings(tenantId, [
        {
          plentyUnitId: unitId,
          shopwareUnitId,
          mappingType: 'AUTO',
          lastSyncAction: 'create',
        },
      ]);

      return shopwareUnitId;
    } catch (error) {
      this.log.error('Failed to create unit', {
        unitId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Ensure units exist for multiple variations
   * Returns a map of plenty unit ID -> shopware unit ID
   */
  async ensureUnitsExist(
    tenantId: string,
    variations: PlentyVariation[],
    shopware: IShopwareClient
  ): Promise<UnitMappingLookup> {
    // Collect unique unit IDs
    const unitIds = new Set<number>();
    for (const variation of variations) {
      const unitId = variation.unit?.unitId;
      if (unitId && unitId !== 0) {
        unitIds.add(unitId);
      }
    }

    if (unitIds.size === 0) {
      return {};
    }

    const unitIdArray = Array.from(unitIds);

    this.log.debug('Ensuring units exist', {
      count: unitIdArray.length,
    });

    // Load existing mappings
    const existingMappings = await this.mappingService.getBatchMappings(tenantId, unitIdArray);

    // Find unmapped units
    const unmappedUnitIds = unitIdArray.filter((id) => !existingMappings[id]);

    if (unmappedUnitIds.length === 0) {
      this.log.debug('All units already mapped');
      return existingMappings;
    }

    this.log.info('Creating missing units', {
      unmappedCount: unmappedUnitIds.length,
    });

    // Create missing units
    const newMappings: UnitMappingRecord[] = [];

    for (const unitId of unmappedUnitIds) {
      try {
        const shopwareUnitId = await this.createUnitInShopware(
          tenantId,
          unitId,
          shopware
        );

        // Store the new mapping
        newMappings.push({
          plentyUnitId: unitId,
          shopwareUnitId,
          mappingType: 'AUTO',
          lastSyncAction: 'create',
        });

        // Update local lookup for subsequent use
        existingMappings[unitId] = {
          shopwareUnitId,
          mappingType: 'AUTO',
        };
      } catch (error) {
        this.log.error('Failed to create unit', {
          unitId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other units
      }
    }

    // Save all new mappings to database
    if (newMappings.length > 0) {
      await this.mappingService.upsertMappings(tenantId, newMappings);
    }

    return existingMappings;
  }

  /**
   * Create a single unit in Shopware
   * Returns the Shopware unit ID
   */
  private async createUnitInShopware(
    tenantId: string,
    plentyUnitId: number,
    shopware: IShopwareClient
  ): Promise<string> {
    // Load unit from cache
    const plentyUnit = await this.getCachedPlentyUnit(tenantId, plentyUnitId);

    if (!plentyUnit) {
      throw new Error(`Unit ${plentyUnitId} not found in PlentyUnit cache`);
    }

    // Transform to Shopware format
    const shopwareUnit = this.transformUnit(plentyUnit);

    // Create in Shopware
    this.log.info('Creating unit in Shopware', {
      plentyUnitId,
      shortCode: shopwareUnit.shortCode,
      name: shopwareUnit.name,
    });

    const result = await shopware.createUnit(shopwareUnit);

    if (!result.success) {
      throw new Error(`Failed to create unit in Shopware: ${result.error || 'Unknown error'}`);
    }

    return result.id;
  }

  /**
   * Transform PlentyUnit to ShopwareUnit
   */
  private transformUnit(plentyUnit: PlentyUnit): ShopwareUnit {
    // Extract name from localized names (prefer de -> en -> first available)
    let unitName = plentyUnit.unitOfMeasurement;
    const names = plentyUnit.names as Record<string, string> | null;

    if (names && typeof names === 'object') {
      unitName = names.de || names.en || Object.values(names)[0] || plentyUnit.unitOfMeasurement;
    }

    return {
      id: '', // Will be generated by Shopware
      shortCode: plentyUnit.unitOfMeasurement,
      name: unitName,
      _plentyUnitId: plentyUnit.id,
    };
  }

  /**
   * Get unit from local cache (PlentyUnit table)
   */
  private async getCachedPlentyUnit(
    tenantId: string,
    unitId: number
  ): Promise<PlentyUnit | null> {
    // Check in-memory cache first
    if (this.unitCache.has(unitId)) {
      return this.unitCache.get(unitId)!;
    }

    // Load from database
    const unit = await this.prisma.plentyUnit.findUnique({
      where: {
        tenantId_id: {
          tenantId,
          id: unitId,
        },
      },
    });

    if (unit) {
      this.unitCache.set(unitId, unit);
    }

    return unit;
  }

  /**
   * Get Shopware unit ID for a Plenty unit ID
   * Returns null if not mapped
   */
  async getShopwareUnitId(
    tenantId: string,
    plentyUnitId: number
  ): Promise<string | null> {
    const mapping = await this.mappingService.getMapping(tenantId, plentyUnitId);
    return mapping?.shopwareUnitId || null;
  }

  /**
   * Clear the in-memory unit cache
   */
  clearCache(): void {
    this.unitCache.clear();
  }
}
