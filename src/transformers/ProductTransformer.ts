import { PrismaClient, MediaSourceType } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger, generateDeterministicUuid } from '../utils';
import type { PlentyVariation, PlentyItemImage, PlentyItemProperty } from '../types/plenty';
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
  // Sales channel for product visibility (required for products to appear in storefront)
  salesChannelId?: string;
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

    // Sales channel visibility (required for product to appear in storefront)
    // Only parent products need visibilities - variants inherit from parent
    if (context.salesChannelId) {
      product.visibilities = [
        {
          salesChannelId: context.salesChannelId,
          visibility: 30, // 30 = visible in both search and listings
        },
      ];
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

    // Note: Plenty properties (non-selection) are now handled as Property Options
    // via buildPropertiesFromPlentyProperties, not as custom fields

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
   * Build properties array from Plenty Properties
   * Includes BOTH:
   * - Selection-type properties (from variationProperties via PropertySelectionMapping)
   * - Non-selection-type properties (from properties via PropertyValueMapping)
   */
  private async buildPropertiesFromPlentyProperties(
    variation: PlentyVariation,
    tenantId: string
  ): Promise<ShopwarePropertyOption[]> {
    const { PropertyMappingService } = await import('../services/PropertyMappingService');
    const propertyMappingService = new PropertyMappingService();

    const properties: ShopwarePropertyOption[] = [];

    // 1. Handle selection-type properties (from variationProperties)
    const variationProperties = variation.variationProperties || [];
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

    // 2. Handle non-selection-type properties (from properties array)
    const itemProperties = variation.properties || [];
    const nonSelectionProperties = itemProperties.filter(
      (p) => p.selectionRelationId === null
    );

    for (const prop of nonSelectionProperties) {
      // Extract value (resolves selection IDs to actual names for selection-type properties)
      const value = await this.extractPropertyValue(prop, tenantId);
      if (!value) continue;

      const valueHash = propertyMappingService.generateValueHash(prop.propertyId, value);

      // Look up the mapping
      const valueMappings = await propertyMappingService.getBatchPropertyValueMappings(
        tenantId,
        prop.propertyId,
        [valueHash]
      );

      if (valueMappings[valueHash]) {
        properties.push({ id: valueMappings[valueHash].shopwarePropertyOptionId });
      } else {
        this.log.warn('No value mapping found for non-selection property', {
          propertyId: prop.propertyId,
          valueHash,
          value: value.substring(0, 50),
        });
      }
    }

    return properties;
  }

  /**
   * Extract value from property, resolving selection IDs to actual names
   * For selection-type properties: looks up the selection ID in cached property to get the actual name
   * For non-selection properties: returns the raw value from relationValues
   */
  private async extractPropertyValue(
    prop: PlentyItemProperty,
    tenantId: string
  ): Promise<string | null> {
    if (!prop.relationValues || prop.relationValues.length === 0) {
      return null;
    }

    // Get raw value from relationValues (prefer de, then en, then first available)
    const preferredLangs = ['de', 'en'];
    let rawValue: string | null = null;
    let valueLang = 'de';

    for (const lang of preferredLangs) {
      const langValue = prop.relationValues.find(
        (rv) => rv.lang.toLowerCase() === lang
      );
      if (langValue?.value) {
        rawValue = langValue.value;
        valueLang = lang;
        break;
      }
    }

    if (!rawValue) {
      rawValue = prop.relationValues[0]?.value || null;
      valueLang = prop.relationValues[0]?.lang || 'de';
    }

    if (!rawValue) {
      return null;
    }

    // Check if this is a selection-type property by looking up the cached property
    const cachedProperty = await this.prisma.plentyProperty.findUnique({
      where: {
        tenantId_id: {
          tenantId,
          id: prop.propertyId,
        },
      },
    });

    if (cachedProperty && (cachedProperty.cast === 'selection' || cachedProperty.cast === 'multiSelection')) {
      // For selection properties, the rawValue is the selection ID - look up the actual name
      const selectionId = parseInt(rawValue, 10);

      if (!isNaN(selectionId) && cachedProperty.selections) {
        const selections = cachedProperty.selections as Array<{
          id: number;
          values?: Record<string, string>;
          position?: number;
        }>;

        const selection = selections.find((s) => s.id === selectionId);

        if (selection?.values) {
          // Get name in preferred language
          const selectionName = selection.values[valueLang] ||
                               selection.values['de'] ||
                               selection.values['en'] ||
                               Object.values(selection.values)[0];

          if (selectionName) {
            this.log.debug('Resolved selection value in transformer', {
              propertyId: prop.propertyId,
              selectionId,
              rawValue,
              resolvedName: selectionName,
            });
            return selectionName;
          }
        }

        this.log.warn('Selection not found in cached property (transformer)', {
          propertyId: prop.propertyId,
          selectionId,
          availableSelections: selections.map(s => s.id),
        });
      }
    }

    // For non-selection properties or if lookup failed, return the raw value
    return rawValue;
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
   *
   * Uses variationLinks from images (fetched from /variation_images API) to determine
   * which images belong to which variation:
   *
   * - Parent (main) variations: Get images with NO variation links (global images)
   *   AND images explicitly linked to this variation
   * - Child variations: ONLY get images explicitly linked to this specific variation
   *   (no global images, as those belong to the parent)
   */
  private async buildProductMedia(
    variation: PlentyVariation,
    context: TransformContext
  ): Promise<ShopwareProductMedia[]> {
    if (!context.shopwareClient || !context.itemImages) {
      return [];
    }

    const allItemImages = context.itemImages.get(variation.itemId) || [];

    if (allItemImages.length === 0) {
      return [];
    }

    // Filter images based on variation type using variationLinks from the image-side API
    // variationLinks tells us which variations each image is assigned to
    //
    // Image assignment strategy:
    // - Parent (main variation): Gets ALL images from the item (acts as media pool)
    //   This ensures all images are uploaded to Shopware once on the parent
    // - Child variants: ONLY get images explicitly linked to that specific variation
    //   They reference images already uploaded via the parent
    //
    // This optimizes uploads (all images uploaded once to parent) while ensuring
    // each variant displays only its own specific images.
    let imagesToUse: PlentyItemImage[] = [];

    if (variation.isMain) {
      // Parent variation: Gets ALL images from the item (global + all variant-linked)
      // This makes the parent the "media pool" - all images are uploaded here
      imagesToUse = allItemImages;

      const globalImages = allItemImages.filter(img => !img.variationLinks || img.variationLinks.length === 0);
      const variantLinkedImages = allItemImages.filter(img => img.variationLinks && img.variationLinks.length > 0);

      this.log.info('Assigning ALL images to PARENT variation (media pool)', {
        variationId: variation.id,
        variationNumber: variation.number,
        totalItemImages: allItemImages.length,
        globalImageCount: globalImages.length,
        variantLinkedImageCount: variantLinkedImages.length,
        allImageIds: imagesToUse.map(img => img.id),
      });
    } else {
      // Child variation: ONLY use images that are EXPLICITLY linked to this variation
      // These images are already uploaded via the parent, we just link them here
      imagesToUse = allItemImages.filter((img) => {
        // Skip global images - those are only on the parent
        if (!img.variationLinks || img.variationLinks.length === 0) {
          return false;
        }
        // Only include images explicitly linked to this specific variation
        return img.variationLinks.some((link) => link.variationId === variation.id);
      });

      const linkedToChild = allItemImages.filter(img =>
        img.variationLinks?.some(link => link.variationId === variation.id)
      );

      this.log.info('Filtered images for CHILD variation', {
        variationId: variation.id,
        variationNumber: variation.number,
        totalItemImages: allItemImages.length,
        linkedToChildIds: linkedToChild.map(img => img.id),
        finalImageIds: imagesToUse.map(img => img.id),
        finalImageCount: imagesToUse.length,
      });
    }

    if (imagesToUse.length === 0) {
      return [];
    }

    const { MediaService } = await import('../services/MediaService');
    const mediaService = new MediaService();

    const media: ShopwareProductMedia[] = [];

    for (const [index, img] of imagesToUse.entries()) {
      try {
        // Skip if no URL available
        if (!img.url) {
          this.log.warn('Image missing URL', { variationId: variation.id, imageId: img.id });
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
          // Generate deterministic ID for product_media to enable upsert
          // Based on variation ID and image ID - stable across syncs
          const productMediaId = generateDeterministicUuid(
            'product-media',
            String(variation.id),
            String(img.id)
          );

          media.push({
            id: productMediaId,
            mediaId: result.shopwareMediaId,
            position: img.position || index,
          });

          this.log.info('Media processed for variation', {
            variationId: variation.id,
            imageId: img.id,
            shopwareMediaId: result.shopwareMediaId,
            productMediaId,
            wasExisting: result.wasExisting,
            position: img.position || index,
          });
        } else if (!result.success) {
          this.log.warn('Media upload failed', {
            variationId: variation.id,
            imageId: img.id,
            url: img.url,
            error: result.error,
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

    // Summary log
    this.log.info('buildProductMedia complete', {
      variationId: variation.id,
      variationNumber: variation.number,
      isMain: variation.isMain,
      inputImageCount: imagesToUse.length,
      outputMediaCount: media.length,
      mediaIds: media.map(m => ({ productMediaId: m.id, shopwareMediaId: m.mediaId, position: m.position })),
    });

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
