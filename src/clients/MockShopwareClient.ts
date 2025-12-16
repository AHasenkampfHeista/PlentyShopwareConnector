import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';
import { IShopwareClient, MockShopwareClientConfig } from './interfaces';
import {
  ShopwareProduct,
  ShopwareStockUpdate,
  ShopwareSyncResult,
  ShopwareBulkProduct,
  ShopwareBulkSyncResult,
  ShopwareBulkItemResult,
  ShopwareCategory,
  ShopwarePropertyGroup,
  ShopwarePropertyOption,
  ShopwareManufacturer,
  ShopwareUnit,
} from '../types/shopware';

/**
 * Mock Shopware Client
 * Saves products to mock_shopware_products database table instead of real Shopware API
 * Implements the same interface as the real ShopwareClient for easy swapping
 */
export class MockShopwareClient implements IShopwareClient {
  private prisma: PrismaClient;
  private tenantId: string;
  private authenticated = false;
  private log = createLogger({ client: 'MockShopwareClient' });

  constructor(config: MockShopwareClientConfig) {
    this.tenantId = config.tenantId;
    this.prisma = getPrismaClient();
    this.log = createLogger({ client: 'MockShopwareClient', tenantId: this.tenantId });
  }

  /**
   * Mock authentication - always succeeds
   */
  async authenticate(): Promise<void> {
    this.log.info('Mock Shopware: Authentication (simulated)');
    this.authenticated = true;
  }

  /**
   * Create a new product in the mock database
   */
  async createProduct(product: ShopwareProduct): Promise<ShopwareSyncResult> {
    try {
      this.log.debug('Mock Shopware: Creating product', { sku: product.productNumber });

      // Extract price info
      const mainPrice = product.price?.[0];
      const priceGross = mainPrice?.gross ?? 0;
      const priceNet = mainPrice?.net ?? priceGross / 1.19; // Assume 19% VAT if not provided

      // Create the product in mock table
      const created = await this.prisma.mockShopwareProduct.create({
        data: {
          tenantId: this.tenantId,
          sku: product.productNumber,
          productNumber: product.productNumber,
          name: product.name || '',
          description: product.description || undefined,
          priceGross: priceGross,
          priceNet: priceNet,
          currency: mainPrice?.currencyId || 'EUR',
          stock: product.stock || 0,
          active: product.active ?? true,
          plentyItemId: product._plentyItemId || undefined,
          plentyVariationId: product._plentyVariationId || undefined,
          rawShopwareData: product as unknown as object,
        },
      });

      this.log.info('Mock Shopware: Product created', {
        id: created.id,
        sku: created.sku,
      });

      return {
        id: created.id,
        productNumber: product.productNumber,
        action: 'create',
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Handle unique constraint violation (product already exists)
      if (errorMessage.includes('Unique constraint')) {
        this.log.warn('Mock Shopware: Product already exists, updating instead', {
          sku: product.productNumber,
        });
        // Try to update instead
        return this.updateProductBySku(product.productNumber, product);
      }

      this.log.error('Mock Shopware: Failed to create product', {
        sku: product.productNumber,
        error: errorMessage,
      });

      return {
        id: '',
        productNumber: product.productNumber,
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update an existing product by ID
   */
  async updateProduct(id: string, product: Partial<ShopwareProduct>): Promise<ShopwareSyncResult> {
    try {
      this.log.debug('Mock Shopware: Updating product by ID', { id });

      const updateData = this.buildUpdateData(product);

      const updated = await this.prisma.mockShopwareProduct.update({
        where: { id },
        data: updateData,
      });

      this.log.info('Mock Shopware: Product updated', {
        id: updated.id,
        sku: updated.sku,
      });

      return {
        id: updated.id,
        productNumber: updated.sku,
        action: 'update',
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log.error('Mock Shopware: Failed to update product', { id, error: errorMessage });

      return {
        id,
        productNumber: product.productNumber || '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update an existing product by SKU
   */
  async updateProductBySku(
    sku: string,
    product: Partial<ShopwareProduct>
  ): Promise<ShopwareSyncResult> {
    try {
      this.log.debug('Mock Shopware: Updating product by SKU', { sku });

      const updateData = this.buildUpdateData(product);

      const updated = await this.prisma.mockShopwareProduct.update({
        where: {
          tenantId_sku: {
            tenantId: this.tenantId,
            sku,
          },
        },
        data: updateData,
      });

      this.log.info('Mock Shopware: Product updated', {
        id: updated.id,
        sku: updated.sku,
      });

      return {
        id: updated.id,
        productNumber: updated.sku,
        action: 'update',
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log.error('Mock Shopware: Failed to update product by SKU', { sku, error: errorMessage });

      return {
        id: '',
        productNumber: sku,
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Build update data object from product
   */
  private buildUpdateData(product: Partial<ShopwareProduct>): Record<string, unknown> {
    const updateData: Record<string, unknown> = {};

    if (product.name !== undefined) {
      updateData.name = product.name;
    }

    if (product.description !== undefined) {
      updateData.description = product.description;
    }

    if (product.stock !== undefined) {
      updateData.stock = product.stock;
    }

    if (product.active !== undefined) {
      updateData.active = product.active;
    }

    if (product.price?.[0]) {
      const mainPrice = product.price[0];
      updateData.priceGross = mainPrice.gross;
      updateData.priceNet = mainPrice.net ?? mainPrice.gross / 1.19;
      updateData.currency = mainPrice.currencyId || 'EUR';
    }

    if (product._plentyItemId !== undefined) {
      updateData.plentyItemId = product._plentyItemId;
    }

    if (product._plentyVariationId !== undefined) {
      updateData.plentyVariationId = product._plentyVariationId;
    }

    updateData.rawShopwareData = product;

    return updateData;
  }

  /**
   * Bulk sync products (create or update in batch)
   * Implements upsert pattern - creates if ID is not provided, updates if ID exists
   */
  async bulkSyncProducts(products: ShopwareBulkProduct[]): Promise<ShopwareBulkSyncResult> {
    this.log.info('Mock Shopware: Bulk syncing products', { count: products.length });

    const results: ShopwareBulkItemResult[] = [];

    // Process each product in a transaction for consistency
    try {
      for (const product of products) {
        try {
          let shopwareId: string;
          let action: 'create' | 'update';

          // If ID is provided, it's an update; otherwise it's a create
          if (product.id) {
            // Update existing product
            const updateData = this.buildUpdateData(product);
            const updated = await this.prisma.mockShopwareProduct.update({
              where: { id: product.id },
              data: updateData,
            });
            shopwareId = updated.id;
            action = 'update';
          } else {
            // Create new product or update if SKU exists
            const mainPrice = product.price?.[0];
            const priceGross = mainPrice?.gross ?? 0;
            const priceNet = mainPrice?.net ?? priceGross / 1.19;

            const created = await this.prisma.mockShopwareProduct.upsert({
              where: {
                tenantId_sku: {
                  tenantId: this.tenantId,
                  sku: product.productNumber,
                },
              },
              create: {
                tenantId: this.tenantId,
                sku: product.productNumber,
                productNumber: product.productNumber,
                name: product.name || '',
                description: product.description || undefined,
                priceGross: priceGross,
                priceNet: priceNet,
                currency: mainPrice?.currencyId || 'EUR',
                stock: product.stock || 0,
                active: product.active ?? true,
                plentyItemId: product._plentyItemId || undefined,
                plentyVariationId: product._plentyVariationId || undefined,
                rawShopwareData: product as unknown as object,
              },
              update: {
                name: product.name,
                description: product.description,
                priceGross: priceGross,
                priceNet: priceNet,
                stock: product.stock,
                active: product.active,
                rawShopwareData: product as unknown as object,
              },
            });
            shopwareId = created.id;
            action = 'create';
          }

          results.push({
            productNumber: product.productNumber,
            shopwareId,
            action,
            success: true,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.log.error('Mock Shopware: Failed to sync product in bulk', {
            sku: product.productNumber,
            error: errorMessage,
          });

          results.push({
            productNumber: product.productNumber,
            shopwareId: product.id || '',
            action: product.id ? 'update' : 'create',
            success: false,
            error: errorMessage,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      this.log.info('Mock Shopware: Bulk sync completed', {
        total: products.length,
        success: successCount,
        failed: failCount,
      });

      return {
        success: failCount === 0,
        results,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log.error('Mock Shopware: Bulk sync transaction failed', { error: errorMessage });

      throw new Error(`Bulk sync failed: ${errorMessage}`);
    }
  }

  /**
   * Get product by SKU
   */
  async getProductBySku(sku: string): Promise<ShopwareProduct | null> {
    try {
      const product = await this.prisma.mockShopwareProduct.findUnique({
        where: {
          tenantId_sku: {
            tenantId: this.tenantId,
            sku,
          },
        },
      });

      if (!product) {
        return null;
      }

      // Convert to ShopwareProduct format
      return {
        id: product.id,
        productNumber: product.sku,
        name: product.name,
        description: product.description || undefined,
        stock: product.stock,
        active: product.active,
        price: [
          {
            currencyId: product.currency,
            gross: product.priceGross.toNumber(),
            net: product.priceNet?.toNumber() ?? product.priceGross.toNumber() / 1.19,
            linked: true,
          },
        ],
        _plentyItemId: product.plentyItemId || undefined,
        _plentyVariationId: product.plentyVariationId || undefined,
      };
    } catch (error) {
      this.log.error('Mock Shopware: Failed to get product', { sku, error });
      return null;
    }
  }

  /**
   * Check if product exists by SKU
   */
  async productExists(sku: string): Promise<boolean> {
    try {
      const count = await this.prisma.mockShopwareProduct.count({
        where: {
          tenantId: this.tenantId,
          sku,
        },
      });
      return count > 0;
    } catch (error) {
      this.log.error('Mock Shopware: Failed to check product existence', { sku, error });
      return false;
    }
  }

  /**
   * Update stock for a product using product ID (preferred method)
   * Uses the product UUID for direct, reliable lookups
   */
  async updateStockById(productId: string, stock: number): Promise<ShopwareSyncResult> {
    try {
      this.log.debug('Mock Shopware: Updating stock by ID', { productId, stock });

      // Update directly using the product ID (UUID) - most reliable method
      const updated = await this.prisma.mockShopwareProduct.update({
        where: { id: productId },
        data: { stock },
      });

      this.log.info('Mock Shopware: Stock updated', {
        id: productId,
        sku: updated.sku,
        stock,
      });

      return {
        id: updated.id,
        productNumber: updated.sku,
        action: 'update',
        success: true,
        details: { stock },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log.error('Mock Shopware: Failed to update stock', {
        productId,
        error: errorMessage
      });

      return {
        id: productId,
        productNumber: '',
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update stock for a product using SKU (legacy method, prefer updateStockById)
   * @deprecated Use updateStockById instead for more reliable updates
   */
  async updateStock(sku: string, stock: number): Promise<ShopwareSyncResult> {
    try {
      this.log.debug('Mock Shopware: Updating stock by SKU', { sku, stock });

      // First check if product exists
      const existing = await this.prisma.mockShopwareProduct.findUnique({
        where: {
          tenantId_sku: {
            tenantId: this.tenantId,
            sku,
          },
        },
      });

      if (!existing) {
        this.log.warn('Mock Shopware: Product not found for stock update', { sku });
        return {
          id: '',
          productNumber: sku,
          action: 'skip',
          success: false,
          error: 'Product not found. Product must be synced before stock can be updated.',
        };
      }

      // Update stock
      const updated = await this.prisma.mockShopwareProduct.update({
        where: {
          tenantId_sku: {
            tenantId: this.tenantId,
            sku,
          },
        },
        data: { stock },
      });

      this.log.info('Mock Shopware: Stock updated', {
        sku,
        stock,
      });

      return {
        id: updated.id,
        productNumber: sku,
        action: 'update',
        success: true,
        details: { stock },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log.error('Mock Shopware: Failed to update stock', { sku, error: errorMessage });

      return {
        id: '',
        productNumber: sku,
        action: 'error',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Batch update stock for multiple products
   */
  async batchUpdateStock(updates: ShopwareStockUpdate[]): Promise<ShopwareSyncResult[]> {
    const results: ShopwareSyncResult[] = [];

    for (const update of updates) {
      // Use product ID (UUID) for direct, reliable lookups
      const result = await this.updateStockById(update.id, update.stock);
      results.push(result);
    }

    const successful = results.filter((r) => r.success).length;
    this.log.info('Mock Shopware: Batch stock update complete', {
      total: updates.length,
      successful,
      failed: updates.length - successful,
    });

    return results;
  }

  // ============================================
  // MEDIA METHODS
  // ============================================

  /**
   * Create a media entity
   */
  async createMedia(params: {
    fileName: string;
    folderId?: string;
    title?: string;
    alt?: string;
  }): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Creating media entity', { fileName: params.fileName });

    const created = await this.prisma.mockShopwareMedia.create({
      data: {
        tenantId: this.tenantId,
        fileName: params.fileName.replace(/\.[^/.]+$/, ''),
        fileExtension: params.fileName.split('.').pop() || 'jpg',
        mimeType: 'image/jpeg',
        title: params.title,
        alt: params.alt,
        folderId: params.folderId,
      },
    });

    return {
      id: created.id,
      productNumber: '',
      action: 'create',
      success: true,
    };
  }

  /**
   * Upload media file from URL to an existing media entity
   */
  async uploadMediaFromUrl(mediaId: string, sourceUrl: string, fileName: string): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Uploading media from URL', { mediaId, sourceUrl, fileName });

    // In mock mode, we just update the record with the source URL
    await this.prisma.mockShopwareMedia.update({
      where: { id: mediaId },
      data: {
        sourceUrl,
        fileName: fileName.replace(/\.[^/.]+$/, ''),
        fileExtension: fileName.split('.').pop() || 'jpg',
      },
    });

    return {
      id: mediaId,
      productNumber: '',
      action: 'update',
      success: true,
    };
  }

  /**
   * Create media and upload from URL in one operation
   */
  async createMediaFromUrl(params: {
    sourceUrl: string;
    fileName: string;
    folderId?: string;
    title?: string;
    alt?: string;
  }): Promise<ShopwareSyncResult & { mimeType?: string; fileSize?: number }> {
    this.log.info('Mock Shopware: Creating media from URL', { sourceUrl: params.sourceUrl, fileName: params.fileName });

    // In mock mode, determine mime type from extension
    const extension = params.fileName.split('.').pop()?.toLowerCase() || 'jpg';
    const extToMime: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    };
    const mimeType = extToMime[extension] || 'image/jpeg';

    const created = await this.prisma.mockShopwareMedia.create({
      data: {
        tenantId: this.tenantId,
        fileName: params.fileName.replace(/\.[^/.]+$/, ''),
        fileExtension: extension,
        mimeType,
        title: params.title,
        alt: params.alt,
        folderId: params.folderId,
        sourceUrl: params.sourceUrl,
        fileSize: 0, // We don't actually download in mock mode
      },
    });

    return {
      id: created.id,
      productNumber: '',
      action: 'create',
      success: true,
      mimeType,
      fileSize: 0,
    };
  }

  /**
   * Get media by ID
   */
  async getMediaById(id: string): Promise<{ id: string; fileName: string; mimeType: string; fileSize: number } | null> {
    const media = await this.prisma.mockShopwareMedia.findUnique({
      where: { id },
    });

    if (!media) return null;

    return {
      id: media.id,
      fileName: `${media.fileName}.${media.fileExtension}`,
      mimeType: media.mimeType,
      fileSize: media.fileSize || 0,
    };
  }

  /**
   * Check if media exists by ID
   */
  async mediaExists(id: string): Promise<boolean> {
    const media = await this.prisma.mockShopwareMedia.findUnique({
      where: { id },
      select: { id: true },
    });
    return !!media;
  }

  /**
   * Get or create a media folder by name
   */
  async getOrCreateMediaFolder(folderName: string): Promise<string> {
    this.log.info('Mock Shopware: Getting or creating media folder', { folderName });

    // In mock mode, we just return a deterministic UUID based on folder name
    // This simulates folder management without actually storing folders
    const crypto = await import('crypto');
    const folderId = crypto.createHash('md5').update(`${this.tenantId}-${folderName}`).digest('hex');

    return folderId;
  }

  /**
   * Test connection - always succeeds for mock
   */
  async testConnection(): Promise<boolean> {
    try {
      // Test database connection
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.log.error('Mock Shopware: Connection test failed', { error });
      return false;
    }
  }

  /**
   * Get the default tax rate (mock implementation)
   * Returns a mock 19% German tax rate
   */
  async getDefaultTax(): Promise<{ id: string; taxRate: number; name: string } | null> {
    return {
      id: '0193e95fe3a6749ebcaa24ff0f3f5c82', // Mock UUID
      taxRate: 19,
      name: 'Standard rate',
    };
  }

  /**
   * Get the default currency (mock implementation)
   * Returns EUR as the default currency
   */
  async getDefaultCurrency(): Promise<{ id: string; isoCode: string; factor: number } | null> {
    return {
      id: 'b7d2554b0ce847cd82f3ac9bd1c0dfca', // Mock UUID for EUR
      isoCode: 'EUR',
      factor: 1,
    };
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * Get all products for this tenant (useful for debugging)
   */
  async getAllProducts(): Promise<ShopwareProduct[]> {
    const products = await this.prisma.mockShopwareProduct.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return products.map((p) => ({
      id: p.id,
      productNumber: p.sku,
      name: p.name,
      description: p.description || undefined,
      stock: p.stock,
      active: p.active,
      price: [
        {
          currencyId: p.currency,
          gross: p.priceGross.toNumber(),
          net: p.priceNet?.toNumber() ?? p.priceGross.toNumber() / 1.19,
          linked: true,
        },
      ],
      _plentyItemId: p.plentyItemId || undefined,
      _plentyVariationId: p.plentyVariationId || undefined,
    }));
  }

  /**
   * Create a new category
   */
  async createCategory(category: ShopwareCategory): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Creating category', { name: category.name });

    const created = await this.prisma.mockShopwareCategory.create({
      data: {
        id: category.id || crypto.randomUUID(),
        tenantId: this.tenantId,
        parentId: category.parentId,
        name: category.name || 'Unnamed Category',
        active: category.active ?? true,
        visible: category.visible ?? true,
        level: category.level ?? 1,
        plentyCategoryId: category._plentyCategoryId,
        rawShopwareData: category as unknown as object,
      },
    });

    return {
      id: created.id,
      productNumber: '',
      action: 'create',
      success: true,
    };
  }

  /**
   * Update an existing category by ID
   */
  async updateCategory(id: string, category: Partial<ShopwareCategory>): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Updating category', { id });

    const updated = await this.prisma.mockShopwareCategory.update({
      where: {
        id,
      },
      data: {
        parentId: category.parentId,
        name: category.name,
        active: category.active,
        visible: category.visible,
        level: category.level,
        rawShopwareData: category as unknown as object,
      },
    });

    return {
      id: updated.id,
      productNumber: '',
      action: 'update',
      success: true,
    };
  }

  /**
   * Get category by ID
   */
  async getCategoryById(id: string): Promise<ShopwareCategory | null> {
    const category = await this.prisma.mockShopwareCategory.findUnique({
      where: {
        id,
      },
    });

    if (!category) {
      return null;
    }

    // Only return categories for this tenant
    if (category.tenantId !== this.tenantId) {
      return null;
    }

    return {
      id: category.id,
      parentId: category.parentId || undefined,
      name: category.name,
      active: category.active,
      visible: category.visible,
      level: category.level,
      _plentyCategoryId: category.plentyCategoryId || undefined,
    };
  }

  /**
   * Check if category exists by ID
   */
  async categoryExists(id: string): Promise<boolean> {
    const category = await this.prisma.mockShopwareCategory.findUnique({
      where: {
        id,
      },
    });

    return category !== null && category.tenantId === this.tenantId;
  }

  /**
   * Bulk sync categories (create or update in batch)
   */
  async bulkSyncCategories(categories: ShopwareCategory[]): Promise<ShopwareBulkSyncResult> {
    this.log.info('Mock Shopware: Bulk syncing categories', { count: categories.length });

    const results: ShopwareBulkItemResult[] = [];

    for (const category of categories) {
      try {
        // Upsert pattern: if ID provided and exists, update; otherwise create
        if (category.id && (await this.categoryExists(category.id))) {
          const result = await this.updateCategory(category.id, category);
          results.push({
            productNumber: '',
            shopwareId: result.id,
            action: 'update',
            success: result.success,
            error: result.error,
          });
        } else {
          const result = await this.createCategory(category);
          results.push({
            productNumber: '',
            shopwareId: result.id,
            action: 'create',
            success: result.success,
            error: result.error,
          });
        }
      } catch (error) {
        this.log.error('Mock Shopware: Failed to sync category', {
          category: category.name,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          productNumber: '',
          shopwareId: category.id || '',
          action: 'create',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failedCount = results.filter((r) => !r.success).length;

    return {
      success: failedCount === 0,
      results,
    };
  }

  /**
   * Create a new price
   */
  async createPrice(price: {
    name: string;
    type?: string;
    isGross?: boolean;
    plentySalesPriceId?: number;
    translations?: Record<string, string>;
  }): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Creating price', { name: price.name, type: price.type });

    const created = await this.prisma.mockShopwarePrice.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: this.tenantId,
        name: price.name,
        type: price.type || 'default',
        isGross: price.isGross ?? true,
        plentySalesPriceId: price.plentySalesPriceId,
        translations: price.translations as unknown as object,
        rawShopwareData: price as unknown as object,
      },
    });

    return {
      id: created.id,
      productNumber: '',
      action: 'create',
      success: true,
    };
  }

  /**
   * Update an existing price by ID
   */
  async updatePrice(
    id: string,
    price: {
      name?: string;
      type?: string;
      isGross?: boolean;
      translations?: Record<string, string>;
    }
  ): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Updating price', { id });

    const updated = await this.prisma.mockShopwarePrice.update({
      where: {
        id,
      },
      data: {
        name: price.name,
        type: price.type,
        isGross: price.isGross,
        translations: price.translations as unknown as object,
        rawShopwareData: price as unknown as object,
      },
    });

    return {
      id: updated.id,
      productNumber: '',
      action: 'update',
      success: true,
    };
  }

  /**
   * Get price by ID
   */
  async getPriceById(id: string): Promise<{ id: string; name: string; type: string } | null> {
    const price = await this.prisma.mockShopwarePrice.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        name: true,
        type: true,
        tenantId: true,
      },
    });

    if (!price || price.tenantId !== this.tenantId) {
      return null;
    }

    return {
      id: price.id,
      name: price.name,
      type: price.type,
    };
  }

  /**
   * Check if price exists by ID
   */
  async priceExists(id: string): Promise<boolean> {
    const price = await this.prisma.mockShopwarePrice.findUnique({
      where: {
        id,
      },
    });

    return price !== null && price.tenantId === this.tenantId;
  }

  /**
   * Bulk sync prices (create or update in batch)
   */
  async bulkSyncPrices(
    prices: Array<{
      id: string;
      name: string;
      priority?: number;
      translations?: Record<string, { name: string }>;
    }>
  ): Promise<ShopwareBulkSyncResult> {
    this.log.info('Mock Shopware: Bulk syncing prices', { count: prices.length });

    const results: ShopwareBulkItemResult[] = [];

    for (const price of prices) {
      try {
        // Upsert pattern: if ID provided and exists, update; otherwise create
        if (price.id && (await this.priceExists(price.id))) {
          await this.prisma.mockShopwarePrice.update({
            where: { id: price.id },
            data: {
              name: price.name,
              translations: price.translations as unknown as object,
              rawShopwareData: price as unknown as object, // priority stored here
            },
          });

          results.push({
            productNumber: '',
            shopwareId: price.id,
            action: 'update',
            success: true,
          });
        } else {
          const id = price.id || crypto.randomUUID();
          await this.prisma.mockShopwarePrice.create({
            data: {
              id,
              tenantId: this.tenantId,
              name: price.name,
              translations: price.translations as unknown as object,
              rawShopwareData: price as unknown as object, // priority stored here
            },
          });

          results.push({
            productNumber: '',
            shopwareId: id,
            action: 'create',
            success: true,
          });
        }
      } catch (error) {
        results.push({
          productNumber: '',
          shopwareId: price.id || '',
          action: 'create',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failedCount = results.filter((r) => !r.success).length;

    return {
      success: failedCount === 0,
      results,
    };
  }

  /**
   * Create a new manufacturer
   */
  async createManufacturer(manufacturer: ShopwareManufacturer): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Creating manufacturer', { name: manufacturer.name });

    const created = await this.prisma.mockShopwareManufacturer.create({
      data: {
        id: manufacturer.id || crypto.randomUUID(),
        tenantId: this.tenantId,
        name: manufacturer.name || 'Unnamed Manufacturer',
        link: manufacturer.link,
        description: manufacturer.description,
        mediaId: manufacturer.mediaId,
        plentyManufacturerId: manufacturer._plentyManufacturerId,
        translations: manufacturer.translations as unknown as object,
        rawShopwareData: manufacturer as unknown as object,
      },
    });

    return {
      id: created.id,
      productNumber: '', // Not applicable for manufacturers
      action: 'create',
      success: true,
    };
  }

  /**
   * Update an existing manufacturer by ID
   */
  async updateManufacturer(
    id: string,
    manufacturer: Partial<ShopwareManufacturer>
  ): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Updating manufacturer', { id });

    const updated = await this.prisma.mockShopwareManufacturer.update({
      where: { id },
      data: {
        name: manufacturer.name,
        link: manufacturer.link,
        description: manufacturer.description,
        mediaId: manufacturer.mediaId,
        translations: manufacturer.translations as unknown as object,
        rawShopwareData: manufacturer as unknown as object,
      },
    });

    return {
      id: updated.id,
      productNumber: '', // Not applicable for manufacturers
      action: 'update',
      success: true,
    };
  }

  /**
   * Get manufacturer by ID
   */
  async getManufacturerById(id: string): Promise<ShopwareManufacturer | null> {
    const manufacturer = await this.prisma.mockShopwareManufacturer.findUnique({
      where: { id },
    });

    if (!manufacturer || manufacturer.tenantId !== this.tenantId) {
      return null;
    }

    return {
      id: manufacturer.id,
      name: manufacturer.name,
      link: manufacturer.link || undefined,
      description: manufacturer.description || undefined,
      mediaId: manufacturer.mediaId || undefined,
      translations: manufacturer.translations as Record<string, { name: string; description?: string }>,
      _plentyManufacturerId: manufacturer.plentyManufacturerId || undefined,
    };
  }

  /**
   * Check if manufacturer exists by ID
   */
  async manufacturerExists(id: string): Promise<boolean> {
    const manufacturer = await this.prisma.mockShopwareManufacturer.findUnique({
      where: { id },
    });

    return manufacturer !== null && manufacturer.tenantId === this.tenantId;
  }

  /**
   * Bulk sync manufacturers (create or update in batch)
   */
  async bulkSyncManufacturers(
    manufacturers: ShopwareManufacturer[]
  ): Promise<ShopwareBulkSyncResult> {
    this.log.info('Mock Shopware: Bulk syncing manufacturers', { count: manufacturers.length });

    const results: ShopwareBulkItemResult[] = [];

    for (const manufacturer of manufacturers) {
      try {
        // Upsert pattern: if ID provided and exists, update; otherwise create
        if (manufacturer.id && (await this.manufacturerExists(manufacturer.id))) {
          const result = await this.updateManufacturer(manufacturer.id, manufacturer);
          results.push({
            productNumber: '',
            shopwareId: result.id,
            action: 'update',
            success: result.success,
            error: result.error,
          });
        } else {
          const result = await this.createManufacturer(manufacturer);
          results.push({
            productNumber: '',
            shopwareId: result.id,
            action: 'create',
            success: result.success,
            error: result.error,
          });
        }
      } catch (error) {
        this.log.error('Mock Shopware: Failed to sync manufacturer', {
          manufacturer: manufacturer.name,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          productNumber: '',
          shopwareId: manufacturer.id || '',
          action: 'create',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failedCount = results.filter((r) => !r.success).length;

    return {
      success: failedCount === 0,
      results,
    };
  }

  /**
   * Create a new unit
   */
  async createUnit(unit: ShopwareUnit): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Creating unit', { shortCode: unit.shortCode, name: unit.name });

    const created = await this.prisma.mockShopwareUnit.create({
      data: {
        id: unit.id || crypto.randomUUID(),
        tenantId: this.tenantId,
        shortCode: unit.shortCode,
        name: unit.name,
        plentyUnitId: unit._plentyUnitId,
        translations: unit.translations as unknown as object,
        rawShopwareData: unit as unknown as object,
      },
    });

    return {
      id: created.id,
      productNumber: '', // Not applicable for units
      action: 'create',
      success: true,
    };
  }

  /**
   * Update an existing unit by ID
   */
  async updateUnit(
    id: string,
    unit: Partial<ShopwareUnit>
  ): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Updating unit', { id });

    const updated = await this.prisma.mockShopwareUnit.update({
      where: { id },
      data: {
        shortCode: unit.shortCode,
        name: unit.name,
        translations: unit.translations as unknown as object,
        rawShopwareData: unit as unknown as object,
      },
    });

    return {
      id: updated.id,
      productNumber: '', // Not applicable for units
      action: 'update',
      success: true,
    };
  }

  /**
   * Get unit by ID
   */
  async getUnitById(id: string): Promise<ShopwareUnit | null> {
    const unit = await this.prisma.mockShopwareUnit.findUnique({
      where: { id },
    });

    if (!unit || unit.tenantId !== this.tenantId) {
      return null;
    }

    return {
      id: unit.id,
      shortCode: unit.shortCode,
      name: unit.name || undefined,
      translations: unit.translations as Record<string, { shortCode: string; name?: string }>,
      _plentyUnitId: unit.plentyUnitId || undefined,
    };
  }

  /**
   * Check if unit exists by ID
   */
  async unitExists(id: string): Promise<boolean> {
    const unit = await this.prisma.mockShopwareUnit.findUnique({
      where: { id },
    });

    return unit !== null && unit.tenantId === this.tenantId;
  }

  /**
   * Bulk sync units (create or update in batch)
   */
  async bulkSyncUnits(
    units: ShopwareUnit[]
  ): Promise<ShopwareBulkSyncResult> {
    this.log.info('Mock Shopware: Bulk syncing units', { count: units.length });

    const results: ShopwareBulkItemResult[] = [];

    for (const unit of units) {
      try {
        // Upsert pattern: if ID provided and exists, update; otherwise create
        if (unit.id && (await this.unitExists(unit.id))) {
          const result = await this.updateUnit(unit.id, unit);
          results.push({
            productNumber: '',
            shopwareId: result.id,
            action: 'update',
            success: result.success,
            error: result.error,
          });
        } else {
          const result = await this.createUnit(unit);
          results.push({
            productNumber: '',
            shopwareId: result.id,
            action: 'create',
            success: result.success,
            error: result.error,
          });
        }
      } catch (error) {
        this.log.error('Mock Shopware: Failed to sync unit', {
          unit: unit.shortCode,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          productNumber: '',
          shopwareId: unit.id || '',
          action: 'create',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failedCount = results.filter((r) => !r.success).length;

    return {
      success: failedCount === 0,
      results,
    };
  }

  /**
   * Create a property group
   */
  async createPropertyGroup(group: ShopwarePropertyGroup): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Creating property group', { name: group.name });

    const created = await this.prisma.mockShopwarePropertyGroup.create({
      data: {
        id: group.id || crypto.randomUUID(),
        tenantId: this.tenantId,
        name: group.name || 'Unnamed Property Group',
        displayType: group.displayType || 'text',
        sortingType: group.sortingType || 'alphanumeric',
        position: group.position ?? 0,
        plentyAttributeId: group._plentyAttributeId,
        translations: group.translations as unknown as object || {},
        rawShopwareData: group as unknown as object,
      },
    });

    return {
      id: created.id,
      productNumber: '', // Not applicable for property groups
      action: 'create',
      success: true,
    };
  }

  /**
   * Update a property group by ID
   */
  async updatePropertyGroup(
    id: string,
    group: Partial<ShopwarePropertyGroup>
  ): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Updating property group', { id });

    const updated = await this.prisma.mockShopwarePropertyGroup.update({
      where: { id },
      data: {
        name: group.name,
        displayType: group.displayType,
        sortingType: group.sortingType,
        position: group.position,
        translations: group.translations as unknown as object,
        rawShopwareData: group as unknown as object,
      },
    });

    return {
      id: updated.id,
      productNumber: '', // Not applicable for property groups
      action: 'update',
      success: true,
    };
  }

  /**
   * Get property group by ID
   */
  async getPropertyGroupById(id: string): Promise<ShopwarePropertyGroup | null> {
    const group = await this.prisma.mockShopwarePropertyGroup.findUnique({
      where: { id },
    });

    if (!group || group.tenantId !== this.tenantId) {
      return null;
    }

    return {
      id: group.id,
      name: group.name,
      displayType: group.displayType,
      sortingType: group.sortingType,
      position: group.position,
      translations: group.translations as Record<string, { name: string; description?: string }>,
      _plentyAttributeId: group.plentyAttributeId || undefined,
    };
  }

  /**
   * Check if property group exists
   */
  async propertyGroupExists(id: string): Promise<boolean> {
    const group = await this.prisma.mockShopwarePropertyGroup.findUnique({
      where: { id },
    });

    return group !== null && group.tenantId === this.tenantId;
  }

  /**
   * Create a property option
   */
  async createPropertyOption(option: ShopwarePropertyOption): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Creating property option', {
      name: option.name,
      groupId: option.groupId,
    });

    const created = await this.prisma.mockShopwarePropertyOption.create({
      data: {
        id: option.id || crypto.randomUUID(),
        tenantId: this.tenantId,
        propertyGroupId: option.groupId || '',
        name: option.name || 'Unnamed Property Option',
        position: option.position ?? 0,
        colorHexCode: option.colorHexCode,
        mediaId: option.mediaId,
        plentyAttributeId: option._plentyAttributeId,
        plentyAttributeValueId: option._plentyAttributeValueId,
        translations: option.translations as unknown as object || {},
        rawShopwareData: option as unknown as object,
      },
    });

    return {
      id: created.id,
      productNumber: '', // Not applicable for property options
      action: 'create',
      success: true,
    };
  }

  /**
   * Update a property option by ID
   */
  async updatePropertyOption(
    id: string,
    option: Partial<ShopwarePropertyOption>
  ): Promise<ShopwareSyncResult> {
    this.log.info('Mock Shopware: Updating property option', { id });

    const updated = await this.prisma.mockShopwarePropertyOption.update({
      where: { id },
      data: {
        propertyGroupId: option.groupId,
        name: option.name,
        position: option.position,
        colorHexCode: option.colorHexCode,
        mediaId: option.mediaId,
        translations: option.translations as unknown as object,
        rawShopwareData: option as unknown as object,
      },
    });

    return {
      id: updated.id,
      productNumber: '', // Not applicable for property options
      action: 'update',
      success: true,
    };
  }

  /**
   * Get property option by ID
   */
  async getPropertyOptionById(id: string): Promise<ShopwarePropertyOption | null> {
    const option = await this.prisma.mockShopwarePropertyOption.findUnique({
      where: { id },
    });

    if (!option || option.tenantId !== this.tenantId) {
      return null;
    }

    return {
      id: option.id,
      groupId: option.propertyGroupId,
      name: option.name,
      position: option.position,
      colorHexCode: option.colorHexCode || undefined,
      mediaId: option.mediaId || undefined,
      translations: option.translations as Record<string, { name: string }>,
      _plentyAttributeId: option.plentyAttributeId || undefined,
      _plentyAttributeValueId: option.plentyAttributeValueId || undefined,
    };
  }

  /**
   * Check if property option exists
   */
  async propertyOptionExists(id: string): Promise<boolean> {
    const option = await this.prisma.mockShopwarePropertyOption.findUnique({
      where: { id },
    });

    return option !== null && option.tenantId === this.tenantId;
  }

  /**
   * Bulk sync property groups
   */
  async bulkSyncPropertyGroups(
    groups: ShopwarePropertyGroup[]
  ): Promise<ShopwareBulkSyncResult> {
    this.log.info('Mock Shopware: Bulk syncing property groups', { count: groups.length });

    const results: ShopwareBulkItemResult[] = [];

    for (const group of groups) {
      try {
        // Upsert pattern: if ID provided and exists, update; otherwise create
        if (group.id && (await this.propertyGroupExists(group.id))) {
          const result = await this.updatePropertyGroup(group.id, group);
          results.push({
            productNumber: '',
            shopwareId: result.id,
            action: 'update',
            success: result.success,
            error: result.error,
          });
        } else {
          const result = await this.createPropertyGroup(group);
          results.push({
            productNumber: '',
            shopwareId: result.id,
            action: 'create',
            success: result.success,
            error: result.error,
          });
        }
      } catch (error) {
        this.log.error('Mock Shopware: Failed to sync property group', {
          group: group.name,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          productNumber: '',
          shopwareId: group.id || '',
          action: 'create',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failedCount = results.filter((r) => !r.success).length;

    return {
      success: failedCount === 0,
      results,
    };
  }

  /**
   * Bulk sync property options
   */
  async bulkSyncPropertyOptions(
    options: ShopwarePropertyOption[]
  ): Promise<ShopwareBulkSyncResult> {
    this.log.info('Mock Shopware: Bulk syncing property options', { count: options.length });

    const results: ShopwareBulkItemResult[] = [];

    for (const option of options) {
      try {
        // Upsert pattern: if ID provided and exists, update; otherwise create
        if (option.id && (await this.propertyOptionExists(option.id))) {
          const result = await this.updatePropertyOption(option.id, option);
          results.push({
            productNumber: '',
            shopwareId: result.id,
            action: 'update',
            success: result.success,
            error: result.error,
          });
        } else {
          const result = await this.createPropertyOption(option);
          results.push({
            productNumber: '',
            shopwareId: result.id,
            action: 'create',
            success: result.success,
            error: result.error,
          });
        }
      } catch (error) {
        this.log.error('Mock Shopware: Failed to sync property option', {
          option: option.name,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          productNumber: '',
          shopwareId: option.id || '',
          action: 'create',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failedCount = results.filter((r) => !r.success).length;

    return {
      success: failedCount === 0,
      results,
    };
  }

  /**
   * Ensure the custom field set for Plenty connector exists
   * Mock implementation - just logs
   */
  async ensurePlentyCustomFieldSet(): Promise<void> {
    this.log.info('Mock Shopware: ensurePlentyCustomFieldSet called (no-op in mock)');
  }

  /**
   * Delete all products for this tenant (useful for testing)
   */
  async deleteAllProducts(): Promise<number> {
    const result = await this.prisma.mockShopwareProduct.deleteMany({
      where: { tenantId: this.tenantId },
    });
    this.log.info('Mock Shopware: Deleted all products', { count: result.count });
    return result.count;
  }

  /**
   * Get product count for this tenant
   */
  async getProductCount(): Promise<number> {
    return this.prisma.mockShopwareProduct.count({
      where: { tenantId: this.tenantId },
    });
  }
}
