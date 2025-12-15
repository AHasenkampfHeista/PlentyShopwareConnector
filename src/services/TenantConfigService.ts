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
}
