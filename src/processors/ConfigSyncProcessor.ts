import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createJobLogger } from '../utils/logger';
import { PlentyClient } from '../clients/PlentyClient';
import type { PlentyClientConfig } from '../clients/PlentyClient';
import { createShopwareClient } from '../clients/ShopwareClientFactory';
import type { IShopwareClient } from '../clients/interfaces';
import type {
  PlentyCategory,
  PlentyAttribute,
  PlentySalesPrice,
  PlentyManufacturer,
  PlentyUnit,
} from '../types/plenty';
import type { DecryptedSyncJobData, ConfigSyncResult } from '../types/sync';

/**
 * Configuration Sync Processor
 * Fetches and caches configuration data from Plenty:
 * - Categories
 * - Attributes
 * - Sales Prices
 * - Manufacturers
 * - Units
 */
export class ConfigSyncProcessor {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Process a CONFIG sync job
   */
  async process(jobData: DecryptedSyncJobData): Promise<ConfigSyncResult> {
    const log = createJobLogger(jobData.id, jobData.tenantId, 'CONFIG');
    const startTime = Date.now();

    log.info('Starting config sync');

    const result: ConfigSyncResult = {
      categories: { synced: 0, errors: 0 },
      attributes: { synced: 0, errors: 0 },
      salesPrices: { synced: 0, errors: 0 },
      manufacturers: { synced: 0, errors: 0 },
      units: { synced: 0, errors: 0 },
      duration: 0,
    };

    try {
      // Initialize Plenty client
      const plentyConfig: PlentyClientConfig = {
        baseUrl: jobData.plentyUrl,
        credentials: jobData.plentyCredentials,
      };
      const plenty = new PlentyClient(plentyConfig);
      await plenty.authenticate();

      // Initialize Shopware client
      const shopware: IShopwareClient = createShopwareClient({
        tenantId: jobData.tenantId,
      });
      await shopware.authenticate();

      // Sync each config type
      log.info('Syncing categories');
      //result.categories = await this.syncCategories(jobData.tenantId, plenty, shopware);

      log.info('Syncing attributes');
      //result.attributes = await this.syncAttributes(jobData.tenantId, plenty, shopware);

      log.info('Syncing sales prices');
      result.salesPrices = await this.syncSalesPrices(jobData.tenantId, plenty, shopware);

      log.info('Syncing manufacturers');
      //result.manufacturers = await this.syncManufacturers(jobData.tenantId, plenty, shopware);

      log.info('Syncing units');
      result.units = await this.syncUnits(jobData.tenantId, plenty, shopware);

      // Update sync state
      await this.updateSyncState(jobData.tenantId);

      result.duration = Date.now() - startTime;
      log.info('Config sync completed', { result });

      return result;
    } catch (error) {
      result.duration = Date.now() - startTime;
      log.error('Config sync failed', { error, result });
      throw error;
    }
  }

  /**
   * Sync categories from Plenty using bulk operations
   * Categories are processed level by level to ensure parents exist before children
   */
  private async syncCategories(
    tenantId: string,
    plenty: PlentyClient,
    shopware: IShopwareClient
  ): Promise<{ synced: number; errors: number }> {
    const log = createJobLogger('', tenantId, 'CONFIG');

    try {
      const categories = await plenty.getAllCategories();

      if (categories.length === 0) {
        log.info('No categories to sync');
        return { synced: 0, errors: 0 };
      }

      log.info('Starting bulk category sync', { count: categories.length });

      // Step 1: Bulk upsert to local cache
      await this.bulkUpsertCategoriesToCache(tenantId, categories);

      // Step 2: Get all existing mappings at once
      const { CategoryMappingService } = await import('../services/CategoryMappingService');
      const mappingService = new CategoryMappingService();
      const existingMappings = await mappingService.getBatchMappings(
        tenantId,
        categories.map((c) => c.id)
      );

      // Step 3: Group categories by level for hierarchical processing
      const categoriesByLevel = new Map<number, PlentyCategory[]>();
      for (const category of categories) {
        const level = category.level || 0;
        if (!categoriesByLevel.has(level)) {
          categoriesByLevel.set(level, []);
        }
        categoriesByLevel.get(level)!.push(category);
      }

      // Sort levels in ascending order
      const sortedLevels = Array.from(categoriesByLevel.keys()).sort((a, b) => a - b);

      log.info('Categories grouped by level', {
        levels: sortedLevels,
        countPerLevel: sortedLevels.map((l) => ({ level: l, count: categoriesByLevel.get(l)!.length })),
      });

      // Track all mappings (existing + newly created) for parent ID resolution
      const allMappings = new Map<number, string>();
      for (const [plentyId, mapping] of Object.entries(existingMappings)) {
        allMappings.set(Number(plentyId), mapping.shopwareCategoryId);
      }

      // Helper to generate UUID
      const generateUuid = (): string => {
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };

      // Locale mapping for translations
      const localeMap: Record<string, string> = {
        de: 'de-DE',
        en: 'en-GB',
        fr: 'fr-FR',
        it: 'it-IT',
        es: 'es-ES',
        nl: 'nl-NL',
        pl: 'pl-PL',
      };

      let totalSynced = 0;
      let totalErrors = 0;

      // Step 4: Process each level in order
      for (const level of sortedLevels) {
        const levelCategories = categoriesByLevel.get(level)!;
        log.info('Processing category level', { level, count: levelCategories.length });

        // Prepare bulk payload for this level
        const bulkPayload: Array<{
          id: string;
          name: string;
          parentId?: string;
          active: boolean;
          visible: boolean;
          translations: Record<string, { name: string }>;
        }> = [];

        const mappingUpdates: Array<{
          plentyCategoryId: number;
          shopwareCategoryId: string;
          mappingType: 'MANUAL' | 'AUTO';
          lastSyncAction: 'create' | 'update';
        }> = [];

        for (const category of levelCategories) {
          // Extract localized names from details
          const names: Record<string, string> = {};
          if (category.details) {
            for (const detail of category.details) {
              names[detail.lang] = detail.name;
            }
          }

          // Convert string Y/N to boolean
          const linklist = category.linklist === 'Y' || category.linklist === true;

          // Get category name (prefer de -> en -> first available)
          const categoryName = names['de'] || names['en'] || Object.values(names)[0] || `Category ${category.id}`;

          // Build translations for Shopware
          const translations: Record<string, { name: string }> = {};
          for (const [lang, name] of Object.entries(names)) {
            const shopwareLang = localeMap[lang] || lang;
            translations[shopwareLang] = { name };
          }

          // Resolve parent Shopware ID from our tracking map
          let shopwareParentId: string | undefined;
          if (category.parentCategoryId) {
            shopwareParentId = allMappings.get(category.parentCategoryId);
            if (!shopwareParentId) {
              log.warn('Parent category not found in mappings', {
                categoryId: category.id,
                parentCategoryId: category.parentCategoryId,
              });
            }
          }

          // Get or generate Shopware ID
          const existingMapping = existingMappings[category.id];
          const shopwareId = existingMapping?.shopwareCategoryId || generateUuid();

          // Track this mapping for child categories
          allMappings.set(category.id, shopwareId);

          bulkPayload.push({
            id: shopwareId,
            name: categoryName,
            ...(shopwareParentId && { parentId: shopwareParentId }),
            active: linklist,
            visible: linklist,
            translations,
          });

          mappingUpdates.push({
            plentyCategoryId: category.id,
            shopwareCategoryId: shopwareId,
            mappingType: (existingMapping?.mappingType as 'MANUAL' | 'AUTO') || 'AUTO',
            lastSyncAction: existingMapping ? 'update' : 'create',
          });
        }

        // Step 5: Bulk sync this level to Shopware
        if (bulkPayload.length > 0) {
          log.info('Executing bulk sync for level', { level, count: bulkPayload.length });

          const bulkResult = await shopware.bulkSyncCategories(
            bulkPayload.map((p) => ({
              id: p.id,
              name: p.name,
              parentId: p.parentId,
              active: p.active,
              visible: p.visible,
              translations: p.translations,
            }))
          );

          // Step 6: Update mappings based on results
          if (bulkResult.success) {
            await mappingService.upsertMappings(tenantId, mappingUpdates);
            totalSynced += levelCategories.length;
            log.info('Level sync completed successfully', { level, synced: levelCategories.length });
          } else {
            // Count successes and failures
            const successCount = bulkResult.results.filter((r) => r.success).length;
            const errorCount = bulkResult.results.filter((r) => !r.success).length;

            // Only update mappings for successful items
            const successfulMappings = mappingUpdates.filter((_, index) => bulkResult.results[index]?.success);
            if (successfulMappings.length > 0) {
              await mappingService.upsertMappings(tenantId, successfulMappings);
            }

            totalSynced += successCount;
            totalErrors += errorCount;
            log.warn('Level sync completed with errors', { level, synced: successCount, errors: errorCount });
          }
        }
      }

      log.info('Bulk category sync completed', { synced: totalSynced, errors: totalErrors });
      return { synced: totalSynced, errors: totalErrors };
    } catch (error) {
      log.error('Failed to sync categories', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to sync categories: ${error}`);
    }
  }

  /**
   * Bulk upsert categories to local cache
   */
  private async bulkUpsertCategoriesToCache(tenantId: string, categories: PlentyCategory[]): Promise<void> {
    // Use transaction for bulk upsert
    await this.prisma.$transaction(
      categories.map((category) => {
        // Extract localized names from details
        const names: Record<string, string> = {};
        if (category.details) {
          for (const detail of category.details) {
            names[detail.lang] = detail.name;
          }
        }

        // Convert string Y/N to boolean
        const linklist = category.linklist === 'Y' || category.linklist === true;
        const sitemap = category.sitemap === 'Y' || category.sitemap === true;

        return this.prisma.plentyCategory.upsert({
          where: {
            tenantId_id: {
              tenantId,
              id: category.id,
            },
          },
          create: {
            id: category.id,
            tenantId,
            parentId: category.parentCategoryId,
            level: category.level,
            type: category.type,
            linklist,
            right: category.right,
            sitemap,
            hasChildren: category.hasChildren,
            names,
            rawData: category as unknown as object,
            syncedAt: new Date(),
          },
          update: {
            parentId: category.parentCategoryId,
            level: category.level,
            type: category.type,
            linklist,
            right: category.right,
            sitemap,
            hasChildren: category.hasChildren,
            names,
            rawData: category as unknown as object,
            syncedAt: new Date(),
          },
        });
      })
    );
  }

  /**
   * Sync attributes from Plenty using bulk operations
   * Two-phase sync: first property groups, then property options
   * Handles display type mapping and image uploads for media-type attributes
   */
  private async syncAttributes(
    tenantId: string,
    plenty: PlentyClient,
    shopware: IShopwareClient
  ): Promise<{ synced: number; errors: number }> {
    const log = createJobLogger('', tenantId, 'CONFIG');

    try {
      const attributes = await plenty.getAllAttributes();

      if (attributes.length === 0) {
        log.info('No attributes to sync');
        return { synced: 0, errors: 0 };
      }

      log.info('Starting bulk attribute sync', { count: attributes.length });

      // Step 1: Bulk upsert all attributes to local cache
      await this.bulkUpsertAttributesToCache(tenantId, attributes);

      // Step 2: Get all existing mappings at once
      const { AttributeMappingService } = await import('../services/AttributeMappingService');
      const mappingService = new AttributeMappingService();

      const existingAttributeMappings = await mappingService.getBatchAttributeMappings(
        tenantId,
        attributes.map((a) => a.id)
      );

      // Collect all attribute value IDs for batch lookup
      const allValueIds: number[] = [];
      for (const attribute of attributes) {
        const values = attribute.values || attribute.attributeValues || [];
        for (const value of values) {
          allValueIds.push(value.id);
        }
      }

      const existingValueMappings = await mappingService.getBatchAttributeValueMappings(tenantId, allValueIds);

      log.info('Loaded existing mappings', {
        attributeMappings: Object.keys(existingAttributeMappings).length,
        valueMappings: Object.keys(existingValueMappings).length,
      });

      // Helper to generate UUID
      const generateUuid = (): string => {
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };

      // Locale mapping for translations
      const localeMap: Record<string, string> = {
        de: 'de-DE',
        en: 'en-GB',
        fr: 'fr-FR',
        it: 'it-IT',
        es: 'es-ES',
        nl: 'nl-NL',
        pl: 'pl-PL',
      };

      // Map Plenty typeOfSelectionInOnlineStore to Shopware displayType
      const mapDisplayType = (plentyType: string): string => {
        switch (plentyType?.toLowerCase()) {
          case 'image':
            return 'media';
          case 'dropdown':
            return 'select';
          default:
            return 'text';
        }
      };

      // Step 3: Prepare bulk payload for property groups
      const propertyGroupPayload: Array<{
        id: string;
        name: string;
        displayType: string;
        sortingType: string;
        position: number;
        translations: Record<string, { name: string }>;
      }> = [];

      const attributeMappingUpdates: Array<{
        plentyAttributeId: number;
        shopwarePropertyGroupId: string;
        mappingType: 'MANUAL' | 'AUTO';
        lastSyncAction: 'create' | 'update';
      }> = [];

      // Track generated Shopware IDs and display types for property options
      const attributeToShopwareGroupId = new Map<number, string>();
      const attributeDisplayTypes = new Map<number, string>();

      for (const attribute of attributes) {
        // Extract localized names
        const names: Record<string, string> = {};
        if (attribute.attributeNames) {
          for (const name of attribute.attributeNames) {
            names[name.lang] = name.name;
          }
        }

        const attributeName = names['de'] || names['en'] || Object.values(names)[0] || attribute.backendName;

        // Build translations
        const translations: Record<string, { name: string }> = {};
        for (const [lang, name] of Object.entries(names)) {
          const shopwareLang = localeMap[lang] || lang;
          translations[shopwareLang] = { name };
        }

        // Get or generate Shopware ID
        const existingMapping = existingAttributeMappings[attribute.id];
        const shopwareId = existingMapping?.shopwarePropertyGroupId || generateUuid();

        // Map display type from Plenty to Shopware
        const displayType = mapDisplayType(attribute.typeOfSelectionInOnlineStore);

        // Track for later use by property options
        attributeToShopwareGroupId.set(attribute.id, shopwareId);
        attributeDisplayTypes.set(attribute.id, displayType);

        log.debug('Mapping attribute display type', {
          attributeId: attribute.id,
          plentyType: attribute.typeOfSelectionInOnlineStore,
          shopwareDisplayType: displayType,
        });

        propertyGroupPayload.push({
          id: shopwareId,
          name: attributeName,
          displayType,
          sortingType: 'alphanumeric',
          position: attribute.position,
          translations,
        });

        attributeMappingUpdates.push({
          plentyAttributeId: attribute.id,
          shopwarePropertyGroupId: shopwareId,
          mappingType: (existingMapping?.mappingType as 'MANUAL' | 'AUTO') || 'AUTO',
          lastSyncAction: existingMapping ? 'update' : 'create',
        });
      }

      // Step 4: Bulk sync property groups to Shopware
      log.info('Executing bulk sync for property groups', { count: propertyGroupPayload.length });
      const groupResult = await shopware.bulkSyncPropertyGroups(propertyGroupPayload);

      let totalSynced = 0;
      let totalErrors = 0;

      if (groupResult.success) {
        await mappingService.upsertAttributeMappings(tenantId, attributeMappingUpdates);
        totalSynced += attributes.length;
        log.info('Property groups synced successfully', { count: attributes.length });
      } else {
        const successCount = groupResult.results.filter((r) => r.success).length;
        const errorCount = groupResult.results.filter((r) => !r.success).length;

        const successfulMappings = attributeMappingUpdates.filter((_, index) => groupResult.results[index]?.success);
        if (successfulMappings.length > 0) {
          await mappingService.upsertAttributeMappings(tenantId, successfulMappings);
        }

        totalSynced += successCount;
        totalErrors += errorCount;
        log.warn('Property groups sync completed with errors', { synced: successCount, errors: errorCount });
      }

      // Step 5: Upload images for media-type attribute values
      const { MediaService } = await import('../services/MediaService');
      const mediaService = new MediaService();
      const valueMediaIds = new Map<number, string>(); // valueId -> mediaId

      // Get Plenty frontend URL from tenant configuration
      const { TenantConfigService, ConfigKeys } = await import('../services/TenantConfigService');
      const configService = new TenantConfigService();
      const plentyFrontendUrl = await configService.getPlentyFrontendUrl(tenantId);

      if (!plentyFrontendUrl) {
        log.warn('Plenty frontend URL not configured, skipping attribute image uploads. Set config key: ' + ConfigKeys.PLENTY_FRONTEND_URL);
      } else {
        for (const attribute of attributes) {
          const displayType = attributeDisplayTypes.get(attribute.id);
          if (displayType !== 'media') continue;

          const values = attribute.values || attribute.attributeValues || [];
          for (const value of values) {
            if (!value.image) continue;

            // Construct full image URL from Plenty frontend
            const imageUrl = `${plentyFrontendUrl}/images/produkte/grp/${value.image}`;

          log.debug('Uploading attribute value image', {
            attributeId: attribute.id,
            valueId: value.id,
            imageName: value.image,
            imageUrl,
          });

          const uploadResult = await mediaService.uploadFromUrl(tenantId, shopware, {
            sourceUrl: imageUrl,
            sourceType: 'PROPERTY_OPTION_IMAGE',
            sourceEntityId: `${attribute.id}_${value.id}`,
            folderName: 'Attribute Images',
            fileName: `attr_${attribute.id}_val_${value.id}_${value.image}`,
            title: `${attribute.backendName} - ${value.backendName}`,
            alt: value.backendName,
          });

          if (uploadResult.success && uploadResult.shopwareMediaId) {
            valueMediaIds.set(value.id, uploadResult.shopwareMediaId);
            log.debug('Attribute value image uploaded', {
              valueId: value.id,
              mediaId: uploadResult.shopwareMediaId,
            });
          } else {
            log.warn('Failed to upload attribute value image', {
              attributeId: attribute.id,
              valueId: value.id,
              imageName: value.image,
              imageUrl,
              error: uploadResult.error || 'Unknown error',
            });
            }
          }
        }
      }

      log.info('Attribute value image uploads completed', { uploadedCount: valueMediaIds.size });

      // Step 6: Prepare bulk payload for property options
      const propertyOptionPayload: Array<{
        id: string;
        groupId: string;
        name: string;
        position: number;
        mediaId?: string;
        translations: Record<string, { name: string }>;
      }> = [];

      const valueMappingUpdates: Array<{
        plentyAttributeId: number;
        plentyAttributeValueId: number;
        shopwarePropertyGroupId: string;
        shopwarePropertyOptionId: string;
        mappingType: 'MANUAL' | 'AUTO';
        lastSyncAction: 'create' | 'update';
      }> = [];

      for (const attribute of attributes) {
        const shopwareGroupId = attributeToShopwareGroupId.get(attribute.id);
        if (!shopwareGroupId) continue;

        const values = attribute.values || attribute.attributeValues || [];

        for (const value of values) {
          // Extract localized names
          const valueNames: Record<string, string> = {};
          if (value.valueNames) {
            for (const name of value.valueNames) {
              valueNames[name.lang] = name.name;
            }
          }

          const valueName = valueNames['de'] || valueNames['en'] || Object.values(valueNames)[0] || value.backendName;

          // Build translations
          const translations: Record<string, { name: string }> = {};
          for (const [lang, name] of Object.entries(valueNames)) {
            const shopwareLang = localeMap[lang] || lang;
            translations[shopwareLang] = { name };
          }

          // Get or generate Shopware ID
          const existingValueMapping = existingValueMappings[value.id];
          const shopwareOptionId = existingValueMapping?.shopwarePropertyOptionId || generateUuid();

          // Get media ID if image was uploaded for this value
          const mediaId = valueMediaIds.get(value.id);

          log.debug('Preparing property option', {
            attributeId: attribute.id,
            valueId: value.id,
            valueName,
            position: value.position,
            positionType: typeof value.position,
          });

          propertyOptionPayload.push({
            id: shopwareOptionId,
            groupId: shopwareGroupId,
            name: valueName,
            position: value.position ?? 0,
            ...(mediaId && { mediaId }),
            translations,
          });

          valueMappingUpdates.push({
            plentyAttributeId: attribute.id,
            plentyAttributeValueId: value.id,
            shopwarePropertyGroupId: shopwareGroupId,
            shopwarePropertyOptionId: shopwareOptionId,
            mappingType: (existingValueMapping?.mappingType as 'MANUAL' | 'AUTO') || 'AUTO',
            lastSyncAction: existingValueMapping ? 'update' : 'create',
          });
        }
      }

      // Step 7: Bulk sync property options to Shopware
      if (propertyOptionPayload.length > 0) {
        log.info('Executing bulk sync for property options', { count: propertyOptionPayload.length });

        // Log sample of the payload to verify positions
        const sampleOptions = propertyOptionPayload.slice(0, 10);
        const sampleStr = sampleOptions.map((o) => `${o.name}:${o.position}`).join(', ');
        log.info(`Sample property options (first 10): ${sampleStr}`);

        const optionResult = await shopware.bulkSyncPropertyOptions(propertyOptionPayload);

        if (optionResult.success) {
          await mappingService.upsertAttributeValueMappings(tenantId, valueMappingUpdates);
          log.info('Property options synced successfully', { count: propertyOptionPayload.length });
        } else {
          const successCount = optionResult.results.filter((r) => r.success).length;
          const errorCount = optionResult.results.filter((r) => !r.success).length;

          const successfulMappings = valueMappingUpdates.filter((_, index) => optionResult.results[index]?.success);
          if (successfulMappings.length > 0) {
            await mappingService.upsertAttributeValueMappings(tenantId, successfulMappings);
          }

          totalErrors += errorCount;
          log.warn('Property options sync completed with errors', { synced: successCount, errors: errorCount });
        }
      }

      log.info('Bulk attribute sync completed', { synced: totalSynced, errors: totalErrors });
      return { synced: totalSynced, errors: totalErrors };
    } catch (error) {
      log.error('Failed to sync attributes', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to sync attributes: ${error}`);
    }
  }

  /**
   * Bulk upsert attributes to local cache
   */
  private async bulkUpsertAttributesToCache(tenantId: string, attributes: PlentyAttribute[]): Promise<void> {
    await this.prisma.$transaction(
      attributes.map((attribute) => {
        // Extract localized names
        const names: Record<string, string> = {};
        if (attribute.attributeNames) {
          for (const name of attribute.attributeNames) {
            names[name.lang] = name.name;
          }
        }

        return this.prisma.plentyAttribute.upsert({
          where: {
            tenantId_id: {
              tenantId,
              id: attribute.id,
            },
          },
          create: {
            id: attribute.id,
            tenantId,
            backendName: attribute.backendName,
            position: attribute.position,
            isSurchargePercental: attribute.isSurchargePercental,
            isLinkableToImage: attribute.isLinkableToImage,
            amazonAttribute: attribute.amazonAttribute,
            fruugoAttribute: attribute.fruugoAttribute,
            pixmaniaAttribute: attribute.pixmaniaAttribute,
            googleShoppingAttribute: attribute.googleShoppingAttribute,
            attributeValues: (attribute.values || attribute.attributeValues) as unknown as object,
            names,
            rawData: attribute as unknown as object,
            syncedAt: new Date(),
          },
          update: {
            backendName: attribute.backendName,
            position: attribute.position,
            isSurchargePercental: attribute.isSurchargePercental,
            isLinkableToImage: attribute.isLinkableToImage,
            amazonAttribute: attribute.amazonAttribute,
            fruugoAttribute: attribute.fruugoAttribute,
            pixmaniaAttribute: attribute.pixmaniaAttribute,
            googleShoppingAttribute: attribute.googleShoppingAttribute,
            attributeValues: (attribute.values || attribute.attributeValues) as unknown as object,
            names,
            rawData: attribute as unknown as object,
            syncedAt: new Date(),
          },
        });
      })
    );
  }

  /**
   * Sync sales prices from Plenty - cache locally only
   * Sales prices are used during product sync to determine which price to use
   * We don't sync them to Shopware as entities - the price values come from variations
   */
  private async syncSalesPrices(
    tenantId: string,
    plenty: PlentyClient,
    _shopware: IShopwareClient // Unused - kept for interface consistency
  ): Promise<{ synced: number; errors: number }> {
    const log = createJobLogger('', tenantId, 'CONFIG');

    try {
      const salesPrices = await plenty.getAllSalesPrices();

      if (salesPrices.length === 0) {
        log.info('No sales prices to sync');
        return { synced: 0, errors: 0 };
      }

      log.info('Caching sales prices locally', { count: salesPrices.length });

      // Bulk upsert to local cache
      await this.bulkUpsertSalesPricesToCache(tenantId, salesPrices);

      // Log which price types are available for configuration reference
      const priceTypes = salesPrices.map((sp) => ({
        id: sp.id,
        type: sp.type,
        name: sp.names?.[0]?.nameInternal || 'Unknown',
      }));
      log.info('Available sales price types for configuration', { priceTypes });

      log.info('Sales prices cached successfully', { synced: salesPrices.length });
      return { synced: salesPrices.length, errors: 0 };
    } catch (error) {
      log.error('Failed to sync sales prices', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to sync sales prices: ${error}`);
    }
  }

  /**
   * Bulk upsert sales prices to local cache
   */
  private async bulkUpsertSalesPricesToCache(tenantId: string, salesPrices: PlentySalesPrice[]): Promise<void> {
    await this.prisma.$transaction(
      salesPrices.map((salesPrice) => {
        // Extract localized names
        const names: Record<string, string> = {};
        if (salesPrice.names) {
          for (const name of salesPrice.names) {
            names[name.lang] = name.nameInternal;
          }
        }

        // Extract currency from currencies relation
        let currency: string | null = null;
        if (salesPrice.currencies && salesPrice.currencies.length > 0) {
          currency = salesPrice.currencies[0].currency;
        }

        // Extract IDs from relations
        const countryIds = salesPrice.countries?.map((c) => c.countryId) || [];
        const customerClassIds = salesPrice.customerClasses?.map((c) => c.customerClassId) || [];
        const referrerIds = salesPrice.referrers?.map((r) => r.referrerId) || [];

        return this.prisma.plentySalesPrice.upsert({
          where: {
            tenantId_id: {
              tenantId,
              id: salesPrice.id,
            },
          },
          create: {
            id: salesPrice.id,
            tenantId,
            position: salesPrice.position,
            minimumOrderQuantity: salesPrice.minimumOrderQuantity,
            type: salesPrice.type,
            isCustomerPrice: salesPrice.isCustomerPrice,
            isDisplayedByDefault: salesPrice.isDisplayedByDefault,
            isLiveConversion: salesPrice.isLiveConversion,
            currency,
            countryIds,
            customerClassIds,
            referrerIds,
            names,
            rawData: salesPrice as unknown as object,
            syncedAt: new Date(),
          },
          update: {
            position: salesPrice.position,
            minimumOrderQuantity: salesPrice.minimumOrderQuantity,
            type: salesPrice.type,
            isCustomerPrice: salesPrice.isCustomerPrice,
            isDisplayedByDefault: salesPrice.isDisplayedByDefault,
            isLiveConversion: salesPrice.isLiveConversion,
            currency,
            countryIds,
            customerClassIds,
            referrerIds,
            names,
            rawData: salesPrice as unknown as object,
            syncedAt: new Date(),
          },
        });
      })
    );
  }

  /**
   * Sync manufacturers from Plenty using bulk operations
   */
  private async syncManufacturers(
    tenantId: string,
    plenty: PlentyClient,
    shopware: IShopwareClient
  ): Promise<{ synced: number; errors: number }> {
    const log = createJobLogger('', tenantId, 'CONFIG');

    try {
      const manufacturers = await plenty.getManufacturers();

      if (manufacturers.length === 0) {
        log.info('No manufacturers to sync');
        return { synced: 0, errors: 0 };
      }

      log.info('Starting bulk manufacturer sync', { count: manufacturers.length });

      // Step 1: Bulk upsert to local cache
      await this.bulkUpsertManufacturersToCache(tenantId, manufacturers);

      // Step 2: Get all existing mappings at once
      const { ManufacturerMappingService } = await import('../services/ManufacturerMappingService');
      const mappingService = new ManufacturerMappingService();
      const existingMappings = await mappingService.getBatchMappings(
        tenantId,
        manufacturers.map((m) => m.id)
      );

      // Step 3: Upload logos and collect mediaIds
      const { MediaService } = await import('../services/MediaService');
      const mediaService = new MediaService();
      const logoMediaIds = new Map<number, string>();

      for (const manufacturer of manufacturers) {
        if (manufacturer.logo) {
          const logoExtension = manufacturer.logo.split('.').pop()?.toLowerCase() || 'jpg';
          const safeManufacturerName = manufacturer.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          const logoFileName = `manufacturer_${safeManufacturerName}_${manufacturer.id}.${logoExtension}`;

          const uploadResult = await mediaService.uploadFromUrl(tenantId, shopware, {
            sourceUrl: manufacturer.logo,
            sourceType: 'MANUFACTURER_LOGO',
            sourceEntityId: String(manufacturer.id),
            folderName: 'Manufacturer Logos',
            fileName: logoFileName,
            title: `${manufacturer.name} Logo`,
            alt: manufacturer.name,
          });

          if (uploadResult.success && uploadResult.shopwareMediaId) {
            logoMediaIds.set(manufacturer.id, uploadResult.shopwareMediaId);
          }
        }
      }

      log.info('Logo uploads completed', { uploadedCount: logoMediaIds.size });

      // Step 4: Prepare bulk payload for Shopware
      const bulkPayload: Array<{
        id: string;
        name: string;
        link: string | null;
        description: string | null;
        mediaId?: string;
      }> = [];

      const mappingUpdates: Array<{
        plentyManufacturerId: number;
        shopwareManufacturerId: string;
        mappingType: 'MANUAL' | 'AUTO';
        lastSyncAction: 'create' | 'update';
      }> = [];

      // Helper to generate UUID (same as ShopwareClient)
      const generateUuid = (): string => {
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };

      for (const manufacturer of manufacturers) {
        const existingMapping = existingMappings[manufacturer.id];
        const shopwareId = existingMapping?.shopwareManufacturerId || generateUuid();
        const mediaId = logoMediaIds.get(manufacturer.id);

        bulkPayload.push({
          id: shopwareId,
          name: manufacturer.name,
          link: manufacturer.url || null,
          description: manufacturer.comment || null,
          ...(mediaId && { mediaId }),
        });

        mappingUpdates.push({
          plentyManufacturerId: manufacturer.id,
          shopwareManufacturerId: shopwareId,
          mappingType: existingMapping?.mappingType as 'MANUAL' | 'AUTO' || 'AUTO',
          lastSyncAction: existingMapping ? 'update' : 'create',
        });
      }

      // Step 5: Bulk sync to Shopware
      log.info('Executing bulk sync to Shopware', { count: bulkPayload.length });
      const bulkResult = await shopware.bulkSyncManufacturers(bulkPayload);

      // Step 6: Update mappings based on results
      if (bulkResult.success) {
        await mappingService.upsertMappings(tenantId, mappingUpdates);
        log.info('Bulk manufacturer sync completed successfully', { synced: manufacturers.length });
        return { synced: manufacturers.length, errors: 0 };
      } else {
        // Count successes and failures from individual results
        const successCount = bulkResult.results.filter((r) => r.success).length;
        const errorCount = bulkResult.results.filter((r) => !r.success).length;

        // Only update mappings for successful items
        const successfulMappings = mappingUpdates.filter((_, index) => bulkResult.results[index]?.success);
        if (successfulMappings.length > 0) {
          await mappingService.upsertMappings(tenantId, successfulMappings);
        }

        log.warn('Bulk manufacturer sync completed with errors', { synced: successCount, errors: errorCount });
        return { synced: successCount, errors: errorCount };
      }
    } catch (error) {
      log.error('Failed to sync manufacturers', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to sync manufacturers: ${error}`);
    }
  }

  /**
   * Bulk upsert manufacturers to local cache
   */
  private async bulkUpsertManufacturersToCache(
    tenantId: string,
    manufacturers: PlentyManufacturer[]
  ): Promise<void> {
    // Use transaction for bulk upsert
    await this.prisma.$transaction(
      manufacturers.map((manufacturer) =>
        this.prisma.plentyManufacturer.upsert({
          where: {
            tenantId_id: {
              tenantId,
              id: manufacturer.id,
            },
          },
          create: {
            id: manufacturer.id,
            tenantId,
            name: manufacturer.name,
            externalName: manufacturer.externalName,
            logo: manufacturer.logo,
            url: manufacturer.url,
            street: manufacturer.street,
            houseNo: manufacturer.houseNo,
            postcode: manufacturer.postcode,
            town: manufacturer.town,
            phoneNumber: manufacturer.phoneNumber,
            faxNumber: manufacturer.faxNumber,
            email: manufacturer.email,
            countryId: manufacturer.countryId,
            pixmaniaBrandId: manufacturer.pixmaniaBrandId,
            neckermannBrandId: manufacturer.neckermannBrandId,
            position: manufacturer.position,
            comment: manufacturer.comment,
            laRedouteBrandId: manufacturer.laRedouteBrandId,
            rawData: manufacturer as unknown as object,
            syncedAt: new Date(),
          },
          update: {
            name: manufacturer.name,
            externalName: manufacturer.externalName,
            logo: manufacturer.logo,
            url: manufacturer.url,
            street: manufacturer.street,
            houseNo: manufacturer.houseNo,
            postcode: manufacturer.postcode,
            town: manufacturer.town,
            phoneNumber: manufacturer.phoneNumber,
            faxNumber: manufacturer.faxNumber,
            email: manufacturer.email,
            countryId: manufacturer.countryId,
            pixmaniaBrandId: manufacturer.pixmaniaBrandId,
            neckermannBrandId: manufacturer.neckermannBrandId,
            position: manufacturer.position,
            comment: manufacturer.comment,
            laRedouteBrandId: manufacturer.laRedouteBrandId,
            rawData: manufacturer as unknown as object,
            syncedAt: new Date(),
          },
        })
      )
    );
  }

  /**
   * Upsert a single manufacturer
   */
  private async upsertManufacturer(
    tenantId: string,
    manufacturer: PlentyManufacturer,
    shopware: IShopwareClient
  ): Promise<void> {
    // Save to local cache
    await this.prisma.plentyManufacturer.upsert({
      where: {
        tenantId_id: {
          tenantId,
          id: manufacturer.id,
        },
      },
      create: {
        id: manufacturer.id,
        tenantId,
        name: manufacturer.name,
        externalName: manufacturer.externalName,
        logo: manufacturer.logo,
        url: manufacturer.url,
        street: manufacturer.street,
        houseNo: manufacturer.houseNo,
        postcode: manufacturer.postcode,
        town: manufacturer.town,
        phoneNumber: manufacturer.phoneNumber,
        faxNumber: manufacturer.faxNumber,
        email: manufacturer.email,
        countryId: manufacturer.countryId,
        pixmaniaBrandId: manufacturer.pixmaniaBrandId,
        neckermannBrandId: manufacturer.neckermannBrandId,
        position: manufacturer.position,
        comment: manufacturer.comment,
        laRedouteBrandId: manufacturer.laRedouteBrandId,
        rawData: manufacturer as unknown as object,
        syncedAt: new Date(),
      },
      update: {
        name: manufacturer.name,
        externalName: manufacturer.externalName,
        logo: manufacturer.logo,
        url: manufacturer.url,
        street: manufacturer.street,
        houseNo: manufacturer.houseNo,
        postcode: manufacturer.postcode,
        town: manufacturer.town,
        phoneNumber: manufacturer.phoneNumber,
        faxNumber: manufacturer.faxNumber,
        email: manufacturer.email,
        countryId: manufacturer.countryId,
        pixmaniaBrandId: manufacturer.pixmaniaBrandId,
        neckermannBrandId: manufacturer.neckermannBrandId,
        position: manufacturer.position,
        comment: manufacturer.comment,
        laRedouteBrandId: manufacturer.laRedouteBrandId,
        rawData: manufacturer as unknown as object,
        syncedAt: new Date(),
      },
    });

    // Check if mapping exists
    const { ManufacturerMappingService } = await import('../services/ManufacturerMappingService');
    const mappingService = new ManufacturerMappingService();

    const existingMapping = await mappingService.getMapping(tenantId, manufacturer.id);

    // Handle logo upload if manufacturer has a logo URL
    let mediaId: string | null = null;
    const log = createJobLogger('', tenantId, 'CONFIG');

    if (manufacturer.logo) {
      log.info('Manufacturer has logo, attempting upload', {
        manufacturerId: manufacturer.id,
        manufacturerName: manufacturer.name,
        logoUrl: manufacturer.logo,
      });

      const { MediaService } = await import('../services/MediaService');
      const mediaService = new MediaService();

      // Generate a filename from the manufacturer name
      const logoExtension = manufacturer.logo.split('.').pop()?.toLowerCase() || 'jpg';
      const safeManufacturerName = manufacturer.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const logoFileName = `manufacturer_${safeManufacturerName}_${manufacturer.id}.${logoExtension}`;

      const uploadResult = await mediaService.uploadFromUrl(tenantId, shopware, {
        sourceUrl: manufacturer.logo,
        sourceType: 'MANUFACTURER_LOGO',
        sourceEntityId: String(manufacturer.id),
        folderName: 'Manufacturer Logos',
        fileName: logoFileName,
        title: `${manufacturer.name} Logo`,
        alt: manufacturer.name,
      });

      log.info('Logo upload result', {
        manufacturerId: manufacturer.id,
        success: uploadResult.success,
        wasExisting: uploadResult.wasExisting,
        shopwareMediaId: uploadResult.shopwareMediaId,
        error: uploadResult.error,
      });

      if (uploadResult.success && uploadResult.shopwareMediaId) {
        mediaId = uploadResult.shopwareMediaId;
      }
    } else {
      log.debug('Manufacturer has no logo', {
        manufacturerId: manufacturer.id,
        manufacturerName: manufacturer.name,
      });
    }

    if (!existingMapping) {
      // No mapping exists - create manufacturer in Shopware
      const result = await shopware.createManufacturer({
        id: '',
        name: manufacturer.name,
        link: manufacturer.url || null,
        description: manufacturer.comment || null,
        mediaId: mediaId || undefined,
        _plentyManufacturerId: manufacturer.id,
      });

      if (result.success && result.id) {
        // Store the mapping
        await mappingService.upsertMappings(tenantId, [
          {
            plentyManufacturerId: manufacturer.id,
            shopwareManufacturerId: result.id,
            mappingType: 'AUTO',
            lastSyncAction: 'create',
          },
        ]);
      }
    } else {
      // Mapping exists - update the manufacturer in Shopware
      await shopware.updateManufacturer(existingMapping.shopwareManufacturerId, {
        name: manufacturer.name,
        link: manufacturer.url || null,
        description: manufacturer.comment || null,
        mediaId: mediaId || undefined,
      });

      // Update mapping sync time
      await mappingService.upsertMappings(tenantId, [
        {
          plentyManufacturerId: manufacturer.id,
          shopwareManufacturerId: existingMapping.shopwareManufacturerId,
          mappingType: existingMapping.mappingType as 'MANUAL' | 'AUTO',
          lastSyncAction: 'update',
        },
      ]);
    }
  }

  /**
   * Sync units from Plenty using bulk operations
   */
  private async syncUnits(
    tenantId: string,
    plenty: PlentyClient,
    shopware: IShopwareClient
  ): Promise<{ synced: number; errors: number }> {
    const log = createJobLogger('', tenantId, 'CONFIG');

    try {
      const units = await plenty.getUnits();

      if (units.length === 0) {
        log.info('No units to sync');
        return { synced: 0, errors: 0 };
      }

      log.info('Starting bulk unit sync', { count: units.length });

      // Step 1: Bulk upsert to local cache
      await this.bulkUpsertUnitsToCache(tenantId, units);

      // Step 2: Get all existing mappings at once
      const { UnitMappingService } = await import('../services/UnitMappingService');
      const mappingService = new UnitMappingService();
      const existingMappings = await mappingService.getBatchMappings(
        tenantId,
        units.map((u) => u.id)
      );

      log.info('Loaded existing mappings', { count: Object.keys(existingMappings).length });

      // Helper to generate UUID
      const generateUuid = (): string => {
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };

      // Locale mapping for translations
      const localeMap: Record<string, string> = {
        de: 'de-DE',
        en: 'en-GB',
        fr: 'fr-FR',
        it: 'it-IT',
        es: 'es-ES',
        nl: 'nl-NL',
        pl: 'pl-PL',
      };

      // Step 3: Prepare bulk payload for Shopware
      const bulkPayload: Array<{
        id: string;
        shortCode: string;
        name: string;
        translations: Record<string, { shortCode: string; name: string }>;
      }> = [];

      const mappingUpdates: Array<{
        plentyUnitId: number;
        shopwareUnitId: string;
        mappingType: 'MANUAL' | 'AUTO';
        lastSyncAction: 'create' | 'update';
      }> = [];

      for (const unit of units) {
        // Extract localized names
        const names: Record<string, string> = {};
        if (unit.names) {
          for (const name of unit.names) {
            names[name.lang] = name.name;
          }
        }

        // Get unit name (prefer de -> en -> first available)
        const unitName = names['de'] || names['en'] || Object.values(names)[0] || unit.unitOfMeasurement;

        // Build translations for Shopware
        const translations: Record<string, { shortCode: string; name: string }> = {};
        for (const [lang, name] of Object.entries(names)) {
          const shopwareLang = localeMap[lang] || lang;
          translations[shopwareLang] = { shortCode: unit.unitOfMeasurement, name };
        }

        // Get or generate Shopware ID
        const existingMapping = existingMappings[unit.id];
        const shopwareId = existingMapping?.shopwareUnitId || generateUuid();

        bulkPayload.push({
          id: shopwareId,
          shortCode: unit.unitOfMeasurement,
          name: unitName,
          translations,
        });

        mappingUpdates.push({
          plentyUnitId: unit.id,
          shopwareUnitId: shopwareId,
          mappingType: (existingMapping?.mappingType as 'MANUAL' | 'AUTO') || 'AUTO',
          lastSyncAction: existingMapping ? 'update' : 'create',
        });
      }

      // Step 4: Bulk sync to Shopware
      log.info('Executing bulk sync to Shopware', { count: bulkPayload.length });
      const bulkResult = await shopware.bulkSyncUnits(bulkPayload);

      // Step 5: Update mappings based on results
      if (bulkResult.success) {
        await mappingService.upsertMappings(tenantId, mappingUpdates);
        log.info('Bulk unit sync completed successfully', { synced: units.length });
        return { synced: units.length, errors: 0 };
      } else {
        // Count successes and failures from individual results
        const successCount = bulkResult.results.filter((r) => r.success).length;
        const errorCount = bulkResult.results.filter((r) => !r.success).length;

        // Only update mappings for successful items
        const successfulMappings = mappingUpdates.filter((_, index) => bulkResult.results[index]?.success);
        if (successfulMappings.length > 0) {
          await mappingService.upsertMappings(tenantId, successfulMappings);
        }

        log.warn('Bulk unit sync completed with errors', { synced: successCount, errors: errorCount });
        return { synced: successCount, errors: errorCount };
      }
    } catch (error) {
      log.error('Failed to sync units', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to sync units: ${error}`);
    }
  }

  /**
   * Bulk upsert units to local cache
   */
  private async bulkUpsertUnitsToCache(tenantId: string, units: PlentyUnit[]): Promise<void> {
    await this.prisma.$transaction(
      units.map((unit) => {
        // Extract localized names
        const names: Record<string, string> = {};
        if (unit.names) {
          for (const name of unit.names) {
            names[name.lang] = name.name;
          }
        }

        return this.prisma.plentyUnit.upsert({
          where: {
            tenantId_id: {
              tenantId,
              id: unit.id,
            },
          },
          create: {
            id: unit.id,
            tenantId,
            position: unit.position,
            unitOfMeasurement: unit.unitOfMeasurement,
            isDecimalPlacesAllowed: unit.isDecimalPlacesAllowed,
            names,
            rawData: unit as unknown as object,
            syncedAt: new Date(),
          },
          update: {
            position: unit.position,
            unitOfMeasurement: unit.unitOfMeasurement,
            isDecimalPlacesAllowed: unit.isDecimalPlacesAllowed,
            names,
            rawData: unit as unknown as object,
            syncedAt: new Date(),
          },
        });
      })
    );
  }

  /**
   * Update the sync state for CONFIG
   */
  private async updateSyncState(tenantId: string): Promise<void> {
    const now = new Date();

    await this.prisma.syncState.upsert({
      where: {
        tenantId_syncType: {
          tenantId,
          syncType: 'CONFIG',
        },
      },
      create: {
        tenantId,
        syncType: 'CONFIG',
        lastSyncAt: now,
        lastSuccessfulSyncAt: now,
      },
      update: {
        lastSyncAt: now,
        lastSuccessfulSyncAt: now,
      },
    });
  }

  /**
   * Check if config is stale (older than threshold)
   */
  async isConfigStale(tenantId: string, thresholdHours: number = 6): Promise<boolean> {
    const state = await this.prisma.syncState.findUnique({
      where: {
        tenantId_syncType: {
          tenantId,
          syncType: 'CONFIG',
        },
      },
    });

    if (!state || !state.lastSuccessfulSyncAt) {
      return true; // Never synced
    }

    const ageMs = Date.now() - state.lastSuccessfulSyncAt.getTime();
    const thresholdMs = thresholdHours * 60 * 60 * 1000;

    return ageMs > thresholdMs;
  }

  /**
   * Get config age in hours
   */
  async getConfigAge(tenantId: string): Promise<number | null> {
    const state = await this.prisma.syncState.findUnique({
      where: {
        tenantId_syncType: {
          tenantId,
          syncType: 'CONFIG',
        },
      },
    });

    if (!state || !state.lastSuccessfulSyncAt) {
      return null;
    }

    const ageMs = Date.now() - state.lastSuccessfulSyncAt.getTime();
    return ageMs / (60 * 60 * 1000);
  }
}
