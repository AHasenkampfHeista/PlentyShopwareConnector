import { PrismaClient, MediaSourceType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';
import type { PlentyVariation, PlentyItemImage } from '../types/plenty';
import type { ShopwareProduct, ShopwareProductMedia, ShopwarePropertyOption, ShopwareProductTranslation } from '../types/shopware';
import type { FieldMapping, TransformationRule } from '../types/sync';
import type { IShopwareClient } from '../clients/interfaces';

const DEFAULT_CURRENCY_ID = 'EUR';
const DEFAULT_TAX_RATE = 19; // German VAT

// Language code mapping: Plenty -> Shopware
const LOCALE_MAP: Record<string, string> = {
  de: 'de-DE',
  en: 'en-GB',
  fr: 'fr-FR',
  it: 'it-IT',
  es: 'es-ES',
  nl: 'nl-NL',
  pl: 'pl-PL',
  cz: 'cs-CZ',
  pt: 'pt-PT',
  da: 'da-DK',
  sv: 'sv-SE',
  no: 'nb-NO',
  fi: 'fi-FI',
  ro: 'ro-RO',
  ru: 'ru-RU',
  tr: 'tr-TR',
};

interface LocalConfig {
  categories: Map<number, { id: number; names: Record<string, string> | null }>;
  attributes: Map<number, { id: number; names: Record<string, string> | null; backendName: string }>;
  salesPrices: Map<number, { id: number; type: string; currency: string | null }>;
  salesPriceMappings: Map<number, { shopwarePriceId: string; mappingType: string }>;
}

export interface TransformContext {
  tenantId: string;
  shopwareClient?: IShopwareClient;
  itemImages?: Map<number, PlentyItemImage[]>;
  customMappings?: FieldMapping[];
  // Shopware system defaults (must be fetched from Shopware before transforming)
  defaultTaxId?: string;
  defaultTaxRate?: number;
  defaultCurrencyId?: string;
}

/**
 * Product Transformer
 * Transforms Plenty variations to Shopware product format
 * Supports parent-child product structure with proper options/properties distinction
 */
export class ProductTransformer {
  private prisma: PrismaClient;
  private log = createLogger({ service: 'ProductTransformer' });
  private configCache: Map<string, LocalConfig> = new Map();

  constructor() {
    this.prisma = getPrismaClient();
  }

  // ============================================
  // MAIN TRANSFORM METHODS
  // ============================================

  /**
   * Transform a main variation to a Shopware PARENT product
   * Parent products: NO parentId, NO options, HAS properties (attributes + Plenty Properties)
   */
  async transformAsParent(
    variation: PlentyVariation,
    context: TransformContext
  ): Promise<ShopwareProduct> {
    const product = await this.transformBase(variation, context);

    // Parent-specific: no parentId, no options
    delete product.parentId;
    delete product.options;

    // Properties: Include both Plenty Attributes (as informational) and Plenty Properties
    const attributeProperties = await this.buildOptionsFromAttributes(variation, context.tenantId);
    const plentyProperties = await this.buildPropertiesFromPlentyProperties(variation, context.tenantId);
    product.properties = [...attributeProperties, ...plentyProperties];

    // Translations for all available languages
    product.translations = this.buildTranslations(variation);

    // Images (parents get all item images)
    if (context.shopwareClient && context.itemImages) {
      product.media = await this.buildProductMedia(variation, context);
    }

    return product;
  }

  /**
   * Transform a child variation to a Shopware VARIANT product
   * Child products: HAS parentId, HAS options (variant-defining), MAY have properties
   */
  async transformAsChild(
    variation: PlentyVariation,
    parentShopwareId: string,
    context: TransformContext
  ): Promise<ShopwareProduct> {
    const product = await this.transformBase(variation, context);

    // Child-specific: set parentId
    product.parentId = parentShopwareId;

    // Options: Attribute values that define this variant (Color, Size, etc.)
    product.options = await this.buildOptionsFromAttributes(variation, context.tenantId);

    // Properties: Only Plenty Properties (not attributes, as those are in options)
    product.properties = await this.buildPropertiesFromPlentyProperties(variation, context.tenantId);

    // Translations (can override parent's translations)
    product.translations = this.buildTranslations(variation);

    // Variant-specific images
    if (context.shopwareClient && context.itemImages) {
      product.media = await this.buildProductMedia(variation, context);
    }

    return product;
  }

  /**
   * Legacy transform method - maintains backward compatibility
   * Transforms as a flat product (no parent-child relationship)
   */
  async transform(
    variation: PlentyVariation,
    tenantId: string,
    customMappings?: FieldMapping[]
  ): Promise<ShopwareProduct> {
    const context: TransformContext = { tenantId, customMappings };
    return this.transformAsParent(variation, context);
  }

  // ============================================
  // BASE TRANSFORMATION
  // ============================================

  /**
   * Base transformation shared by parent and child
   * Handles core fields: productNumber, name, description, stock, price, categories, taxId
   */
  private async transformBase(
    variation: PlentyVariation,
    context: TransformContext
  ): Promise<ShopwareProduct> {
    const config = await this.getLocalConfig(context.tenantId);

    // Get text in preferred language (de first, then en, then first available)
    const text = this.getVariationText(variation, ['de', 'en']);

    // Transform prices (with currencyId from context)
    const prices = this.transformPrices(variation, config, context);

    // Calculate stock
    const stock = this.calculateStock(variation);

    // Build base product
    const product: ShopwareProduct = {
      productNumber: variation.number || `PLY-${variation.id}`,
      name: text.name || `Product ${variation.id}`,
      description: text.description || undefined,
      stock: stock,
      active: variation.isActive ?? true,
      price: prices,
      // taxId is REQUIRED by Shopware - must come from context
      taxId: context.defaultTaxId,
      // Internal references
      _plentyItemId: variation.itemId,
      _plentyVariationId: variation.id,
    };

    // Add categories if available
    const categoryIds = variation.variationCategories?.map((vc) => vc.categoryId) || [];
    if (categoryIds.length > 0) {
      const { CategoryMappingService } = await import('../services/CategoryMappingService');
      const categoryMappingService = new CategoryMappingService();
      const categoryMappings = await categoryMappingService.getBatchMappings(context.tenantId, categoryIds);

      product.categories = Object.values(categoryMappings).map((mapping) => ({
        id: mapping.shopwareCategoryId,
      }));
    }

    // Apply custom field mappings if provided
    if (context.customMappings && context.customMappings.length > 0) {
      this.applyCustomMappings(product, variation, context.customMappings);
    }

    return product;
  }

  // ============================================
  // OPTIONS & PROPERTIES BUILDERS
  // ============================================

  /**
   * Build options/properties array from variationAttributeValues
   * Used for: child variants `options` field OR parent `properties` field
   */
  private async buildOptionsFromAttributes(
    variation: PlentyVariation,
    tenantId: string
  ): Promise<ShopwarePropertyOption[]> {
    const attributeValueIds = (variation.variationAttributeValues || [])
      .map((vav) => vav.valueId || vav.attributeValueId)
      .filter((id): id is number => id !== undefined && id !== null);

    if (attributeValueIds.length === 0) {
      return [];
    }

    const { AttributeMappingService } = await import('../services/AttributeMappingService');
    const attributeMappingService = new AttributeMappingService();
    const attributeValueMappings = await attributeMappingService.getBatchAttributeValueMappings(
      tenantId,
      attributeValueIds
    );

    return Object.values(attributeValueMappings).map((mapping) => ({
      id: mapping.shopwarePropertyOptionId,
    }));
  }

  /**
   * Build properties array from Plenty Properties (variationProperties)
   * Used for informational properties like Material, Care Instructions
   */
  private async buildPropertiesFromPlentyProperties(
    variation: PlentyVariation,
    tenantId: string
  ): Promise<ShopwarePropertyOption[]> {
    const variationProperties = variation.variationProperties || [];

    if (variationProperties.length === 0) {
      return [];
    }

    const { PropertyMappingService } = await import('../services/PropertyMappingService');
    const propertyMappingService = new PropertyMappingService();

    const properties: ShopwarePropertyOption[] = [];

    // Get all selection IDs
    const selectionIds = variationProperties
      .filter((vp) => vp.propertySelectionId !== null)
      .map((vp) => vp.propertySelectionId as number);

    if (selectionIds.length > 0) {
      const selectionMappings = await propertyMappingService.getBatchPropertySelectionMappings(
        tenantId,
        selectionIds
      );

      for (const vp of variationProperties) {
        if (vp.propertySelectionId && selectionMappings[vp.propertySelectionId]) {
          const mapping = selectionMappings[vp.propertySelectionId];
          properties.push({ id: mapping.shopwarePropertyOptionId });
        }
      }
    }

    return properties;
  }

  // ============================================
  // TRANSLATIONS BUILDER
  // ============================================

  /**
   * Build translations object from variationTexts
   * Maps Plenty language codes to Shopware locale codes
   */
  private buildTranslations(variation: PlentyVariation): Record<string, ShopwareProductTranslation> {
    const variationTexts = variation.variationTexts || [];

    // Fallback to item texts if no variation texts
    const itemTexts = variation.item?.itemTexts || [];
    const allTexts = variationTexts.length > 0 ? variationTexts : itemTexts;

    if (allTexts.length === 0) {
      return {};
    }

    const translations: Record<string, ShopwareProductTranslation> = {};

    for (const text of allTexts) {
      const shopwareLocale = LOCALE_MAP[text.lang] || `${text.lang}-${text.lang.toUpperCase()}`;

      translations[shopwareLocale] = {
        name: text.name || '',
        description: text.description || text.shortDescription || undefined,
        metaDescription: text.metaDescription || undefined,
        metaTitle: undefined, // PlentyVariationText doesn't have metaTitle
        keywords: text.metaKeywords || undefined,
      };
    }

    return translations;
  }

  // ============================================
  // MEDIA BUILDER
  // ============================================

  /**
   * Build product media array from item images
   * Uploads images to Shopware and returns media references
   */
  private async buildProductMedia(
    variation: PlentyVariation,
    context: TransformContext
  ): Promise<ShopwareProductMedia[]> {
    if (!context.shopwareClient || !context.itemImages) {
      return [];
    }

    const itemImages = context.itemImages.get(variation.itemId) || [];

    if (itemImages.length === 0) {
      return [];
    }

    const { MediaService } = await import('../services/MediaService');
    const mediaService = new MediaService();

    const media: ShopwareProductMedia[] = [];

    for (const [index, img] of itemImages.entries()) {
      try {
        // Skip if no URL available
        if (!img.url) {
          continue;
        }

        // Upload to Shopware via MediaService
        const result = await mediaService.uploadFromUrl(context.tenantId, context.shopwareClient, {
          sourceUrl: img.url,
          sourceType: MediaSourceType.PRODUCT_IMAGE,
          sourceEntityId: `${variation.itemId}:${img.id}`,
          folderName: 'Product Media',
          title: img.names?.[0]?.name || `${variation.number || variation.id} - Image ${index + 1}`,
          alt: img.names?.[0]?.alternate || `Product image for ${variation.number}`,
        });

        if (result.success && result.shopwareMediaId) {
          media.push({
            mediaId: result.shopwareMediaId,
            position: img.position || index,
          });
        }
      } catch (error) {
        this.log.warn('Failed to upload product image', {
          variationId: variation.id,
          imageId: img.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return media;
  }

  // ============================================
  // BATCH TRANSFORMATION
  // ============================================

  /**
   * Transform multiple variations (legacy method)
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

  // ============================================
  // CONFIGURATION & CACHING
  // ============================================

  /**
   * Get locally cached configuration data
   */
  private async getLocalConfig(tenantId: string): Promise<LocalConfig> {
    // Check cache first
    if (this.configCache.has(tenantId)) {
      return this.configCache.get(tenantId)!;
    }

    // Load from database
    const [categories, attributes, salesPrices, salesPriceMappings] = await Promise.all([
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
      this.prisma.salesPriceMapping.findMany({
        where: { tenantId },
        select: { plentySalesPriceId: true, shopwarePriceId: true, mappingType: true },
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
      salesPriceMappings: new Map(
        salesPriceMappings.map((m) => [
          m.plentySalesPriceId,
          { shopwarePriceId: m.shopwarePriceId, mappingType: m.mappingType },
        ])
      ),
    };

    // Cache for 5 minutes
    this.configCache.set(tenantId, config);
    setTimeout(() => {
      this.configCache.delete(tenantId);
    }, 5 * 60 * 1000);

    return config;
  }

  // ============================================
  // TEXT & PRICE HELPERS
  // ============================================

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
   * Transform variation sales prices to Shopware price format
   * Uses currencyId and taxRate from context (fetched from Shopware)
   */
  private transformPrices(
    variation: PlentyVariation,
    config: LocalConfig,
    context: TransformContext
  ): { currencyId: string; gross: number; net: number; linked: boolean; listPrice?: { gross: number; net: number; linked: boolean } | null }[] {
    const prices = variation.variationSalesPrices || [];

    // Use currency UUID from context, fallback to the string constant (will fail validation in Shopware)
    const currencyId = context.defaultCurrencyId || DEFAULT_CURRENCY_ID;
    // Use tax rate from context, fallback to 19%
    const taxRate = context.defaultTaxRate || DEFAULT_TAX_RATE;

    if (prices.length === 0) {
      return [{
        currencyId,
        gross: 0,
        net: 0,
        linked: true,
        listPrice: null,
      }];
    }

    // Find main price (default type) and RRP price
    let mainPriceValue: number | null = null;
    let rrpPriceValue: number | null = null;
    let mainSalesPriceId: number | null = null;

    for (const price of prices) {
      const salesPrice = config.salesPrices.get(price.salesPriceId);

      if (!salesPrice) continue;

      if (salesPrice.type === 'default' && mainPriceValue === null) {
        mainPriceValue = price.price;
        mainSalesPriceId = price.salesPriceId;
      }

      if (salesPrice.type === 'rrp' && rrpPriceValue === null) {
        rrpPriceValue = price.price;
      }
    }

    // If still no main price, use first available
    if (mainPriceValue === null && prices.length > 0) {
      mainPriceValue = prices[0].price;
      mainSalesPriceId = prices[0].salesPriceId;
    }

    // Look for RRP if not found
    if (rrpPriceValue === null) {
      for (const price of prices) {
        const salesPrice = config.salesPrices.get(price.salesPriceId);
        if (salesPrice?.type === 'rrp' && price.salesPriceId !== mainSalesPriceId) {
          rrpPriceValue = price.price;
          break;
        }
      }
    }

    const grossPrice = mainPriceValue ?? 0;
    const netPrice = grossPrice / (1 + taxRate / 100);

    const shopwarePrice: {
      currencyId: string;
      gross: number;
      net: number;
      linked: boolean;
      listPrice?: { gross: number; net: number; linked: boolean } | null;
    } = {
      currencyId,
      gross: grossPrice,
      net: netPrice,
      linked: true,
      listPrice: null,
    };

    if (rrpPriceValue !== null && rrpPriceValue > grossPrice) {
      const rrpNet = rrpPriceValue / (1 + taxRate / 100);
      shopwarePrice.listPrice = {
        gross: rrpPriceValue,
        net: rrpNet,
        linked: true,
      };
    }

    return [shopwarePrice];
  }

  /**
   * Calculate total stock from all warehouses
   */
  private calculateStock(variation: PlentyVariation): number {
    const stockEntries = variation.stock || [];

    if (stockEntries.length === 0) {
      return 0;
    }

    return stockEntries.reduce((total, entry) => {
      return total + (entry.netStock || 0);
    }, 0);
  }

  // ============================================
  // CUSTOM MAPPING HELPERS
  // ============================================

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
          const transformedValue = mapping.transformationRule
            ? this.applyTransformation(value, mapping.transformationRule)
            : value;

          this.setNestedValue(product as unknown as Record<string, unknown>, mapping.shopwareField, transformedValue);
        } else if (mapping.defaultValue !== undefined) {
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

  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (/^\d+$/.test(part)) {
        current = (current as unknown[])[parseInt(part, 10)];
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }

    return current;
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined) {
        current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

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
