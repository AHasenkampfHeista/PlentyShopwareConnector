import { PrismaClient, PlentyAttribute } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';
import {
  AttributeMappingService,
  AttributeMappingLookup,
  AttributeMappingRecord,
  AttributeValueMappingLookup,
  AttributeValueMappingRecord,
} from './AttributeMappingService';
import type { IShopwareClient } from '../clients/interfaces';
import type { ShopwarePropertyGroup, ShopwarePropertyOption } from '../types/shopware';
import type { PlentyVariation } from '../types/plenty';

/**
 * Attribute Sync Service
 * Orchestrates on-demand attribute and attribute value creation in Shopware during product sync
 *
 * Key features:
 * - Respects manual mappings (never overwrite)
 * - Handles two-level structure: Property Groups (attributes) and Property Options (attribute values)
 * - Extracts localized translations from JSON
 * - Uses PlentyAttribute table as source of truth
 */
export class AttributeSyncService {
  private prisma: PrismaClient;
  private mappingService: AttributeMappingService;
  private attributeCache: Map<number, PlentyAttribute> = new Map();
  private log = createLogger({ service: 'AttributeSyncService' });

  constructor() {
    this.prisma = getPrismaClient();
    this.mappingService = new AttributeMappingService();
  }

  /**
   * Ensure attributes and attribute values exist in Shopware for a product variation
   * Returns both attribute and attribute value mappings
   *
   * Algorithm:
   * 1. Extract attribute value IDs from variation.variationAttributeValues
   * 2. Load cached PlentyAttribute records to find parent attributes
   * 3. Ensure property groups (attributes) exist first
   * 4. Ensure property options (attribute values) exist
   * 5. Return complete mappings for use in product transformation
   */
  async ensureAttributesExist(
    tenantId: string,
    variation: PlentyVariation,
    shopware: IShopwareClient
  ): Promise<{
    attributeMappings: AttributeMappingLookup;
    attributeValueMappings: AttributeValueMappingLookup;
  }> {
    // Extract attribute value IDs from variation (filter out undefined/null)
    const attributeValueIds = (variation.variationAttributeValues || [])
      .map((vav) => vav.valueId || vav.attributeValueId)
      .filter((id): id is number => id !== undefined && id !== null);

    if (attributeValueIds.length === 0) {
      return {
        attributeMappings: {},
        attributeValueMappings: {},
      };
    }

    this.log.debug('Ensuring attributes exist', {
      variationId: variation.id,
      attributeValueCount: attributeValueIds.length,
    });

    // Load existing attribute value mappings
    const existingValueMappings = await this.mappingService.getBatchAttributeValueMappings(
      tenantId,
      attributeValueIds
    );

    // Find unmapped attribute values
    const unmappedValueIds = attributeValueIds.filter((id) => !existingValueMappings[id]);

    if (unmappedValueIds.length === 0) {
      // All attribute values already mapped, extract attribute IDs from value mappings
      const attributeIds = [
        ...new Set(
          Object.values(existingValueMappings).map((m) => {
            // Extract attribute ID from mapping (we'll need to query this separately)
            // For now, return empty attribute mappings as values are already mapped
            return 0;
          })
        ),
      ].filter((id) => id !== 0);

      const attributeMappings = await this.mappingService.getBatchAttributeMappings(
        tenantId,
        attributeIds
      );

      this.log.debug('All attribute values already mapped', { variationId: variation.id });
      return {
        attributeMappings,
        attributeValueMappings: existingValueMappings,
      };
    }

    this.log.info('Creating missing attributes and values', {
      variationId: variation.id,
      unmappedValueCount: unmappedValueIds.length,
    });

    // Load all attribute data needed for unmapped values
    const attributeData = await this.loadAttributesForValues(tenantId, unmappedValueIds);

    // Collect unique attribute IDs that need mapping
    const attributeIds = [...new Set(attributeData.map((ad) => ad.attributeId))];

    // Load existing attribute mappings
    const existingAttributeMappings = await this.mappingService.getBatchAttributeMappings(
      tenantId,
      attributeIds
    );

    // Create missing property groups (attributes)
    const newAttributeMappings: AttributeMappingRecord[] = [];
    const unmappedAttributeIds = attributeIds.filter((id) => !existingAttributeMappings[id]);

    for (const attributeId of unmappedAttributeIds) {
      try {
        const shopwareGroupId = await this.createPropertyGroupInShopware(
          tenantId,
          attributeId,
          shopware
        );

        newAttributeMappings.push({
          plentyAttributeId: attributeId,
          shopwarePropertyGroupId: shopwareGroupId,
          mappingType: 'AUTO',
          lastSyncAction: 'create',
        });

        // Update local lookup
        existingAttributeMappings[attributeId] = {
          shopwarePropertyGroupId: shopwareGroupId,
          mappingType: 'AUTO',
        };
      } catch (error) {
        this.log.error('Failed to create property group', {
          attributeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Save new attribute mappings
    if (newAttributeMappings.length > 0) {
      await this.mappingService.upsertAttributeMappings(tenantId, newAttributeMappings);
    }

    // Create missing property options (attribute values)
    const newValueMappings: AttributeValueMappingRecord[] = [];

    for (const data of attributeData) {
      // Skip if value is already mapped
      if (existingValueMappings[data.valueId]) {
        continue;
      }

      // Get property group ID for this value
      const groupMapping = existingAttributeMappings[data.attributeId];
      if (!groupMapping) {
        this.log.warn('Property group not found for value', {
          attributeId: data.attributeId,
          valueId: data.valueId,
        });
        continue;
      }

      try {
        const shopwareOptionId = await this.createPropertyOptionInShopware(
          tenantId,
          data.attributeId,
          data.valueId,
          groupMapping.shopwarePropertyGroupId,
          shopware
        );

        newValueMappings.push({
          plentyAttributeId: data.attributeId,
          plentyAttributeValueId: data.valueId,
          shopwarePropertyGroupId: groupMapping.shopwarePropertyGroupId,
          shopwarePropertyOptionId: shopwareOptionId,
          mappingType: 'AUTO',
          lastSyncAction: 'create',
        });

        // Update local lookup
        existingValueMappings[data.valueId] = {
          shopwarePropertyGroupId: groupMapping.shopwarePropertyGroupId,
          shopwarePropertyOptionId: shopwareOptionId,
          mappingType: 'AUTO',
        };
      } catch (error) {
        this.log.error('Failed to create property option', {
          attributeId: data.attributeId,
          valueId: data.valueId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Save new value mappings
    if (newValueMappings.length > 0) {
      await this.mappingService.upsertAttributeValueMappings(tenantId, newValueMappings);
    }

    return {
      attributeMappings: existingAttributeMappings,
      attributeValueMappings: existingValueMappings,
    };
  }

  /**
   * Load attribute data for specific attribute value IDs
   * Returns array of {attributeId, valueId} pairs
   */
  private async loadAttributesForValues(
    tenantId: string,
    valueIds: number[]
  ): Promise<Array<{ attributeId: number; valueId: number }>> {
    const results: Array<{ attributeId: number; valueId: number }> = [];

    // Load all attributes for this tenant
    const attributes = await this.prisma.plentyAttribute.findMany({
      where: { tenantId },
    });

    // Find which attribute each value belongs to
    for (const attribute of attributes) {
      const attributeValues =
        (attribute.attributeValues as Array<{ id: number }>) || [];

      for (const value of attributeValues) {
        if (valueIds.includes(value.id)) {
          results.push({
            attributeId: attribute.id,
            valueId: value.id,
          });
        }
      }
    }
    return results;
  }

  /**
   * Create a property group (attribute) in Shopware
   * Returns the Shopware property group ID
   */
  private async createPropertyGroupInShopware(
    tenantId: string,
    plentyAttributeId: number,
    shopware: IShopwareClient
  ): Promise<string> {
    // Load attribute from cache
    const plentyAttribute = await this.getCachedPlentyAttribute(tenantId, plentyAttributeId);

    if (!plentyAttribute) {
      throw new Error(`Attribute ${plentyAttributeId} not found in PlentyAttribute cache`);
    }

    // Transform to Shopware format
    const shopwareGroup = this.transformPropertyGroup(plentyAttribute);

    // Create in Shopware
    this.log.info('Creating property group in Shopware', {
      plentyAttributeId,
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
   * Create a property option (attribute value) in Shopware
   * Returns the Shopware property option ID
   */
  private async createPropertyOptionInShopware(
    tenantId: string,
    plentyAttributeId: number,
    plentyAttributeValueId: number,
    shopwareGroupId: string,
    shopware: IShopwareClient
  ): Promise<string> {
    // Load attribute from cache
    const plentyAttribute = await this.getCachedPlentyAttribute(tenantId, plentyAttributeId);

    if (!plentyAttribute) {
      throw new Error(`Attribute ${plentyAttributeId} not found in PlentyAttribute cache`);
    }

    // Find the specific value within the attribute
    const attributeValues =
      (plentyAttribute.attributeValues as Array<{
        id: number;
        backendName?: string;
        valueNames?: Array<{ lang: string; name: string }>;
      }>) || [];

    const attributeValue = attributeValues.find((v) => v.id === plentyAttributeValueId);

    if (!attributeValue) {
      throw new Error(
        `Attribute value ${plentyAttributeValueId} not found in attribute ${plentyAttributeId}`
      );
    }

    // Transform to Shopware format
    const shopwareOption = this.transformPropertyOption(
      attributeValue,
      shopwareGroupId,
      plentyAttributeId,
      plentyAttributeValueId
    );

    // Create in Shopware
    this.log.info('Creating property option in Shopware', {
      plentyAttributeId,
      plentyAttributeValueId,
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
   * Transform PlentyAttribute to ShopwarePropertyGroup with translations
   */
  private transformPropertyGroup(plentyAttribute: PlentyAttribute): ShopwarePropertyGroup {
    // Extract name (prefer backendName or first translated name)
    let groupName = plentyAttribute.backendName || 'Unnamed Property Group';

    // Build translations object
    const translations: Record<string, { name: string; description?: string }> = {};

    if (plentyAttribute.names && typeof plentyAttribute.names === 'object') {
      const names = plentyAttribute.names as Record<string, string>;
      for (const [lang, name] of Object.entries(names)) {
        translations[lang] = { name };
      }

      // Use first translation as default name if backendName is not available
      if (!plentyAttribute.backendName && Object.keys(names).length > 0) {
        groupName = names.de || names.en || Object.values(names)[0] || groupName;
      }
    }

    return {
      id: '', // Will be generated by Shopware
      name: groupName,
      displayType: 'text',
      sortingType: 'alphanumeric',
      position: plentyAttribute.position || 0,
      translations,
      _plentyAttributeId: plentyAttribute.id,
    };
  }

  /**
   * Transform PlentyAttributeValue to ShopwarePropertyOption with translations
   */
  private transformPropertyOption(
    attributeValue: {
      id: number;
      backendName?: string;
      valueNames?: Array<{ lang: string; name: string }>;
    },
    shopwareGroupId: string,
    plentyAttributeId: number,
    plentyAttributeValueId: number
  ): ShopwarePropertyOption {
    // Extract name (prefer backendName or first translated name)
    let optionName = attributeValue.backendName || 'Unnamed Property Option';

    // Build translations object
    const translations: Record<string, { name: string }> = {};

    if (attributeValue.valueNames && Array.isArray(attributeValue.valueNames)) {
      for (const valueName of attributeValue.valueNames) {
        translations[valueName.lang] = { name: valueName.name };
      }

      // Use first translation as default name if backendName is not available
      if (!attributeValue.backendName && attributeValue.valueNames.length > 0) {
        const firstTranslation =
          attributeValue.valueNames.find((vn) => vn.lang === 'de') ||
          attributeValue.valueNames.find((vn) => vn.lang === 'en') ||
          attributeValue.valueNames[0];

        if (firstTranslation) {
          optionName = firstTranslation.name;
        }
      }
    }

    return {
      id: '', // Will be generated by Shopware
      groupId: shopwareGroupId,
      name: optionName,
      position: 0,
      translations,
      _plentyAttributeId: plentyAttributeId,
      _plentyAttributeValueId: plentyAttributeValueId,
    };
  }

  /**
   * Get attribute from local cache (PlentyAttribute table)
   */
  private async getCachedPlentyAttribute(
    tenantId: string,
    attributeId: number
  ): Promise<PlentyAttribute | null> {
    // Check in-memory cache first
    if (this.attributeCache.has(attributeId)) {
      return this.attributeCache.get(attributeId)!;
    }

    // Load from database
    const attribute = await this.prisma.plentyAttribute.findUnique({
      where: {
        tenantId_id: {
          tenantId,
          id: attributeId,
        },
      },
    });

    if (attribute) {
      this.attributeCache.set(attributeId, attribute);
    }

    return attribute;
  }

  /**
   * Clear the in-memory attribute cache
   */
  clearCache(): void {
    this.attributeCache.clear();
  }
}
