import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';

/**
 * Well-known configuration keys
 */
export const ConfigKeys = {
  // URLs
  PLENTY_FRONTEND_URL: 'plentyFrontendUrl',

  // Sales Price Configuration
  DEFAULT_SALES_PRICE_ID: 'defaultSalesPriceId',
  RRP_SALES_PRICE_ID: 'rrpSalesPriceId',

  // Property Configuration
  PROPERTY_REFERRERS: 'propertyReferrers', // Array of referrer IDs to import, e.g., ["1.00"] for webshop
  PROPERTY_CLIENTS: 'propertyClients', // Array of Plenty client IDs (Mandanten), e.g., ["18857"]

  // Mappings
  TAX_MAPPINGS: 'taxMappings', // { plentyTaxId: shopwareTaxId }

  // Shopware System Defaults (UUIDs fetched from Shopware)
  SHOPWARE_DEFAULT_TAX_ID: 'shopwareDefaultTaxId', // Shopware UUID for default tax rate
  SHOPWARE_DEFAULT_TAX_RATE: 'shopwareDefaultTaxRate', // Tax rate as number (e.g., 19)
  SHOPWARE_DEFAULT_CURRENCY_ID: 'shopwareDefaultCurrencyId', // Shopware UUID for default currency

  // Category Configuration
  SHOPWARE_ROOT_CATEGORY_ID: 'shopwareRootCategoryId', // Shopware navigation root category UUID - all Plenty categories will be children of this

  // Sales Channel Configuration
  SHOPWARE_SALES_CHANNEL_ID: 'shopwareSalesChannelId', // Shopware sales channel UUID - products will be visible in this channel
} as const;

export type ConfigKey = (typeof ConfigKeys)[keyof typeof ConfigKeys];

/**
 * Tenant Configuration Service
 * Provides type-safe access to tenant-specific configuration values
 */
export class TenantConfigService {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'TenantConfigService' });

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Get a configuration value (raw JSON)
   */
  async get<T = unknown>(tenantId: string, key: string): Promise<T | null> {
    const config = await this.prisma.tenantConfig.findUnique({
      where: {
        tenantId_key: {
          tenantId,
          key,
        },
      },
    });

    if (!config) {
      return null;
    }

    return config.value as T;
  }

  /**
   * Get a string configuration value
   */
  async getString(tenantId: string, key: string): Promise<string | null> {
    const value = await this.get<string>(tenantId, key);
    if (value === null) return null;
    if (typeof value !== 'string') {
      this.log.warn('Config value is not a string', { tenantId, key, actualType: typeof value });
      return String(value);
    }
    return value;
  }

  /**
   * Get a number configuration value
   */
  async getNumber(tenantId: string, key: string): Promise<number | null> {
    const value = await this.get<number>(tenantId, key);
    if (value === null) return null;
    if (typeof value !== 'number') {
      this.log.warn('Config value is not a number', { tenantId, key, actualType: typeof value });
      const parsed = Number(value);
      return isNaN(parsed) ? null : parsed;
    }
    return value;
  }

  /**
   * Get a boolean configuration value
   */
  async getBoolean(tenantId: string, key: string): Promise<boolean | null> {
    const value = await this.get<boolean>(tenantId, key);
    if (value === null) return null;
    if (typeof value !== 'boolean') {
      this.log.warn('Config value is not a boolean', { tenantId, key, actualType: typeof value });
      return Boolean(value);
    }
    return value;
  }

  /**
   * Get a mapping configuration value (key-value pairs)
   */
  async getMapping(tenantId: string, key: string): Promise<Record<string, string> | null> {
    const value = await this.get<Record<string, string>>(tenantId, key);
    if (value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
      this.log.warn('Config value is not an object', { tenantId, key, actualType: typeof value });
      return null;
    }
    return value;
  }

  /**
   * Get an array configuration value
   */
  async getArray<T = string>(tenantId: string, key: string): Promise<T[] | null> {
    const value = await this.get<T[]>(tenantId, key);
    if (value === null) return null;
    if (!Array.isArray(value)) {
      this.log.warn('Config value is not an array', { tenantId, key, actualType: typeof value });
      return null;
    }
    return value;
  }

  /**
   * Set a configuration value
   */
  async set(tenantId: string, key: string, value: unknown, description?: string): Promise<void> {
    this.log.debug('Setting config', { tenantId, key });

    await this.prisma.tenantConfig.upsert({
      where: {
        tenantId_key: {
          tenantId,
          key,
        },
      },
      create: {
        tenantId,
        key,
        value: value as object,
        description,
      },
      update: {
        value: value as object,
        ...(description !== undefined && { description }),
      },
    });
  }

  /**
   * Set multiple configuration values at once
   */
  async setMany(
    tenantId: string,
    configs: Array<{ key: string; value: unknown; description?: string }>
  ): Promise<void> {
    this.log.debug('Setting multiple configs', { tenantId, count: configs.length });

    await this.prisma.$transaction(
      configs.map((config) =>
        this.prisma.tenantConfig.upsert({
          where: {
            tenantId_key: {
              tenantId,
              key: config.key,
            },
          },
          create: {
            tenantId,
            key: config.key,
            value: config.value as object,
            description: config.description,
          },
          update: {
            value: config.value as object,
            ...(config.description !== undefined && { description: config.description }),
          },
        })
      )
    );
  }

  /**
   * Delete a configuration value
   */
  async delete(tenantId: string, key: string): Promise<boolean> {
    try {
      await this.prisma.tenantConfig.delete({
        where: {
          tenantId_key: {
            tenantId,
            key,
          },
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all configuration values for a tenant
   */
  async getAll(tenantId: string): Promise<Record<string, unknown>> {
    const configs = await this.prisma.tenantConfig.findMany({
      where: { tenantId },
    });

    const result: Record<string, unknown> = {};
    for (const config of configs) {
      result[config.key] = config.value;
    }
    return result;
  }

  /**
   * Check if a configuration key exists
   */
  async exists(tenantId: string, key: string): Promise<boolean> {
    const count = await this.prisma.tenantConfig.count({
      where: {
        tenantId,
        key,
      },
    });
    return count > 0;
  }

  // ============================================
  // CONVENIENCE METHODS FOR COMMON CONFIGS
  // ============================================

  /**
   * Get the Plenty frontend URL for image URLs
   */
  async getPlentyFrontendUrl(tenantId: string): Promise<string | null> {
    return this.getString(tenantId, ConfigKeys.PLENTY_FRONTEND_URL);
  }

  /**
   * Get the default sales price ID to use for Shopware's main price
   */
  async getDefaultSalesPriceId(tenantId: string): Promise<number | null> {
    return this.getNumber(tenantId, ConfigKeys.DEFAULT_SALES_PRICE_ID);
  }

  /**
   * Get the RRP sales price ID to use for Shopware's list price
   */
  async getRrpSalesPriceId(tenantId: string): Promise<number | null> {
    return this.getNumber(tenantId, ConfigKeys.RRP_SALES_PRICE_ID);
  }

  /**
   * Get tax ID mappings (Plenty tax ID -> Shopware tax ID)
   */
  async getTaxMappings(tenantId: string): Promise<Record<string, string> | null> {
    return this.getMapping(tenantId, ConfigKeys.TAX_MAPPINGS);
  }

  /**
   * Get Shopware tax ID for a Plenty tax ID
   */
  async getShopwareTaxId(tenantId: string, plentyTaxId: number | string): Promise<string | null> {
    const mappings = await this.getTaxMappings(tenantId);
    if (!mappings) return null;
    return mappings[String(plentyTaxId)] || null;
  }

  /**
   * Get property referrers to import (defaults to ["1.00"] for webshop)
   */
  async getPropertyReferrers(tenantId: string): Promise<string[]> {
    const referrers = await this.getArray<string>(tenantId, ConfigKeys.PROPERTY_REFERRERS);
    // Default to webshop referrer if not configured
    return referrers ?? ['1.00'];
  }

  /**
   * Get property clients (Mandanten) to import
   * Returns null if not configured (meaning: import for all clients)
   */
  async getPropertyClients(tenantId: string): Promise<string[] | null> {
    return this.getArray<string>(tenantId, ConfigKeys.PROPERTY_CLIENTS);
  }

  // ============================================
  // SHOPWARE SYSTEM DEFAULTS
  // ============================================

  /**
   * Get Shopware default tax configuration
   * Returns null if not configured (needs to be fetched from Shopware first)
   */
  async getShopwareDefaultTax(tenantId: string): Promise<{ id: string; taxRate: number } | null> {
    const id = await this.getString(tenantId, ConfigKeys.SHOPWARE_DEFAULT_TAX_ID);
    const taxRate = await this.getNumber(tenantId, ConfigKeys.SHOPWARE_DEFAULT_TAX_RATE);

    if (!id || taxRate === null) {
      return null;
    }

    return { id, taxRate };
  }

  /**
   * Set Shopware default tax configuration
   */
  async setShopwareDefaultTax(tenantId: string, id: string, taxRate: number): Promise<void> {
    await this.setMany(tenantId, [
      {
        key: ConfigKeys.SHOPWARE_DEFAULT_TAX_ID,
        value: id,
        description: 'Shopware default tax UUID (auto-fetched from Shopware)',
      },
      {
        key: ConfigKeys.SHOPWARE_DEFAULT_TAX_RATE,
        value: taxRate,
        description: 'Shopware default tax rate percentage',
      },
    ]);
  }

  /**
   * Get Shopware default currency ID
   * Returns null if not configured (needs to be fetched from Shopware first)
   */
  async getShopwareDefaultCurrencyId(tenantId: string): Promise<string | null> {
    return this.getString(tenantId, ConfigKeys.SHOPWARE_DEFAULT_CURRENCY_ID);
  }

  /**
   * Set Shopware default currency ID
   */
  async setShopwareDefaultCurrencyId(tenantId: string, currencyId: string): Promise<void> {
    await this.set(tenantId, ConfigKeys.SHOPWARE_DEFAULT_CURRENCY_ID, currencyId, 'Shopware default currency UUID (auto-fetched from Shopware)');
  }

  /**
   * Get all Shopware system defaults
   * Returns null if any value is missing
   */
  async getShopwareDefaults(tenantId: string): Promise<{
    taxId: string;
    taxRate: number;
    currencyId: string;
  } | null> {
    const tax = await this.getShopwareDefaultTax(tenantId);
    const currencyId = await this.getShopwareDefaultCurrencyId(tenantId);

    if (!tax || !currencyId) {
      return null;
    }

    return {
      taxId: tax.id,
      taxRate: tax.taxRate,
      currencyId,
    };
  }

  /**
   * Set all Shopware system defaults
   */
  async setShopwareDefaults(
    tenantId: string,
    defaults: { taxId: string; taxRate: number; currencyId: string }
  ): Promise<void> {
    await this.setMany(tenantId, [
      {
        key: ConfigKeys.SHOPWARE_DEFAULT_TAX_ID,
        value: defaults.taxId,
        description: 'Shopware default tax UUID',
      },
      {
        key: ConfigKeys.SHOPWARE_DEFAULT_TAX_RATE,
        value: defaults.taxRate,
        description: 'Shopware default tax rate percentage',
      },
      {
        key: ConfigKeys.SHOPWARE_DEFAULT_CURRENCY_ID,
        value: defaults.currencyId,
        description: 'Shopware default currency UUID',
      },
    ]);
  }

  // ============================================
  // CATEGORY CONFIGURATION
  // ============================================

  /**
   * Get Shopware root category ID
   * All Plenty categories will be created as children of this category
   * Returns null if not configured (categories will be created at root level)
   */
  async getShopwareRootCategoryId(tenantId: string): Promise<string | null> {
    return this.getString(tenantId, ConfigKeys.SHOPWARE_ROOT_CATEGORY_ID);
  }

  /**
   * Set Shopware root category ID
   */
  async setShopwareRootCategoryId(tenantId: string, categoryId: string): Promise<void> {
    await this.set(
      tenantId,
      ConfigKeys.SHOPWARE_ROOT_CATEGORY_ID,
      categoryId,
      'Shopware navigation root category - all Plenty categories become children of this'
    );
  }

  // ============================================
  // SALES CHANNEL CONFIGURATION
  // ============================================

  /**
   * Get Shopware sales channel ID
   * Products will be assigned visibility to this sales channel
   * Returns null if not configured (products won't appear in storefront!)
   */
  async getShopwareSalesChannelId(tenantId: string): Promise<string | null> {
    return this.getString(tenantId, ConfigKeys.SHOPWARE_SALES_CHANNEL_ID);
  }

  /**
   * Set Shopware sales channel ID
   */
  async setShopwareSalesChannelId(tenantId: string, salesChannelId: string): Promise<void> {
    await this.set(
      tenantId,
      ConfigKeys.SHOPWARE_SALES_CHANNEL_ID,
      salesChannelId,
      'Shopware sales channel - products will be visible in this storefront'
    );
  }
}
