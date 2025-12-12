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
      //result.categories = await this.syncCategories(jobData.tenantId, plenty);

      log.info('Syncing attributes');
      //result.attributes = await this.syncAttributes(jobData.tenantId, plenty);

      log.info('Syncing sales prices');
      //result.salesPrices = await this.syncSalesPrices(jobData.tenantId, plenty, shopware);

      log.info('Syncing manufacturers');
      result.manufacturers = await this.syncManufacturers(jobData.tenantId, plenty, shopware);

      log.info('Syncing units');
      //result.units = await this.syncUnits(jobData.tenantId, plenty, shopware);

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
   * Sync categories from Plenty
   */
  private async syncCategories(
    tenantId: string,
    plenty: PlentyClient,
    shopware: IShopwareClient
  ): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const categories = await plenty.getAllCategories();

      // Sort categories by level to ensure parents are created before children
      const sortedCategories = [...categories].sort((a, b) => (a.level || 0) - (b.level || 0));

      for (const category of sortedCategories) {
        try {
          await this.upsertCategory(tenantId, category, shopware);
          synced++;
        } catch (error) {
          const log = createJobLogger('', tenantId, 'CONFIG');
          log.error('Failed to upsert category', {
            categoryId: category.id,
            categoryIdType: typeof category.id,
            parentCategoryId: category.parentCategoryId,
            level: category.level,
            type: category.type,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : 'Unknown',
            stack: error instanceof Error ? error.stack : undefined,
            fullError: error,
          });
          errors++;
        }
      }
    } catch (error) {
      throw new Error(`Failed to fetch categories: ${error}`);
    }

    return { synced, errors };
  }

  /**
   * Upsert a single category
   */
  private async upsertCategory(
    tenantId: string,
    category: PlentyCategory,
    shopware: IShopwareClient
  ): Promise<void> {
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

    const log = createJobLogger('', tenantId, 'CONFIG');
    log.debug('Upserting category', {
      categoryId: category.id,
      categoryIdType: typeof category.id,
      parentId: category.parentCategoryId,
      level: category.level,
      type: category.type,
      linklist,
      sitemap,
      hasChildren: category.hasChildren,
      namesCount: Object.keys(names).length,
    });

    // Save to local cache
    await this.prisma.plentyCategory.upsert({
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

    // Check if mapping exists
    const { CategoryMappingService } = await import('../services/CategoryMappingService');
    const mappingService = new CategoryMappingService();

    const existingMapping = await mappingService.getMapping(tenantId, category.id);

    // Get category name (prefer de -> en -> first available)
    const categoryName = names['de'] || names['en'] || Object.values(names)[0] || `Category ${category.id}`;

    // Build translations for Shopware
    const translations: Record<string, { name: string }> = {};
    for (const [lang, name] of Object.entries(names)) {
      // Map language codes to Shopware locale format
      const localeMap: Record<string, string> = {
        de: 'de-DE',
        en: 'en-GB',
        fr: 'fr-FR',
        it: 'it-IT',
        es: 'es-ES',
        nl: 'nl-NL',
        pl: 'pl-PL',
      };
      const shopwareLang = localeMap[lang] || lang;
      translations[shopwareLang] = { name };
    }

    // Get parent Shopware category ID if this category has a parent
    let shopwareParentId: string | undefined;
    if (category.parentCategoryId) {
      const parentMapping = await mappingService.getMapping(tenantId, category.parentCategoryId);
      if (parentMapping) {
        shopwareParentId = parentMapping.shopwareCategoryId;
      }
    }

    if (!existingMapping) {
      // No mapping exists - create category in Shopware
      const result = await shopware.createCategory({
        id: '',
        name: categoryName,
        parentId: shopwareParentId,
        active: linklist,
        visible: linklist,
        level: category.level,
        translations,
        _plentyCategoryId: category.id,
      });

      if (result.success && result.id) {
        // Store the mapping
        await mappingService.upsertMappings(tenantId, [
          {
            plentyCategoryId: category.id,
            shopwareCategoryId: result.id,
            mappingType: 'AUTO',
            lastSyncAction: 'create',
          },
        ]);
      }
    } else {
      // Mapping exists - update the category in Shopware
      await shopware.updateCategory(existingMapping.shopwareCategoryId, {
        name: categoryName,
        parentId: shopwareParentId,
        active: linklist,
        visible: linklist,
        translations,
      });

      // Update mapping sync time
      await mappingService.upsertMappings(tenantId, [
        {
          plentyCategoryId: category.id,
          shopwareCategoryId: existingMapping.shopwareCategoryId,
          mappingType: existingMapping.mappingType as 'MANUAL' | 'AUTO',
          lastSyncAction: 'update',
        },
      ]);
    }
  }

  /**
   * Sync attributes from Plenty
   */
  private async syncAttributes(
    tenantId: string,
    plenty: PlentyClient,
    shopware: IShopwareClient
  ): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const attributes = await plenty.getAllAttributes();

      for (const attribute of attributes) {
        try {
          await this.upsertAttribute(tenantId, attribute, shopware);
          synced++;
        } catch (error) {
          const log = createJobLogger('', tenantId, 'CONFIG');
          log.error('Failed to upsert attribute', {
            attributeId: attribute.id,
            backendName: attribute.backendName,
            error: error instanceof Error ? error.message : String(error),
          });
          errors++;
        }
      }
    } catch (error) {
      throw new Error(`Failed to fetch attributes: ${error}`);
    }

    return { synced, errors };
  }

  /**
   * Upsert a single attribute (property group) and its values (property options)
   */
  private async upsertAttribute(
    tenantId: string,
    attribute: PlentyAttribute,
    shopware: IShopwareClient
  ): Promise<void> {
    // Extract localized names for the attribute
    const names: Record<string, string> = {};
    if (attribute.attributeNames) {
      for (const name of attribute.attributeNames) {
        names[name.lang] = name.name;
      }
    }

    // Save to local cache
    await this.prisma.plentyAttribute.upsert({
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

    // Import mapping service
    const { AttributeMappingService } = await import('../services/AttributeMappingService');
    const mappingService = new AttributeMappingService();

    // Check if attribute mapping exists
    const existingMapping = await mappingService.getAttributeMapping(tenantId, attribute.id);

    // Get attribute name (prefer de -> en -> backendName)
    const attributeName = names['de'] || names['en'] || Object.values(names)[0] || attribute.backendName;

    // Build translations for Shopware
    const translations: Record<string, { name: string }> = {};
    for (const [lang, name] of Object.entries(names)) {
      const localeMap: Record<string, string> = {
        de: 'de-DE',
        en: 'en-GB',
        fr: 'fr-FR',
        it: 'it-IT',
        es: 'es-ES',
        nl: 'nl-NL',
        pl: 'pl-PL',
      };
      const shopwareLang = localeMap[lang] || lang;
      translations[shopwareLang] = { name };
    }

    let shopwarePropertyGroupId: string;

    if (!existingMapping) {
      // No mapping exists - create property group in Shopware
      const result = await shopware.createPropertyGroup({
        id: '',
        name: attributeName,
        displayType: 'text',
        sortingType: 'alphanumeric',
        position: attribute.position,
        translations,
        _plentyAttributeId: attribute.id,
      });

      if (result.success && result.id) {
        shopwarePropertyGroupId = result.id;
        // Store the mapping
        await mappingService.upsertAttributeMappings(tenantId, [
          {
            plentyAttributeId: attribute.id,
            shopwarePropertyGroupId: result.id,
            mappingType: 'AUTO',
            lastSyncAction: 'create',
          },
        ]);
      } else {
        throw new Error(`Failed to create property group for attribute ${attribute.id}`);
      }
    } else {
      shopwarePropertyGroupId = existingMapping.shopwarePropertyGroupId;
      // Mapping exists - update the property group in Shopware
      await shopware.updatePropertyGroup(existingMapping.shopwarePropertyGroupId, {
        name: attributeName,
        position: attribute.position,
        translations,
      });

      // Update mapping sync time
      await mappingService.upsertAttributeMappings(tenantId, [
        {
          plentyAttributeId: attribute.id,
          shopwarePropertyGroupId: existingMapping.shopwarePropertyGroupId,
          mappingType: existingMapping.mappingType as 'MANUAL' | 'AUTO',
          lastSyncAction: 'update',
        },
      ]);
    }

    // Now sync attribute values (property options)
    const attributeValues = attribute.values || attribute.attributeValues || [];

    for (const value of attributeValues) {
      await this.upsertAttributeValue(
        tenantId,
        attribute.id,
        shopwarePropertyGroupId,
        value,
        shopware,
        mappingService
      );
    }
  }

  /**
   * Upsert a single attribute value (property option)
   */
  private async upsertAttributeValue(
    tenantId: string,
    plentyAttributeId: number,
    shopwarePropertyGroupId: string,
    value: { id: number; backendName: string; position: number; valueNames?: { lang: string; name: string }[] },
    shopware: IShopwareClient,
    mappingService: InstanceType<typeof import('../services/AttributeMappingService').AttributeMappingService>
  ): Promise<void> {
    // Extract localized names for the value
    const valueNames: Record<string, string> = {};
    if (value.valueNames) {
      for (const name of value.valueNames) {
        valueNames[name.lang] = name.name;
      }
    }

    // Get value name (prefer de -> en -> backendName)
    const valueName = valueNames['de'] || valueNames['en'] || Object.values(valueNames)[0] || value.backendName;

    // Build translations for Shopware
    const translations: Record<string, { name: string }> = {};
    for (const [lang, name] of Object.entries(valueNames)) {
      const localeMap: Record<string, string> = {
        de: 'de-DE',
        en: 'en-GB',
        fr: 'fr-FR',
        it: 'it-IT',
        es: 'es-ES',
        nl: 'nl-NL',
        pl: 'pl-PL',
      };
      const shopwareLang = localeMap[lang] || lang;
      translations[shopwareLang] = { name };
    }

    // Check if value mapping exists
    const existingValueMapping = await mappingService.getAttributeValueMapping(tenantId, value.id);

    if (!existingValueMapping) {
      // No mapping exists - create property option in Shopware
      const result = await shopware.createPropertyOption({
        id: '',
        groupId: shopwarePropertyGroupId,
        name: valueName,
        position: value.position,
        translations,
        _plentyAttributeId: plentyAttributeId,
        _plentyAttributeValueId: value.id,
      });

      if (result.success && result.id) {
        // Store the mapping
        await mappingService.upsertAttributeValueMappings(tenantId, [
          {
            plentyAttributeId,
            plentyAttributeValueId: value.id,
            shopwarePropertyGroupId,
            shopwarePropertyOptionId: result.id,
            mappingType: 'AUTO',
            lastSyncAction: 'create',
          },
        ]);
      }
    } else {
      // Mapping exists - update the property option in Shopware
      await shopware.updatePropertyOption(existingValueMapping.shopwarePropertyOptionId, {
        name: valueName,
        position: value.position,
        translations,
      });

      // Update mapping sync time
      await mappingService.upsertAttributeValueMappings(tenantId, [
        {
          plentyAttributeId,
          plentyAttributeValueId: value.id,
          shopwarePropertyGroupId: existingValueMapping.shopwarePropertyGroupId,
          shopwarePropertyOptionId: existingValueMapping.shopwarePropertyOptionId,
          mappingType: existingValueMapping.mappingType as 'MANUAL' | 'AUTO',
          lastSyncAction: 'update',
        },
      ]);
    }
  }

  /**
   * Sync sales prices from Plenty
   */
  private async syncSalesPrices(
    tenantId: string,
    plenty: PlentyClient,
    shopware: IShopwareClient
  ): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const salesPrices = await plenty.getAllSalesPrices();

      for (const salesPrice of salesPrices) {
        try {
          await this.upsertSalesPrice(tenantId, salesPrice, shopware);
          synced++;
        } catch (error) {
          errors++;
        }
      }
    } catch (error) {
      throw new Error(`Failed to fetch sales prices: ${error}`);
    }

    return { synced, errors };
  }

  /**
   * Upsert a single sales price
   */
  private async upsertSalesPrice(
    tenantId: string,
    salesPrice: PlentySalesPrice,
    shopware: IShopwareClient
  ): Promise<void> {
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

    // Extract country IDs
    const countryIds = salesPrice.countries?.map((c) => c.countryId) || [];

    // Extract customer class IDs
    const customerClassIds = salesPrice.customerClasses?.map((c) => c.customerClassId) || [];

    // Extract referrer IDs
    const referrerIds = salesPrice.referrers?.map((r) => r.referrerId) || [];

    // Save to local cache
    await this.prisma.plentySalesPrice.upsert({
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

    // Check if mapping exists
    const { SalesPriceMappingService } = await import('../services/SalesPriceMappingService');
    const mappingService = new SalesPriceMappingService();

    const existingMapping = await mappingService.getMapping(tenantId, salesPrice.id);

    if (!existingMapping) {
      // No mapping exists - create price in Shopware
      const priceName = names['en'] || names['de'] || `Price ${salesPrice.id}`;
      const result = await shopware.createPrice({
        name: priceName,
        type: salesPrice.type,
        isGross: true,
        plentySalesPriceId: salesPrice.id,
        translations: names,
      });

      if (result.success && result.id) {
        // Store the mapping
        await mappingService.upsertMappings(tenantId, [
          {
            plentySalesPriceId: salesPrice.id,
            shopwarePriceId: result.id,
            mappingType: 'AUTO',
            lastSyncAction: 'create',
          },
        ]);
      }
    } else {
      // Mapping exists - optionally update the price in Shopware
      const priceName = names['en'] || names['de'] || `Price ${salesPrice.id}`;
      await shopware.updatePrice(existingMapping.shopwarePriceId, {
        name: priceName,
        type: salesPrice.type,
        isGross: true,
        translations: names,
      });

      // Update mapping sync time
      await mappingService.upsertMappings(tenantId, [
        {
          plentySalesPriceId: salesPrice.id,
          shopwarePriceId: existingMapping.shopwarePriceId,
          mappingType: existingMapping.mappingType as 'MANUAL' | 'AUTO',
          lastSyncAction: 'update',
        },
      ]);
    }
  }

  /**
   * Sync manufacturers from Plenty
   */
  private async syncManufacturers(
    tenantId: string,
    plenty: PlentyClient,
    shopware: IShopwareClient
  ): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const manufacturers = await plenty.getManufacturers();

      for (const manufacturer of manufacturers) {
        try {
          await this.upsertManufacturer(tenantId, manufacturer, shopware);
          synced++;
        } catch (error) {
          errors++;
        }
      }
    } catch (error) {
      throw new Error(`Failed to fetch manufacturers: ${error}`);
    }

    return { synced, errors };
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
   * Sync units from Plenty
   */
  private async syncUnits(
    tenantId: string,
    plenty: PlentyClient,
    shopware: IShopwareClient
  ): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const units = await plenty.getUnits();

      for (const unit of units) {
        try {
          await this.upsertUnit(tenantId, unit, shopware);
          synced++;
        } catch (error) {
          errors++;
        }
      }
    } catch (error) {
      throw new Error(`Failed to fetch units: ${error}`);
    }

    return { synced, errors };
  }

  /**
   * Upsert a single unit
   */
  private async upsertUnit(
    tenantId: string,
    unit: PlentyUnit,
    shopware: IShopwareClient
  ): Promise<void> {
    // Extract localized names
    const names: Record<string, string> = {};
    if (unit.names) {
      for (const name of unit.names) {
        names[name.lang] = name.name;
      }
    }

    // Save to local cache
    await this.prisma.plentyUnit.upsert({
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

    // Check if mapping exists
    const { UnitMappingService } = await import('../services/UnitMappingService');
    const mappingService = new UnitMappingService();

    const existingMapping = await mappingService.getMapping(tenantId, unit.id);

    // Get unit name (prefer de -> en -> first available)
    const unitName = names['de'] || names['en'] || Object.values(names)[0] || unit.unitOfMeasurement;

    if (!existingMapping) {
      // No mapping exists - create unit in Shopware
      const result = await shopware.createUnit({
        id: '',
        shortCode: unit.unitOfMeasurement,
        name: unitName,
        _plentyUnitId: unit.id,
      });

      if (result.success && result.id) {
        // Store the mapping
        await mappingService.upsertMappings(tenantId, [
          {
            plentyUnitId: unit.id,
            shopwareUnitId: result.id,
            mappingType: 'AUTO',
            lastSyncAction: 'create',
          },
        ]);
      }
    } else {
      // Mapping exists - optionally update the unit in Shopware
      await shopware.updateUnit(existingMapping.shopwareUnitId, {
        shortCode: unit.unitOfMeasurement,
        name: unitName,
      });

      // Update mapping sync time
      await mappingService.upsertMappings(tenantId, [
        {
          plentyUnitId: unit.id,
          shopwareUnitId: existingMapping.shopwareUnitId,
          mappingType: existingMapping.mappingType as 'MANUAL' | 'AUTO',
          lastSyncAction: 'update',
        },
      ]);
    }
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
