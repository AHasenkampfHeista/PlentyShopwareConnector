import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { createLogger } from '../utils/logger';
import { IShopwareClient, MockShopwareClientConfig } from './interfaces';
import { ShopwareProduct, ShopwareStockUpdate, ShopwareSyncResult } from '../types/shopware';

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
   * Update stock for a product
   */
  async updateStock(sku: string, stock: number): Promise<ShopwareSyncResult> {
    try {
      this.log.debug('Mock Shopware: Updating stock', { sku, stock });

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
      const sku = update.productNumber || update.id;
      const result = await this.updateStock(sku, update.stock);
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
