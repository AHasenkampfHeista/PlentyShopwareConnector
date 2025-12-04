import { PrismaClient } from '@prisma/client';
import { getPrismaClient, createJobLogger, PlentyClient, PlentyClientConfig } from '@connector/shared';
import {
  PlentyCategory,
  PlentyAttribute,
  PlentySalesPrice,
  PlentyManufacturer,
  PlentyUnit,
} from '@connector/shared';
import { DecryptedSyncJobData, ConfigSyncResult } from '@connector/shared';

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

      // Sync each config type
      log.info('Syncing categories');
      result.categories = await this.syncCategories(jobData.tenantId, plenty);

      log.info('Syncing attributes');
      result.attributes = await this.syncAttributes(jobData.tenantId, plenty);

      log.info('Syncing sales prices');
      result.salesPrices = await this.syncSalesPrices(jobData.tenantId, plenty);

      log.info('Syncing manufacturers');
      result.manufacturers = await this.syncManufacturers(jobData.tenantId, plenty);

      log.info('Syncing units');
      result.units = await this.syncUnits(jobData.tenantId, plenty);

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
    plenty: PlentyClient
  ): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const categories = await plenty.getAllCategories();

      for (const category of categories) {
        try {
          await this.upsertCategory(tenantId, category);
          synced++;
        } catch (error) {
          const log = createJobLogger('', tenantId, 'CONFIG');
          log.error('Failed to upsert category', {
            categoryId: category.id,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
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
  private async upsertCategory(tenantId: string, category: PlentyCategory): Promise<void> {
    // Extract localized names from details
    const names: Record<string, string> = {};
    if (category.details) {
      for (const detail of category.details) {
        names[detail.lang] = detail.name;
      }
    }

    // Use boolean values from category
    const linklist = category.linklist;
    const sitemap = category.sitemap;

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
  }

  /**
   * Sync attributes from Plenty
   */
  private async syncAttributes(
    tenantId: string,
    plenty: PlentyClient
  ): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const attributes = await plenty.getAttributes();

      for (const attribute of attributes) {
        try {
          await this.upsertAttribute(tenantId, attribute);
          synced++;
        } catch (error) {
          errors++;
        }
      }
    } catch (error) {
      throw new Error(`Failed to fetch attributes: ${error}`);
    }

    return { synced, errors };
  }

  /**
   * Upsert a single attribute
   */
  private async upsertAttribute(tenantId: string, attribute: PlentyAttribute): Promise<void> {
    // Extract localized names
    const names: Record<string, string> = {};
    if (attribute.attributeNames) {
      for (const name of attribute.attributeNames) {
        names[name.lang] = name.name;
      }
    }

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
        attributeValues: attribute.attributeValues as unknown as object,
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
        attributeValues: attribute.attributeValues as unknown as object,
        names,
        rawData: attribute as unknown as object,
        syncedAt: new Date(),
      },
    });
  }

  /**
   * Sync sales prices from Plenty
   */
  private async syncSalesPrices(
    tenantId: string,
    plenty: PlentyClient
  ): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const salesPrices = await plenty.getSalesPrices();

      for (const salesPrice of salesPrices) {
        try {
          await this.upsertSalesPrice(tenantId, salesPrice);
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
  private async upsertSalesPrice(tenantId: string, salesPrice: PlentySalesPrice): Promise<void> {
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
  }

  /**
   * Sync manufacturers from Plenty
   */
  private async syncManufacturers(
    tenantId: string,
    plenty: PlentyClient
  ): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const manufacturers = await plenty.getManufacturers();

      for (const manufacturer of manufacturers) {
        try {
          await this.upsertManufacturer(tenantId, manufacturer);
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
    manufacturer: PlentyManufacturer
  ): Promise<void> {
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
  }

  /**
   * Sync units from Plenty
   */
  private async syncUnits(
    tenantId: string,
    plenty: PlentyClient
  ): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const units = await plenty.getUnits();

      for (const unit of units) {
        try {
          await this.upsertUnit(tenantId, unit);
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
  private async upsertUnit(tenantId: string, unit: PlentyUnit): Promise<void> {
    // Extract localized names
    const names: Record<string, string> = {};
    if (unit.names) {
      for (const name of unit.names) {
        names[name.lang] = name.name;
      }
    }

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
