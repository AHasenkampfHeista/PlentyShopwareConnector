import { PrismaClient, PlentyManufacturer } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';
import { ManufacturerMappingService, ManufacturerMappingLookup, ManufacturerMappingRecord } from './ManufacturerMappingService';
import type { IShopwareClient } from '../clients/interfaces';
import type { ShopwareManufacturer } from '../types/shopware';
import type { PlentyVariation, PlentyItem } from '../types/plenty';

/**
 * Manufacturer Sync Service
 * Orchestrates on-demand manufacturer creation in Shopware during product sync
 *
 * Key features:
 * - Respects manual mappings (never overwrite)
 * - Uses PlentyManufacturer table as source of truth
 * - Creates manufacturers in Shopware when products reference them
 */
export class ManufacturerSyncService {
  private prisma: PrismaClient;
  private mappingService: ManufacturerMappingService;
  private manufacturerCache: Map<number, PlentyManufacturer> = new Map();
  private log = createLogger({ service: 'ManufacturerSyncService' });

  constructor() {
    this.prisma = getPrismaClient();
    this.mappingService = new ManufacturerMappingService();
  }

  /**
   * Ensure a manufacturer exists in Shopware for a product/variation
   * Returns the Shopware manufacturer ID if available
   *
   * Algorithm:
   * 1. Extract manufacturer ID from variation.item.manufacturerId
   * 2. Load existing mapping (manual + auto)
   * 3. For unmapped manufacturer:
   *    a. Load from PlentyManufacturer cache
   *    b. Transform to Shopware format
   *    c. Create in Shopware
   *    d. Store mapping as AUTO
   * 4. Return Shopware manufacturer ID
   */
  async ensureManufacturerExists(
    tenantId: string,
    variation: PlentyVariation,
    shopware: IShopwareClient
  ): Promise<string | null> {
    // Extract manufacturer ID from variation's item
    const manufacturerId = variation.item?.manufacturerId;

    if (!manufacturerId || manufacturerId === 0) {
      return null;
    }

    this.log.debug('Ensuring manufacturer exists', {
      variationId: variation.id,
      manufacturerId,
    });

    // Load existing mapping
    const existingMappings = await this.mappingService.getBatchMappings(tenantId, [manufacturerId]);

    if (existingMappings[manufacturerId]) {
      this.log.debug('Manufacturer already mapped', {
        variationId: variation.id,
        manufacturerId,
        shopwareId: existingMappings[manufacturerId].shopwareManufacturerId,
      });
      return existingMappings[manufacturerId].shopwareManufacturerId;
    }

    // Create missing manufacturer
    this.log.info('Creating missing manufacturer', {
      variationId: variation.id,
      manufacturerId,
    });

    try {
      const shopwareManufacturerId = await this.createManufacturerInShopware(
        tenantId,
        manufacturerId,
        shopware
      );

      // Store the new mapping
      await this.mappingService.upsertMappings(tenantId, [
        {
          plentyManufacturerId: manufacturerId,
          shopwareManufacturerId,
          mappingType: 'AUTO',
          lastSyncAction: 'create',
        },
      ]);

      return shopwareManufacturerId;
    } catch (error) {
      this.log.error('Failed to create manufacturer', {
        manufacturerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Ensure manufacturers exist for multiple variations
   * Returns a map of plenty manufacturer ID -> shopware manufacturer ID
   */
  async ensureManufacturersExist(
    tenantId: string,
    variations: PlentyVariation[],
    shopware: IShopwareClient
  ): Promise<ManufacturerMappingLookup> {
    // Collect unique manufacturer IDs
    const manufacturerIds = new Set<number>();
    for (const variation of variations) {
      const mfrId = variation.item?.manufacturerId;
      if (mfrId && mfrId !== 0) {
        manufacturerIds.add(mfrId);
      }
    }

    if (manufacturerIds.size === 0) {
      return {};
    }

    const manufacturerIdArray = Array.from(manufacturerIds);

    this.log.debug('Ensuring manufacturers exist', {
      count: manufacturerIdArray.length,
    });

    // Load existing mappings
    const existingMappings = await this.mappingService.getBatchMappings(tenantId, manufacturerIdArray);

    // Find unmapped manufacturers
    const unmappedManufacturerIds = manufacturerIdArray.filter((id) => !existingMappings[id]);

    if (unmappedManufacturerIds.length === 0) {
      this.log.debug('All manufacturers already mapped');
      return existingMappings;
    }

    this.log.info('Creating missing manufacturers', {
      unmappedCount: unmappedManufacturerIds.length,
    });

    // Create missing manufacturers
    const newMappings: ManufacturerMappingRecord[] = [];

    for (const manufacturerId of unmappedManufacturerIds) {
      try {
        const shopwareManufacturerId = await this.createManufacturerInShopware(
          tenantId,
          manufacturerId,
          shopware
        );

        // Store the new mapping
        newMappings.push({
          plentyManufacturerId: manufacturerId,
          shopwareManufacturerId,
          mappingType: 'AUTO',
          lastSyncAction: 'create',
        });

        // Update local lookup for subsequent use
        existingMappings[manufacturerId] = {
          shopwareManufacturerId,
          mappingType: 'AUTO',
        };
      } catch (error) {
        this.log.error('Failed to create manufacturer', {
          manufacturerId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other manufacturers
      }
    }

    // Save all new mappings to database
    if (newMappings.length > 0) {
      await this.mappingService.upsertMappings(tenantId, newMappings);
    }

    return existingMappings;
  }

  /**
   * Create a single manufacturer in Shopware
   * Returns the Shopware manufacturer ID
   */
  private async createManufacturerInShopware(
    tenantId: string,
    plentyManufacturerId: number,
    shopware: IShopwareClient
  ): Promise<string> {
    // Load manufacturer from cache
    const plentyManufacturer = await this.getCachedPlentyManufacturer(tenantId, plentyManufacturerId);

    if (!plentyManufacturer) {
      throw new Error(`Manufacturer ${plentyManufacturerId} not found in PlentyManufacturer cache`);
    }

    // Transform to Shopware format
    const shopwareManufacturer = this.transformManufacturer(plentyManufacturer);

    // Create in Shopware
    this.log.info('Creating manufacturer in Shopware', {
      plentyManufacturerId,
      name: shopwareManufacturer.name,
    });

    const result = await shopware.createManufacturer(shopwareManufacturer);

    if (!result.success) {
      throw new Error(`Failed to create manufacturer in Shopware: ${result.error || 'Unknown error'}`);
    }

    return result.id;
  }

  /**
   * Transform PlentyManufacturer to ShopwareManufacturer
   */
  private transformManufacturer(plentyManufacturer: PlentyManufacturer): ShopwareManufacturer {
    return {
      id: '', // Will be generated by Shopware
      name: plentyManufacturer.name,
      link: plentyManufacturer.url || undefined,
      description: plentyManufacturer.comment || undefined,
      _plentyManufacturerId: plentyManufacturer.id,
    };
  }

  /**
   * Get manufacturer from local cache (PlentyManufacturer table)
   */
  private async getCachedPlentyManufacturer(
    tenantId: string,
    manufacturerId: number
  ): Promise<PlentyManufacturer | null> {
    // Check in-memory cache first
    if (this.manufacturerCache.has(manufacturerId)) {
      return this.manufacturerCache.get(manufacturerId)!;
    }

    // Load from database
    const manufacturer = await this.prisma.plentyManufacturer.findUnique({
      where: {
        tenantId_id: {
          tenantId,
          id: manufacturerId,
        },
      },
    });

    if (manufacturer) {
      this.manufacturerCache.set(manufacturerId, manufacturer);
    }

    return manufacturer;
  }

  /**
   * Get Shopware manufacturer ID for a Plenty manufacturer ID
   * Returns null if not mapped
   */
  async getShopwareManufacturerId(
    tenantId: string,
    plentyManufacturerId: number
  ): Promise<string | null> {
    const mapping = await this.mappingService.getMapping(tenantId, plentyManufacturerId);
    return mapping?.shopwareManufacturerId || null;
  }

  /**
   * Clear the in-memory manufacturer cache
   */
  clearCache(): void {
    this.manufacturerCache.clear();
  }
}
