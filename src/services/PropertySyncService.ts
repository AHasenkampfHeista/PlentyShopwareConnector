import { PrismaClient, PlentyProperty } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';
import {
  PropertyMappingService,
  PropertyMappingLookup,
  PropertyMappingRecord,
  PropertySelectionMappingLookup,
  PropertySelectionMappingRecord,
  PropertyValueMappingLookup,
  PropertyValueMappingRecord,
} from './PropertyMappingService';
import type { IShopwareClient } from '../clients/interfaces';
import type { ShopwarePropertyGroup, ShopwarePropertyOption } from '../types/shopware';
import type { PlentyVariation, PlentyItemProperty } from '../types/plenty';

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
    valueMappings: PropertyValueMappingLookup;
  }> {
    const variationProperties = variation.variationProperties || [];
    const itemProperties = variation.properties || [];

    // Handle non-selection properties (from variation.properties)
    const valueMappings = await this.ensureNonSelectionPropertiesExist(
      tenantId,
      itemProperties,
      shopware
    );

    if (variationProperties.length === 0) {
      return {
        propertyMappings: {},
        selectionMappings: {},
        valueMappings,
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
      valueMappings,
    };
  }

  /**
   * Ensure property options exist for non-selection properties (text, int, float, etc.)
   * Creates options dynamically based on unique values found in the data
   */
  async ensureNonSelectionPropertiesExist(
    tenantId: string,
    properties: PlentyItemProperty[],
    shopware: IShopwareClient
  ): Promise<PropertyValueMappingLookup> {
    // Filter to only non-selection properties
    const nonSelectionProperties = properties.filter(
      (p) => p.selectionRelationId === null
    );

    if (nonSelectionProperties.length === 0) {
      return {};
    }

    this.log.debug('Processing non-selection properties', {
      totalProperties: properties.length,
      nonSelectionCount: nonSelectionProperties.length,
    });

    const valueMappings: PropertyValueMappingLookup = {};
    const newValueMappingRecords: PropertyValueMappingRecord[] = [];

    // Group by propertyId for efficient processing
    const propertiesByPropId = new Map<number, PlentyItemProperty[]>();
    for (const prop of nonSelectionProperties) {
      const existing = propertiesByPropId.get(prop.propertyId) || [];
      existing.push(prop);
      propertiesByPropId.set(prop.propertyId, existing);
    }

    for (const [propertyId, propsWithSameId] of propertiesByPropId) {
      this.log.debug(`Processing non-selection property: propertyId=${propertyId}, valueCount=${propsWithSameId.length}`);

      // Ensure property group exists first
      let propertyMapping = await this.mappingService.getPropertyMapping(tenantId, propertyId);

      if (!propertyMapping) {
        this.log.debug(`No existing mapping for propertyId=${propertyId}, creating property group`);
        // Create the property group
        try {
          const shopwareGroupId = await this.createPropertyGroupInShopware(
            tenantId,
            propertyId,
            shopware
          );

          const plentyProperty = await this.getCachedPlentyProperty(tenantId, propertyId);

          await this.mappingService.upsertPropertyMappings(tenantId, [{
            plentyPropertyId: propertyId,
            plentyPropertyGroupId: plentyProperty?.propertyGroupId ?? null,
            shopwarePropertyGroupId: shopwareGroupId,
            mappingType: 'AUTO',
            lastSyncAction: 'create',
          }]);

          propertyMapping = {
            shopwarePropertyGroupId: shopwareGroupId,
            mappingType: 'AUTO',
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.log.error(`Failed to create property group for non-selection property: propertyId=${propertyId}, error=${errorMsg}`);
          continue;
        }
      }

      // Process each property entry (may have multiple entries for same propertyId)
      for (const prop of propsWithSameId) {
        // Get all values from relationValues (handles multiSelection returning multiple values)
        const values = await this.extractPropertyValues(prop, tenantId, propertyId);

        if (values.length === 0) {
          this.log.debug('Skipping property with no values', {
            propertyId,
            relationValuesCount: prop.relationValues?.length || 0,
          });
          continue;
        }

        this.log.info('Processing property values for auto-creation', {
          propertyId,
          valueCount: values.length,
          values: values.map(v => v.substring(0, 30)),
          hasPropertyMapping: !!propertyMapping,
          shopwareGroupId: propertyMapping?.shopwarePropertyGroupId,
        });

        // Process each value (for multiSelection this will be multiple values)
        for (const value of values) {
          if (!value || value === '') {
            continue;
          }

          const valueHash = this.mappingService.generateValueHash(propertyId, String(value));

          // Check if mapping already exists
          const existingMappings = await this.mappingService.getBatchPropertyValueMappings(
            tenantId,
            propertyId,
            [valueHash]
          );

          if (existingMappings[valueHash]) {
            this.log.debug('Value mapping already exists, skipping creation', {
              propertyId,
              value: String(value).substring(0, 50),
              valueHash,
              shopwareOptionId: existingMappings[valueHash].shopwarePropertyOptionId,
            });
            valueMappings[valueHash] = existingMappings[valueHash];
          } else {
            this.log.info('No existing value mapping, creating new property option', {
              propertyId,
              value: String(value).substring(0, 50),
              valueHash,
              shopwareGroupId: propertyMapping.shopwarePropertyGroupId,
            });
            // Create new option in Shopware
            try {
              const shopwareOptionId = await this.createPropertyOptionForValue(
                tenantId,
                propertyId,
                String(value),
                propertyMapping.shopwarePropertyGroupId,
                shopware
              );

              newValueMappingRecords.push({
                plentyPropertyId: propertyId,
                valueHash,
                originalValue: String(value),
                shopwarePropertyGroupId: propertyMapping.shopwarePropertyGroupId,
                shopwarePropertyOptionId: shopwareOptionId,
                mappingType: 'AUTO',
                lastSyncAction: 'create',
              });

              valueMappings[valueHash] = {
                shopwarePropertyGroupId: propertyMapping.shopwarePropertyGroupId,
                shopwarePropertyOptionId: shopwareOptionId,
                mappingType: 'AUTO',
              };

              this.log.info('Created property option for value', {
                propertyId,
                value: String(value).substring(0, 50),
                shopwareOptionId,
              });
            } catch (error) {
              this.log.error('Failed to create property option for value', {
                propertyId,
                value: String(value).substring(0, 50),
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
    }

    // Save all new value mappings
    if (newValueMappingRecords.length > 0) {
      await this.mappingService.upsertPropertyValueMappings(tenantId, newValueMappingRecords);
    }

    return valueMappings;
  }

  /**
   * Extract values from a property based on its type
   * Returns an array of resolved values (single element for most types, multiple for multiSelection)
   *
   * Supported property types:
   * - int, float, text: Returns the raw value as-is
   * - selection: Resolves the selection ID to its localized name
   * - multiSelection: Resolves ALL selection IDs to their localized names
   *
   * For selection types, relationValues contains entries with:
   * - lang: "0" (indicates selection ID, not a language code)
   * - value: the selection ID to look up
   */
  private async extractPropertyValues(
    prop: PlentyItemProperty,
    tenantId: string,
    propertyId: number
  ): Promise<string[]> {
    if (!prop.relationValues || prop.relationValues.length === 0) {
      return [];
    }

    // Get cached property to determine type
    const cachedProperty = await this.getCachedPlentyProperty(tenantId, propertyId);
    const propertyType = cachedProperty?.cast || 'text';

    this.log.debug('Extracting property values by type', {
      propertyId,
      propertyType,
      relationValuesCount: prop.relationValues.length,
    });

    // Dispatch to type-specific handler
    switch (propertyType) {
      case 'multiSelection':
        return this.extractMultiSelectionValues(prop, cachedProperty);

      case 'selection':
        return this.extractSelectionValue(prop, cachedProperty);

      case 'int':
      case 'float':
      case 'text':
      default:
        return this.extractSimpleValue(prop);
    }
  }

  /**
   * Handler for simple value types (int, float, text)
   * Returns raw value from relationValues, preferring de > en > first available
   */
  private extractSimpleValue(prop: PlentyItemProperty): string[] {
    const preferredLangs = ['de', 'en'];
    let rawValue: string | null = null;

    for (const lang of preferredLangs) {
      const langValue = prop.relationValues?.find(
        (rv) => rv.lang.toLowerCase() === lang
      );
      if (langValue?.value) {
        rawValue = langValue.value;
        break;
      }
    }

    if (!rawValue && prop.relationValues && prop.relationValues.length > 0) {
      rawValue = prop.relationValues[0]?.value || null;
    }

    return rawValue ? [rawValue] : [];
  }

  /**
   * Handler for single selection type
   * Resolves one selection ID to its localized name
   */
  private extractSelectionValue(
    prop: PlentyItemProperty,
    cachedProperty: PlentyProperty | null
  ): string[] {
    if (!cachedProperty?.selections) {
      this.log.warn('Selection property missing cached selections', {
        propertyId: prop.propertyId,
      });
      return this.extractSimpleValue(prop); // Fallback to raw value
    }

    const selections = cachedProperty.selections as Array<{
      id: number;
      values?: Record<string, string>;
    }>;

    // For selection type, get the value (selection ID) - prefer de, then en, then lang="0"
    const preferredLangs = ['de', 'en', '0'];
    let rawValue: string | null = null;

    for (const lang of preferredLangs) {
      const langValue = prop.relationValues?.find(
        (rv) => rv.lang.toLowerCase() === lang || rv.lang === lang
      );
      if (langValue?.value) {
        rawValue = langValue.value;
        break;
      }
    }

    if (!rawValue && prop.relationValues && prop.relationValues.length > 0) {
      rawValue = prop.relationValues[0]?.value || null;
    }

    if (!rawValue) {
      return [];
    }

    const selectionId = parseInt(rawValue, 10);
    if (isNaN(selectionId)) {
      return [rawValue]; // Return as-is if not a valid ID
    }

    const selection = selections.find((s) => s.id === selectionId);
    if (!selection?.values) {
      this.log.warn('Selection ID not found in cached property', {
        propertyId: prop.propertyId,
        selectionId,
        availableIds: selections.map(s => s.id),
      });
      return [rawValue]; // Return raw ID as fallback
    }

    const resolvedName = selection.values['de'] ||
                        selection.values['en'] ||
                        Object.values(selection.values)[0];

    this.log.debug('Resolved selection value', {
      propertyId: prop.propertyId,
      selectionId,
      resolvedName,
    });

    return resolvedName ? [resolvedName] : [rawValue];
  }

  /**
   * Handler for multiSelection type
   * Resolves ALL selection IDs (entries with lang="0") to their localized names
   */
  private extractMultiSelectionValues(
    prop: PlentyItemProperty,
    cachedProperty: PlentyProperty | null
  ): string[] {
    if (!cachedProperty?.selections) {
      this.log.warn('MultiSelection property missing cached selections', {
        propertyId: prop.propertyId,
      });
      return [];
    }

    const selections = cachedProperty.selections as Array<{
      id: number;
      values?: Record<string, string>;
    }>;

    // For multiSelection, entries with lang="0" contain selection IDs
    const selectionEntries = prop.relationValues?.filter(
      (rv) => rv.lang === '0' || rv.lang === 'de' || rv.lang === 'en'
    ) || [];

    // If no explicit selection entries, try all entries
    const entriesToProcess = selectionEntries.length > 0
      ? selectionEntries
      : prop.relationValues || [];

    const resolvedValues: string[] = [];

    for (const entry of entriesToProcess) {
      if (!entry.value) continue;

      const selectionId = parseInt(entry.value, 10);
      if (isNaN(selectionId)) {
        // Not a valid selection ID, could be a raw value - include it
        resolvedValues.push(entry.value);
        continue;
      }

      const selection = selections.find((s) => s.id === selectionId);
      if (!selection?.values) {
        this.log.warn('MultiSelection ID not found in cached property', {
          propertyId: prop.propertyId,
          selectionId,
        });
        continue; // Skip missing selections
      }

      const resolvedName = selection.values['de'] ||
                          selection.values['en'] ||
                          Object.values(selection.values)[0];

      if (resolvedName) {
        resolvedValues.push(resolvedName);
        this.log.debug('Resolved multiSelection value', {
          propertyId: prop.propertyId,
          selectionId,
          resolvedName,
        });
      }
    }

    this.log.info('Extracted multiSelection values', {
      propertyId: prop.propertyId,
      inputEntries: entriesToProcess.length,
      resolvedCount: resolvedValues.length,
      values: resolvedValues,
    });

    return resolvedValues;
  }

  /**
   * Legacy method for backward compatibility - returns single value
   * @deprecated Use extractPropertyValues instead
   */
  private async extractPropertyValue(
    prop: PlentyItemProperty,
    tenantId: string,
    propertyId: number
  ): Promise<string | null> {
    const values = await this.extractPropertyValues(prop, tenantId, propertyId);
    return values.length > 0 ? values[0] : null;
  }

  /**
   * Create a property option for a non-selection property value
   */
  private async createPropertyOptionForValue(
    tenantId: string,
    plentyPropertyId: number,
    value: string,
    shopwareGroupId: string,
    shopware: IShopwareClient
  ): Promise<string> {
    // Validate required parameters
    if (!shopwareGroupId) {
      throw new Error(
        `Cannot create property option: missing Shopware group ID for property ${plentyPropertyId}. ` +
        `Ensure the property group was created during CONFIG sync.`
      );
    }

    if (!value || value.trim() === '') {
      throw new Error(
        `Cannot create property option: empty value for property ${plentyPropertyId}`
      );
    }

    this.log.info('Creating property option in Shopware', {
      plentyPropertyId,
      value: value.substring(0, 50),
      shopwareGroupId,
    });

    // Build translations from the value
    // For non-selection properties, value is the same across languages
    const translations: Record<string, { name: string }> = {
      de: { name: value },
      en: { name: value },
    };

    const shopwareOption: ShopwarePropertyOption = {
      id: '',
      groupId: shopwareGroupId,
      name: value,
      position: 0,
      translations,
      _plentyPropertyId: plentyPropertyId,
    };

    this.log.debug('Shopware property option payload', {
      groupId: shopwareOption.groupId,
      name: shopwareOption.name,
      position: shopwareOption.position,
    });

    const result = await shopware.createPropertyOption(shopwareOption);

    if (!result.success) {
      this.log.error('Shopware API rejected property option creation', {
        plentyPropertyId,
        value: value.substring(0, 50),
        shopwareGroupId,
        error: result.error,
      });
      throw new Error(
        `Failed to create property option in Shopware: ${result.error || 'Unknown error'}`
      );
    }

    this.log.info('Property option created successfully', {
      plentyPropertyId,
      value: value.substring(0, 50),
      shopwareOptionId: result.id,
    });

    return result.id;
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
    this.log.debug(`createPropertyGroupInShopware: loading property ${plentyPropertyId} from cache`);

    // Load property from cache
    const plentyProperty = await this.getCachedPlentyProperty(tenantId, plentyPropertyId);

    if (!plentyProperty) {
      const errorMsg =
        `Property ${plentyPropertyId} not found in cache. ` +
        `This property exists on products but was not synced during CONFIG sync. ` +
        `To fix: 1) Run a CONFIG sync to refresh property definitions. ` +
        `2) If property was recently added in Plenty, ensure "Webshop visibility" is enabled ` +
        `(Plenty > Setup > Item > Properties > Property ${plentyPropertyId}). ` +
        `Property OPTIONS cannot be auto-created without the property GROUP existing first.`;
      this.log.error(errorMsg);
      throw new Error(errorMsg);
    }

    this.log.debug(`Found property in cache: id=${plentyProperty.id}, cast=${plentyProperty.cast}`);

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
