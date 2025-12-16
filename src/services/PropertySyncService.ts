import { PrismaClient, PlentyProperty } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';
import {
  PropertyMappingService,
  PropertyMappingLookup,
  PropertyMappingRecord,
  PropertySelectionMappingLookup,
  PropertySelectionMappingRecord,
} from './PropertyMappingService';
import type { IShopwareClient } from '../clients/interfaces';
import type { ShopwarePropertyGroup, ShopwarePropertyOption } from '../types/shopware';
import type { PlentyVariation } from '../types/plenty';

/**
 * Property Sync Service
 * Orchestrates on-demand property and property selection creation in Shopware during product sync
 *
 * Key features:
 * - Respects manual mappings (never overwrite)
 * - Handles two-level structure: Property Groups (properties) and Property Options (selections)
 * - Extracts localized translations from JSON
 * - Uses PlentyProperty table as source of truth
 *
 * Note: This is for Plenty Properties (Eigenschaften), not Attributes (Merkmale).
 * Properties are informational, Attributes are variant-defining.
 */
export class PropertySyncService {
  private prisma: PrismaClient;
  private mappingService: PropertyMappingService;
  private propertyCache: Map<number, PlentyProperty> = new Map();
  private log = createLogger({ service: 'PropertySyncService' });

  constructor() {
    this.prisma = getPrismaClient();
    this.mappingService = new PropertyMappingService();
  }

  /**
   * Ensure properties and property selections exist in Shopware for a product variation
   * Returns both property and selection mappings
   *
   * Algorithm:
   * 1. Extract property IDs and selection IDs from variation.variationProperties
   * 2. Load cached PlentyProperty records
   * 3. Ensure property groups (properties) exist first
   * 4. Ensure property options (selections) exist
   * 5. Return complete mappings for use in product transformation
   */
  async ensurePropertiesExist(
    tenantId: string,
    variation: PlentyVariation,
    shopware: IShopwareClient
  ): Promise<{
    propertyMappings: PropertyMappingLookup;
    selectionMappings: PropertySelectionMappingLookup;
  }> {
    const variationProperties = variation.variationProperties || [];

    if (variationProperties.length === 0) {
      return {
        propertyMappings: {},
        selectionMappings: {},
      };
    }

    // Extract property IDs and selection IDs
    const propertyIds = [...new Set(variationProperties.map((vp) => vp.propertyId))];
    const selectionIds = variationProperties
      .filter((vp) => vp.propertySelectionId !== null)
      .map((vp) => vp.propertySelectionId as number);

    this.log.debug('Ensuring properties exist', {
      variationId: variation.id,
      propertyCount: propertyIds.length,
      selectionCount: selectionIds.length,
    });

    // Load existing property mappings
    const existingPropertyMappings = await this.mappingService.getBatchPropertyMappings(
      tenantId,
      propertyIds
    );

    // Load existing selection mappings
    const existingSelectionMappings = await this.mappingService.getBatchPropertySelectionMappings(
      tenantId,
      selectionIds
    );

    // Find unmapped properties
    const unmappedPropertyIds = propertyIds.filter((id) => !existingPropertyMappings[id]);

    // Create missing property groups (properties)
    if (unmappedPropertyIds.length > 0) {
      this.log.info('Creating missing properties', {
        variationId: variation.id,
        unmappedCount: unmappedPropertyIds.length,
      });

      const newPropertyMappings: PropertyMappingRecord[] = [];

      for (const propertyId of unmappedPropertyIds) {
        try {
          const shopwareGroupId = await this.createPropertyGroupInShopware(
            tenantId,
            propertyId,
            shopware
          );

          const plentyProperty = await this.getCachedPlentyProperty(tenantId, propertyId);

          newPropertyMappings.push({
            plentyPropertyId: propertyId,
            plentyPropertyGroupId: plentyProperty?.propertyGroupId ?? null,
            shopwarePropertyGroupId: shopwareGroupId,
            mappingType: 'AUTO',
            lastSyncAction: 'create',
          });

          // Update local lookup
          existingPropertyMappings[propertyId] = {
            shopwarePropertyGroupId: shopwareGroupId,
            mappingType: 'AUTO',
          };
        } catch (error) {
          this.log.error('Failed to create property group', {
            propertyId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Save new property mappings
      if (newPropertyMappings.length > 0) {
        await this.mappingService.upsertPropertyMappings(tenantId, newPropertyMappings);
      }
    }

    // Find unmapped selections
    const unmappedSelectionIds = selectionIds.filter((id) => !existingSelectionMappings[id]);

    // Create missing property options (selections)
    if (unmappedSelectionIds.length > 0) {
      this.log.info('Creating missing property selections', {
        variationId: variation.id,
        unmappedCount: unmappedSelectionIds.length,
      });

      const newSelectionMappings: PropertySelectionMappingRecord[] = [];

      // Build a map of selectionId -> propertyId from variationProperties
      const selectionToPropertyMap = new Map<number, number>();
      for (const vp of variationProperties) {
        if (vp.propertySelectionId !== null) {
          selectionToPropertyMap.set(vp.propertySelectionId, vp.propertyId);
        }
      }

      for (const selectionId of unmappedSelectionIds) {
        const propertyId = selectionToPropertyMap.get(selectionId);

        if (!propertyId) {
          this.log.warn('Property ID not found for selection', { selectionId });
          continue;
        }

        // Get property group ID
        const propertyMapping = existingPropertyMappings[propertyId];
        if (!propertyMapping) {
          this.log.warn('Property group not found for selection', {
            selectionId,
            propertyId,
          });
          continue;
        }

        try {
          const shopwareOptionId = await this.createPropertyOptionInShopware(
            tenantId,
            propertyId,
            selectionId,
            propertyMapping.shopwarePropertyGroupId,
            shopware
          );

          newSelectionMappings.push({
            plentyPropertyId: propertyId,
            plentySelectionId: selectionId,
            shopwarePropertyGroupId: propertyMapping.shopwarePropertyGroupId,
            shopwarePropertyOptionId: shopwareOptionId,
            mappingType: 'AUTO',
            lastSyncAction: 'create',
          });

          // Update local lookup
          existingSelectionMappings[selectionId] = {
            shopwarePropertyGroupId: propertyMapping.shopwarePropertyGroupId,
            shopwarePropertyOptionId: shopwareOptionId,
            mappingType: 'AUTO',
          };
        } catch (error) {
          this.log.error('Failed to create property option', {
            propertyId,
            selectionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Save new selection mappings
      if (newSelectionMappings.length > 0) {
        await this.mappingService.upsertPropertySelectionMappings(tenantId, newSelectionMappings);
      }
    }

    return {
      propertyMappings: existingPropertyMappings,
      selectionMappings: existingSelectionMappings,
    };
  }

  /**
   * Create a property group (property) in Shopware
   * Returns the Shopware property group ID
   */
  private async createPropertyGroupInShopware(
    tenantId: string,
    plentyPropertyId: number,
    shopware: IShopwareClient
  ): Promise<string> {
    // Load property from cache
    const plentyProperty = await this.getCachedPlentyProperty(tenantId, plentyPropertyId);

    if (!plentyProperty) {
      throw new Error(`Property ${plentyPropertyId} not found in PlentyProperty cache`);
    }

    // Transform to Shopware format
    const shopwareGroup = this.transformPropertyGroup(plentyProperty);

    // Create in Shopware
    this.log.info('Creating property group in Shopware', {
      plentyPropertyId,
      name: shopwareGroup.name,
    });

    const result = await shopware.createPropertyGroup(shopwareGroup);

    if (!result.success) {
      throw new Error(
        `Failed to create property group in Shopware: ${result.error || 'Unknown error'}`
      );
    }

    return result.id;
  }

  /**
   * Create a property option (selection) in Shopware
   * Returns the Shopware property option ID
   */
  private async createPropertyOptionInShopware(
    tenantId: string,
    plentyPropertyId: number,
    plentySelectionId: number,
    shopwareGroupId: string,
    shopware: IShopwareClient
  ): Promise<string> {
    // Load property from cache
    const plentyProperty = await this.getCachedPlentyProperty(tenantId, plentyPropertyId);

    if (!plentyProperty) {
      throw new Error(`Property ${plentyPropertyId} not found in PlentyProperty cache`);
    }

    // Find the specific selection within the property
    const selections = (plentyProperty.selections as Array<{
      id: number;
      values?: Record<string, string>;
    }>) || [];

    const selection = selections.find((s) => s.id === plentySelectionId);

    if (!selection) {
      throw new Error(
        `Selection ${plentySelectionId} not found in property ${plentyPropertyId}`
      );
    }

    // Transform to Shopware format
    const shopwareOption = this.transformPropertyOption(
      selection,
      shopwareGroupId,
      plentyPropertyId,
      plentySelectionId
    );

    // Create in Shopware
    this.log.info('Creating property option in Shopware', {
      plentyPropertyId,
      plentySelectionId,
      groupId: shopwareGroupId,
      name: shopwareOption.name,
    });

    const result = await shopware.createPropertyOption(shopwareOption);

    if (!result.success) {
      throw new Error(
        `Failed to create property option in Shopware: ${result.error || 'Unknown error'}`
      );
    }

    return result.id;
  }

  /**
   * Transform PlentyProperty to ShopwarePropertyGroup with translations
   */
  private transformPropertyGroup(plentyProperty: PlentyProperty): ShopwarePropertyGroup {
    // Extract name from localized names
    let groupName = 'Unnamed Property Group';

    // Build translations object
    const translations: Record<string, { name: string; description?: string }> = {};

    if (plentyProperty.names && typeof plentyProperty.names === 'object') {
      const names = plentyProperty.names as Record<string, string>;
      for (const [lang, name] of Object.entries(names)) {
        translations[lang] = { name };
      }

      // Use first translation as default name
      if (Object.keys(names).length > 0) {
        groupName = names.de || names.en || Object.values(names)[0] || groupName;
      }
    }

    return {
      id: '', // Will be generated by Shopware
      name: groupName,
      displayType: 'text',
      sortingType: 'alphanumeric',
      position: plentyProperty.position || 0,
      translations,
      _plentyPropertyId: plentyProperty.id,
    };
  }

  /**
   * Transform PlentyPropertySelection to ShopwarePropertyOption with translations
   */
  private transformPropertyOption(
    selection: {
      id: number;
      values?: Record<string, string>;
    },
    shopwareGroupId: string,
    plentyPropertyId: number,
    plentySelectionId: number
  ): ShopwarePropertyOption {
    // Extract name from localized values
    let optionName = 'Unnamed Property Option';

    // Build translations object
    const translations: Record<string, { name: string }> = {};

    if (selection.values && typeof selection.values === 'object') {
      for (const [lang, name] of Object.entries(selection.values)) {
        translations[lang] = { name };
      }

      // Use first translation as default name
      if (Object.keys(selection.values).length > 0) {
        optionName =
          selection.values.de ||
          selection.values.en ||
          Object.values(selection.values)[0] ||
          optionName;
      }
    }

    return {
      id: '', // Will be generated by Shopware
      groupId: shopwareGroupId,
      name: optionName,
      position: 0,
      translations,
      _plentyPropertyId: plentyPropertyId,
      _plentyPropertySelectionId: plentySelectionId,
    };
  }

  /**
   * Get property from local cache (PlentyProperty table)
   */
  private async getCachedPlentyProperty(
    tenantId: string,
    propertyId: number
  ): Promise<PlentyProperty | null> {
    // Check in-memory cache first
    if (this.propertyCache.has(propertyId)) {
      return this.propertyCache.get(propertyId)!;
    }

    // Load from database
    const property = await this.prisma.plentyProperty.findUnique({
      where: {
        tenantId_id: {
          tenantId,
          id: propertyId,
        },
      },
    });

    if (property) {
      this.propertyCache.set(propertyId, property);
    }

    return property;
  }

  /**
   * Clear the in-memory property cache
   */
  clearCache(): void {
    this.propertyCache.clear();
  }
}
