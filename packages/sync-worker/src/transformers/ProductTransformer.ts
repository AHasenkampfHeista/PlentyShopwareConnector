import { PrismaClient } from '@prisma/client';
import { getPrismaClient, createLogger } from '@connector/shared';
import { PlentyVariation } from '@connector/shared';
import { ShopwareProduct } from '@connector/shared';
import { FieldMapping, TransformationRule } from '@connector/shared';

const DEFAULT_CURRENCY_ID = 'EUR';
const DEFAULT_TAX_RATE = 19; // German VAT

interface LocalConfig {
  categories: Map<number, { id: number; names: Record<string, string> | null }>;
  attributes: Map<number, { id: number; names: Record<string, string> | null; backendName: string }>;
  salesPrices: Map<number, { id: number; type: string; currency: string | null }>;
}

/**
 * Product Transformer
 * Transforms Plenty variations to Shopware product format
 * Uses locally cached configuration data
 */
export class ProductTransformer {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'ProductTransformer' });
  private configCache: Map<string, LocalConfig> = new Map();

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Transform a Plenty variation to Shopware product format
   */
  async transform(
    variation: PlentyVariation,
    tenantId: string,
    customMappings?: FieldMapping[]
  ): Promise<ShopwareProduct> {
    // Load local config if not cached
    const config = await this.getLocalConfig(tenantId);

    // Get text in preferred language (de first, then en, then first available)
    const text = this.getVariationText(variation, ['de', 'en']);

    // Find main price
    const mainPrice = this.findMainPrice(variation, config);

    // Calculate net price from gross (assuming standard tax rate)
    const grossPrice = mainPrice?.price ?? 0;
    const netPrice = grossPrice / (1 + DEFAULT_TAX_RATE / 100);

    // Get stock from first warehouse
    const stock = this.calculateStock(variation);

    // Build base product
    const product: ShopwareProduct = {
      productNumber: variation.number || `PLY-${variation.id}`,
      name: text.name || `Product ${variation.id}`,
      description: text.description || undefined,
      stock: stock,
      active: variation.isActive ?? true,
      price: [
        {
          currencyId: DEFAULT_CURRENCY_ID,
          gross: grossPrice,
          net: netPrice,
          linked: true,
        },
      ],
      // Internal references
      _plentyItemId: variation.itemId,
      _plentyVariationId: variation.id,
    };

    // Apply custom field mappings if provided
    if (customMappings && customMappings.length > 0) {
      this.applyCustomMappings(product, variation, customMappings);
    }

    return product;
  }

  /**
   * Transform multiple variations
   */
  async transformBatch(
    variations: PlentyVariation[],
    tenantId: string,
    customMappings?: FieldMapping[]
  ): Promise<ShopwareProduct[]> {
    const products: ShopwareProduct[] = [];

    // Pre-load config once for batch
    await this.getLocalConfig(tenantId);

    for (const variation of variations) {
      try {
        const product = await this.transform(variation, tenantId, customMappings);
        products.push(product);
      } catch (error) {
        this.log.error('Failed to transform variation', {
          variationId: variation.id,
          error,
        });
        // Continue with next variation
      }
    }

    return products;
  }

  /**
   * Get locally cached configuration data
   */
  private async getLocalConfig(tenantId: string): Promise<LocalConfig> {
    // Check cache first
    if (this.configCache.has(tenantId)) {
      return this.configCache.get(tenantId)!;
    }

    // Load from database
    const [categories, attributes, salesPrices] = await Promise.all([
      this.prisma.plentyCategory.findMany({
        where: { tenantId },
        select: { id: true, names: true },
      }),
      this.prisma.plentyAttribute.findMany({
        where: { tenantId },
        select: { id: true, names: true, backendName: true },
      }),
      this.prisma.plentySalesPrice.findMany({
        where: { tenantId },
        select: { id: true, type: true, currency: true },
      }),
    ]);

    const config: LocalConfig = {
      categories: new Map(
        categories.map((c) => [c.id, { id: c.id, names: c.names as Record<string, string> | null }])
      ),
      attributes: new Map(
        attributes.map((a) => [
          a.id,
          { id: a.id, names: a.names as Record<string, string> | null, backendName: a.backendName },
        ])
      ),
      salesPrices: new Map(
        salesPrices.map((p) => [p.id, { id: p.id, type: p.type, currency: p.currency }])
      ),
    };

    // Cache for 5 minutes
    this.configCache.set(tenantId, config);
    setTimeout(() => {
      this.configCache.delete(tenantId);
    }, 5 * 60 * 1000);

    return config;
  }

  /**
   * Get variation text in preferred language
   */
  private getVariationText(
    variation: PlentyVariation,
    preferredLanguages: string[]
  ): { name: string; description: string } {
    const texts = variation.variationTexts || [];

    // Try to find text in preferred language order
    for (const lang of preferredLanguages) {
      const text = texts.find((t) => t.lang === lang);
      if (text && text.name) {
        return {
          name: text.name,
          description: text.description || text.shortDescription || '',
        };
      }
    }

    // Fall back to first available
    if (texts.length > 0) {
      return {
        name: texts[0].name || '',
        description: texts[0].description || texts[0].shortDescription || '',
      };
    }

    // No texts available - try item texts if available
    if (variation.item?.itemTexts) {
      for (const lang of preferredLanguages) {
        const text = variation.item.itemTexts.find((t) => t.lang === lang);
        if (text && text.name) {
          return {
            name: text.name,
            description: text.description || text.shortDescription || '',
          };
        }
      }
    }

    return { name: '', description: '' };
  }

  /**
   * Find the main/default price from variation sales prices
   */
  private findMainPrice(
    variation: PlentyVariation,
    config: LocalConfig
  ): { price: number; salesPriceId: number } | null {
    const prices = variation.variationSalesPrices || [];

    if (prices.length === 0) {
      return null;
    }

    // Try to find the default price first
    for (const price of prices) {
      const salesPrice = config.salesPrices.get(price.salesPriceId);
      if (salesPrice?.type === 'default') {
        return { price: price.price, salesPriceId: price.salesPriceId };
      }
    }

    // Fall back to first price
    return { price: prices[0].price, salesPriceId: prices[0].salesPriceId };
  }

  /**
   * Calculate total stock from all warehouses
   */
  private calculateStock(variation: PlentyVariation): number {
    const stockEntries = variation.variationStock || [];

    if (stockEntries.length === 0) {
      return 0;
    }

    // Sum up net stock from all warehouses
    return stockEntries.reduce((total, entry) => {
      return total + (entry.stockNet || 0);
    }, 0);
  }

  /**
   * Apply custom field mappings to the product
   */
  private applyCustomMappings(
    product: ShopwareProduct,
    variation: PlentyVariation,
    mappings: FieldMapping[]
  ): void {
    for (const mapping of mappings) {
      try {
        const value = this.getNestedValue(variation, mapping.plentyField);

        if (value !== undefined) {
          // Apply transformation if specified
          const transformedValue = mapping.transformationRule
            ? this.applyTransformation(value, mapping.transformationRule)
            : value;

          this.setNestedValue(product as unknown as Record<string, unknown>, mapping.shopwareField, transformedValue);
        } else if (mapping.defaultValue !== undefined) {
          // Use default value if source value is undefined
          this.setNestedValue(product as unknown as Record<string, unknown>, mapping.shopwareField, mapping.defaultValue);
        }
      } catch (error) {
        this.log.warn('Failed to apply mapping', {
          plentyField: mapping.plentyField,
          shopwareField: mapping.shopwareField,
          error,
        });
      }
    }
  }

  /**
   * Get nested value from object using dot notation
   * e.g., "variationTexts.0.name" -> variation.variationTexts[0].name
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      // Handle array index
      if (/^\d+$/.test(part)) {
        current = (current as unknown[])[parseInt(part, 10)];
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }

    return current;
  }

  /**
   * Set nested value on object using dot notation
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined) {
        // Create object or array based on next part
        current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Apply transformation rule to a value
   */
  private applyTransformation(value: unknown, rule: TransformationRule): unknown {
    switch (rule.type) {
      case 'direct':
        return value;

      case 'multiply':
        if (typeof value === 'number' && rule.params?.factor) {
          return value * (rule.params.factor as number);
        }
        return value;

      case 'divide':
        if (typeof value === 'number' && rule.params?.divisor) {
          return value / (rule.params.divisor as number);
        }
        return value;

      case 'concat':
        if (rule.params?.fields && rule.params?.separator !== undefined) {
          // This would need the full object context, simplified here
          return value;
        }
        return value;

      case 'map':
        if (rule.params?.mapping && typeof value === 'string') {
          const mapping = rule.params.mapping as Record<string, unknown>;
          return mapping[value] ?? rule.params.defaultValue ?? value;
        }
        return value;

      default:
        return value;
    }
  }

  /**
   * Clear config cache for a tenant
   */
  clearCache(tenantId?: string): void {
    if (tenantId) {
      this.configCache.delete(tenantId);
    } else {
      this.configCache.clear();
    }
  }
}
